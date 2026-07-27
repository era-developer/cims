# CIMS - Component Inventory Management System

> **🟢 Status: Ready for Production Launch** | April 6, 2026

A full-stack, open-source Component Inventory Management System for academic labs and innovation centers. It manages component stock, student requests, admin approvals, and Excel-based logs without requiring a database.

---

## 🚀 Quick Start

```bash
# Start the system
cd backend
node server.js

# Open browser
http://localhost:5000
```

**Default Credentials:**
- Super Admin: `superadmin` / `superadmin123`
- Center Admin: `jp_nagar_admin` / `admin123`
- Student: `jp_nagar_student1` / `student123`

---

## ✨ What's New (April 2026)

- ✅ **Multi-Center Support**: 9 independent centers with isolated data
- ✅ **Mobile Fixed**: Dynamic API URL detection - login works on all devices
- ✅ **Email System**: Per-center email IDs with common SMTP gateway
- ✅ **Single Port**: Backend + Frontend on port 5000 (no proxies needed)
- ✅ **Fresh Start**: Clean data state ready for production
- ✅ **Tested**: All systems verified and working

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, React Router 6 |
| Backend | Node.js + Express |
| Storage | Excel files via ExcelJS |
| Email | Nodemailer |
| WhatsApp | n8n + Meta WhatsApp Cloud API (optional) |
| Auth | JWT + bcryptjs |
| Deployment | PM2 |

---

## Project Structure

```text
cims/
|-- backend/
|   |-- server.js
|   |-- .env
|   |-- routes/
|   |-- middleware/
|   `-- utils/
|-- frontend/
|   |-- public/
|   |-- src/
|   `-- build/
|-- README.md
|-- DEPLOYMENT_GUIDE.md
|-- start.bat
`-- start.sh
```

---

## Installation And Setup

### Prerequisites

- Node.js v18 or later
- npm
- Git (optional)

### Configure Environment

Edit `backend/.env`:

```env
PORT=5000
JWT_SECRET=change_this_to_something_random_and_long

# Email settings (for order notifications)
CENTER_EMAIL=lab.coordinator@yourcollege.edu
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=your_gmail_app_password

# WhatsApp settings (optional, via n8n)
N8N_WHATSAPP_ENABLED=true
N8N_WHATSAPP_OUTBOUND_WEBHOOK=https://your-n8n-instance/webhook/cims-whatsapp-outbound
N8N_WHATSAPP_SHARED_SECRET=replace_with_a_long_random_secret
N8N_WHATSAPP_ADMIN_TO=+919999999999
```

Gmail App Password setup:

1. Go to `https://myaccount.google.com`
2. Open `Security`
3. Enable `2-Step Verification`
4. Open `App Passwords`
5. Create a password for Mail and use it as `SMTP_PASS`

n8n WhatsApp setup:

1. Run n8n where it can receive public webhooks
2. Create an outbound workflow for CIMS order and status events
3. Send WhatsApp using the Meta WhatsApp Cloud API node
4. Set `N8N_WHATSAPP_OUTBOUND_WEBHOOK` to that webhook URL
5. Set the same `N8N_WHATSAPP_SHARED_SECRET` in both CIMS and n8n
6. Forward incoming WhatsApp replies to `POST /api/webhooks/whatsapp`

---

## Quick Run Flow

Use this order for the normal local setup:

```bash
# 1) Install backend dependencies
cd cims/backend
npm install

# 2) Install frontend dependencies
cd ../frontend
npm install

# 3) Build the frontend
npm run build

# 4) Start the backend
cd ../backend
node server.js
```

Open:

- App: `http://localhost:5000`
- API health: `http://localhost:5000/api/health`

The backend serves the built React app from `frontend/build`, so after the build finishes you only need to run `node server.js` for normal usage.

---

## Run Modes

### Option A - Normal Local Run

Use this when you want the full app from one URL:

```bash
cd cims/frontend
npm run build

cd ../backend
node server.js
```

Open `http://localhost:5000`

### Option B - Frontend Development Mode

Use this while editing React files and you want hot reload:

```bash
# Terminal 1
cd cims/backend
node server.js

# Terminal 2
cd cims/frontend
npm start
```

Open `http://localhost:3000`

In development mode, the React dev server uses the proxy in `frontend/package.json` to reach the backend on `http://localhost:5000`.

### Rebuild After Frontend Changes

If you changed React code and you are using the normal local run flow:

```bash
cd cims/frontend
npm run build

cd ../backend
node server.js
```

---

## Maintenance & Cleanup

- **Canonical inventory sync script:** Use `node backend/scripts/updateGopalanInventory.js [centerIds...]` to refresh any center from its Excel export. The script now handles all centers, defaults blank stocks to zero, mirrors approved values to `Total Procured`, and logs which rows were touched.
- **Legacy scripts:** The previous helpers (`importReferenceInventory.js`, `sync-inventories.js`) are documented in `CLEANUP.md` and are retained only under `backend/scripts/legacy/` for reference. The active workflow should not call them directly.
- **Cleanup reference:** See `CLEANUP.md` for the latest audit of untracked data dumps, archived documents, and the guidelines for keeping the repo lean (archiving logs outside Git, ignoring future center exports, etc.).

## Running Globally With ngrok

After the backend is running on port `5000`, start ngrok in a new terminal:

```bash
ngrok http 5000
```

ngrok will print a public HTTPS URL like:

```text
https://your-project-name.ngrok-free.dev
```

Share that URL to access the app outside your local network.

Notes:

- Free ngrok URLs usually change every time ngrok restarts
- Some visitors may see an ngrok warning page before reaching the app
- Since the backend serves the built frontend, tunneling port `5000` exposes both the UI and the API

---

## Running Continuously

### Using PM2

```bash
# Install PM2 globally
npm install -g pm2

# Build frontend first
cd cims/frontend
npm run build

# Start backend with PM2
cd ../backend
pm2 start server.js --name cims

# Auto-start on system reboot
pm2 startup
pm2 save
```

Useful commands:

```bash
pm2 status
pm2 logs cims
pm2 restart cims
pm2 stop cims
```

---

## Default Credentials

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Student | `student1` | `student123` |
| Student | `student2` | `pass123` |

Change these immediately after first login from the Admin -> Users section.

---

## Excel Files Generated

All data is stored in `backend/data/`:

| File | Contents |
|------|---------|
| `inventory.xlsx` | Components, stock, totals, location |
| `orders.xlsx` | Requests, student details, status, remarks |
| `users.xlsx` | User accounts with hashed passwords |
| `activity_logs.xlsx` | Login, order, update, and delete activity |
| `whatsapp_messages.xlsx` | Incoming WhatsApp replies from n8n |

These reports can be downloaded from the Admin dashboard.

---

## Features Overview

### Student Portal

- Login with username and password
- Browse components with search and category filtering
- View stock status in real time
- Add items to cart and update quantities
- Submit checkout details including academic and project information
- Track order status

### Admin Portal

- View dashboard statistics
- Add, edit, delete, and update component stock
- Toggle component visibility for students
- Approve or reject orders with remarks
- Create student and admin accounts
- Download Excel reports

### Center-to-Center Transfer Requests

- The **My Center** page (new admin tab) is the single place to request components from other labs. Click the request button, add the required components (suggestions arrive as you type), provide the optional link/notes, and submit the form with program details and responsible-person contact information.
- Requests are forwarded to the super admin for approval and supply-center selection. Notifications are emailed to both centers, and the inventory stock is adjusted automatically in the supplying and receiving centers once the transfer is approved or returned.
- If a component is missing from your inventory, add it via the Inventory page before including it in a transfer request so the system can track stock levels and procurement history properly.
- Super admins review every request on the **Admin Transfers** page (`/admin/transfers`), pick the supply center, add supplier remarks, and mark the stock as returned when the borrowed components are back in place.
- The history block below the “My Center” form now mirrors the student “My Orders” view, including responsible-person/contact info. Each approved transfer presents a “Return components” button that opens a dialog for optional courier/tracking details; submitting it sends the return confirmation email to both the super admin and the supplying center.

### Email Notifications

- Order placed -> email to center or lab email
- Order approved or rejected -> email to student

### WhatsApp Notifications

- Optional order and status events sent from CIMS to n8n
- Incoming replies stored in `backend/data/whatsapp_messages.xlsx`
- Admin messages endpoint available at `/api/admin/whatsapp/messages`

---

## Access From Other Devices On The Same Network

Find your computer's IP address:

- Windows: `ipconfig`
- macOS/Linux: `ifconfig` or `ip a`

Then open:

```text
http://YOUR_IP:5000
```

---

## Customization

### Add Your Institution Logo

Replace the SVG logo block in `frontend/src/components/Navbar.jsx` and `frontend/src/pages/Login.jsx` with your `<img>` tag.

### Change Center Name

Search for `CIMS` in the codebase and replace it with your center name.

### Add More Fields To The Order Form

Edit `frontend/src/pages/Cart.jsx` and update the `INITIAL_DETAILS` object and the form fields.

---

## Adding Components Later

1. Log in as admin
2. Go to Inventory
3. Click `+ Add New Component`
4. Fill in the component details
5. Save to make it visible to students

---

## Support Resources

- Node.js docs: `https://nodejs.org/docs`
- React docs: `https://react.dev`
- ExcelJS: `https://github.com/exceljs/exceljs`
- Nodemailer: `https://nodemailer.com`
- PM2: `https://pm2.keymetrics.io`

---

## License

MIT License - free for academic and educational use.
