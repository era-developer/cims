# KIMS - Kalam Pragati Inventory Management System

> **Kalam Pragati** — *Empowering Engineers with Skills for Success* — an initiative of the ERA Foundation.

KIMS manages the component inventory of Kalam Pragati centers: what is in stock, which
student has borrowed what, admin approvals, returns, damage, invoices, and
center-to-center transfers. Every physical unit is tracked individually by asset tag.

It is a fork of the ERA Foundation's CIMS (Comedkare) portal, running as a fully separate
deployment. See [KIMS_DEPLOYMENT.md](KIMS_DEPLOYMENT.md) for how the two are kept apart.

---

## Quick start

```bash
cd D:\KIMS\backend
node server.js
```

Open <http://localhost:5001>.

In production KIMS runs as the Windows service **`KIMS`** (installed by
`install-kims-service.ps1`), so it is normally already up.

There are no default credentials. The super admin account was created by the seed
script and its password was shown once at seed time; change it from **My Profile**
after first login. Create every other account from **Admin → Users**.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, React Router 6 (served as a static build by the backend) |
| Backend | Node.js 22+ / Express |
| Database | SQLite via Node's built-in `node:sqlite` — one file, `backend/data/kims.db` |
| Email | Nodemailer over Gmail SMTP |
| WhatsApp | n8n webhook → Meta WhatsApp Cloud API (optional) |
| Reports | ExcelJS (Excel exports), PDFKit (invoice / order PDFs) |
| Auth | JWT + bcryptjs |
| Service | NSSM Windows service (PM2 config also provided) |

---

## Project structure

```text
KIMS/
|-- backend/
|   |-- server.js              Express app; serves API + built frontend on one port
|   |-- .env                   Port, DB path, JWT secret, SMTP, WhatsApp (not in git)
|   |-- db/migrations/         Schema, applied automatically at startup
|   |-- routes/                auth, centers, components, orders, admin, invoices, assets,
|   |                          transfers, programs, procurement, internal-issues, webhooks
|   |-- utils/                 centers.js, settings.js, email.js, whatsapp.js, db.js ...
|   |-- scripts/
|   |   |-- seed-kims.js            Build a fresh KIMS database
|   |   |-- link-catalog-images.js  Carry component photos over from CIMS
|   |   `-- legacy-centers.js       Frozen list for the old Comedkare migration scripts
|   `-- data/
|       |-- kims.db            The database
|       |-- catalog_images/    Component photos
|       `-- invoice_documents/ Uploaded invoice scans
|-- frontend/
|   |-- src/                   React app
|   `-- build/                 Production build (generated)
|-- install-kims-service.ps1   Install as the KIMS Windows service
|-- KIMS_DEPLOYMENT.md         Deployment, isolation from CIMS, what to configure
|-- USER_MANUAL_ADMIN_SUPERADMIN.md
|-- USER_MANUAL_STUDENT.md
|-- CHEAT_SHEET_ADMIN_SUPERADMIN.md
`-- CHEAT_SHEET_STUDENT.md
```

---

## Installation

### Prerequisites

- Node.js **v22 or later** (the `node:sqlite` module ships with Node)
- npm

### Build and run

```bash
cd D:\KIMS\frontend && npm install && npm run build
```

```bash
cd D:\KIMS\backend && npm install && node server.js
```

The backend serves the built React app from `frontend/build`, so after the build only
`node server.js` (or the Windows service) is needed.

### Configure `backend/.env`

```env
PORT=5001
KIMS_DB_PATH=./data/kims.db
JWT_SECRET=<long random string, unique to this deployment>

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<kalam pragati gmail address>
SMTP_PASS=<gmail app password>

# Public URL (email footers, registration QR)
SITE_URL=http://localhost:5001

# WhatsApp via n8n (optional)
N8N_WHATSAPP_ENABLED=false
# N8N_WHATSAPP_OUTBOUND_WEBHOOK=
# N8N_WHATSAPP_SHARED_SECRET=
```

Gmail App Password: Google Account → Security → 2-Step Verification → App Passwords →
create one for Mail, and use it as `SMTP_PASS`.

**Notification recipients and branding are not in `.env`.** The order-notification
email, admin WhatsApp number, organisation name and sender name are stored in the
database and edited under **Admin → Settings** — no restart needed. The `.env` values
are only fallbacks.

---

## Running as a Windows service

From an elevated PowerShell:

```bash
powershell -ExecutionPolicy Bypass -File D:\KIMS\install-kims-service.ps1
```

Then:

```bash
Restart-Service KIMS
```

Logs: `backend\nssm-out.log`, `backend\nssm-err.log`.
Health: <http://localhost:5001/api/health> — reports whether SMTP and WhatsApp are configured.

### Rebuild after frontend changes

```bash
cd D:\KIMS\frontend && npm run build
```

Then `Restart-Service KIMS` (or restart `node server.js`).

### Frontend development mode (hot reload)

```bash
cd D:\KIMS\frontend && npm start
```

Opens on <http://localhost:3000>. Update the `proxy` in `frontend/package.json` to
`http://localhost:5001` if the dev server cannot reach the API.

---

## Data

Everything lives in one SQLite file, `backend/data/kims.db`. Back it up by copying the
file (stop the service first, or copy `kims.db`, `kims.db-wal` and `kims.db-shm` together).

Key tables:

| Table | Contents |
|-------|---------|
| `centers` | Centers (managed from Admin → Settings) |
| `app_settings` | Org name, notification email, WhatsApp number, sender name |
| `users` / `students` | Accounts and student profiles |
| `product_catalog` | Component types, per center |
| `assets` | Every physical unit, with its tag and lifecycle status |
| `issue_records` | Student orders and what was issued / returned / damaged |
| `invoices` | Procurement invoices and line items |
| `transfers` | Center-to-center loans |
| `activity_logs` | Audit trail |

Stock is not a stored number: it is the count of `assets` with status `available`.

### Rebuilding the database from scratch

```bash
cd D:\KIMS\backend\scripts
node seed-kims.js --db ../data/kims.db --apply
node link-catalog-images.js --db ../data/kims.db --apply
```

The seed refuses to run against a database that already has data.

---

## Features

### Student portal
- Self-registration (approved by a center admin), login with username or email
- Browse components with photos, search and classification filters, live stock
- Cart → checkout with project details, team members and terms acceptance
- Email OTP confirmation on order submission
- Track orders, request returns, keep profile updated
- WhatsApp handoff to the center admin after ordering (when configured)

### Admin portal
- Center dashboard: stock, low stock, pending orders and registrations, asset values
- Inventory: components and individual asset units, tag codes, photos, warranty,
  damage/consumption with reasons, internal issue and return for staff use
- Orders: approve with quantity edits, reject, process returns and damage
- Invoices: procurement entry with line items, GST, vendor, attached scans, PDF
- Users: approve registrations, create and manage accounts
- Programs and per-program issue history
- My Center: request components from other centers or from the super admin
- Excel exports: inventory, orders, users, transfers, activity logs

### Super admin only
- Everything above across all centers, plus analytics
- **Settings**: add / edit / deactivate centers; set the order-notification email and
  admin WhatsApp number, org-wide and per center
- Transfers: approve center-to-center loans and returns
- Procurement requests from centers

### Notifications
- Order placed → email to the center's notification address (or the org default)
- Order approved / rejected / return reminders → email to the student
- Optional WhatsApp equivalents through n8n

---

## Access

- **Public (anywhere):** <https://kalampragati.s.gy/kims> (short link →
  <https://kims.tailf03e8e.ts.net>, served through Tailscale Funnel from this PC). See `KIMS_DEPLOYMENT.md` for how it works and how to manage it.
- **Same network:** find this machine's IP (`ipconfig`) and open `http://YOUR_IP:5001`.

---

## Customisation

- **Logo**: replace `frontend/public/logo.png` and `backend/assets/logo.png`, then rebuild.
- **Names / colours**: `REACT_APP_ORG_NAME`, `REACT_APP_APP_SHORT_NAME`,
  `REACT_APP_PRIMARY_COLOR` at build time; `ORG_NAME`, `ORG_SHORT_NAME`,
  `EMAIL_SENDER_NAME` in `backend/.env`; or edit at runtime in Admin → Settings.
- **Order form fields**: `frontend/src/pages/Cart.jsx`, `INITIAL_DETAILS`.

---

## License

MIT License — free for academic and educational use.
