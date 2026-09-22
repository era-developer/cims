# CIMS Deployment Guide

**CIMS** — Comedkares Innovation Hub Inventory Management System.

CIMS is developed on this PC in `D:\cims` and deployed by **copying the folder to
the server system**, where it runs as a Windows service and is published through
DuckDNS. This guide covers that hand-off, what to configure, the September 2026
upgrade (the KIMS feature set), backups, and how CIMS stays separate from KIMS.

## CIMS and KIMS never overlap

The same codebase runs two portals. When both are on one machine:

| | CIMS (Comedkares) | KIMS (Kalam Pragati) |
|---|---|---|
| Directory | `D:\cims` | `D:\KIMS` |
| Port | **5000** | 5001 |
| Database | `backend\data\cims.db` | `backend\data\kims.db` |
| Windows service | `CIMS` | `KIMS` |
| Scheduled task | `CIMS Backup` | `KIMS Backup` |
| PM2 name | `cims-backend` | `kims-backend` |
| JWT secret | its own | **different** |
| SMTP sender | `comedkares.cims@gmail.com` | `kalampragati.kims@gmail.com` |
| Public URL | `comedkares.s.gy/cims` | `kalampragati.s.gy/kims` |

The JWT secrets must stay different — a shared secret would make a token from one
portal valid on the other. The server refuses to start if `JWT_SECRET` is missing
or under 32 characters. Never run a KIMS script against `D:\cims` or vice versa.

## Deploying to the server (first time or upgrade)

### 1. Build here

```bash
cd D:\cims\frontend && npm install && npm run build
```

```bash
cd D:\cims\backend && npm install
```

### 2. Copy the folder

Copy `D:\cims` to the server **except** `backend\data\` (the server has its own
database, photos and backups) and `backend\.env` (the server's copy has the live
secrets). Everything else — including `node_modules` and `frontend\build` if the
server has no Node build tools — goes across.

If the server has Node and npm, you can instead copy without `node_modules` and run
`npm install` in `backend\` and `frontend\` there.

### 3. Update the server's `backend\.env`

Open the server's existing `.env` and **add** the keys introduced in September 2026
(copy the values from this PC's `backend\.env`, or generate fresh ones):

```env
# Branding fallbacks (live values are in Admin -> Settings)
ORG_NAME=Comedkares Innovation Hub
ORG_SHORT_NAME=CIMS
ORG_TAGLINE=Comedkares Innovation Hub
EMAIL_SENDER_NAME=Comedkares Innovation Hub - CIMS

# Browser push notifications -- generate ONCE on the server and never change:
#   node -e "console.log(require('web-push').generateVAPIDKeys())"
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:comedkares.cims@gmail.com
```

Keep everything that is already there (PORT, JWT_SECRET, SMTP, the nine
`{CENTER}_EMAIL` lines, CENTER_EMAIL, ADMIN_EMAIL, SITE_URL). Make sure
`JWT_SECRET` is at least 32 characters.

The VAPID public key is baked into every phone's push subscription. Generate it
once on the server and keep it; regenerating means every user has to enable
notifications again.

`frontend\.env` is compiled into the build, so it is already correct in the copied
`frontend\build` (public URL `https://comedkares.s.gy/cims`).

### 4. Install / restart the service

From an elevated PowerShell in the CIMS folder on the server:

```bash
powershell -ExecutionPolicy Bypass -File .\install-cims-service.ps1
```

The script uses its own folder as the app directory, reads `PORT` from `.env`,
refuses to run if the port is busy (stop any `pm2` / hand-started `node server.js`
first), and checks `/api/health` afterwards. On an upgrade of an already-installed
service, `Restart-Service CIMS` is enough.

**Schema migrations run automatically at startup.** The September 2026 upgrade adds
three (app_settings + center contacts, push subscriptions, notifications); they only
add tables and nullable columns, so the existing data is untouched. Check
`backend\nssm-out.log` for the `[db] applied migration ...` lines.

### 5. Register the nightly backup

```bash
powershell -ExecutionPolicy Bypass -File .\install-cims-backup-task.ps1
```

Runs `backend\scripts\backup-db.js` at 02:00 daily (and at start-up if missed) as
SYSTEM, into `backend\data\backups\cims-YYYY-MM-DD.db`. Keeps 30 daily copies plus
one per month for a year.

### 6. Check

- <http://localhost:5000/api/health> on the server shows `"email": {"ok": true}`.
- Sign in as a super admin, open **Settings**: the nine centers are listed and the
  *Order email* column shows each hub mailbox (italic *(default)* = inherited from
  `.env`). Use **Send test email** to confirm delivery.
- Open the public URL from a phone: the sign-in page should offer **Install CIMS
  app** (Android Chrome) — that confirms the PWA files are being served.

## Public URL (DuckDNS)

```
Internet --HTTP--> router (port-forward 5000) --> server --> CIMS service :5000
```

`comedkares-cims.duckdns.org` must point at the server's public IP; the DuckDNS
updater on the server keeps it current. The short link `comedkares.s.gy/cims`
(short.io) redirects there and is what is printed on QR labels and in emails
(`SITE_URL` / `REACT_APP_SITE_URL`). If the hostname ever changes, update the
short.io redirect and nothing in the app needs to change.

**Note on HTTPS.** The DuckDNS address is plain HTTP with a router port-forward, so
sign-ins cross the internet unencrypted, and two browser features need HTTPS:
installing the PWA and push notifications (they work on `localhost` and on HTTPS
only). KIMS solved this with Tailscale Funnel (free, auto-renewing certificate,
no open router port) — see `D:\KIMS\KIMS_DEPLOYMENT.md`; the same approach works
for CIMS unchanged, or a Cloudflare Tunnel (`start-with-cloudflare.ps1` is a
starting point). Until then the portal works fully over HTTP; the install button
and push simply stay hidden on non-secure origins.

## Where the data lives

```
backend\data
  cims.db                      the database (plus -wal / -shm while running)
  backups\
    cims-2026-09-22.db         nightly, 02:00, by the "CIMS Backup" task
    cims-before-*.db           snapshots the catalog tools take before changing anything
    backup.log
  catalog_images\              component photos uploaded before Sept 2026 (UUID names)
  components\                  component photos uploaded since, named after the component
  invoices\
    JPN\2026\INV-0042\         <center code>\<year>\<invoice number>
      Project Details.pdf      uploaded scans keep their original filename
  invoice_documents\           scans uploaded before Sept 2026 (if any)
```

Both photo folders are served under the same `/catalog-images/` URLs, so the old
photos keep working without any migration. To tidy everything into the new layout
(optional, re-runnable, takes a snapshot first):

```bash
cd D:\cims\backend\scripts && node organize-data.js --db ../data/cims.db
```

Add `--apply` to actually move files; without it the script only reports what it
would do.

**Restore:** stop the `CIMS` service, replace `cims.db` with a backup (delete the
`-wal` / `-shm` files next to it), start the service. Pending migrations re-apply
automatically.

A backup on the same disk does not survive that disk dying. Copy
`backend\data\backups` (and `catalog_images`, `components`, `invoices`) somewhere
else — Google Drive desktop, another PC — on a schedule you are comfortable with.

## What the super admin can change without a developer

Editable under **Admin → Settings**, effective immediately:

- **Order notification email** — org-wide, and per center (overrides the `.env`
  hub mailbox for that center).
- **Admin WhatsApp number** — org-wide, and per center. 10 digits assumes `+91`.
- **Centers** — add, rename, edit contacts, deactivate, remove. A center that
  owns records is deactivated, never deleted; the last active center cannot be
  removed; codes are printed on asset tags, so keep them stable.
- **Business heads** — the funding entities invoices are booked against
  (ERA Foundation, ComedK).

## Branding

Resolves **database → environment → built-in default**:

- Runtime: `app_settings` table, edited via Admin → Settings.
- Backend env: `ORG_NAME`, `ORG_SHORT_NAME`, `ORG_TAGLINE`, `EMAIL_SENDER_NAME`.
- Frontend build-time: `REACT_APP_ORG_NAME`, `REACT_APP_APP_SHORT_NAME`,
  `REACT_APP_PRIMARY_COLOR`, `REACT_APP_LOGO_URL`, `REACT_APP_LOGO_HAS_WORDMARK`
  — compiled in, so changing them needs `npm run build`.

The logo is `frontend/public/logo.png` (also `backend/assets/logo.png` for emails
and PDFs). It contains the wordmark, so the header renders the image alone. The
PWA icons in `frontend/public/icons/` are the graduation-cap mark on white.

## Installable app (PWA)

`frontend/public/manifest.json`, icons under `frontend/public/icons/`, and a
service worker `frontend/public/sw.js` that caches the app shell and component
photos (never `/api/`). Each `npm run build` stamps the worker's cache name with
the bundle hash (`frontend/scripts/stamp-sw.js`), so a deploy installs a fresh
worker. The server sends `no-store` for `sw.js` and `manifest.json`. Installation
and push need HTTPS (see the DuckDNS note above).

## External services

- **Email (SMTP)** — `comedkares.cims@gmail.com` with a Gmail App Password in
  `backend\.env`. The host is resolved to IPv4 up front (some Windows hosts have no
  IPv6 route and Gmail's AAAA answer would otherwise get cached). `/api/health`
  shows `"email": {"ok": true}` when the login is verified. To rotate: new App
  Password → `SMTP_PASS` → `Restart-Service CIMS`.
- **WhatsApp (n8n → Meta Cloud API)** — optional. Set `N8N_WHATSAPP_ENABLED=true`,
  the webhook URL and shared secret; forward replies to `POST /api/webhooks/whatsapp`.
  The **Send test message** button in Settings reports whether it is configured.
- **Web Push** — VAPID keys in `.env`; subscriptions in `push_subscriptions`. If
  the keys are missing the feature switches itself off and the UI hides it.

## Keeping CIMS in step with KIMS

KIMS (`D:\KIMS`) is a git fork of CIMS; CIMS carries KIMS's commits as of
2026-09-19 plus its own re-adaptation commits (Comedkares branding, transfers,
nine-center routing). To bring later KIMS work into CIMS:

```bash
cd D:\KIMS && git bundle create D:\kims.bundle chore/consolidate-pending-work
```

```bash
cd D:\cims && git fetch D:\kims.bundle chore/consolidate-pending-work:refs/remotes/kims/chore/consolidate-pending-work
```

```bash
cd D:\cims && git merge kims/chore/consolidate-pending-work
```

Creating a bundle only reads KIMS's repository. (A bundle is used because the
Google-Drive-synced `.git` folders contain `desktop.ini` files that break a direct
`git fetch D:\KIMS`.) Expect conflicts only in branding defaults, transfer wiring
and docs; resolve them in CIMS's favour.

## Legacy scripts

`backend/scripts/` also holds one-off tools from the Excel → SQLite migration and
per-center inventory imports. They read a frozen center list from
`scripts/legacy-centers.js`; they are historical and should not be run against the
live database. The Excel workbooks they consumed are kept under
`backend/legacy_excel_data_archive/`.
