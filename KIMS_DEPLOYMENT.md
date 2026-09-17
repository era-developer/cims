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
| SMTP sender | `comedkares.cims@gmail.com` | not yet configured |

**Nothing in `D:\KIMS` may point at CIMS's port, database, service name or
mailbox.** The JWT secrets in particular must stay different: a shared secret
would make a token issued by one portal valid on the other.

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

## Still to configure

Two external services are **deliberately left unconfigured**, because reusing
Comedkare's would mix the two programmes on one credential:

### 1. Email (SMTP)

CIMS sends through the Gmail account `comedkares.cims@gmail.com` using an app
password. Kalam Pragati needs its own mailbox — otherwise KIMS order mail
arrives *from Comedkare*, and revoking one credential breaks both portals.

1. Create a Gmail account for Kalam Pragati.
2. Enable 2-Step Verification, then generate an **App Password**.
3. Put it in `backend\.env` as `SMTP_USER` / `SMTP_PASS`.
4. Restart the service.

Until then the portal works normally; email notifications are skipped and
`/api/health` reports email as not configured.

### 2. WhatsApp (n8n → Meta WhatsApp Cloud API)

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

### 3. Public URL

`SITE_URL` in `backend\.env` is `http://localhost:5001`. Update it once KIMS has
a hostname or tunnel — it is used in email footers and the student registration
QR code. Set `REACT_APP_SITE_URL` to the same value and rebuild the frontend so
the QR points at the public address rather than the current origin.

## What the super admin can now change without a developer

These were previously hardcoded or locked in `.env` behind a service restart.
They are now in the database, editable under **Admin → Settings**:

- **Order notification email** — org-wide, and per center.
- **Admin WhatsApp number** — org-wide, and per center. Entering 10 digits
  assumes `+91`.
- **Centers** — add, rename, edit contacts, deactivate, remove.

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
