const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { verifyEmailConnection } = require('./utils/email');
const { verifyWhatsAppConnection } = require('./utils/whatsapp');
const { processReturnReminders } = require('./utils/reminders');
const fs = require('fs');
const { mkdirSync } = require('fs');
if (!fs.existsSync(path.join(__dirname, 'data'))) mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// Read from the environment rather than utils/settings so the banner and the
// health endpoint never depend on the database being open.
const APP_SHORT_NAME = process.env.ORG_SHORT_NAME || 'KIMS';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Every /api response is per-user, dynamic data -- never let a browser,
// proxy, or tunnel cache it and serve a stale copy on the next fetch.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
// Public center list + branding, needed by the login and registration screens
// before a token exists. Authenticated center management lives under
// /api/admin/centers.
app.use('/api/centers', require('./routes/centers'));
app.use('/api/components', require('./routes/components'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/transfers', require('./routes/transfers'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/programs', require('./routes/programs'));
app.use('/api/internal-issues', require('./routes/internal-issues'));
app.use('/api/procurement', require('./routes/procurement'));

// Catalog photos, either the small original curated set or ones uploaded
// via POST /api/assets/upload-image (see routes/assets.js) -- same-origin
// static files, so no CORS/hotlink proxy is needed the way externally
// -hosted (Drive) component photos require. Filenames are random UUIDs
// assigned once at upload time and never reused, so it's safe to let
// browsers cache them indefinitely instead of re-fetching on every visit.
app.use('/catalog-images', express.static(path.join(__dirname, 'data', 'catalog_images'), {
  maxAge: '30d',
  immutable: true,
}));

// Serve frontend build in production
const frontendBuild = path.join(__dirname, '../frontend/build');
const frontendIndex = path.join(frontendBuild, 'index.html');

if (fs.existsSync(frontendIndex)) {
  // Hashed JS/CSS bundles (main.<hash>.js) are safe to cache forever -- their
  // filename changes whenever their content does. index.html is NOT hashed,
  // so it must always be revalidated, or browsers keep loading an old JS
  // bundle reference after every new deploy and never see the update.
  app.use(express.static(frontendBuild, { index: false }));
  app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(frontendIndex);
  });
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
  <title>${APP_SHORT_NAME} Setup Required</title>
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
    <h1>${APP_SHORT_NAME} backend is running, but the React app has not been built yet.</h1>
    <p>The API is available, but <code>frontend/build/index.html</code> is missing, so the browser cannot load the user interface at this address.</p>
    <div class="status">
      <span>API health: <a href="/api/health">/api/health</a></span>
      <span>Frontend folder: ../frontend</span>
    </div>
    <div class="section">
      <p>Build the frontend, then restart the backend:</p>
      <div class="code">cd KIMS/frontend
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
  res.json({ status: `${APP_SHORT_NAME} Running`, time: new Date(), email, whatsapp });
});

const PORT = process.env.PORT || 5000;
const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
app.listen(PORT, async () => {
  console.log(`\n🚀 ${APP_SHORT_NAME} Backend running on http://localhost:${PORT}`);
  console.log(`📊 API Health: http://localhost:${PORT}/api/health`);
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

