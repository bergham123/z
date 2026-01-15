import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;

import qrcode from "qrcode-terminal";
import fs from "fs-extra";
import path from "path";

// ==================================================
// 1. CONFIGURATION & CONSTANTS
// ==================================================
const CONFIG = {
  files: {
    accounts: "./accounts.json",
    message: "./message.txt",
    contacts: "./my-contact.json", // Requested file
    dashboardDir: "./dashboard",
    sessionDir: "./session",
    aggregate: "./aggregate.json",
    logs: "./automation.log"
  },
  admin: "212642284241@c.us",
  delays: {
    min: 15000, // 15s
    max: 45000  // 45s
  },
  maxRetries: 3
};

// Ensure directories exist
await fs.ensureDir(CONFIG.files.dashboardDir);
await fs.ensureDir(CONFIG.files.sessionDir);

// ==================================================
// 2. UTILITIES & LOGGING
// ==================================================
// Simple logger that saves to file and console
async function logMessage(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}\n`;
  console.log(logLine.trim());
  await fs.appendFile(CONFIG.files.logs, logLine);
}

// Human-like random delay
const randomDelay = () => 
  CONFIG.delays.min + Math.floor(Math.random() * (CONFIG.delays.max - CONFIG.delays.min));

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ==================================================
// 3. STATE MANAGEMENT (Safe Shutdown & Resume)
// ==================================================
const today = new Date().toISOString().split("T")[0];
const dashboardPath = path.join(CONFIG.files.dashboardDir, `dashboard-${today}.json`);

// Initialize dashboard for today
let dashboard = {
  date: today,
  total: 0,
  sent: [],
  failed: [],
  skipped: [] // Track numbers not on WhatsApp
};

// Load existing dashboard if we are resuming
if (await fs.pathExists(dashboardPath)) {
  const saved = await fs.readJson(dashboardPath);
  // Merge saved data to resume
  dashboard = { ...dashboard, ...saved };
  await logMessage(`Resuming from previous state. Sent: ${dashboard.sent.length}, Failed: ${dashboard.failed.length}`);
}

let isShuttingDown = false;

// Graceful shutdown handler
async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  await logMessage(`Received ${signal}. Saving state before exit...`);
  await saveDashboard();
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

async function saveDashboard() {
  await fs.writeJson(dashboardPath, dashboard, { spaces: 2 });
}

// ==================================================
// 4. CONTACTS MODULE (Export Logic)
// ==================================================
async function exportContacts(client) {
  await logMessage("Fetching contacts from WhatsApp...");
  
  try {
    const contacts = await client.getContacts();
    const validContacts = [];

    for (const contact of contacts) {
      // Filter out groups and empty numbers
      if (contact.id.server !== 'c.us' || !contact.number) continue;
      // Filter out business accounts or unknowns if needed
      if (contact.isMe) continue;

      validContacts.push({
        name: contact.pushname || contact.name || contact.number,
        phone: contact.number
      });
    }

    // Sort alphabetically by name
    validContacts.sort((a, b) => a.name.localeCompare(b.name));

    await fs.writeJson(CONFIG.files.contacts, validContacts, { spaces: 2 });
    await logMessage(`Saved ${validContacts.length} contacts to ${CONFIG.files.contacts}`);
    
  } catch (err) {
    await logMessage(`Failed to export contacts: ${err.message}`, "ERROR");
  }
}

// ==================================================
// 5. CAMPAIGN CORE (Smart Sending)
// ==================================================
async function runCampaign(client) {
  // 5.1 Export Contacts first (Requested Feature)
  await exportContacts(client);

  // 5.2 Load Inputs
  if (!await fs.pathExists(CONFIG.files.accounts)) {
    throw new Error("accounts.json not found!");
  }
  const rawNumbers = await fs.readJson(CONFIG.files.accounts);
  const message = await fs.readFile(CONFIG.files.message, "utf8");

  await logMessage(`Starting campaign for ${rawNumbers.length} numbers.`);

  // 5.3 Processing Loop
  for (const num of rawNumbers) {
    if (isShuttingDown) break;

    // RESUME LOGIC: Skip if already sent or processed today
    if (dashboard.sent.includes(num)) {
      await logMessage(`Skipping ${num} (Already sent)`);
      continue;
    }
    if (dashboard.failed.includes(num)) {
      // Optional: Don't retry failed numbers automatically, or handle differently
      await logMessage(`Skipping ${num} (Previously failed)`);
      continue;
    }

    // VALIDATE NUMBER: Check if number exists on WhatsApp
    const numberDetails = await client.getNumberId(num);
    if (!numberDetails) {
      dashboard.skipped.push(num);
      await logMessage(`Skipping ${num} (Not on WhatsApp)`);
      continue;
    }

    const chatId = numberDetails._serialized; // Use the validated ID

    // RETRY LOGIC
    let success = false;
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      if (isShuttingDown) break;
      
      try {
        await client.sendMessage(chatId, message);
        success = true;
        break;
      } catch (err) {
        await logMessage(`Attempt ${attempt} failed for ${num}: ${err.message}`);
        if (attempt < CONFIG.maxRetries) await wait(5000); // Short delay before retry
      }
    }

    // Update State
    if (success) {
      dashboard.sent.push(num);
      dashboard.total++;
      await logMessage(`✅ Sent to ${num}`);
      // SAVE AFTER EVERY SUCCESS (Checkpointing)
      await saveDashboard(); 
    } else {
      dashboard.failed.push(num);
      await logMessage(`❌ Permanently failed ${num}`, "ERROR");
      await saveDashboard();
    }

    // HUMAN DELAY
    const delay = randomDelay();
    await logMessage(`⏳ Waiting ${Math.round(delay / 1000)}s...`);
    await wait(delay);
  }

  await finishCampaign(client);
}

async function finishCampaign(client) {
  await logMessage("Campaign finished. Generating aggregate report...");

  // Aggregate JSON Logic
  const allDashboards = await fs.readdir(CONFIG.files.dashboardDir);
  const aggregate = [];
  for (const file of allDashboards) {
    if (file.endsWith(".json")) {
      const data = await fs.readJson(path.join(CONFIG.files.dashboardDir, file));
      aggregate.push({ date: data.date, total: data.total });
    }
  }
  await fs.writeJson(CONFIG.files.aggregate, aggregate, { spaces: 2 });

  // Send Report to Admin
  const report = `
📊 *Reporte Diario*
------------------
📅 Fecha: ${today}
✅ Enviados: ${dashboard.sent.length}
❌ Fallidos: ${dashboard.failed.length}
🚫 No WhatsApp: ${dashboard.skipped.length}
------------------
📂 Contacts saved to: ${CONFIG.files.contacts}
  `;

  await client.sendMessage(CONFIG.files.admin, report);
  await logMessage("Report sent to admin. Process complete.");
  
  // Keep process running or exit? 
  // For automation, we usually exit. For bot, we keep alive.
  // Based on original script:
  process.exit(0);
}

// ==================================================
// CLIENT INITIALIZATION
// ==================================================
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "main",
    dataPath: CONFIG.files.sessionDir
  }),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true
  }
});

client.on("qr", qr => {
  console.log("🔐 Scan QR:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  await logMessage("✅ WhatsApp Client Ready");
  try {
    await runCampaign(client);
  } catch (error) {
    await logMessage(`Critical Error: ${error.message}`, "ERROR");
    process.exit(1);
  }
});

client.on("auth_failure", msg => {
  console.error("Authentication failure:", msg);
});

client.initialize();
