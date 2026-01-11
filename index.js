import { Client, LocalAuth } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import fs from "fs-extra";

const ACCOUNTS_FILE = "./accounts.json";
const MESSAGE_FILE = "./message.txt";
const DASHBOARD_DIR = "./dashboard";
const ADMIN_NUMBER = "212642284241@c.us";

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = () => 20000 + Math.floor(Math.random() * 20000);

const today = new Date().toISOString().split("T")[0];
const dashboardPath = `${DASHBOARD_DIR}/dashboard-${today}.json`;

await fs.ensureDir(DASHBOARD_DIR);

const dashboard = {
  date: today,
  total: 0,
  sent: [],
  failed: []
};

const client = new Client({
  authStrategy: new LocalAuth(),
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
  console.log("✅ WhatsApp Ready");

  const numbers = await fs.readJson(ACCOUNTS_FILE);
  const message = await fs.readFile(MESSAGE_FILE, "utf8");

  for (const num of numbers) {
    const chatId = `${num}@c.us`;

    try {
      await client.sendMessage(chatId, message);
      dashboard.sent.push(num);
      dashboard.total++;
      console.log(`✔ Sent to ${num}`);
    } catch (err) {
      dashboard.failed.push(num);
      console.log(`❌ Failed ${num}`);
    }

    const delay = randomDelay();
    console.log(`⏳ Waiting ${delay / 1000}s`);
    await wait(delay);
  }

  await fs.writeJson(dashboardPath, dashboard, { spaces: 2 });

  await client.sendMessage(
    ADMIN_NUMBER,
    `✅ WhatsApp Automation Finished
📅 Date: ${today}
📤 Total Sent: ${dashboard.total}`
  );

  console.log("📊 Dashboard saved");
  process.exit(0);
});

client.initialize();
