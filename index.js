require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // supaya DM ke-detect
});

/* ================== CONFIG ================== */

// prefix command
const PREFIX = "!";

// channel untuk form review
const REVIEW_CHANNEL_ID = "ID_CHANNEL_REVIEW"; // TODO: ganti

// channel untuk suggestion
const SUGGEST_CHANNEL_ID = "ID_CHANNEL_SUGGEST"; // TODO: ganti

// ID guild (server)
const GUILD_ID = "ID_GUILD_KAMU"; // TODO: ganti

/* 
  Struktur data:
  userReviews: Map<userId, { stars: number, note: string, at: number }>
*/
const userReviews = new Map();

/* ================== HELPER FUNCTIONS ================== */

// Cek apakah user sudah review
function hasReviewed(userId) {
  return userReviews.has(userId);
}

// Ambil data review user
function getReview(userId) {
  return userReviews.get(userId) || null;
}

// Cek apakah user hanya boleh pakai suggestion (rating ⭐ 1)
function isBlockedToSuggestOnly(userId) {
  const r = getReview(userId);
  return r && r.stars === 1;
}

// Bikin URL ke channel tertentu (buat tombol link)
function channelUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

// Kirim DM aman (handle kalau DM tertutup)
async function safeDM(user, payload) {
  try {
    await user.send(payload);
  } catch (err) {
    console.log(`Gagal kirim DM ke ${user.id}:`, err.message);
  }
}

/* ================== EVENT: READY ================== */

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* ================== EVENT: MESSAGE CREATE ================== */

client.on("messageCreate", async (message) => {
  // ignore bot message
  if (message.author.bot) return;

  // ========== 1. HANDLE REVIEW MESSAGE DI CHANNEL REVIEW ==========
  if (message.channelId === REVIEW_CHANNEL_ID && !message.author.bot) {
    const starsCount = (message.content.match(/⭐/g) || []).length;

    if (starsCount <= 0) return; // kalau ga ada bintang, ga usah diproses

    const stars = Math.min(starsCount, 5); // max 5
    const note = message.content.replace(/⭐/g, "").trim();

    userReviews.set(message.author.id, {
      stars,
      note,
      at: Date.now(),
    });

    const user = message.author;

    // Bikin DM embed sesuai jumlah bintang
    let dmText = "";
    let components = [];

    if (stars === 5) {
      dmText =
        "⭐⭐⭐⭐⭐\nTerima kasih sudah memberikan kami respon positif. Kami sangat menghargai respon yang kamu berikan ❤️";
    } else if (stars === 4) {
      dmText =
        "⭐⭐⭐⭐\nTerima kasih sudah memberikan respon positif kepada kami. Berikan saran kepada admin jika diperlukan 🙏";
    } else if (stars === 3) {
      dmText =
        "⭐⭐⭐\nTerima kasih sudah memberikan review. Berikan saran kepada admin bila ada yang perlu ditingkatkan 🙂";
    } else if (stars === 2) {
      dmText =
        "⭐⭐\nApakah ada yang perlu kami bantu? Silakan gunakan channel suggestions untuk menyampaikan kendala kamu.";
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Buka Channel Suggest")
          .setStyle(ButtonStyle.Link)
          .setURL(channelUrl(GUILD_ID, SUGGEST_CHANNEL_ID))
      );
      components = [row];
    } else if (stars === 1) {
      dmText =
        "⭐\nRespon kamu sangat buruk, apa yang bisa kami bantu? Silakan jelaskan masalah kamu di channel suggestions dan staff kami akan membantu secepatnya.";
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Buka Channel Suggest")
          .setStyle(ButtonStyle.Link)
          .setURL(channelUrl(GUILD_ID, SUGGEST_CHANNEL_ID))
      );
      components = [row];
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle("Terima Kasih atas Review-mu!")
      .setDescription(dmText)
      .setColor(0x00ff99)
      .setFooter({ text: "LimeHub - Feedback Member" });

    await safeDM(user, {
      embeds: [dmEmbed],
      components,
    });

    return;
  }

  // ========== 2. HANDLE COMMAND PREFIX (misal: !eletrident) ==========
  if (!message.guild) return; // kita cuma proses command di server (bukan DM)

  const content = message.content.trim();

  // Contoh: 1 command exact: !eletrident
  if (content === "!eletrident") {
    const userId = message.author.id;

    // Kalau user sudah review ⭐1 → hanya boleh ke suggestions
    if (isBlockedToSuggestOnly(userId)) {
      const suggestChannelMention = `<#${SUGGEST_CHANNEL_ID}>`;
      await message.reply({
        content:
          `Kamu memberikan review ⭐ kepada kami.\n` +
          `Untuk sementara, semua interaksi dengan bot dibatasi.\n` +
          `Silakan diskusikan masalahmu di ${suggestChannelMention} dengan staff kami.`,
      });
      return;
    }

    // Kalau user belum review → wajib review dulu
    if (!hasReviewed(userId)) {
      await message.reply({
        content:
          "Kamu belum mengisi formulir review LimeHub. Cek DM dari bot untuk mengisi review sebelum lanjut menggunakan command.",
      });

      const embed = new EmbedBuilder()
        .setTitle("Formulir Kerja & Review LimeHub")
        .setDescription(
          [
            "Halo! Sebelum lanjut menggunakan fitur bot, mohon isi review singkat tentang pengalamanmu di LimeHub.",
            "",
            "Klik tombol **Work** di bawah ini untuk membuka formulir review di channel khusus.",
          ].join("\n")
        )
        .setColor(0x00aaff)
        .setFooter({ text: "LimeHub - Review System" });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("review_work")
          .setLabel("Work (Isi Review)")
          .setStyle(ButtonStyle.Primary)
      );

      await safeDM(message.author, {
        embeds: [embed],
        components: [row],
      });

      return;
    }

    // Kalau sudah review (⭐2-5) → lanjut aksi normal command
    // Di sini contoh simpel: kirim DM lagi dengan info / fitur command.
    const user = message.author;

    const cmdEmbed = new EmbedBuilder()
      .setTitle("Eletrident - Info & Kerjaan")
      .setDescription(
        "Ini adalah respon khusus untuk command `!eletrident`.\n" +
          "Di sini kamu bisa isi info kerja / task khusus LimeHub (silakan kembangkan sendiri)."
      )
      .setColor(0xffcc00);

    await safeDM(user, { embeds: [cmdEmbed] });
  }
});

/* ================== EVENT: INTERACTION CREATE (BUTTON) ================== */

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

  // Kalau user review ⭐1 → semua interaksi hanya arahkan ke suggestion
  if (isBlockedToSuggestOnly(userId)) {
    const suggestChannelMention = `<#${SUGGEST_CHANNEL_ID}>`;
    await interaction.reply({
      content:
        `Kamu memberikan review ⭐ kepada kami.\n` +
        `Semua interaksi dengan bot saat ini hanya diarahkan ke ${suggestChannelMention} untuk diskusi dengan staff.`,
      ephemeral: true,
    });
    return;
  }

  // Tombol Work dari DM
  if (interaction.customId === "review_work") {
    const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);

    if (!reviewChannel) {
      await interaction.reply({
        content:
          "Channel review belum di-set dengan benar. Hubungi admin server.",
        ephemeral: true,
      });
      return;
    }

    // Kirim embed form review di channel review
    const embed = new EmbedBuilder()
      .setTitle("Formulir Review LimeHub")
      .setDescription(
        [
          `${interaction.user}, terima kasih sudah bersedia memberikan review untuk LimeHub!`,
          "",
          "**Cara isi review:**",
          "1. Kirim pesan di channel ini dengan format:",
          "   - Bintang: contoh `⭐⭐⭐⭐⭐` (1–5 bintang).",
          "   - Boleh tambahkan catatan di belakang bintang.",
          "",
          "Contoh:",
          "`⭐⭐⭐⭐⭐ Pelayanan cepat, staff ramah, mantap!`",
          "",
          "Catatan: Jika kamu memberikan ⭐ 1 atau ⭐ 2, staff kami akan mengutamakanmu untuk bantuan di channel suggestions.",
        ].join("\n")
      )
      .setColor(0x3498db)
      .setFooter({ text: "LimeHub - Mohon isi review dengan jujur 🙏" });

    await reviewChannel.send({ embeds: [embed] });

    // Balas di DM kalau tombol dipencet
    await interaction.reply({
      content: `Formulir review sudah dikirim ke <#${REVIEW_CHANNEL_ID}>. Silakan isi di sana ya!`,
      ephemeral: true,
    });
  }
});

/* ================== LOGIN ================== */

client.login(process.env.DISCORD_TOKEN);
