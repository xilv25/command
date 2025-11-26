// index.js — BOT RATING & SAVE JPG
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");
const express = require("express");
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
} = require("discord.js");

// --- CONFIG & CONSTANTS ---

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || null;

const THEME_COLOR = 0x00cf91;
const EMBED_THUMB_URL =
  "https://cdn.discordapp.com/attachments/1407410043258798083/1442699948238962810/IMG-20251125-WA0011.jpg?ex=69266287&is=69251107&hm=2dd1a59f6642711bede9a9cfd8d17e23f95894b9d95b8106720b604281f59c75&";
const FOOTER_IMAGE_URL =
  "https://media.discordapp.net/attachments/1264174867784142860/1278361754308575314/UhUsLgQ.gif?ex=68e9c1e9&is=68e87069&hm=5025841d8af59d93c656156b609d6ea37be1f13824ac61c6a72190e720245ac6&";

const DB_FILE = path.join(__dirname, "commands.json");

// --- SIMPLE JSON DB ---

let db = {
  commands: {
    // [cmdId]: { guildId, name, title, description, channelId, messageId?, ratings: {1..5}, createdBy }
  },
  settings: {
    // [guildId]: { reviewChannelId, reportChannelId, statsChannelId, statsMessageId }
  },
};

function ensureDbShape() {
  if (!db.commands) db.commands = {};
  if (!db.settings) db.settings = {};
}

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      db = JSON.parse(raw);
      ensureDbShape();
    } else {
      ensureDbShape();
    }
  } catch (err) {
    console.error("Gagal load DB:", err);
    ensureDbShape();
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("Gagal save DB:", err);
  }
}

function genCommandId() {
  return (
    "cmd_" +
    Date.now().toString(36) +
    "_" +
    Math.floor(Math.random() * 1e6).toString(36)
  );
}

// --- EMBED & CANVAS HELPERS ---

function aestheticEmbed(payload = {}, opt = {}) {
  const e = new EmbedBuilder();

  e.setAuthor({
    name: "LimeHub • Service System",
    iconURL: EMBED_THUMB_URL,
  });

  if (payload.title) {
    e.setTitle(`✦ ${payload.title}`);
  }

  if (payload.description) {
    const topLine = "┏━━━━━━━━━━━━━━━━━━━━━━━━━━━";
    const bottomLine = "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━";
    e.setDescription(`${topLine}\n${payload.description}\n${bottomLine}`);
  }

  if (payload.fields && Array.isArray(payload.fields)) {
    e.addFields(
      payload.fields.map((f) => ({
        name:
          f.name.startsWith("•") || f.name.startsWith("➤")
            ? f.name
            : `➤ ${f.name}`,
        value: f.value,
        inline: f.inline ?? false,
      }))
    );
  }

  e.setColor(opt.color || THEME_COLOR);
  e.setThumbnail(EMBED_THUMB_URL);
  e.setImage(FOOTER_IMAGE_URL);
  e.setFooter({
    text: "created by @unstoppable_neid | LimeHub Support",
    iconURL: EMBED_THUMB_URL,
  });
  e.setTimestamp();
  return e;
}

function wrapText(ctx, text, maxWidth) {
  const words = (text || "").split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const testLine = line ? line + " " + word : word;
    const width = ctx.measureText(testLine).width;
    if (width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Gambar kartu mirip embed
async function renderCommandToImage({ username, title, description }) {
  const width = 1280;
  const height = 720;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background: mirip Discord
  ctx.fillStyle = "#050816";
  ctx.fillRect(0, 0, width, height);

  // Card
  const cardX = 140;
  const cardY = 110;
  const cardW = width - 280;
  const cardH = height - 260;

  // Card shadow
  ctx.fillStyle = "#02040b";
  ctx.fillRect(cardX + 6, cardY + 8, cardW, cardH);

  // Card body
  ctx.fillStyle = "#111827";
  ctx.fillRect(cardX, cardY, cardW, cardH);

  // Left accent strip
  ctx.fillStyle = "#00cf91";
  ctx.fillRect(cardX, cardY, 10, cardH);

  // Header (author)
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#83f2c9";
  ctx.fillText("LimeHub • Service System", cardX + 26, cardY + 32);

  // Title
  ctx.font = "30px sans-serif";
  ctx.fillStyle = "#ffffff";
  const fullTitle = title || "Informasi";
  ctx.fillText(`✦ ${fullTitle}`, cardX + 26, cardY + 78);

  // Divider
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 26, cardY + 96);
  ctx.lineTo(cardX + cardW - 26, cardY + 96);
  ctx.stroke();

  // Description text
  ctx.font = "20px sans-serif";
  ctx.fillStyle = "#e5f7f0";
  const text = (description || "").replace(/\r\n/g, "\n");
  const lines = wrapText(ctx, text, cardW - 80);

  let y = cardY + 130;
  for (const line of lines) {
    if (y > cardY + cardH - 80) break;
    ctx.fillText(line, cardX + 26, y);
    y += 28;
  }

  // Footer text di card
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(
    `Untuk: ${username}  •  LimeHub Support`,
    cardX + 26,
    cardY + cardH - 26
  );

  return canvas.toBuffer("image/jpeg", { quality: 0.9 });
}

// --- KEEP ALIVE & CLIENT ---

const app = express();
app.get("/", (_, res) => res.send("Bot Alive ✅"));
app.listen(3000, () => console.log("Keep-alive server running"));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

// --- STATS EMBED (1 bar saja) ---

async function updateStatsEmbed(guildId) {
  const settings = db.settings[guildId];
  if (!settings || !settings.statsChannelId) return;

  const counts = [0, 0, 0, 0, 0]; // index 0 -> 1⭐, dst
  for (const cmdId of Object.keys(db.commands)) {
    const cmd = db.commands[cmdId];
    if (cmd.guildId !== guildId) continue;
    const r = cmd.ratings || {};
    for (let i = 1; i <= 5; i++) {
      counts[i - 1] += r[i] || 0;
    }
  }

  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return;

  const sum =
    counts[0] * 1 +
    counts[1] * 2 +
    counts[2] * 3 +
    counts[3] * 4 +
    counts[4] * 5;
  const avg = sum / total;

  const segments = 20;
  const filled = Math.round((avg / 5) * segments);
  const bar =
    "▰".repeat(filled) + "▱".repeat(Math.max(0, segments - filled));
  const avgStars = "⭐".repeat(Math.round(avg));

  const embed = aestheticEmbed({
    title: "LimeHub Support Rating",
    description: "Ringkasan rating review LimeHub Support dari member.",
    fields: [
      {
        name: "• Rata-rata",
        value: `${avg.toFixed(2)} / 5 ${avgStars}\n${bar}\nTotal review: **${total}**`,
      },
    ],
  });

  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const ch = await guild.channels
      .fetch(settings.statsChannelId)
      .catch(() => null);
    if (!ch || !ch.isTextBased()) return;

    if (settings.statsMessageId) {
      const msg = await ch.messages
        .fetch(settings.statsMessageId)
        .catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] }).catch(() => {});
        return;
      }
    }

    const m = await ch.send({ embeds: [embed] }).catch(() => null);
    if (m) {
      settings.statsMessageId = m.id;
      db.settings[guildId] = settings;
      saveDb();
    }
  } catch (err) {
    console.error("updateStatsEmbed error:", err);
  }
}

// --- SLASH COMMANDS (/setup, /command) ---

async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const setup = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup bot system (admin only)")
    .addSubcommand((sub) =>
      sub
        .setName("command")
        .setDescription("Buat embed dengan tombol Save + Rating")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("ID internal (misal: eletrident) — tidak ditampilkan")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("title")
            .setDescription("Judul di embed & JPG (misal: Eletrident Guide)")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("description")
            .setDescription("Isi informasi yang mau ditampilkan di embed")
            .setRequired(true)
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel tempat embed dikirim")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("channel")
        .setDescription("Atur channel review & report & stats")
        .addChannelOption((o) =>
          o
            .setName("review")
            .setDescription("Channel review (embed review dikirim ke sini)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addChannelOption((o) =>
          o
            .setName("report")
            .setDescription("Channel report untuk rating rendah")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addChannelOption((o) =>
          o
            .setName("stats")
            .setDescription("Channel statistik rating")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    );

  const command = new SlashCommandBuilder()
    .setName("command")
    .setDescription("Kelola command (admin only)")
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Lihat list command yang terdaftar")
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Hapus command dan embed-nya")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("ID internal command (name waktu /setup command)")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit data command & refresh embed")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("ID internal command yang mau diedit")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("title")
            .setDescription("Judul baru (opsional)")
            .setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName("description")
            .setDescription("Deskripsi baru (opsional)")
            .setRequired(false)
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel baru untuk embed (opsional)")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    );

  const commands = [setup, command];

  try {
    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands.map((c) => c.toJSON()) }
      );
      console.log("Slash commands registered (guild)");
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), {
        body: commands.map((c) => c.toJSON()),
      });
      console.log("Slash commands registered (global)");
    }
  } catch (err) {
    console.error("Error register slash:", err);
  }
}

// Helper: bikin / refresh embed command
async function sendOrRefreshCommandEmbed(cmdId) {
  const cmdData = db.commands[cmdId];
  if (!cmdData) return;

  try {
    const guild = await client.guilds.fetch(cmdData.guildId).catch(() => null);
    if (!guild) return;
    const channel = await guild.channels
      .fetch(cmdData.channelId)
      .catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    // delete message lama kalau ada
    if (cmdData.messageId) {
      const oldMsg = await channel.messages
        .fetch(cmdData.messageId)
        .catch(() => null);
      if (oldMsg) {
        await oldMsg.delete().catch(() => {});
      }
    }

    const embed = aestheticEmbed({
      title: cmdData.title,
      description: cmdData.description,
      fields: [
        {
          name: "• Cara Simpan",
          value:
            "Klik tombol **Simpan JPG** di bawah untuk download versi gambar dari informasi ini.",
        },
        {
          name: "• Beri Rating",
          value: "Pilih rating yang menurutmu sesuai (1–5 bintang).",
        },
      ],
    });

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`save:${cmdId}`)
        .setLabel("Simpan JPG")
        .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rate:${cmdId}:1`)
        .setLabel("⭐ 1")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`rate:${cmdId}:2`)
        .setLabel("⭐ 2")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rate:${cmdId}:3`)
        .setLabel("⭐ 3")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`rate:${cmdId}:4`)
        .setLabel("⭐ 4")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`rate:${cmdId}:5`)
        .setLabel("⭐ 5")
        .setStyle(ButtonStyle.Success)
    );

    const msg = await channel.send({
      embeds: [embed],
      components: [row1, row2],
    });

    cmdData.messageId = msg.id;
    db.commands[cmdId] = cmdData;
    saveDb();
  } catch (err) {
    console.error("sendOrRefreshCommandEmbed error:", err);
  }
}

// --- READY ---

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadDb();
  await registerSlashCommands();
});

// --- INTERACTION HANDLER ---

client.on("interactionCreate", async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // Admin check helper
      const isAdmin =
        interaction.memberPermissions &&
        interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

      if (commandName === "setup") {
        const sub = interaction.options.getSubcommand();
        if (!isAdmin) {
          return interaction.reply({
            content:
              "Kamu tidak punya izin untuk memakai command ini (Admin only).",
            ephemeral: true,
          });
        }

        if (sub === "command") {
          const name = interaction.options
            .getString("name", true)
            .toLowerCase()
            .trim();
          const title = interaction.options.getString("title", true);
          const description = interaction.options.getString(
            "description",
            true
          );
          const channel = interaction.options.getChannel("channel", true);

          const cmdId = genCommandId();

          db.commands[cmdId] = {
            guildId: interaction.guildId,
            name,
            title,
            description,
            channelId: channel.id,
            ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            createdBy: interaction.user.id,
          };
          saveDb();

          await sendOrRefreshCommandEmbed(cmdId);

          await interaction.reply({
            embeds: [
              aestheticEmbed({
                title: "Setup Command Berhasil",
                description: `Embed **${title}** telah dibuat di ${channel}. User cukup klik tombol di embed.`,
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        if (sub === "channel") {
          const review = interaction.options.getChannel("review", true);
          const report = interaction.options.getChannel("report", true);
          const stats = interaction.options.getChannel("stats", false) || null;

          db.settings[interaction.guildId] = {
            reviewChannelId: review.id,
            reportChannelId: report.id,
            statsChannelId: stats ? stats.id : null,
            statsMessageId: null,
          };
          saveDb();

          await interaction.reply({
            embeds: [
              aestheticEmbed({
                title: "Setup Channel Berhasil",
                description: "Channel review/report/stats sudah disimpan.",
                fields: [
                  { name: "• Review", value: `${review}`, inline: true },
                  { name: "• Report", value: `${report}`, inline: true },
                  ...(stats
                    ? [{ name: "• Stats", value: `${stats}`, inline: true }]
                    : []),
                ],
              }),
            ],
            ephemeral: true,
          });
          return;
        }
      }

      // /command list/remove/edit
      if (commandName === "command") {
        if (!isAdmin) {
          return interaction.reply({
            content:
              "Kamu tidak punya izin untuk memakai command ini (Admin only).",
            ephemeral: true,
          });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "list") {
          const entries = Object.entries(db.commands).filter(
            ([, v]) => v.guildId === interaction.guildId
          );
          if (!entries.length) {
            return interaction.reply({
              embeds: [
                aestheticEmbed({
                  title: "Daftar Command",
                  description: "Belum ada command yang terdaftar.",
                }),
              ],
              ephemeral: true,
            });
          }

          const lines = entries.map(([id, v], idx) => {
            return `${idx + 1}. **${v.title}**\n   ID: \`${v.name}\`\n   Channel: <#${v.channelId}>`;
          });

          await interaction.reply({
            embeds: [
              aestheticEmbed({
                title: "Daftar Command",
                description: lines.join("\n\n"),
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        if (sub === "remove") {
          const name = interaction.options
            .getString("name", true)
            .toLowerCase()
            .trim();

          const entry = Object.entries(db.commands).find(
            ([, v]) =>
              v.guildId === interaction.guildId && v.name.toLowerCase() === name
          );
          if (!entry) {
            return interaction.reply({
              embeds: [
                aestheticEmbed({
                  title: "Command Tidak Ditemukan",
                  description: `Tidak ada command dengan ID \`${name}\` di server ini.`,
                }),
              ],
              ephemeral: true,
            });
          }

          const [cmdId, cmdData] = entry;

          try {
            const guild = await client.guilds
              .fetch(cmdData.guildId)
              .catch(() => null);
            if (guild) {
              const ch = await guild.channels
                .fetch(cmdData.channelId)
                .catch(() => null);
              if (ch && ch.isTextBased() && cmdData.messageId) {
                const msg = await ch.messages
                  .fetch(cmdData.messageId)
                  .catch(() => null);
                if (msg) await msg.delete().catch(() => {});
              }
            }
          } catch (err) {
            console.error("Error deleting command message:", err);
          }

          delete db.commands[cmdId];
          saveDb();

          // update statistik sesudah remove
          updateStatsEmbed(interaction.guildId).catch(() => {});

          await interaction.reply({
            embeds: [
              aestheticEmbed({
                title: "Command Dihapus",
                description: `Command dengan ID \`${name}\` sudah dihapus beserta embed-nya.`,
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        if (sub === "edit") {
          const name = interaction.options
            .getString("name", true)
            .toLowerCase()
            .trim();
          const newTitle = interaction.options.getString("title", false);
          const newDesc = interaction.options.getString("description", false);
          const newChannel = interaction.options.getChannel("channel", false);

          const entry = Object.entries(db.commands).find(
            ([, v]) =>
              v.guildId === interaction.guildId && v.name.toLowerCase() === name
          );
          if (!entry) {
            return interaction.reply({
              embeds: [
                aestheticEmbed({
                  title: "Command Tidak Ditemukan",
                  description: `Tidak ada command dengan ID \`${name}\` di server ini.`,
                }),
              ],
              ephemeral: true,
            });
          }

          const [cmdId, cmdData] = entry;

          if (newTitle) cmdData.title = newTitle;
          if (newDesc) cmdData.description = newDesc;
          if (newChannel) cmdData.channelId = newChannel.id;

          db.commands[cmdId] = cmdData;
          saveDb();

          await sendOrRefreshCommandEmbed(cmdId);

          await interaction.reply({
            embeds: [
              aestheticEmbed({
                title: "Command Diperbarui",
                description: `Command \`${name}\` sudah di-update dan embednya telah di-refresh.`,
              }),
            ],
            ephemeral: true,
          });
          return;
        }
      }
    }

    // Button interactions
    if (interaction.isButton()) {
      const parts = interaction.customId.split(":");
      const type = parts[0];

      // SAVE JPG
      if (type === "save") {
        const cmdId = parts[1];
        const cmdData = db.commands[cmdId];
        if (!cmdData || cmdData.guildId !== interaction.guildId) {
          return interaction.reply({
            content: "Data tidak ditemukan atau sudah dihapus.",
            ephemeral: true,
          });
        }

        try {
          const buffer = await renderCommandToImage({
            username: interaction.user.username,
            title: cmdData.title,
            description: cmdData.description,
          });

          await interaction.reply({
            content:
              "Berikut JPG untuk informasi ini. Silakan di-save.",
            files: [{ attachment: buffer, name: `limehub-${cmdData.name}.jpg` }],
            ephemeral: true,
          });
        } catch (err) {
          console.error("renderCommandToImage error:", err);
          await interaction.reply({
            content: "Gagal membuat JPG. Coba lagi nanti.",
            ephemeral: true,
          });
        }
        return;
      }

      // RATE -> buka modal
      if (type === "rate") {
        const cmdId = parts[1];
        const ratingStr = parts[2];
        const rating = parseInt(ratingStr, 10);

        const cmdData = db.commands[cmdId];
        if (!cmdData || cmdData.guildId !== interaction.guildId) {
          return interaction.reply({
            content: "Data tidak ditemukan atau sudah dihapus.",
            ephemeral: true,
          });
        }
        if (isNaN(rating) || rating < 1 || rating > 5) {
          return interaction.reply({
            content: "Rating tidak valid.",
            ephemeral: true,
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`review_modal:${cmdId}:${rating}`)
          .setTitle("Form Review");

        const notesInput = new TextInputBuilder()
          .setCustomId("notes")
          .setLabel("Catatan / review (opsional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder(
            "Tuliskan pengalamanmu, masalah, atau saran..."
          );

        modal.addComponents(
          new ActionRowBuilder().addComponents(notesInput)
        );

        await interaction.showModal(modal);
        return;
      }
    }

    // Modal submit (review)
    if (interaction.isModalSubmit()) {
      const [type, cmdId, ratingStr] = interaction.customId.split(":");
      if (type !== "review_modal") return;

      const rating = parseInt(ratingStr, 10);
      const cmdData = db.commands[cmdId];
      if (!cmdData || cmdData.guildId !== interaction.guildId) {
        return interaction.reply({
          content: "Data tidak ditemukan atau sudah dihapus.",
          ephemeral: true,
        });
      }

      const notesRaw = interaction.fields.getTextInputValue("notes") || "";
      const notes = notesRaw.trim() || "Tidak ada catatan.";
      const guildId = cmdData.guildId;
      const settings = db.settings[guildId] || {};

      // Kirim embed ke channel review
      if (settings.reviewChannelId) {
        try {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const rCh = await guild.channels
              .fetch(settings.reviewChannelId)
              .catch(() => null);
            if (rCh && rCh.isTextBased()) {
              const stars = "⭐".repeat(rating);
              const revEmbed = aestheticEmbed({
                title: "Ulasan Baru",
                description: "",
                fields: [
                  {
                    name: "• User",
                    value: `${interaction.user}`, // mention saja, tanpa ID & tanpa nama command
                    inline: false,
                  },
                  {
                    name: "• Rating",
                    value: `${stars} (${rating}/5)`,
                    inline: true,
                  },
                  {
                    name: "• Review",
                    value: notes,
                    inline: false,
                  },
                ],
              });
              await rCh.send({ embeds: [revEmbed] }).catch(() => {});
            }
          }
        } catch (err) {
          console.error("send review embed error:", err);
        }
      }

      // Update rating stats (per-command)
      cmdData.ratings[rating] = (cmdData.ratings[rating] || 0) + 1;
      db.commands[cmdId] = cmdData;
      saveDb();

      // Update statistik server
      updateStatsEmbed(guildId).catch(() => {});

      // DM untuk rating rendah (1 & 2)
      const reportChannelId = settings.reportChannelId;
      const reportUrl = reportChannelId
        ? `https://discord.com/channels/${guildId}/${reportChannelId}`
        : null;

      if (rating === 1 || rating === 2) {
        const desc =
          rating === 1
            ? "Terima kasih sudah jujur memberikan rating 1⭐. Kalau ada masalah, jelaskan di channel report server agar tim bisa bantu."
            : "Kamu memberi rating 2⭐. Kalau ada kendala, tolong jelaskan di channel report server supaya bisa kami perbaiki.";

        const dmEmbed = aestheticEmbed({
          title: `Kamu memberikan rating ${rating}⭐`,
          description: desc,
        });
        const comps = [];
        if (reportUrl) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel("Buka Channel Report")
              .setStyle(ButtonStyle.Link)
              .setURL(reportUrl)
          );
          comps.push(row);
        }

        try {
          const dm = await interaction.user.createDM();
          await dm.send({ embeds: [dmEmbed], components: comps }).catch(() => {});
        } catch (err) {
          console.error("DM rating rendah error:", err);
        }
      }

      // Balasan ke user (ephemeral)
      await interaction.reply({
        ephemeral: true,
        embeds: [
          aestheticEmbed({
            title: "Terima kasih atas reviewmu!",
            description: `Rating yang kamu berikan: **${rating}⭐**.\nFeedback kamu sangat membantu kami meningkatkan kualitas layanan.`,
          }),
        ],
      });

      return;
    }
  } catch (err) {
    console.error("interactionCreate error:", err);
    if (interaction.isRepliable && !interaction.replied) {
      try {
        await interaction.reply({
          content: "Terjadi error tak terduga.",
          ephemeral: true,
        });
      } catch (_) {}
    }
  }
});

// User biasa gak perlu prefix/slash, jadi messageCreate kosong
client.on("messageCreate", (message) => {
  if (message.author.bot) return;
});

// --- LOGIN ---

client.login(TOKEN).catch((err) => {
  console.error("Login failed:", err);
  process.exit(1);
});
