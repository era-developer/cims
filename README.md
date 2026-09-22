# CIMS - Comedkares Innovation Hub Inventory Management System

> **Comedkares Innovation Hub** — an initiative of the ERA Foundation.

CIMS manages the component inventory of the nine Comedkares Innovation Hub centers:
what is in stock at each center, which student has borrowed what, admin approvals,
returns, damage, invoices, staff pulls, and lending between centers. Every physical
unit is tracked individually by asset tag and can carry a printed QR label.

The same codebase also runs **KIMS** (Kalam Pragati, `D:\KIMS`) as a fully separate
deployment; features are developed there and merged here. See
[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for how the two stay apart and how CIMS is
deployed to the server.

---

## Quick start

```bash
cd D:\cims\backend
node server.js
```

Open <http://localhost:5000>.

In production CIMS runs as the Windows service **`CIMS`** (installed by
`install-cims-service.ps1`), so it is normally already up.

There are no default credentials in a live database: accounts are created from
**Admin → Users**, and every user can reset their own password with **Forgot
password** on the sign-in page.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, React Router 6 (served as a static build by the backend); installable PWA |
| Backend | Node.js 22+ / Express |
| Database | SQLite via Node's built-in `node:sqlite` — one file, `backend/data/cims.db` |
| Email | Nodemailer over Gmail SMTP |
| Push | Web Push (VAPID) via `web-push` — no third-party account |
| WhatsApp | n8n webhook → Meta WhatsApp Cloud API (optional) |
| Reports | ExcelJS (Excel exports), PDFKit (invoice / order PDFs) |
| QR | `react-qr-code` for labels, `jsqr` / BarcodeDetector for in-browser scanning |
| Auth | JWT + bcryptjs |
| Service | NSSM Windows service (PM2 config also provided) |

---

## Project structure

```text
cims/
|-- backend/
|   |-- server.js              Express app; serves API + built frontend on one port
|   |-- .env                   Port, DB path, JWT secret, SMTP, per-center emails, VAPID (not in git)
|   |-- db/migrations/         Schema, applied automatically at startup
|   |-- routes/                auth, centers, components, orders, transfers, admin, invoices,
|   |                          assets, units, push, notifications, programs, procurement,
|   |                          internal-issues, webhooks
|   |-- utils/                 centers.js, settings.js, email.js, push.js, notifications.js,
|   |                          whatsapp.js, storage.js, db.js ...
|   |-- scripts/
|   |   |-- backup-db.js            Nightly backup (scheduled task "CIMS Backup")
|   |   |-- organize-data.js        Move photos/scans into the data/ layout below (optional)
|   |   |-- dedupe-catalog.js       Merge catalog names that differ only by spacing/case
|   |   |-- merge-catalog.js        Apply a hand-reviewed catalog merge plan
|   |   `-- legacy-centers.js       Frozen list for the old Excel -> SQLite migration scripts
|   |-- legacy_excel_data_archive/  The pre-SQLite Excel workbooks (history only)
|   `-- data/
|       |-- cims.db            The database
|       |-- backups/           Nightly snapshots
|       |-- catalog_images/    Component photos uploaded before Sept 2026 (still served)
|       |-- components/        Component photos uploaded since, named after the component
|       `-- invoices/          Invoice scans: <center code>/<year>/<invoice no>/<original name>
|-- frontend/
|   |-- src/                   React app
|   |-- public/                index.html, logo, PWA manifest, icons, service worker
|   `-- build/                 Production build (generated)
|-- install-cims-service.ps1   Install as the CIMS Windows service
|-- install-cims-backup-task.ps1  Register the nightly backup task
|-- DEPLOYMENT_GUIDE.md        Deploying to the server, DuckDNS, updating, restoring
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
cd D:\cims\frontend && npm install && npm run build
```

```bash
cd D:\cims\backend && npm install && node server.js
```

The backend serves the built React app from `frontend/build`, so after the build only
`node server.js` (or the Windows service) is needed. Use `npm run build` (not
`react-scripts build` directly) so the service-worker cache version gets stamped.

### Configure `backend/.env`

```env
PORT=5000
CIMS_DB_PATH=./data/cims.db
JWT_SECRET=<long random string, 32+ characters; the server refuses to start without one>

# Email (common SMTP sender for all centers)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=comedkares.cims@gmail.com
SMTP_PASS=<gmail app password>

# Per-center order-notification mailboxes ({CENTER_ID}_EMAIL), with an org-wide fallback
JP_NAGAR_EMAIL=blrjpnagar.hub@comedkares.org
YELAHANKA_EMAIL=blryelahanka.hub@comedkares.org
# ... one per center ...
CENTER_EMAIL=<org-wide fallback>
ADMIN_EMAIL=<super admin address for transfer / procurement mail>

# Public URL (email footers, registration QR)
SITE_URL=https://comedkares.s.gy/cims

# Branding fallbacks (the live values are edited in Admin -> Settings)
ORG_NAME=Comedkares Innovation Hub
ORG_SHORT_NAME=CIMS
ORG_TAGLINE=Comedkares Innovation Hub
EMAIL_SENDER_NAME=Comedkares Innovation Hub - CIMS

# Browser push notifications (generate once: node -e "console.log(require('web-push').generateVAPIDKeys())")
VAPID_PUBLIC_KEY=<from generateVAPIDKeys>
VAPID_PRIVATE_KEY=<from generateVAPIDKeys>
VAPID_SUBJECT=mailto:comedkares.cims@gmail.com

# WhatsApp via n8n (optional)
N8N_WHATSAPP_ENABLED=false
# N8N_WHATSAPP_OUTBOUND_WEBHOOK=
# N8N_WHATSAPP_SHARED_SECRET=
# N8N_WHATSAPP_ADMIN_TO=+91...
```

Gmail App Password: Google Account → Security → 2-Step Verification → App Passwords →
create one for Mail, and use it as `SMTP_PASS`.

**Notification recipients and branding are editable without a restart.** The
order-notification email, admin WhatsApp number, org name and sender name live in the
database and are edited under **Admin → Settings**; the `.env` values are fallbacks. A
center's own address set in Settings wins over its `{CENTER_ID}_EMAIL`, which wins over
`CENTER_EMAIL`.

### `frontend/.env` (build time)

```env
REACT_APP_SITE_URL=https://comedkares.s.gy/cims
REACT_APP_ADMIN_LOGIN_URL=https://comedkares.s.gy/cims
```

These are compiled into QR labels and the registration QR, so a scanned code opens the
public site rather than `localhost`. Rebuild after changing them.

---

## Running as a Windows service

From an elevated PowerShell, in the CIMS folder:

```bash
powershell -ExecutionPolicy Bypass -File .\install-cims-service.ps1
```

```bash
powershell -ExecutionPolicy Bypass -File .\install-cims-backup-task.ps1
```

Then `Restart-Service CIMS` after any update. Logs: `backend\nssm-out.log`,
`backend\nssm-err.log`. Health: <http://localhost:5000/api/health> — reports whether
SMTP and WhatsApp are configured.

The scripts take their paths from their own location, so the folder can be copied to
the server as-is. A PM2 alternative is in `backend/ecosystem.config.js`
(`pm2 start ecosystem.config.js`).

### Rebuild after frontend changes

```bash
cd D:\cims\frontend && npm run build
```

Then `Restart-Service CIMS` (or restart `node server.js`).

### Frontend development mode (hot reload)

```bash
cd D:\cims\frontend && npm start
```

Opens on <http://localhost:3000>, proxying the API to port 5000.

---

## Data

The database is one SQLite file, `backend/data/cims.db`; photos and invoice scans sit
beside it. A scheduled task backs the database up nightly to `backend/data/backups/`
— see `DEPLOYMENT_GUIDE.md` for the layout and restore.

Key tables:

| Table | Contents |
|-------|---------|
| `centers` | The nine centers (managed from Admin → Settings) |
| `app_settings` | Org name, notification email, WhatsApp number, sender name |
| `business_heads` | Funding entities invoices are booked against (ERA Foundation, ComedK) |
| `users` / `students` | Accounts and student profiles |
| `product_catalog` | Component types, per center |
| `assets` | Every physical unit, with its tag and lifecycle status |
| `issue_records` | Student orders and what was issued / returned / damaged |
| `internal_issues` | Staff pulls for sessions and repairs |
| `transfers` | Center-to-center lending, with the exact units moved |
| `invoices` | Procurement invoices and line items |
| `notifications` / `push_subscriptions` | The bell history and enabled devices |
| `activity_logs` | Audit trail |

Stock is not a stored number: it is the count of `assets` with status `available`.

---

## Features

### Student portal
- Self-registration (approved by a center admin), login with username or email
- Browse components with photos, search and classification filters, live stock
- Cart → checkout with project details, team members and terms acceptance
- Email OTP confirmation on order submission
- Track orders, request returns, keep profile updated
- Scan any unit's QR label to see the component and their own history with it
- Installable as an app; bell + push notifications for order updates and return reminders
- WhatsApp handoff to the center admin after ordering (when configured)

### Admin portal
- Center dashboard: stock, low stock, pending orders and registrations, asset values
- Inventory: components and individual asset units, tag codes, photos, warranty,
  damage/consumption with reasons
- QR labels per unit (three sizes) and camera scanning inside every workflow
- Orders: approve by picking or scanning the exact units handed over, reject, one-scanner
  returns with Good/Damaged per unit, swaps
- Internal use: staff pulls by scan/tag/quantity, with a full register and returns
- Invoices: procurement entry with line items, GST, vendor, attached scans, PDF; print
  labels for the units just created
- Users: approve registrations, create accounts (welcome email with set-password link)
- Programs and per-program history (orders, internal use, transfers, procurement)
- My Center: procurement requests to the super admin, and **component transfers from
  other centers** with a return flow
- Excel exports: inventory, orders, transfers, users, internal use, activity logs

### Super admin only
- Everything above across all centers, plus analytics
- **Transfers**: approve requests, pick the supplying center, mark returns
- **Requests**: procurement requests raised by centers
- **Settings**: add / edit / deactivate centers; business heads; the order-notification
  email and admin WhatsApp number, org-wide and per center; send-test buttons

### Notifications
- Email for every account, order, return, reminder, procurement and transfer event
  (see the admin manual for the full table)
- In-app bell with full history for every user, and Web Push to enabled devices
- Optional WhatsApp equivalents through n8n

---

## Access

- **Public:** <https://comedkares.s.gy/cims> → `comedkares-cims.duckdns.org:5000`
  (router port-forward to the server; see `DEPLOYMENT_GUIDE.md`).
- **Same network:** find the server's IP (`ipconfig`) and open `http://SERVER_IP:5000`.

---

## Customisation

- **Logo**: replace `frontend/public/logo.png` and `backend/assets/logo.png`, regenerate
  `frontend/public/icons/*` if the mark changes, then rebuild.
- **Names / colours**: `REACT_APP_ORG_NAME`, `REACT_APP_APP_SHORT_NAME`,
  `REACT_APP_PRIMARY_COLOR` at build time; `ORG_NAME`, `ORG_SHORT_NAME`,
  `EMAIL_SENDER_NAME` in `backend/.env`; or edit at runtime in Admin → Settings.
- **Order form fields**: `frontend/src/pages/Cart.jsx`, `INITIAL_DETAILS`.

---

## License

MIT License — free for academic and educational use.
