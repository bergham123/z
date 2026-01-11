const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode"); // Make sure to install this: npm install qrcode
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

// ─── CONFIG ─────────────────────────────
const DELAY_MIN = 20 * 1000; 
const DELAY_MAX = 60 * 1000; 
const IMAGE_PATH = path.join(__dirname, "images.webp");
const LINK = "https://your-site.com"; 

const CONTACTS_FILE = path.join(__dirname, "contacts.json");
const PROGRESS_FILE = path.join(__dirname, "progress.json");
const LOG_FILE = path.join(__dirname, "messages.txt");

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

const { generateMessage } = require("./textSpin.js");

// ─── WHATSAPP CLIENT ──────────────────
const client = new Client({
  authStrategy: new LocalAuth({ 
      clientId: "hello-bot",
      dataPath: "./.wwebjs_auth" // Explicitly define where to save session
  }),
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
  console.log("\nQR RECEIVED. Saving to qr.png...");
  // Save QR to file so we can download it from GitHub Actions Artifacts
  await qrcode.toFile('./qr.png', qr);
  console.log("Scan the QR code in the Artifacts section of this run.");
});

client.on("authenticated", () => {
  console.log("✅ Authenticated! Saving session...");
});

client.on("auth_failure", (msg) => console.error("❌ Auth failure:", msg));

client.on("ready", async () => {
  console.log("🤖 Bot ready. Checking for saved session...");
  
  // Delete the QR file since we don't need it anymore (cleanup)
  if (fs.existsSync("./qr.png")) fs.unlinkSync("./qr.png");

  console.log("🚀 Sending messages...");

  let media = null;
  if (fs.existsSync(IMAGE_PATH)) {
    const imageData = fs.readFileSync(IMAGE_PATH);
    media = new MessageMedia("image/webp", imageData.toString("base64"), "promo.webp");
  }

  const nextContacts = contacts.filter((c) => !progress.sent.includes(c));

  if (nextContacts.length === 0) {
    console.log("✅ All contacts finished.");
    process.exit(0);
  }

  for (const number of nextContacts) {
    try {
      const text = generateMessage();
      const fullMessage = media ? text + "\n" + LINK : text + "\n" + LINK;

      if (media) {
        await client.sendMessage(number + "@c.us", media, { caption: fullMessage });
      } else {
        await client.sendMessage(number + "@c.us", fullMessage);
      }

      const timestamp = new Date().toISOString();
      appendLog(`[${timestamp}] SENT_TO:${number} MSG:${fullMessage}`);
      progress.sent.push(number);
      saveJSON(PROGRESS_FILE, progress);

      const wait = random(DELAY_MIN, DELAY_MAX);
      console.log(`⏱ Waiting ${wait / 1000}s...`);
      await delay(wait);
    } catch (err) {
      console.error("Error sending to", number, err);
    }
  }

  console.log("✅ Batch complete.");
  process.exit(0);
});

// ─── INITIALIZE CLIENT ───────────────
client.initialize();
