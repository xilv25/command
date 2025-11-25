// index.js (restore /setup & command management; remove /htb slash)
// ENV expected (fill as needed):
// TOKEN, CLIENT_ID, (optional) GUILD_ID,
// CHANNEL_HTB_ID (optional), OWNER_ID, OWNER2_ID,
// RATING1_ROLE_ID, RATING2_ROLE_ID, RATING_STRIP_ROLE_IDS,
// ROLE_LHT_ID, ROLE_HELPER_ID, ROLE_PREMIUM_ID,
// CHANNEL_SUGGEST_ID, CHANNEL_BUGREPORT_ID

require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField
} = require("discord.js");
const express = require("express");

// keep-alive (optional)
const app = express();
app.get("/", (_, res) => res.send("Bot Alive ✅"));
app.listen(3000, () => console.log("Keep-alive running"));

// Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// Theme & assets
const THEME_COLOR = 0x58dca3;
const EMBED_COVER_URL = "https://cdn.discordapp.com/attachments/1407410043258798083/1442691419620905181/New_Project_228_9B39783.png?ex=69265a96&is=69250916&hm=47519585ec3b6c3a47bf3c578105a79928478600eb88fcc7cb07e0666f5cd003&";
const EMBED_THUMB_URL = "https://cdn.discordapp.com/attachments/1407410043258798083/1442699948238962810/IMG-20251125-WA0011.jpg?ex=69266287&is=69251107&hm=2dd1a59f6642711bede9a9cfd8d17e23f95894b9d95b8106720b604281f59c75&";
const THEME_DIVIDER = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

// In-memory stores
const guildSettings = new Map();    // guildId -> {reviewChannelId, reportChannelId, buyChannelId, buyMode,...}
const customCommands = new Map();   // guildId -> Map(cmdName -> {isi, backup})
const reviewDone = new Set();       // `${guildId}:${cmd}:${userId}`
const blacklist = new Set();        // `${guildId}:${userId}`
const pendingReviewReminder = new Map();
const ratingStats = new Map();      // guildId -> {counts: [c1..c5]}
const delayState = new Map();       // guildId -> state
const commandUsage = new Map();     // guildId -> count
const userCooldown = new Map();     // `${guildId}:${userId}` -> timestamp
const userCommandLevel = new Map(); // `${guildId}:${userId}` -> level
const rating1RoleBackup = new Map(); // `${guildId}:${userId}` -> [roleIds]
const buyActivity = new Map();

// Owner/staff states
let ownerStatus = null;
let owner2Status = null;
const staffAfk = new Map();

// Config / env
const PREFIX = "!";
const MAX_COMMANDS_BEFORE_DELAY = 7;
const DELAY_SECONDS = 5;
const USER_COOLDOWN_MS = 60_000;

const RATING1_ROLE_ID = process.env.RATING1_ROLE_ID || null;
const RATING2_ROLE_ID = process.env.RATING2_ROLE_ID || null;
const RATING_STRIP_ROLE_IDS = process.env.RATING_STRIP_ROLE_IDS ? process.env.RATING_STRIP_ROLE_IDS.split(",").map(s=>s.trim()).filter(Boolean) : [];
const OWNER_ID = process.env.OWNER_ID || null;
const OWNER2_ID = process.env.OWNER2_ID || null;
const ROLE_LHT_ID = process.env.ROLE_LHT_ID || null;
const ROLE_HELPER_ID = process.env.ROLE_HELPER_ID || null;
const ROLE_PREMIUM_ID = process.env.ROLE_PREMIUM_ID || null;
const CHANNEL_SUGGEST_ID = process.env.CHANNEL_SUGGEST_ID || null;
const CHANNEL_BUGREPORT_ID = process.env.CHANNEL_BUGREPORT_ID || null;
const CHANNEL_HTB_ID = process.env.CHANNEL_HTB_ID || "1428613011513278486";

// safety global handlers
process.on('unhandledRejection', (r,p) => console.warn("UnhandledRejection", r));
process.on('uncaughtException', e => console.error("UncaughtException", e));

// helpers
function aestheticEmbed(payload = {}, opt = {}) {
  const e = new EmbedBuilder();
  if (payload.title) e.setTitle(payload.title);
  if (payload.description) e.setDescription(payload.description);
  if (payload.fields) e.addFields(payload.fields);
  e.setColor(opt.color || THEME_COLOR);
  e.setThumbnail(EMBED_THUMB_URL);
  e.setFooter({ text: payload.footer || `${THEME_DIVIDER} • LimeHub` });
  e.setTimestamp();
  return e;
}
function trimForField(text) { if (!text) return "–"; if (text.length > 1000) return text.slice(0,997) + "..."; return text; }
function parseDurationToMs(str) {
  if (!str || typeof str !== "string") return 0;
  const m = str.trim().toLowerCase().match(/^(\d+)(s|m|h|d)$/);
  if (!m) return 0;
  const n = parseInt(m[1],10);
  switch (m[2]) { case "s": return n*1000; case "m": return n*60*1000; case "h": return n*3600*1000; case "d": return n*86400*1000; default: return 0; }
}
function addRating(guildId, rating) {
  let s = ratingStats.get(guildId); if (!s) s = { counts: [0,0,0,0,0] };
  s.counts[rating-1] = (s.counts[rating-1]||0) + 1; ratingStats.set(guildId, s);
}

// update stats embed
async function updateStatsMessage(guildId) {
  const settings = guildSettings.get(guildId); if (!settings || !settings.statsChannelId) return;
  const stats = ratingStats.get(guildId); if (!stats) return;
  const counts = stats.counts; const total = counts.reduce((a,b)=>a+b,0); if (!total) return;
  const sum = counts.reduce((acc,c,idx)=>acc + c*(idx+1),0); const avg = sum/total; const pct = (avg/5)*100;
  const segments = 12; const filled = Math.round((pct/100)*segments); const bar = "▰".repeat(filled) + "▱".repeat(Math.max(0,segments-filled));
  const avgStars = "⭐".repeat(Math.round(avg));
  const embed = aestheticEmbed({
    title: "Statistik Review Server",
    description: "Ringkasan rating dari review member.",
    fields: [
      { name: "Rata-rata", value: `${avg.toFixed(2)} / 5 ${avgStars ? `(${avgStars})` : ""}`, inline: false },
      { name: "Total Persentase", value: `${pct.toFixed(1)}%`, inline: true },
      { name: "Progress", value: bar, inline: false }
    ]
  });
  try {
    const ch = await client.channels.fetch(settings.statsChannelId).catch(()=>null);
    if (!ch || !ch.isTextBased()) return;
    if (settings.statsMessageId) {
      const msg = await ch.messages.fetch(settings.statsMessageId).catch(()=>null);
      if (msg) { await msg.edit({ embeds: [embed] }).catch(()=>{}); return; }
    }
    const m = await ch.send({ embeds: [embed] }).catch(()=>null);
    if (m) { settings.statsMessageId = m.id; guildSettings.set(guildId, settings); }
  } catch (err) { console.error("updateStatsMessage err:", err); }
}

// send blocked DM (rating 1)
async function sendBlockedDM(user, guildId) {
  const settings = guildSettings.get(guildId); const reportChannelId = settings?.reportChannelId; const reportUrl = reportChannelId ? `https://discord.com/channels/${guildId}/${reportChannelId}` : null;
  const embed = aestheticEmbed({ title: "Akses Command Ditangguhkan", description: "Kamu sementara tidak bisa memakai command.\nSilakan jelaskan masalahmu di channel report server, staff akan bantu." }, { color: 0xff5555 });
  const comps = []; if (reportUrl) comps.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Buka Channel Report").setStyle(ButtonStyle.Link).setURL(reportUrl)));
  try { const dm = await user.createDM(); await dm.send({ embeds: [embed], components: comps }).catch(()=>{}); } catch (e) { console.error("sendBlockedDM err:", e); }
}

// HTB embed maker
async function makeBuyEmbed(guildId) {
  const settings = guildSettings.get(guildId) || {};
  const htbChannelId = CHANNEL_HTB_ID;
  const htbUrl = `https://discord.com/channels/${guildId}/${htbChannelId}`;
  const reportUrl = settings?.reportChannelId ? `https://discord.com/channels/${guildId}/${settings.reportChannelId}` : null;
  const embed = new EmbedBuilder()
    .setTitle("✨ How to buy — LimeHub Script")
    .setColor(THEME_COLOR)
    .setDescription("Panduan langkah demi langkah untuk membeli script LimeHub. Klik **Buy** untuk membuka panduan lengkap di channel How-to-buy.")
    .setThumbnail(EMBED_THUMB_URL)
    .setImage(EMBED_COVER_URL)
    .addFields(
      { name: "Price", value: "**Rp 40.000,00**", inline: true },
      { name: "Delivery", value: "Instant / After Payment", inline: true },
      { name: "\u200B", value: "\u200B", inline: false },
      { name: "Steps", value: "1) Klik Buy → buka channel How-to-buy.\n2) Ikuti instruksi pembayaran.\n3) Lakukan pembayaran.\n4) Staff ticket akan mengkonfirmasi pembayaran.", inline: false }
    )
    .setFooter({ text: `${THEME_DIVIDER} • Need help? Use Report`, iconURL: EMBED_THUMB_URL })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Buy — How to buy").setStyle(ButtonStyle.Link).setURL(htbUrl));
  return { embed, components: [row] };
}

// ensureBuyEmbed: delete old & send new
async function ensureBuyEmbed(guildId) {
  const settings = guildSettings.get(guildId); if (!settings || !settings.buyChannelId) return;
  const ch = await client.channels.fetch(settings.buyChannelId).catch(()=>null); if (!ch || !ch.isTextBased()) return;
  const buyData = await makeBuyEmbed(guildId); if (!buyData) return;
  if (settings.buyMessageId) {
    const old = await ch.messages.fetch(settings.buyMessageId).catch(()=>null);
    if (old) { await old.delete().catch(()=>{}); settings.buyMessageId = null; guildSettings.set(guildId, settings); }
  }
  const m = await ch.send({ embeds: [buyData.embed], components: buyData.components }).catch(err => { console.error("send buy embed err:", err); return null; });
  if (m) { settings.buyMessageId = m.id; guildSettings.set(guildId, settings); }
}

// start intervals for buy (auto/timer)
function startBuyIntervalsIfNeeded(guildId) {
  const settings = guildSettings.get(guildId); if (!settings || !settings.buyChannelId) return;
  if (settings._buyTimerInterval) { clearInterval(settings._buyTimerInterval); delete settings._buyTimerInterval; }
  if (settings._buyAutoInterval) { clearInterval(settings._buyAutoInterval); delete settings._buyAutoInterval; }
  if (settings.buyMode === "timer" && settings.buyTimerMs && settings.buyTimerMs > 0) {
    settings._buyTimerInterval = setInterval(() => ensureBuyEmbed(guildId).catch(()=>{}), settings.buyTimerMs);
  } else if (settings.buyMode === "auto" && settings.buyAutoSeconds && settings.buyAutoSeconds > 0) {
    settings._buyAutoInterval = setInterval(() => ensureBuyEmbed(guildId).catch(()=>{}), settings.buyAutoSeconds*1000);
  } else {
    settings._buyMessageCounter = settings._buyMessageCounter || 0;
  }
  guildSettings.set(guildId, settings);
}

// Delay protection message
async function startDelayForGuild(guildId, channel, triggeredByUser) {
  let state = delayState.get(guildId);
  if (state && state.active) return;
  const endTime = Date.now() + DELAY_SECONDS*1000;
  state = { active: true, endTime, channelId: channel.id, messageId: null, intervalId: null };
  delayState.set(guildId, state);
  const makeEmbed = sec => aestheticEmbed({ title: "Delay Proteksi Server", description: "Banyak member yang memakai command bersamaan, jadi bot istirahat sebentar.\n" + `Command bisa dipakai lagi dalam **${sec} detik**.` }, { color: 0xffaa00 });
  const msg = await channel.send({ embeds: [makeEmbed(DELAY_SECONDS)] }).catch(()=>null);
  if (!msg) { delayState.set(guildId, { active: false }); return; }
  state.messageId = msg.id; delayState.set(guildId, state);
  const iv = setInterval(async () => {
    const st = delayState.get(guildId); if (!st || !st.active) return;
    const now = Date.now(); const remainingMs = st.endTime - now;
    if (remainingMs <= 0) {
      clearInterval(st.intervalId);
      try { const ch = await client.channels.fetch(st.channelId).catch(()=>null); if (ch && ch.isTextBased()) { const m = await ch.messages.fetch(st.messageId).catch(()=>null); if (m) await m.delete().catch(()=>{}); } } catch(e) { console.error("delete delay embed err:", e); }
      delayState.set(guildId, { active: false }); commandUsage.set(guildId, 0);
      return;
    }
    const remaining = Math.ceil(remainingMs/1000);
    try {
      const ch = await client.channels.fetch(st.channelId).catch(()=>null); if (!ch || !ch.isTextBased()) return;
      const m = await ch.messages.fetch(st.messageId).catch(()=>null); if (!m) return;
      await m.edit({ embeds: [makeEmbed(remaining)] }).catch(()=>{});
    } catch(e) { console.error("update delay embed err:", e); }
  }, 1000);
  state.intervalId = iv; delayState.set(guildId, state);
}

// Slash command registration (setup includes "channel" + "howto" + "command create/list/remove")
async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  const commands = [];

  const setup = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup bot")
    .addSubcommand(sub => sub.setName("channel").setDescription("Set review/report/buy/stats channels")
      .addChannelOption(o => o.setName("review").setDescription("Review channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(o => o.setName("report").setDescription("Report channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption(o => o.setName("buy").setDescription("Buy channel (optional)").addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addChannelOption(o => o.setName("stats").setDescription("Stats channel (optional)").addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand(sub => sub.setName("howto").setDescription("Setup How-to-buy behavior (HTB)")
      .addChannelOption(o => o.setName("channel").setDescription("HTB channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName("mode").setDescription("Mode: auto/detect/timer").setRequired(true)
        .addChoices({ name: "auto", value: "auto" }, { name: "detect", value: "detect" }, { name: "timer", value: "timer" }))
      .addIntegerOption(o => o.setName("detect_count").setDescription("Detect count for detect mode").setRequired(false))
      .addStringOption(o => o.setName("timer").setDescription("Timer (ex: 15s, 1m)").setRequired(false))
      .addIntegerOption(o => o.setName("auto_seconds").setDescription("Auto seconds for auto mode").setRequired(false)))
    .addSubcommand(sub => sub.setName("command").setDescription("Create a prefix command")
      .addStringOption(o => o.setName("name").setDescription("Command name (without !)").setRequired(true))
      .addStringOption(o => o.setName("isi").setDescription("Main content to DM").setRequired(true))
      .addStringOption(o => o.setName("backup").setDescription("Backup content to send when 'doesn't work' clicked").setRequired(false)));

  const cmd = new SlashCommandBuilder()
    .setName("command")
    .setDescription("Manage stored prefix commands")
    .addSubcommand(s => s.setName("list").setDescription("List commands"))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a command").addStringOption(o => o.setName("name").setDescription("Command name").setRequired(true)));

  commands.push(setup, cmd);

  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands.map(c=>c.toJSON()) });
      console.log("Registered guild slash commands");
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands.map(c=>c.toJSON()) });
      console.log("Registered global slash commands");
    }
  } catch (err) { console.error("register slash err:", err); }
}

// ready
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerSlashCommands().catch(()=>{});
  // restart buy intervals if settings stored
  for (const [gid, s] of guildSettings.entries()) startBuyIntervalsIfNeeded(gid);
});

// messageCreate: main logic (HTB detect, owner/staff mention replies, dot commands, prefix commands)
client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;
    const guildId = message.guildId;
    const content = message.content || "";
    const contentLower = content.trim().toLowerCase();

    // HTB detect mode
    const s = guildSettings.get(guildId);
    if (s && s.buyChannelId && message.channel.id === s.buyChannelId && !message.author.bot) {
      const mode = s.buyMode || "detect";
      if (mode === "detect") {
        s._buyMessageCounter = (s._buyMessageCounter||0) + 1; guildSettings.set(guildId, s);
        const threshold = s.buyDetectCount || 15;
        if (s._buyMessageCounter >= threshold) { await ensureBuyEmbed(guildId).catch(e=>console.error("ensureBuyEmbed detect err:", e)); s._buyMessageCounter = 0; guildSettings.set(guildId, s); }
      }
    }

    // mentions -> owner/staff auto reply
    if (message.mentions && message.mentions.users.size > 0) {
      if (OWNER_ID && ownerStatus && message.mentions.users.has(OWNER_ID) && message.author.id !== OWNER_ID) {
        const desc = ownerStatus === "sibuk" ? `Maaf, <@${OWNER_ID}> sedang sibuk.` : ownerStatus === "slow" ? `Mohon bersabar. <@${OWNER_ID}> sedang slow respon.` : `Maaf, <@${OWNER_ID}> sedang offline.`;
        await message.channel.send({ embeds: [aestheticEmbed({ description: desc })] }).catch(()=>{});
      }
      if (OWNER2_ID && owner2Status && message.mentions.users.has(OWNER2_ID) && message.author.id !== OWNER2_ID) {
        const desc = owner2Status === "sibuk" ? `Maaf, <@${OWNER2_ID}> sedang sibuk.` : owner2Status === "slow" ? `Mohon bersabar. <@${OWNER2_ID}> sedang slow respon.` : `Maaf, <@${OWNER2_ID}> sedang offline.`;
        await message.channel.send({ embeds: [aestheticEmbed({ description: desc })] }).catch(()=>{});
      }
      for (const [uid, st] of staffAfk.entries()) if (st === "off" && message.mentions.users.has(uid) && message.author.id !== uid) await message.channel.send({ embeds: [aestheticEmbed({ description: `Maaf, <@${uid}> sedang offline.` })] }).catch(()=>{});
    }

    // dot prefix commands (admin via reply)
    if (contentLower.startsWith(".")) {
      const [dotCmd] = contentLower.split(/\s+/);
      if (message.reference && [".clear", ".mute", ".blacklist", ".kick", ".ban"].includes(dotCmd)) {
        const mem = message.member; if (!mem) return;
        if (!(mem.permissions.has(PermissionsBitField.Flags.Administrator) || mem.permissions.has(PermissionsBitField.Flags.ManageGuild) || mem.permissions.has(PermissionsBitField.Flags.ManageMessages))) return;
        const replied = await message.channel.messages.fetch(message.reference.messageId).catch(()=>null); if (!replied) return;
        // kick/ban
        if ([".kick",".ban"].includes(dotCmd)) {
          const targetId = replied.author.id; const targetMember = await message.guild.members.fetch(targetId).catch(()=>null);
          if (!targetMember) return message.reply("User tidak ditemukan.");
          if (dotCmd === ".kick") { if (!(mem.permissions.has(PermissionsBitField.Flags.KickMembers) || mem.permissions.has(PermissionsBitField.Flags.Administrator))) return message.reply("No permission"); try { await targetMember.kick(`Kick by ${message.author.tag}`); await message.reply({ embeds: [aestheticEmbed({ description: `👢 ${replied.author} di-kick oleh ${message.author}.` })] }).catch(()=>{});} catch(e){console.error(e); message.reply("Kick failed"); } return; }
          if (dotCmd === ".ban") { if (!(mem.permissions.has(PermissionsBitField.Flags.BanMembers) || mem.permissions.has(PermissionsBitField.Flags.Administrator))) return message.reply("No permission"); try { await message.guild.bans.create(targetId, { reason: `Banned by ${message.author.tag}` }); await message.reply({ embeds: [aestheticEmbed({ description: `⛔ ${replied.author} di-ban oleh ${message.author}.` })] }).catch(()=>{});} catch(e){console.error(e); message.reply("Ban failed"); } return; }
        }
        // clear
        if (dotCmd === ".clear") {
          const targetId = replied.author.id; blacklist.delete(`${guildId}:${targetId}`);
          const tm = await message.guild.members.fetch(targetId).catch(()=>null);
          if (tm) {
            const bakKey = `${guildId}:${targetId}`; const toRestore = rating1RoleBackup.get(bakKey);
            if (toRestore && toRestore.length) { await tm.roles.add(toRestore).catch(()=>{}); rating1RoleBackup.delete(bakKey); }
            if (RATING1_ROLE_ID && tm.roles.cache.has(RATING1_ROLE_ID)) await tm.roles.remove(RATING1_ROLE_ID).catch(()=>{});
            if (RATING2_ROLE_ID && tm.roles.cache.has(RATING2_ROLE_ID)) await tm.roles.remove(RATING2_ROLE_ID).catch(()=>{});
          }
          await message.reply({ embeds: [aestheticEmbed({ description: `✅ ${replied.author} sudah di-clear.` })] }).catch(()=>{});
          return;
        }
        // mute
        if (dotCmd === ".mute") {
          if (!RATING2_ROLE_ID) { await message.reply({ content: "RATING2_ROLE_ID belum diset." }); return; }
          const targetId = replied.author.id; const tm = await message.guild.members.fetch(targetId).catch(()=>null);
          if (!tm) return;
          if (!tm.roles.cache.has(RATING2_ROLE_ID)) await tm.roles.add(RATING2_ROLE_ID).catch(()=>{});
          await message.reply({ embeds: [aestheticEmbed({ description: `🔇 ${replied.author} diberi mute.` })] }).catch(()=>{});
          return;
        }
        // blacklist
        if (dotCmd === ".blacklist") {
          const targetId = replied.author.id; blacklist.add(`${guildId}:${targetId}`);
          const tm = await message.guild.members.fetch(targetId).catch(()=>null);
          if (tm) {
            const toRemove = tm.roles.cache.filter(r=>RATING_STRIP_ROLE_IDS.includes(r.id)).map(r=>r.id);
            if (toRemove.length) { rating1RoleBackup.set(`${guildId}:${targetId}`, toRemove); await tm.roles.remove(toRemove).catch(()=>{}); }
            if (RATING1_ROLE_ID && !tm.roles.cache.has(RATING1_ROLE_ID)) await tm.roles.add(RATING1_ROLE_ID).catch(()=>{});
          }
          await message.reply({ embeds: [aestheticEmbed({ description: `⛔ ${replied.author} di-blacklist.` })] }).catch(()=>{});
          return;
        }
      }

      // owner commands shortcuts
      if (OWNER_ID && message.author.id === OWNER_ID) {
        if (contentLower === ".lht" && ROLE_LHT_ID) { await message.channel.send({ content: `<@&${ROLE_LHT_ID}>` }).catch(()=>{}); return; }
        if (contentLower === ".hlp" && ROLE_HELPER_ID) { await message.channel.send({ content: `<@&${ROLE_HELPER_ID}>` }).catch(()=>{}); return; }
        if (contentLower === ".hidetag" && ROLE_PREMIUM_ID) { const m = await message.channel.send({ content: `<@&${ROLE_PREMIUM_ID}>` }).catch(()=>null); if (m) setTimeout(()=>m.delete().catch(()=>{}),3000); message.delete().catch(()=>{}); return; }
        if (contentLower === ".sibuk") { ownerStatus = "sibuk"; await message.reply({ embeds: [aestheticEmbed({ description: "Status: sibuk" })] }).catch(()=>{}); return; }
        if (contentLower === ".slow") { ownerStatus = "slow"; await message.reply({ embeds: [aestheticEmbed({ description: "Status: slow" })] }).catch(()=>{}); return; }
        if (contentLower === ".off") { ownerStatus = "off"; await message.reply({ embeds: [aestheticEmbed({ description: "Status: off" })] }).catch(()=>{}); return; }
        if (contentLower === ".on") { ownerStatus = null; await message.reply({ embeds: [aestheticEmbed({ description: "Status reset" })] }).catch(()=>{}); return; }
      }
      if (OWNER2_ID && message.author.id === OWNER2_ID) {
        if (contentLower === ".sibuk") { owner2Status = "sibuk"; await message.reply({ embeds: [aestheticEmbed({ description: "Status: sibuk" })] }).catch(()=>{}); return; }
        if (contentLower === ".slow") { owner2Status = "slow"; await message.reply({ embeds: [aestheticEmbed({ description: "Status: slow" })] }).catch(()=>{}); return; }
        if (contentLower === ".off") { owner2Status = "off"; await message.reply({ embeds: [aestheticEmbed({ description: "Status: off" })] }).catch(()=>{}); return; }
        if (contentLower === ".on") { owner2Status = null; await message.reply({ embeds: [aestheticEmbed({ description: "Status reset" })] }).catch(()=>{}); return; }
      }

      // staff small commands .suggest .bugreport .off .on
      if ([".suggest",".bugreport",".off",".on"].includes(contentLower.split(/\s+/)[0])) {
        const mem = message.member; if (!mem) return;
        if (!(mem.permissions.has(PermissionsBitField.Flags.Administrator) || mem.permissions.has(PermissionsBitField.Flags.ManageGuild) || mem.permissions.has(PermissionsBitField.Flags.ManageMessages))) return;
        if (contentLower === ".suggest" && CHANNEL_SUGGEST_ID) { await message.reply({ embeds: [aestheticEmbed({ title: "Suggest", description: `Silakan post di <#${CHANNEL_SUGGEST_ID}>` })] }).catch(()=>{}); return; }
        if (contentLower === ".bugreport" && CHANNEL_BUGREPORT_ID) { await message.reply({ embeds: [aestheticEmbed({ title: "Bugreport", description: `Silakan laporkan di <#${CHANNEL_BUGREPORT_ID}>` })] }).catch(()=>{}); return; }
        if (contentLower === ".off") { staffAfk.set(message.author.id, "off"); await message.reply({ embeds: [aestheticEmbed({ description: "Status staff: offline" })] }).catch(()=>{}); return; }
        if (contentLower === ".on") { staffAfk.delete(message.author.id); await message.reply({ embeds: [aestheticEmbed({ description: "Status staff: on" })] }).catch(()=>{}); return; }
      }
    }

    // PREFIX commands (!)
    if (!content.startsWith(PREFIX)) return;
    const parts = content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = parts.shift()?.toLowerCase(); if (!cmd) return;

    // delay check
    const d = delayState.get(guildId); if (d && d.active) return;

    // user cooldown (level affects)
    const keyUser = `${guildId}:${message.author.id}`; const now = Date.now();
    const level = userCommandLevel.get(keyUser) || 0; const baseCooldown = level === 3 ? 5*60_000 : USER_COOLDOWN_MS;
    const last = userCooldown.get(keyUser) || 0; if (now - last < baseCooldown) return; userCooldown.set(keyUser, now);

    // blacklist
    if (blacklist.has(`${guildId}:${message.author.id}`)) { await sendBlockedDM(message.author, guildId); return; }

    const guildCmds = customCommands.get(guildId); if (!guildCmds) return;
    const cmdData = guildCmds.get(cmd); if (!cmdData) return;

    // usage for delay
    let count = commandUsage.get(guildId) || 0; count += 1; commandUsage.set(guildId,count);
    if (count > MAX_COMMANDS_BEFORE_DELAY) { await startDelayForGuild(guildId, message.channel, message.author); return; }

    // send DM with two buttons
    const dmEmbed = new EmbedBuilder().setTitle("Informasi untuk Kamu").setColor(THEME_COLOR).setThumbnail(EMBED_THUMB_URL).setDescription(cmdData.isi).setFooter({ text: THEME_DIVIDER + " • LimeHub" }).setTimestamp();
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cmd_work:${guildId}:${cmd}`).setLabel("Work").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`cmd_fail:${guildId}:${cmd}`).setLabel("Doesn't work").setStyle(ButtonStyle.Danger));
    try {
      const dm = await message.author.createDM();
      await dm.send({ embeds: [dmEmbed], components: [row] }).catch(()=>{});
      const reminderKey = `${guildId}:${message.author.id}:${cmd}`;
      if (pendingReviewReminder.has(reminderKey)) { clearTimeout(pendingReviewReminder.get(reminderKey)); pendingReviewReminder.delete(reminderKey); }
      const t = setTimeout(async () => { pendingReviewReminder.delete(reminderKey); try { const dm2 = await message.author.createDM(); const remEmb = aestheticEmbed({ title: "Bantu Kami Dengan Review 💚", description: "Jika command membantu, klik Work di DM lalu isi formulir." }); await dm2.send({ embeds: [remEmb] }).catch(()=>{}); } catch(e){} }, 60_000);
      pendingReviewReminder.set(reminderKey, t);

      // confirmation ephemeral-like with countdown
      let rem = 3; let confEmb = aestheticEmbed({ description: `✅ ${message.author}, cek DM kamu ya. Embed sudah dikirim.\n(Hilang dalam ${rem} detik)` });
      const confMsg = await message.reply({ embeds: [confEmb] }).catch(()=>null);
      if (!confMsg) return;
      const iv = setInterval(async () => { rem--; if (rem<=0) { clearInterval(iv); confMsg.delete().catch(()=>{}); return; } confEmb = aestheticEmbed({ description: `✅ ${message.author}, cek DM kamu ya. Embed sudah dikirim.\n(Hilang dalam ${rem} detik)` }); confMsg.edit({ embeds: [confEmb] }).catch(()=>{}); }, 1000);
    } catch (e) { console.error("send DM err:", e); await message.reply({ content: "❌ Gagal kirim DM. Pastikan DM terbuka.", allowedMentions: { repliedUser: false } }).catch(()=>{}); }
  } catch (err) { console.error("messageCreate top err:", err); }
});

// interactionCreate
client.on("interactionCreate", async interaction => {
  try {
    // Slash
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      if (name === "setup") {
        const sub = interaction.options.getSubcommand();
        if (sub === "channel") {
          const review = interaction.options.getChannel("review", true);
          const report = interaction.options.getChannel("report", true);
          const buy = interaction.options.getChannel("buy", false) || null;
          const stats = interaction.options.getChannel("stats", false) || null;
          const settings = guildSettings.get(interaction.guildId) || {};
          settings.reviewChannelId = review.id; settings.reportChannelId = report.id;
          if (buy) settings.buyChannelId = buy.id;
          if (stats) settings.statsChannelId = stats.id;
          guildSettings.set(interaction.guildId, settings);
          await interaction.reply({ embeds: [aestheticEmbed({ title: "Setup Channel ✅", description: "Channels saved.", fields: [{ name: "Review", value: `<#${review.id}>`, inline: true }, { name: "Report", value: `<#${report.id}>`, inline: true }, ...(buy?[{ name: "Buy", value: `<#${buy.id}>`, inline: true }]:[]), ...(stats?[{ name: "Stats", value: `<#${stats.id}>`, inline: true }]:[]) ] })], ephemeral: true });
          if (settings.buyChannelId) { await ensureBuyEmbed(interaction.guildId).catch(()=>{}); startBuyIntervalsIfNeeded(interaction.guildId); }
          return;
        }
        if (sub === "howto") {
          const channel = interaction.options.getChannel("channel", true);
          const mode = interaction.options.getString("mode", true);
          const detectCount = interaction.options.getInteger("detect_count", false) || 0;
          const timerStr = interaction.options.getString("timer", false) || null;
          const autoSeconds = interaction.options.getInteger("auto_seconds", false) || 0;
          const settings = guildSettings.get(interaction.guildId) || {};
          settings.buyChannelId = channel.id; settings.buyMode = mode;
          if (mode === "detect") { settings.buyDetectCount = detectCount > 0 ? detectCount : 15; settings._buyMessageCounter = 0; }
          else if (mode === "timer") { const ms = parseDurationToMs(timerStr) || (autoSeconds>0?autoSeconds*1000:60000); settings.buyTimerMs = ms; }
          else if (mode === "auto") { settings.buyAutoSeconds = autoSeconds > 0 ? autoSeconds : 30; }
          guildSettings.set(interaction.guildId, settings);
          await ensureBuyEmbed(interaction.guildId).catch(()=>{});
          startBuyIntervalsIfNeeded(interaction.guildId);
          await interaction.reply({ embeds: [aestheticEmbed({ title: "HTB Setup", description: `Channel: <#${channel.id}>\nMode: **${mode}**`, fields: [ ...(mode==="detect"?[{ name: "Detect Count", value: `${settings.buyDetectCount}`, inline: true }]:[]), ...(mode==="timer"?[{ name: "Timer (ms)", value: `${settings.buyTimerMs}`, inline: true }]:[]), ...(mode==="auto"?[{ name: "Auto Seconds", value: `${settings.buyAutoSeconds}`, inline: true }]:[]) ] })], ephemeral: true });
          return;
        }
        if (sub === "command") {
          // create prefix command
          const nameCmd = interaction.options.getString("name", true).toLowerCase().trim();
          const isi = interaction.options.getString("isi", true);
          const backup = interaction.options.getString("backup", false) || "Tidak ada backup.";
          let gcmd = customCommands.get(interaction.guildId);
          if (!gcmd) { gcmd = new Map(); customCommands.set(interaction.guildId, gcmd); }
          gcmd.set(nameCmd, { isi, backup });
          await interaction.reply({ embeds: [aestheticEmbed({ title: "Command Saved ✅", description: `\`!${nameCmd}\` berhasil disimpan.`, fields: [{ name: "Isi", value: trimForField(isi), inline: false }, { name: "Backup", value: trimForField(backup), inline: false }] })], ephemeral: true });
          return;
        }
      }

      if (name === "command") {
        const sub = interaction.options.getSubcommand();
        if (sub === "list") {
          const gcmd = customCommands.get(interaction.guildId);
          if (!gcmd || gcmd.size === 0) return interaction.reply({ content: "Belum ada command terdaftar.", ephemeral: true });
          const list = [...gcmd.keys()].map(k=>`• \`!${k}\``).join("\n");
          return interaction.reply({ embeds: [aestheticEmbed({ title: "Daftar Command", description: list })], ephemeral: true });
        }
        if (sub === "remove") {
          const nameCmd = interaction.options.getString("name", true).toLowerCase().trim();
          const gcmd = customCommands.get(interaction.guildId);
          if (!gcmd || !gcmd.has(nameCmd)) return interaction.reply({ content: "Command tidak ditemukan.", ephemeral: true });
          gcmd.delete(nameCmd);
          return interaction.reply({ embeds: [aestheticEmbed({ title: "Command Dihapus", description: `\`!${nameCmd}\` telah dihapus.` })], ephemeral: true });
        }
      }
    }

    // Button interactions
    if (interaction.isButton()) {
      const parts = interaction.customId.split(":"); const type = parts[0];
      if (type === "cmd_work") {
        const guildId = parts[1]; const cmdName = parts[2];
        if (blacklist.has(`${guildId}:${interaction.user.id}`)) { await sendBlockedDM(interaction.user, guildId); return interaction.reply({ content: "Kamu dibatasi, buka report.", ephemeral: true }); }
        if (reviewDone.has(`${guildId}:${cmdName}:${interaction.user.id}`)) return interaction.reply({ content: "Sudah isi review.", ephemeral: true });
        const emb = aestheticEmbed({ title: "Form Review", description: "Klik 'Isi formulir' untuk membuka form." });
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`review_open:${guildId}:${cmdName}`).setLabel("Isi formulir").setStyle(ButtonStyle.Primary));
        await interaction.reply({ embeds: [emb], components: [row], ephemeral: true }); return;
      }
      if (type === "review_open") {
        const guildId = parts[1]; const cmdName = parts[2];
        if (blacklist.has(`${guildId}:${interaction.user.id}`)) { await sendBlockedDM(interaction.user, guildId); return interaction.reply({ content: "Kamu dibatasi, buka report.", ephemeral: true }); }
        if (reviewDone.has(`${guildId}:${cmdName}:${interaction.user.id}`)) return interaction.reply({ content: "Sudah isi review.", ephemeral: true });
        // safe edit original DM message: may be deleted; ignore errors
        try {
          if (interaction.message && interaction.message.id) {
            const ch = await client.channels.fetch(interaction.message.channelId).catch(()=>null);
            if (ch && ch.isTextBased()) {
              const msg = await ch.messages.fetch(interaction.message.id).catch(()=>null);
              if (msg && msg.editable) {
                const origRow = msg.components[0];
                if (origRow && origRow.components) {
                  const newComps = origRow.components.map(btn => {
                    try { const nb = ButtonBuilder.from(btn); if (btn.customId === interaction.customId) nb.setDisabled(true); return nb; } catch(e) { if (btn.customId===interaction.customId) btn.setDisabled(true); return btn; }
                  });
                  await msg.edit({ components: [new ActionRowBuilder().addComponents(newComps)] }).catch(()=>{});
                }
              }
            }
          }
        } catch (e) { console.debug("edit original DM failed:", e?.message || e); }
        // show modal
        const modal = new ModalBuilder().setCustomId(`review_modal:${guildId}:${cmdName}`).setTitle("Form Review");
        const ratingInput = new TextInputBuilder().setCustomId("rating").setLabel("Rating (1-5)").setStyle(TextInputStyle.Short).setPlaceholder("1-5").setRequired(true);
        const notesInput = new TextInputBuilder().setCustomId("notes").setLabel("Catatan").setStyle(TextInputStyle.Paragraph).setPlaceholder("Opsional").setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(ratingInput), new ActionRowBuilder().addComponents(notesInput));
        await interaction.showModal(modal); return;
      }
      if (type === "cmd_fail") {
        const guildId = parts[1]; const cmdName = parts[2];
        if (blacklist.has(`${guildId}:${interaction.user.id}`)) { await sendBlockedDM(interaction.user, guildId); return interaction.reply({ content: "Kamu dibatasi, buka report.", ephemeral: true }); }
        const gcmd = customCommands.get(guildId); const data = gcmd?.get(cmdName);
        if (!data) return interaction.reply({ content: "Command data missing.", ephemeral: true });
        const emb = aestheticEmbed({ title: "Informasi Backup", description: data.backup || "Tidak ada backup." });
        await interaction.reply({ embeds: [emb], ephemeral: true }); return;
      }
    }

  // Modal submit (review)
    if (interaction.isModalSubmit()) {
      const [type, guildId, cmdName] = interaction.customId.split(":");
      if (type !== "review_modal") return;
      await interaction.deferReply({ ephemeral: true });
      const ratingStr = interaction.fields.getTextInputValue("rating").trim();
      const notes = (interaction.fields.getTextInputValue("notes") || "").trim() || "Tidak ada catatan.";
      const rating = parseInt(ratingStr,10);
      if (isNaN(rating) || rating < 1 || rating > 5) { await interaction.editReply({ content: "Rating harus angka 1 sampai 5." }); return; }
      const settings = guildSettings.get(guildId); if (!settings || !settings.reviewChannelId) { await interaction.editReply({ content: "Review channel belum diset." }); return; }
      const guild = await client.guilds.fetch(guildId).catch(()=>null); if (!guild) { await interaction.editReply({ content: "Gagal temukan server." }); return; }
      const rCh = await guild.channels.fetch(settings.reviewChannelId).catch(()=>null); if (!rCh || !rCh.isTextBased()) { await interaction.editReply({ content: "Review channel invalid." }); return; }
      const stars = "⭐".repeat(rating);
      const revEmb = aestheticEmbed({ title: "Ulasan Baru", fields: [{ name: "User", value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: false }, { name: "Command", value: `!${cmdName}`, inline: true }, { name: "Rating", value: stars, inline: true }, { name: "Review", value: notes, inline: false }] });
      await rCh.send({ embeds: [revEmb] }).catch(()=>{});
      addRating(guildId, rating); await updateStatsMessage(guildId);
      reviewDone.add(`${guildId}:${cmdName}:${interaction.user.id}`);

      const reportUrl = settings.reportChannelId ? `https://discord.com/channels/${guildId}/${settings.reportChannelId}` : null;
      if (rating === 1) {
        blacklist.add(`${guildId}:${interaction.user.id}`);
        try {
          const member = await guild.members.fetch(interaction.user.id).catch(()=>null);
          if (member) {
            const toRemove = member.roles.cache.filter(r=>RATING_STRIP_ROLE_IDS.includes(r.id)).map(r=>r.id);
            if (toRemove.length) { rating1RoleBackup.set(`${guildId}:${interaction.user.id}`, toRemove); await member.roles.remove(toRemove).catch(()=>{}); }
            if (RATING1_ROLE_ID && !member.roles.cache.has(RATING1_ROLE_ID)) await member.roles.add(RATING1_ROLE_ID).catch(()=>{});
          }
        } catch(e){ console.error("rating1 role err:", e); }
        if (settings.reportChannelId) { const rc = await guild.channels.fetch(settings.reportChannelId).catch(()=>null); if (rc && rc.isTextBased()) rc.send({ content: `${interaction.user}`, embeds: [aestheticEmbed({ title: "Laporan Diperlukan (1⭐)", description: "User memberi rating 1. Mohon bantu tindak lanjut." })] }).catch(()=>{}); }
        const dm = aestheticEmbed({ title: "Kamu memberikan rating 1 ⭐", description: "Untuk sementara kamu tidak bisa memakai command. Jelaskan di channel report." }, { color: 0xff5555 });
        const comps = []; if (reportUrl) comps.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Buka Channel Report").setStyle(ButtonStyle.Link).setURL(reportUrl)));
        try { const dmc = await interaction.user.createDM(); await dmc.send({ embeds: [dm], components: comps }).catch(()=>{}); } catch(e){}
        await interaction.editReply({ content: "Review 1⭐ diterima. Cek DM." }); return;
      } else if (rating === 2) {
        try { const member = await guild.members.fetch(interaction.user.id).catch(()=>null); if (member && RATING2_ROLE_ID) await member.roles.add(RATING2_ROLE_ID).catch(()=>{}); } catch(e){}
        const dm2 = aestheticEmbed({ title: "Kamu memberikan rating 2 ⭐", description: "Kamu dibatasi chat/voice sementara. Jelaskan di report jika perlu." }, { color: 0xffaa00 });
        const comps2 = []; if (reportUrl) comps2.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Buka Channel Report").setStyle(ButtonStyle.Link).setURL(reportUrl)));
        try { const dmc = await interaction.user.createDM(); await dmc.send({ embeds: [dm2], components: comps2 }).catch(()=>{}); } catch(e){}
        await interaction.editReply({ content: "Review 2⭐ diterima. Cek DM." }); return;
      } else if (rating === 3) {
        userCommandLevel.set(`${guildId}:${interaction.user.id}`, 3); await interaction.editReply({ content: "Rating 3⭐ — command dibatasi 1x per 5 menit." }); return;
      } else if (rating === 4) {
        userCommandLevel.delete(`${guildId}:${interaction.user.id}`); await interaction.editReply({ content: "Rating 4⭐ — terima kasih." }); return;
      } else {
        userCommandLevel.delete(`${guildId}:${interaction.user.id}`); await interaction.editReply({ content: "Rating 5⭐ — terima kasih banyak!" }); return;
      }
    }
  } catch (err) { console.error("interactionCreate err:", err); }
});

// login
client.login(process.env.TOKEN).catch(err => { console.error("Login failed:", err); process.exit(1); });
