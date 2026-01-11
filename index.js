const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

// ─── CONFIG ─────────────────────────────
const DELAY_MIN = 20 * 1000; // 20 seconds
const DELAY_MAX = 60 * 1000; // 60 seconds
const IMAGE_PATH = path.join(__dirname, "images.webp");
const LINK = "https://your-site.com"; // your link

const CONTACTS_FILE = path.join(__dirname, "contacts.json");
const PROGRESS_FILE = path.join(__dirname, "progress.json");
const LOG_FILE = path.join(__dirname, "messages.txt");

// Session directory for persistence
const SESSION_DIR = path.join(__dirname, ".wwebjs_auth");

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

// Check if session exists
function checkSessionExists() {
  return fs.existsSync(SESSION_DIR);
}

// ─── LOAD CONTACTS & PROGRESS ──────────
const contactsData = loadJSON(CONTACTS_FILE, { contacts: [] });
const progress = loadJSON(PROGRESS_FILE, { sent: [] });
const contacts = contactsData.contacts;

// ─── LOAD TEXT SPIN ────────────────────
const { generateMessage } = require("./textSpin.js");

// ─── WHATSAPP CLIENT ──────────────────
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "hello-bot",
    dataPath: __dirname // Store session in current directory
  }),
  puppeteer: {
    headless: "new", // Use new headless mode
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-setuid-sandbox",
      "--disable-infobars"
    ],
  },
});

// ─── QR & AUTH HANDLERS ───────────────
let qrGenerated = false;

client.on("qr", (qr) => {
  if (!qrGenerated) {
    console.log("\n⚠️ Session not found. Please scan this QR code with WhatsApp 👇\n");
    qrcode.generate(qr, { small: true });
    console.log("\n⚠️ IMPORTANT: After scanning, let the bot run for 5-10 seconds to save the session.");
    console.log("⚠️ Then manually stop this run and trigger the workflow again.\n");
    qrGenerated = true;
  }
});

client.on("authenticated", () => {
  console.log("✅ Authenticated! Session will be saved.");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Auth failure:", msg);
});

client.on("ready", async () => {
  console.log("🤖 Bot ready, sending all unsent contacts...");

  // ─── LOAD IMAGE ───────────────────────
  let media = null;
  if (fs.existsSync(IMAGE_PATH)) {
    try {
      const imageData = fs.readFileSync(IMAGE_PATH);
      media = new MessageMedia("image/webp", imageData.toString("base64"), "promo.webp");
    } catch (err) {
      console.error("Error loading image:", err);
    }
  }

  // ─── SEND MESSAGES ───────────────────
  const nextContacts = contacts.filter((c) => !progress.sent.includes(c));

  if (nextContacts.length === 0) {
    console.log("✅ All contacts finished. Nothing to send.");
    return;
  }

  console.log(`📤 Found ${nextContacts.length} contacts to send messages to...`);

  for (const number of nextContacts) {
    try {
      const text = generateMessage();
      const fullMessage = media ? text + "\n" + LINK : text + "\n" + LINK;

      console.log(`📨 Sending to: ${number}`);

      if (media) {
        await client.sendMessage(number + "@c.us", media, { caption: fullMessage });
      } else {
        await client.sendMessage(number + "@c.us", fullMessage);
      }

      // ─── LOG & UPDATE PROGRESS ─────────
      const timestamp = new Date().toISOString();
      appendLog(`[${timestamp}] SENT_TO:${number} MSG:${fullMessage}`);
      progress.sent.push(number);
      saveJSON(PROGRESS_FILE, progress);

      // ─── RANDOM DELAY ─────────────────
      const wait = random(DELAY_MIN, DELAY_MAX);
      console.log(`⏱ Sent to ${number}. Waiting ${wait / 1000}s before next message...`);
      await delay(wait);

    } catch (err) {
      console.error(`❌ Error sending message to ${number}:`, err.message);
      // Continue with next contact instead of stopping
    }
  }

  console.log("✅ All messages sent for this run!");
  
  // Give time for session to save properly
  await delay(5000);
  
  // Don't exit immediately - let session save
  console.log("🔄 Session saved. You can now stop the bot.");
  
  // Keep the process alive
  process.exit(0);
});

// ─── ERROR HANDLING ──────────────────
client.on("disconnected", (reason) => {
  console.log("Client was logged out", reason);
});

// ─── INITIALIZE CLIENT ───────────────
console.log("🔍 Checking for existing session...");
if (checkSessionExists()) {
  console.log("✅ Found existing session. No need to scan QR code.");
} else {
  console.log("❌ No session found. QR code will be generated.");
}

client.initialize();

// Handle process termination gracefully
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await client.destroy();
  process.exit(0);
});
