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

// ====== EXPRESS KEEP ALIVE (opsional, buat Replit) ======
const app = express();
app.get("/", (_, res) => res.send("Bot Alive ✅"));
app.listen(3000, () => console.log("Keep-alive server running"));

// ====== CLIENT SETUP ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// ====== "DATABASE" SEDERHANA DI MEMORI ======
// key: guildId -> { reviewChannelId, reportChannelId, statsChannelId, statsMessageId }
const guildSettings = new Map();
// key: guildId -> Map(commandName -> { isi, backup })
const customCommands = new Map();
// user yang sudah pernah isi review per guild+command -> key: `${guildId}:${commandName}:${userId}`
const reviewDone = new Set();
// user yang di-blacklist per guild -> key: `${guildId}:${userId}`
const blacklist = new Set();
// timer reminder review -> key: `${guildId}:${userId}:${commandName}` -> Timeout
const pendingReviewReminder = new Map();
// statistik rating per guild -> key: guildId -> { counts: [c1,c2,c3,c4,c5] }
const ratingStats = new Map();

// ====== WARNA TEMA ======
const THEME_COLOR = 0x00cf91;

// ====== REGISTER SLASH COMMANDS ======
async function registerSlashCommands() {
  const commands = [];

  // /setup channel & /setup command
  const setupCommand = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup bot")
    .addSubcommand(sub =>
      sub
        .setName("channel")
        .setDescription("Set channel review, report, dan optional stats")
        .addChannelOption(opt =>
          opt
            .setName("review")
            .setDescription("Channel untuk review")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addChannelOption(opt =>
          opt
            .setName("report")
            .setDescription("Channel untuk report")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum)
            .setRequired(true)
        )
        .addChannelOption(opt =>
          opt
            .setName("stats")
            .setDescription("Channel statistik review (opsional)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("command")
        .setDescription("Daftarkan command prefix yang DM embed ke user")
        .addStringOption(opt =>
          opt
            .setName("name")
            .setDescription("Nama command tanpa prefix, contoh: eletrident")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName("isi")
            .setDescription("Isi utama embed (akan dikirim ke DM)")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName("backup")
            .setDescription("Isi backup / info tambahan embed")
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

  // /command list & /command remove
  const commandCommand = new SlashCommandBuilder()
    .setName("command")
    .setDescription("Kelola command prefix DM")
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("Lihat semua command yang terdaftar")
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Hapus salah satu command")
        .addStringOption(opt =>
          opt
            .setName("name")
            .setDescription("Nama command yang mau dihapus (tanpa prefix)")
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

  commands.push(setupCommand, commandCommand);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    console.log("💾 Registering (overwrite) application commands...");

    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands.map(c => c.toJSON()) }
      );
      console.log("✅ Guild slash commands registered");
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands.map(c => c.toJSON()) }
      );
      console.log("✅ Global slash commands registered");
    }
  } catch (err) {
    console.error("Error registering commands:", err);
  }
}

// ====== READY EVENT ======
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  registerSlashCommands();
});

// ==================================
// ========== INTERACTIONS ==========
// ==================================
client.on("interactionCreate", async interaction => {
  // ========== SLASH COMMAND ==========
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === "setup") {
      const sub = interaction.options.getSubcommand();

      // /setup channel
      if (sub === "channel") {
        const review = interaction.options.getChannel("review", true);
        const report = interaction.options.getChannel("report", true);
        const stats = interaction.options.getChannel("stats", false) || null;

        const settings = guildSettings.get(interaction.guildId) || {};
        settings.reviewChannelId = review.id;
        settings.reportChannelId = report.id;
        if (stats) settings.statsChannelId = stats.id;
        guildSettings.set(interaction.guildId, settings);

        const fields = [
          { name: "Review Channel", value: `<#${review.id}>`, inline: true },
          { name: "Report Channel", value: `<#${report.id}>`, inline: true }
        ];
        if (stats) {
          fields.push({ name: "Stats Channel", value: `<#${stats.id}>`, inline: true });
        }

        const embed = new EmbedBuilder()
          .setTitle("Setup Channel ✅")
          .setColor(THEME_COLOR)
          .setDescription("Channel berhasil disetting.")
          .addFields(fields)
          .setFooter({ text: "Konfigurasi bot review, report & stats" })
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

        if (stats) {
          await updateStatsMessage(interaction.guildId);
        }
      }

      // /setup command
      if (sub === "command") {
        const nameRaw = interaction.options.getString("name", true);
        const name = nameRaw.toLowerCase().trim();
        const isi = interaction.options.getString("isi", true);
        const backup = interaction.options.getString("backup", true);

        let guildCmds = customCommands.get(interaction.guildId);
        if (!guildCmds) {
          guildCmds = new Map();
          customCommands.set(interaction.guildId, guildCmds);
        }

        guildCmds.set(name, { isi, backup });

        const embed = new EmbedBuilder()
          .setTitle("Setup Command ✅")
          .setColor(THEME_COLOR)
          .setDescription("Command prefix berhasil disimpan.")
          .addFields(
            { name: "Command", value: `\`!${name}\``, inline: true },
            { name: "Isi", value: trimForField(isi), inline: false },
            { name: "Backup", value: trimForField(backup), inline: false }
          )
          .setFooter({ text: "Command ini akan mengirim DM ke user yang mengetiknya." })
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    if (commandName === "command") {
      const sub = interaction.options.getSubcommand();

      if (sub === "list") {
        const guildCmds = customCommands.get(interaction.guildId);

        if (!guildCmds || guildCmds.size === 0) {
          return interaction.reply({
            content: "Belum ada command yang terdaftar.",
            ephemeral: true
          });
        }

        const listStr = [...guildCmds.keys()]
          .map(name => `• \`!${name}\``)
          .join("\n");

        const embed = new EmbedBuilder()
          .setTitle("Daftar Command Prefix")
          .setColor(THEME_COLOR)
          .setDescription(listStr)
          .setFooter({ text: `Total: ${guildCmds.size} command` })
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (sub === "remove") {
        const nameRaw = interaction.options.getString("name", true);
        const name = nameRaw.toLowerCase().trim();

        const guildCmds = customCommands.get(interaction.guildId);
        if (!guildCmds || !guildCmds.has(name)) {
          return interaction.reply({
            content: `Command \`!${name}\` tidak ditemukan.`,
            ephemeral: true
          });
        }

        guildCmds.delete(name);

        const embed = new EmbedBuilder()
          .setTitle("Command Dihapus ✅")
          .setColor(THEME_COLOR)
          .setDescription(`Command \`!${name}\` berhasil dihapus.`)
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
    return;
  }

  // ========== BUTTON INTERACTION ==========
  if (interaction.isButton()) {
    const parts = interaction.customId.split(":");
    const type = parts[0];

    if (type === "cmd_work") {
      const guildId = parts[1];
      const cmdName = parts[2];

      const reminderKey = `${guildId}:${interaction.user.id}:${cmdName}`;
      const pending = pendingReviewReminder.get(reminderKey);
      if (pending) {
        clearTimeout(pending);
        pendingReviewReminder.delete(reminderKey);
      }

      const blKey = `${guildId}:${interaction.user.id}`;
      if (blacklist.has(blKey)) {
        await sendBlockedDM(interaction.user, guildId);
        return interaction.reply({
          content: "Kamu sedang dibatasi dan harus membuat report dulu.",
        });
      }

      const key = `${guildId}:${cmdName}:${interaction.user.id}`;

      if (reviewDone.has(key)) {
        return interaction.reply({
          content: "Kamu sudah pernah mengisi review untuk command ini. Terima kasih 🙏",
        });
      }

      const formEmbed = new EmbedBuilder()
        .setTitle("Form Review")
        .setColor(THEME_COLOR)
        .setDescription("Silakan isi review untuk command ini.")
        .addFields(
          { name: "Command", value: `!${cmdName}`, inline: true }
        )
        .setFooter({ text: "Klik tombol di bawah untuk membuka formulir." })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`review_open:${guildId}:${cmdName}`)
          .setLabel("Isi formulir")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({ embeds: [formEmbed], components: [row] });
      return;
    }

    if (type === "review_open") {
      const guildId = parts[1];
      const cmdName = parts[2];

      const blKey = `${guildId}:${interaction.user.id}`;
      if (blacklist.has(blKey)) {
        await sendBlockedDM(interaction.user, guildId);
        return interaction.reply({
          content: "Kamu sedang dibatasi dan harus membuat report dulu.",
        });
      }

      const key = `${guildId}:${cmdName}:${interaction.user.id}`;

      if (reviewDone.has(key)) {
        return interaction.reply({
          content: "Kamu sudah pernah mengisi review untuk command ini. Terima kasih 🙏",
        });
      }

      const originalRow = interaction.message.components[0];
      const components = originalRow.components.map(btn => {
        if (btn.customId === interaction.customId) {
          return ButtonBuilder.from(btn).setDisabled(true);
        }
        return ButtonBuilder.from(btn);
      });

      await interaction.message.edit({
        components: [new ActionRowBuilder().addComponents(components)]
      });

      const modal = new ModalBuilder()
        .setCustomId(`review_modal:${guildId}:${cmdName}`)
        .setTitle("Form Review");

      const ratingInput = new TextInputBuilder()
        .setCustomId("rating")
        .setLabel("Rating (1-5)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Masukkan angka 1 sampai 5")
        .setRequired(true);

      const notesInput = new TextInputBuilder()
        .setCustomId("notes")
        .setLabel("Catatan / Review")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Tulis review kamu di sini (optional)")
        .setRequired(false);

      const row1 = new ActionRowBuilder().addComponents(ratingInput);
      const row2 = new ActionRowBuilder().addComponents(notesInput);

      modal.addComponents(row1, row2);

      await interaction.showModal(modal);
      return;
    }

    if (type === "cmd_fail") {
      const guildId = parts[1];
      const cmdName = parts[2];

      const blKey = `${guildId}:${interaction.user.id}`;
      if (blacklist.has(blKey)) {
        await sendBlockedDM(interaction.user, guildId);
        return interaction.reply({
          content: "Kamu sedang dibatasi dan harus membuat report dulu.",
        });
      }

      const guildCmds = customCommands.get(guildId);
      const cmdData = guildCmds?.get(cmdName);

      if (!cmdData) {
        return interaction.reply({
          content: "Data command tidak ditemukan.",
        });
      }

      const backupEmbed = new EmbedBuilder()
        .setTitle("Informasi Tambahan")
        .setColor(THEME_COLOR)
        .setDescription(cmdData.backup || "Tidak ada informasi backup.")
        .setFooter({ text: `Command: !${cmdName}` })
        .setTimestamp();

      await interaction.reply({ embeds: [backupEmbed] });
      return;
    }
  }

  // ========== MODAL SUBMIT (FORM REVIEW) ==========
  if (interaction.isModalSubmit()) {
    const [type, guildId, cmdName] = interaction.customId.split(":");
    if (type !== "review_modal") return;

    const ratingStr = interaction.fields.getTextInputValue("rating").trim();
    const notesRaw = interaction.fields.getTextInputValue("notes") || "";
    const notes = notesRaw.trim() || "Tidak ada catatan.";

    const rating = parseInt(ratingStr, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      await interaction.reply({
        content: "Rating harus angka 1 sampai 5."
      });
      return;
    }

    const settings = guildSettings.get(guildId);
    const reviewChannelId = settings?.reviewChannelId;

    if (!reviewChannelId) {
      await interaction.reply({
        content: "Review channel belum diset oleh admin server."
      });
      return;
    }

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      await interaction.reply({
        content: "Gagal menemukan server asal."
      });
      return;
    }

    const reviewChannel = await guild.channels.fetch(reviewChannelId).catch(() => null);
    if (!reviewChannel || !reviewChannel.isTextBased()) {
      await interaction.reply({
        content: "Review channel tidak valid."
      });
      return;
    }

    const stars = "⭐".repeat(rating);

    const reviewEmbed = new EmbedBuilder()
      .setTitle("Ulasan Baru")
      .setColor(THEME_COLOR)
      .addFields(
        { name: "User", value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: false },
        { name: "Command", value: `!${cmdName}`, inline: true },
        { name: "Rating", value: stars, inline: true },
        { name: "Review", value: notes, inline: false }
      )
      .setTimestamp();

    await reviewChannel.send({ embeds: [reviewEmbed] });

    addRating(guildId, rating);
    await updateStatsMessage(guildId);

    const key = `${guildId}:${cmdName}:${interaction.user.id}`;
    reviewDone.add(key);

    if (rating === 1) {
      const blKey = `${guildId}:${interaction.user.id}`;
      blacklist.add(blKey);

      const reportChannelId = settings?.reportChannelId;
      if (reportChannelId) {
        const reportChannel = await guild.channels.fetch(reportChannelId).catch(() => null);
        if (reportChannel && reportChannel.isTextBased()) {
          const reportEmbed = new EmbedBuilder()
            .setTitle("Laporan Diperlukan (Rating 1⭐)")
            .setColor(THEME_COLOR)
            .setDescription(
              "Kamu memberikan rating 1. Tolong jelaskan masalahmu di sini agar staff bisa bantu."
            )
            .addFields(
              { name: "Command", value: `!${cmdName}`, inline: true }
            )
            .setTimestamp();

          await reportChannel.send({
            content: `${interaction.user}`,
            embeds: [reportEmbed]
          });
        }
      }

      await interaction.reply({
        content:
          "Kamu memberikan rating 1 ⭐.\nUntuk sementara kamu tidak bisa memakai command.\nSilakan jelaskan masalahmu di channel report server, nanti staff akan bantu dan bisa meng-clear kamu.",
      });
    } else {
      await interaction.reply({
        content: "Terima kasih, review kamu sudah dikirim ke channel review server. 🙏"
      });
    }

    return;
  }
});

// ===============================
// ========== HELPERS ===========
// ===============================
function trimForField(text) {
  if (!text) return "–";
  if (text.length > 1000) return text.slice(0, 997) + "...";
  return text;
}

function addRating(guildId, rating) {
  let stats = ratingStats.get(guildId);
  if (!stats) {
    stats = { counts: [0, 0, 0, 0, 0] };
  }
  stats.counts[rating - 1] = (stats.counts[rating - 1] || 0) + 1;
  ratingStats.set(guildId, stats);
}

// ==== fungsi stats BAR BARU ====
async function updateStatsMessage(guildId) {
  const settings = guildSettings.get(guildId);
  if (!settings || !settings.statsChannelId) return;

  const stats = ratingStats.get(guildId);
  if (!stats) return;
  const counts = stats.counts;
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return;

  const sum = counts.reduce((acc, c, idx) => acc + c * (idx + 1), 0);
  const avg = sum / total;
  const pct = (avg / 5) * 100;

  const segments = 10;
  const filled = Math.round((pct / 100) * segments);
  const bar =
    "▰".repeat(filled) + "▱".repeat(Math.max(0, segments - filled));

  const avgStars = "⭐".repeat(Math.round(avg));

  const embed = new EmbedBuilder()
    .setTitle("Statistik Review Server")
    .setColor(THEME_COLOR)
    .setDescription("Ringkasan rating dari review member.")
    .addFields(
      {
        name: "Rata-rata",
        value: `${avg.toFixed(2)} / 5 ${avgStars ? `(${avgStars})` : ""}`,
        inline: false
      },
      {
        name: "Total Persentase",
        value: `${pct.toFixed(1)}%`,
        inline: true
      },
      {
        name: "Persentase Bar",
        value: bar,
        inline: false
      }
    )
    .setTimestamp();

  try {
    const channel = await client.channels.fetch(settings.statsChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    if (settings.statsMessageId) {
      const msg = await channel.messages.fetch(settings.statsMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] });
        return;
      }
    }

    const newMsg = await channel.send({ embeds: [embed] });
    settings.statsMessageId = newMsg.id;
    guildSettings.set(guildId, settings);
  } catch (err) {
    console.error("Gagal update stats message:", err);
  }
}

async function sendBlockedDM(user, guildId) {
  const settings = guildSettings.get(guildId);
  const reportChannelId = settings?.reportChannelId;
  let reportInfo = "channel report di server.";

  if (reportChannelId) {
    reportInfo = `<#${reportChannelId}>.`;
  }

  const embed = new EmbedBuilder()
    .setTitle("Akses Command Ditangguhkan")
    .setColor(0xff5555)
    .setDescription(
      "Kamu saat ini tidak bisa memakai command karena memberikan rating 1 sebelumnya.\n" +
      `Silakan jelaskan masalahmu di ${reportInfo}\n` +
      "Setelah staff membalas report kamu dengan `.clear`, kamu bisa memakai command lagi."
    )
    .setTimestamp();

  try {
    const dm = await user.createDM();
    await dm.send({ embeds: [embed] });
  } catch (err) {
    console.error("Gagal kirim blocked DM:", err);
  }
}

// ===============================
// ========== MESSAGE ===========
// ===============================
const PREFIX = "!";

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const contentLower = message.content.trim().toLowerCase();

  if (
    contentLower.startsWith(".clear") &&
    message.reference &&
    message.channel &&
    guildSettings.has(message.guildId)
  ) {
    const settings = guildSettings.get(message.guildId);
    if (message.channel.id === settings.reportChannelId) {
      const member = message.member;
      if (
        member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
        member.permissions.has(PermissionsBitField.Flags.ManageMessages)
      ) {
        const repliedMsg = await message.channel.messages
          .fetch(message.reference.messageId)
          .catch(() => null);
        if (!repliedMsg) return;

        const targetId = repliedMsg.author.id;
        const blKey = `${message.guildId}:${targetId}`;

        if (blacklist.delete(blKey)) {
          const embed = new EmbedBuilder()
            .setColor(THEME_COLOR)
            .setDescription(`✅ ${repliedMsg.author} sudah di-clear.\nDia sekarang bisa memakai command lagi.`);
          await message.reply({ embeds: [embed] });
        } else {
          const embed = new EmbedBuilder()
            .setColor(0xffaa00)
            .setDescription("User ini tidak ada di daftar blacklist.");
          await message.reply({ embeds: [embed] });
        }
      }
    }
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmdName = args.shift()?.toLowerCase();
  if (!cmdName) return;

  const blKey = `${message.guildId}:${message.author.id}`;
  if (blacklist.has(blKey)) {
    await sendBlockedDM(message.author, message.guildId);
    return;
  }

  const guildCmds = customCommands.get(message.guildId);
  if (!guildCmds) return;

  const cmdData = guildCmds.get(cmdName);
  if (!cmdData) return;

  const dmEmbed = new EmbedBuilder()
    .setTitle("Informasi untuk Kamu")
    .setColor(THEME_COLOR)
    .setDescription(cmdData.isi)
    .setFooter({
      text: message.guild.name,
      iconURL: message.guild.iconURL({ size: 1024 }) || undefined
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cmd_work:${message.guildId}:${cmdName}`)
      .setLabel("Work")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cmd_fail:${message.guildId}:${cmdName}`)
      .setLabel("Doesn't work")
      .setStyle(ButtonStyle.Danger)
  );

  try {
    const dm = await message.author.createDM();
    await dm.send({ embeds: [dmEmbed], components: [row] });

    const reminderKey = `${message.guildId}:${message.author.id}:${cmdName}`;
    const existing = pendingReviewReminder.get(reminderKey);
    if (existing) {
      clearTimeout(existing);
      pendingReviewReminder.delete(reminderKey);
    }

    const timeout = setTimeout(async () => {
      pendingReviewReminder.delete(reminderKey);
      try {
        const dm2 = await message.author.createDM();
        const reminderEmbed = new EmbedBuilder()
          .setTitle("Bantu Kami Dengan Review 💚")
          .setColor(THEME_COLOR)
          .setDescription(
            "Kalau command barusan **berhasil** membantu kamu, tolong klik tombol **Work** di DM sebelumnya lalu isi review.\n" +
            "Feedback kamu ngebantu banget buat improve layanan kami. 🙏"
          )
          .setTimestamp();

        await dm2.send({ embeds: [reminderEmbed] });
      } catch (err) {
        console.error("Gagal kirim DM reminder:", err);
      }
    }, 60_000);

    pendingReviewReminder.set(reminderKey, timeout);

    let remaining = 3;

    let confirmEmbed = new EmbedBuilder()
      .setColor(THEME_COLOR)
      .setDescription(
        `✅ ${message.author}, cek DM kamu ya. Embed sudah dikirim.\n(Hilang dalam ${remaining} detik)`
      );

    const confirmMessage = await message.reply({ embeds: [confirmEmbed] });

    const interval = setInterval(async () => {
      remaining--;

      if (remaining <= 0) {
        clearInterval(interval);
        confirmMessage.delete().catch(() => {});
        return;
      }

      confirmEmbed = EmbedBuilder.from(confirmEmbed).setDescription(
        `✅ ${message.author}, cek DM kamu ya. Embed sudah dikirim.\n(Hilang dalam ${remaining} detik)`
      );

      confirmMessage.edit({ embeds: [confirmEmbed] }).catch(() => {});
    }, 1000);
  } catch (err) {
    console.error("Gagal kirim DM:", err);
    await message.reply({
      content: "❌ Gagal kirim DM. Pastikan DM kamu tidak tertutup.",
      allowedMentions: { repliedUser: false }
    });
  }
});

// ====== LOGIN ======
client.login(process.env.TOKEN);