# KIMS Deployment Guide

**KIMS** — Kalam Pragati Inventory Management System.

KIMS is a rebrand of Comedkare's CIMS for the Kalam Pragati programme. Both are
initiatives of the ERA Foundation and both run on this machine, side by side and
fully isolated from each other.

## The two deployments must never overlap

| | CIMS (Comedkare) | KIMS (Kalam Pragati) |
|---|---|---|
| Directory | `D:\cims` | `D:\KIMS` |
| Port | 5000 | **5001** |
| Database | `backend\data\cims.db` | `backend\data\kims.db` |
| Windows service | `CIMS` | `KIMS` |
| PM2 name | `cims-backend` | `kims-backend` |
| Install script | (in `D:\cims`) | `install-kims-service.ps1` |
| JWT secret | its own | **different** — see below |
| SMTP sender | `comedkares.cims@gmail.com` | `kalampragati.kims@gmail.com` |

**Nothing in `D:\KIMS` may point at CIMS's port, database, service name or
mailbox.** The JWT secrets in particular must stay different: a shared secret
would make a token issued by one portal valid on the other.
The server now refuses to start if `JWT_SECRET` is missing or under 32
characters, so it can never fall back to a default shared with CIMS.

`D:\cims` is the live Comedkare deployment. Do not run KIMS scripts against it.

## First-time setup

```bash
cd D:\KIMS\frontend && npm install && npm run build
```

```bash
cd D:\KIMS\backend && npm install
```

The database is already seeded. To rebuild it from scratch (this refuses to run
against a database that already has data):

```bash
node scripts/seed-kims.js --db ../data/kims.db --apply
```

That creates the AKTU, Lucknow center, the super admin, and the full component
catalogue at **stock 0**. It reads the component master **read-only** from the
live Comedkare database at `D:\cims\backend\data\cims.db` (override with
`--catalog-from`). It prints a generated password once — sign in and change it.

Then link the component photos (728 of the 1,128 items have one; the images are
generic component pictures already present in `backend/data/catalog_images`):

```bash
node scripts/link-catalog-images.js --db ../data/kims.db --apply
```

No Comedkare data is kept in this tree: the copies of `cims.db` and the legacy
Excel snapshots were removed because they contain Comedkare student records.

## Running

Development:

```bash
cd D:\KIMS\backend && node server.js
```

As a Windows service (elevated PowerShell). The script refuses to run if port
5001 is busy, and reports CIMS's status afterwards so you can confirm it is
still up:

```bash
cd D:\KIMS && powershell -ExecutionPolicy Bypass -File .\install-kims-service.ps1
```

Health check: <http://localhost:5001/api/health>

## External services

### 1. Email (SMTP) — configured

KIMS sends from **`kalampragati.kims@gmail.com`** (Gmail App Password in
`backend\.env`, set 2026-09-17; replaced the interim `gopalancims@gmail.com`). This is separate from CIMS's
`comedkares.cims@gmail.com`, so revoking one credential never affects the other
portal. `/api/health` shows `"email": {"ok": true}` when the login is verified.

To rotate: generate a new App Password (Google Account → Security → 2-Step
Verification → App Passwords), update `SMTP_PASS`, `Restart-Service KIMS`.

### 2. WhatsApp (n8n → Meta WhatsApp Cloud API) — not yet configured

Deliberately left unconfigured rather than reusing Comedkare's, which would mix
the two programmes on one credential.

CIMS does not call WhatsApp directly — it POSTs to an **n8n webhook**, and the
Meta credentials live inside that n8n instance. KIMS needs either its own n8n
workflow or a separate route on the existing one, ideally with its own WhatsApp
sender number so messages from the two programmes are distinguishable.

Set in `backend\.env`:

```
N8N_WHATSAPP_ENABLED=true
N8N_WHATSAPP_OUTBOUND_WEBHOOK=<the KIMS webhook URL>
N8N_WHATSAPP_SHARED_SECRET=<shared secret>
```

Until then the WhatsApp handoff button is simply hidden from students.

### 2a. Browser push notifications — configured

Web Push (VAPID) via the MIT `web-push` package; no third-party account. The
key pair was generated on 2026-09-17 into `backend.env` as
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`. The public key
is baked into every device subscription, so **never regenerate it** unless you
accept that every user has to enable notifications again. Subscriptions live
in the `push_subscriptions` table (migration 022) and go away with the user.
Delivery goes browser → its vendor push service (FCM for Chrome/Android,
Mozilla, Apple); KIMS only ever talks to those endpoints. If the keys are
missing the feature switches itself off and the UI hides.

### 3. Public URL — configured (Tailscale Funnel)

KIMS is reachable worldwide at **<https://kalampragati.s.gy/kims>** (a short.io
redirect, forwards query strings) → **<https://kims.tailf03e8e.ts.net>** via
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel): free, HTTPS with an
auto-renewing Let's Encrypt certificate, no router port-forwarding and no open
ports on this PC. Tailscale is signed in as `gopalancims@` and installed as a
Windows service (Automatic), so the address comes back by itself after a
reboot. The only way the site goes down is this PC being off or offline.

How it is wired:

```
Internet ──HTTPS──> Tailscale relay ──> tailscale.exe (this PC) ──> http://127.0.0.1:5001 (KIMS service)
```

`SITE_URL` in `backend\.env` and `REACT_APP_SITE_URL` / `REACT_APP_ADMIN_LOGIN_URL`
in `frontend\.env` are set to the short link (email footers, registration QR,
WhatsApp handoff). Rebuild the frontend after changing them.

Useful commands (any PowerShell):

```bash
& "C:\Program Files\Tailscale\tailscale.exe" funnel status
```

```bash
& "C:\Program Files\Tailscale\tailscale.exe" funnel --https=443 off
```

One-time admin-console settings worth keeping: **Machines → kims → Disable key
expiry** (otherwise the machine must re-login every 180 days), and **DNS →
HTTPS Certificates** enabled.

The short link is managed at short.io under the `kalampragati.s.gy` domain. If
the Tailscale hostname ever changes, update the redirect target there and
nothing in the app needs to change. Moving to a real subdomain such as
`kims.erafoundationindia.org` later means switching to a Cloudflare Tunnel;
nothing in the app needs to change beyond the two `.env` URLs.

Note on Comedkare: its `comedkares-cims.duckdns.org:5000` address is plain
HTTP with a router port-forward, so its logins cross the internet unencrypted.
It is untouched here, but the same Funnel approach would fix it.

## Installable app (PWA)

The portal is a Progressive Web App: `frontend/public/manifest.json`, icons
under `frontend/public/icons/`, and a service worker `frontend/public/sw.js`
that caches the app shell and component photos (never `/api/`). On Android
Chrome the sign-in page shows an **Install KIMS app** button; on iPhone it
shows the *Share -> Add to Home Screen* hint. Installation needs HTTPS, which
the public URL provides.

Each `npm run build` stamps the worker's cache name with the bundle hash
(`frontend/scripts/stamp-sw.js`), so a deploy installs a fresh worker and old
shells are discarded. The server sends `no-store` for `sw.js` and
`manifest.json`. Use `npm run build` (not `react-scripts build` directly) so
the stamp step runs.

## Where the data lives

Everything the portal stores is under `backend\data`, laid out so a person can
find things without the database:

```
backend\data  kims.db                          the database (plus -wal / -shm while running)
  backups    kims-2026-09-17.db             nightly, 02:00, by the "KIMS Backup" scheduled task
    kims-before-merge-....db       snapshots taken by the catalog tools before they change anything
    backup.log
  components    arduino-uno-r3.webp            one photo per component, named after it
  invoices    AKTU6\                 <center code>\<year>\<invoice number>      Project Details.pdf          uploaded scans keep their original filename
```

Paths stored in the database are relative to `backend\data`, so the folder can
be copied or restored anywhere and every link still works.

**Backups:** `install-kims-backup-task.ps1` registers a Windows scheduled task
that runs `backend\scriptsackup-db.js` nightly at 02:00 (and at start-up if
the PC was off), as SYSTEM. It keeps 30 daily copies plus one per month for a
year. To restore: stop the `KIMS` service, replace `kims.db` with a backup
(delete the `-wal`/`-shm` files), start the service.

A backup on the same disk does not survive that disk dying. Copy
`backend\dataackups` (and `components` + `invoices`) somewhere else --
Google Drive desktop, another PC -- on a schedule you are comfortable with.

**Catalog housekeeping tools** (`backend\scripts`, all dry-run by default):
- `dedupe-catalog.js` -- merges names identical except spacing/case/punctuation.
- `merge-catalog.js --plan file.json` -- applies a hand-reviewed merge list.
- `organize-data.js` -- re-files photos and invoice scans into the layout above.

## What the super admin can now change without a developer

These were previously hardcoded or locked in `.env` behind a service restart.
They are now in the database, editable under **Admin → Settings**:

- **Order notification email** — org-wide, and per center.
- **Admin WhatsApp number** — org-wide, and per center. Entering 10 digits
  assumes `+91`.
- **Centers** — add, rename, edit contacts, deactivate, remove.
- **Business heads** — the funding entities invoices are booked against
  (launch default: ERA Foundation). Dashboard columns follow this list.

Adding a center takes effect immediately: it appears in the login screen's
registration dropdown, every admin center selector, and inventory scoping,
with no rebuild or restart.

### Safety rules built into center management

- A center that owns records (users, catalog, assets, orders, invoices,
  transfers) is **deactivated, not deleted** — history is never silently
  destroyed. The UI tells you which records are holding it back before you
  confirm.
- A center with no records at all is deleted outright.
- The **last active center cannot be removed** — the student catalog and every
  admin screen need at least one.
- Center **codes must be unique** and are printed on asset tags, so keep them
  stable once tags exist.
- Center **IDs are permanent**. They are derived from the name; a name in a
  non-Latin script falls back to the code.

## Branding

Org branding resolves in this order: **database → environment → built-in
default**.

- Runtime: `app_settings` table, edited via Admin → Settings.
- Backend env: `ORG_NAME`, `ORG_SHORT_NAME`, `ORG_TAGLINE`,
  `EMAIL_SENDER_NAME` in `backend\.env`.
- Frontend build-time: `REACT_APP_ORG_NAME`, `REACT_APP_APP_SHORT_NAME`,
  `REACT_APP_PRIMARY_COLOR`, `REACT_APP_LOGO_URL` — these are compiled in, so
  changing them needs `npm run build`.

The logo is `frontend/public/logo.png` (also `backend/assets/logo.png` for
emails and PDFs). It already contains the wordmark and tagline, so the header
renders the image alone — controlled by `REACT_APP_LOGO_HAS_WORDMARK`.

## Legacy scripts

`backend/scripts/` contains one-off tools from Comedkare's Excel → SQLite
migration. They read a frozen center list from `scripts/legacy-centers.js` and
several open their own database from an argv path. They are historical
artifacts — **do not run them against the KIMS database**.
