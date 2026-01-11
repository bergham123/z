const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

// ─── CONFIG ─────────────────────────────
const DELAY_MIN = 20 * 1000; // 20 seconds
const DELAY_MAX = 60 * 1000; // 60 seconds
const IMAGE_PATH = path.join(__dirname, "images.webp");
const LINK = "https://your-site.com"; // your link

const CONTACTS_FILE = path.join(__dirname, "contacts.json");
const PROGRESS_FILE = path.join(__dirname, "progress.json");
const LOG_FILE = path.join(__dirname, "messages.txt");
const QR_IMAGE_PATH = path.join(__dirname, "qr-session.png");

// ─── UTILS ─────────────────────────────
function loadJSON(filePath, defaultData) {
  try {
    if (!fs.existsSync(filePath)) return defaultData;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return defaultData;
  }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function appendLog(line) {
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── LOAD CONTACTS & PROGRESS ──────────
const contactsData = loadJSON(CONTACTS_FILE, { contacts: [] });
const progress = loadJSON(PROGRESS_FILE, { sent: [] });
const contacts = contactsData.contacts;

// ─── LOAD TEXT SPIN ────────────────────
const { generateMessage } = require("./textSpin.js");

// ─── WHATSAPP CLIENT ──────────────────
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "hello-bot" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  },
});

// ─── QR & AUTH HANDLERS ───────────────
client.on("qr", async (qr) => {
  console.log("\nScan this QR code with WhatsApp 👇\n");
  qrcode.generate(qr, { small: true });

  // SAVE QR IMAGE
  try {
    await QRCode.toFile(QR_IMAGE_PATH, qr);
    console.log("💾 QR saved to:", QR_IMAGE_PATH);
  } catch (err) {
    console.error("❌ Failed to save QR image", err);
  }
});

client.on("authenticated", () =>
  console.log("✅ Authenticated! Session saved.")
);

client.on("auth_failure", (msg) =>
  console.error("❌ Auth failure:", msg)
);

// ─── READY ────────────────────────────
client.on("ready", async () => {
  console.log("🤖 Bot ready, sending all unsent contacts...");

  // LOAD IMAGE
  let media = null;
  if (fs.existsSync(IMAGE_PATH)) {
    const imageData = fs.readFileSync(IMAGE_PATH);
    media = new MessageMedia(
      "image/webp",
      imageData.toString("base64"),
      "promo.webp"
    );
  }

  // SEND MESSAGES
  const nextContacts = contacts.filter(
    (c) => !progress.sent.includes(c)
  );

  if (nextContacts.length === 0) {
    console.log("✅ All contacts finished. Nothing to send.");
    return;
  }

  for (const number of nextContacts) {
    try {
      const text = generateMessage();
      const fullMessage = text + "\n" + LINK;

      if (media) {
        await client.sendMessage(
          number + "@c.us",
          media,
          { caption: fullMessage }
        );
      } else {
        await client.sendMessage(
          number + "@c.us",
          fullMessage
        );
      }

      // LOG & SAVE PROGRESS
      const timestamp = new Date().toISOString();
      appendLog(
        `[${timestamp}] SENT_TO:${number} MSG:${fullMessage}`
      );
      progress.sent.push(number);
      saveJSON(PROGRESS_FILE, progress);

      // RANDOM DELAY
      const wait = random(DELAY_MIN, DELAY_MAX);
      console.log(`⏱ Waiting ${wait / 1000}s before next message...`);
      await delay(wait);
    } catch (err) {
      console.error("❌ Error sending message to", number, err);
    }
  }

  console.log("✅ All messages sent for this run!");
  process.exit(0);
});

// ─── INIT ─────────────────────────────
client.initialize();


