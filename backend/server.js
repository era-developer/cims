const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initInventory, initUsers, FILES } = require('./utils/excel');
const { verifyEmailConnection } = require('./utils/email');
const { verifyWhatsAppConnection } = require('./utils/whatsapp');
const { processReturnReminders } = require('./utils/reminders');
const fs = require('fs');
const { mkdirSync } = require('fs');
if (!fs.existsSync(path.join(__dirname, 'data'))) mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/components', require('./routes/components'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/webhooks', require('./routes/webhooks'));

// Serve frontend build in production
const frontendBuild = path.join(__dirname, '../frontend/build');
const frontendIndex = path.join(frontendBuild, 'index.html');

if (fs.existsSync(frontendIndex)) {
  app.use(express.static(frontendBuild));
  app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => res.sendFile(frontendIndex));
} else {
  app.get(/^\/(?!api(?:\/|$)).*/, (_, res) => {
    res
      .status(503)
      .type('html')
      .send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CIMS Setup Required</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7fb;
      --card: #ffffff;
      --text: #16213e;
      --muted: #5f6b82;
      --brand: #1a237e;
      --accent: #ff6d00;
      --border: #dbe3f0;
      --shadow: 0 20px 50px rgba(26, 35, 126, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: "Segoe UI", Arial, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(255, 109, 0, 0.12), transparent 32%),
        radial-gradient(circle at bottom right, rgba(26, 35, 126, 0.12), transparent 36%),
        var(--bg);
      color: var(--text);
    }
    .card {
      width: min(760px, 100%);
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 32px;
      box-shadow: var(--shadow);
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(28px, 5vw, 40px);
      line-height: 1.1;
    }
    p {
      margin: 0 0 16px;
      color: var(--muted);
      line-height: 1.6;
    }
    .pill {
      display: inline-block;
      margin-bottom: 16px;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(255, 109, 0, 0.12);
      color: var(--accent);
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .section {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }
    .code {
      margin-top: 12px;
      padding: 14px 16px;
      border-radius: 14px;
      background: #0f172a;
      color: #e2e8f0;
      font-family: Consolas, "Courier New", monospace;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .status {
      margin-top: 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .status span {
      padding: 10px 14px;
      border-radius: 12px;
      background: #eef2ff;
      color: var(--brand);
      font-weight: 600;
    }
    a { color: var(--brand); }
  </style>
</head>
<body>
  <main class="card">
    <div class="pill">Frontend build missing</div>
    <h1>CIMS backend is running, but the React app has not been built yet.</h1>
    <p>The API is available, but <code>frontend/build/index.html</code> is missing, so the browser cannot load the user interface at this address.</p>
    <div class="status">
      <span>API health: <a href="/api/health">/api/health</a></span>
      <span>Frontend folder: ../frontend</span>
    </div>
    <div class="section">
      <p>Build the frontend, then restart the backend:</p>
      <div class="code">cd cims/frontend
npm install
npm run build</div>
    </div>
    <div class="section">
      <p>After the build finishes, open <code>http://localhost:${process.env.PORT || 5000}</code> again.</p>
    </div>
  </main>
</body>
</html>`);
  });
}

app.get('/api/health', async (_, res) => {
  const email = await verifyEmailConnection();
  const whatsapp = await verifyWhatsAppConnection();
  res.json({ status: 'CIMS Running', time: new Date(), email, whatsapp });
});

// Init Excel files on first run
async function init() {
  if (!fs.existsSync(FILES.inventory)) {
    console.log('📦 Initializing inventory with dummy data...');
    await initInventory();
  }
  if (!fs.existsSync(FILES.users)) {
    console.log('👤 Initializing default users...');
    await initUsers();
  }
}

const PORT = process.env.PORT || 5000;
const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
app.listen(PORT, async () => {
  console.log(`\n🚀 CIMS Backend running on http://localhost:${PORT}`);
  console.log(`📊 API Health: http://localhost:${PORT}/api/health`);
  await init();
  const emailStatus = await verifyEmailConnection();
  if (emailStatus.ok) {
    console.log(`[EMAIL READY] ${emailStatus.message}`);
  } else {
    console.error(`[EMAIL WARNING] ${emailStatus.message}`);
  }
  const whatsappStatus = await verifyWhatsAppConnection();
  if (whatsappStatus.ok) {
    console.log(`[WHATSAPP READY] ${whatsappStatus.message}`);
  } else {
    console.error(`[WHATSAPP WARNING] ${whatsappStatus.message}`);
  }
  try {
    const reminderResult = await processReturnReminders();
    console.log(`[REMINDERS] checked=${reminderResult.checked} eligible=${reminderResult.eligible} sent=${reminderResult.sent}`);
  } catch (err) {
    console.error(`[REMINDERS WARNING] ${err.message}`);
  }
  console.log('✅ Ready!\n');
});

setInterval(async () => {
  try {
    const reminderResult = await processReturnReminders();
    if (reminderResult.eligible || reminderResult.sent) {
      console.log(`[REMINDERS] checked=${reminderResult.checked} eligible=${reminderResult.eligible} sent=${reminderResult.sent}`);
    }
  } catch (err) {
    console.error(`[REMINDERS WARNING] ${err.message}`);
  }
}, REMINDER_INTERVAL_MS);
