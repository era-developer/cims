# 🔧 CIMS — Component Inventory Management System

A full-stack, open-source Component Inventory Management System built for academic labs and innovation centers. Manages component stock, student requests, admin approvals, and maintains Excel-based logs automatically.

---

## 🧰 Tech Stack (100% Open Source & Free)

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, React Router 6 |
| Backend | Node.js + Express |
| Storage | Excel files via ExcelJS (no database needed!) |
| Email | Nodemailer (works with Gmail, Outlook, etc.) |
| WhatsApp | n8n + Meta WhatsApp Cloud API (optional) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Deployment | PM2 (process manager) |

---

## 📁 Project Structure

```
cims/
├── backend/
│   ├── server.js               ← Express app entry
│   ├── .env                    ← Your config (SMTP, JWT, etc.)
│   ├── routes/
│   │   ├── auth.js             ← Login API
│   │   ├── components.js       ← Inventory CRUD API
│   │   ├── orders.js           ← Order placement & approval API
│   │   └── admin.js            ← Stats, user mgmt, downloads
│   ├── middleware/
│   │   └── auth.js             ← JWT auth guard
│   └── utils/
│       ├── excel.js            ← All Excel read/write logic
│       └── email.js            ← Email notifications
│
├── frontend/
│   └── src/
│       ├── App.js              ← Routes
│       ├── context/
│       │   ├── AuthContext.jsx ← Login state
│       │   └── CartContext.jsx ← Cart state
│       ├── pages/
│       │   ├── Login.jsx
│       │   ├── StudentDashboard.jsx  ← Browse components
│       │   ├── Cart.jsx              ← Cart + checkout form
│       │   ├── MyOrders.jsx          ← Student order tracking
│       │   ├── AdminDashboard.jsx    ← Admin overview & downloads
│       │   ├── AdminInventory.jsx    ← Add/edit/delete components
│       │   ├── AdminOrders.jsx       ← Approve/reject requests
│       │   └── AdminUsers.jsx        ← User management
│       └── components/
│           └── Navbar.jsx
│
└── README.md
```

---

## 🚀 Installation & Setup

### Prerequisites
- **Node.js v18+** → https://nodejs.org
- **npm** (comes with Node.js)
- **Git** (optional) → https://git-scm.com

### Step 1 — Install Backend

```bash
cd cims/backend
npm install
```

### Step 2 — Configure Environment

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

> **Gmail App Password Setup:**
> 1. Go to https://myaccount.google.com
> 2. Security → 2-Step Verification (enable it)
> 3. Security → App Passwords → Create for "Mail"
> 4. Use that 16-character password as SMTP_PASS

> **n8n WhatsApp Setup:**
> 1. Self-host or run n8n where it can receive public webhooks
> 2. Create an outbound workflow with a webhook trigger that receives CIMS order/status events
> 3. In that n8n workflow, send WhatsApp using the Meta WhatsApp Cloud API node
> 4. Set `N8N_WHATSAPP_OUTBOUND_WEBHOOK` to that n8n webhook URL
> 5. Set the same `N8N_WHATSAPP_SHARED_SECRET` in both CIMS and n8n
> 6. Configure n8n to forward incoming WhatsApp replies to `POST /api/webhooks/whatsapp`

### Step 3 — Install Frontend

```bash
cd cims/frontend
npm install
```

### Step 4 — Build Frontend

```bash
cd cims/frontend
npm run build
```

### Step 5 — Start the Application

```bash
cd cims/backend
node server.js
```

Open in browser: **http://localhost:5000**

---

## 🔄 Running Continuously (Production)

### Using PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Build frontend first
cd cims/frontend && npm run build

# Start backend with PM2
cd cims/backend
pm2 start server.js --name "cims"

# Auto-start on system reboot
pm2 startup
pm2 save
```

### PM2 Useful Commands

```bash
pm2 status          # Check if running
pm2 logs cims       # View live logs
pm2 restart cims    # Restart app
pm2 stop cims       # Stop app
```

---

## 👥 Default Credentials

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Student | `student1` | `student123` |
| Student | `student2` | `pass123` |

> **⚠️ Change these immediately after first login using Admin → Users**

---

## 📊 Excel Files Generated

All data is stored in `backend/data/` directory:

| File | Contents |
|------|---------|
| `inventory.xlsx` | All components, current stock, total procured, total issued, location |
| `orders.xlsx` | All requests with student details, components, status, remarks |
| `users.xlsx` | User accounts (passwords are hashed) |
| `activity_logs.xlsx` | Every login, order, update, delete action |

Download from Admin Dashboard → "Download Excel Reports"

---

## 🖥️ Features Overview

### Student Portal
- Login with username/password
- Browse components like an e-commerce site (category filter, search)
- Real-time stock status (In Stock / Low Stock / Out of Stock)
- Add to cart, update quantities
- Checkout form with: Student Name, Mobile, USN, College, Department, Course, Project, Team, Faculty Guide, Purpose
- Track order status (Pending / Approved / Rejected)

### Admin Portal
- Dashboard with live stats
- Inventory management: Add, Edit, Delete, quick stock +/− buttons
- Toggle component visibility from students
- Order management: View all requests, approve/reject with remarks
- User management: Create student/admin accounts
- Download all 4 Excel reports

### Email Notifications
- Order placed → Email to center/lab email with full details + component table
- Order approved/rejected → Email to student

### WhatsApp Notifications
- Order placed → Optional WhatsApp event sent from CIMS to n8n
- Order approved/rejected/returned → Optional WhatsApp status event sent from CIMS to n8n
- Incoming WhatsApp replies from n8n → Stored in `backend/data/whatsapp_messages.xlsx`
- Admin can inspect received WhatsApp messages via `/api/admin/whatsapp/messages`

---

## 🌐 Accessing from Other Devices on Same Network

```bash
# Find your computer's IP address
# Windows: ipconfig
# Mac/Linux: ifconfig or ip a

# Students on same WiFi can access via:
http://YOUR_IP:5000
```

---

## 🔧 Customization

### Add Your Institution Logo
Replace in `Navbar.jsx` and `Login.jsx` — look for the SVG logo block and replace with your `<img>` tag.

### Change Center Name
Search for "CIMS" in the codebase and replace with your center name.

### Add More Fields to Order Form
Edit `Cart.jsx` — add fields to the `INITIAL_DETAILS` object and the `Field` components.

---

## 🆕 Adding Components Later

1. Login as admin → Inventory → "+ Add New Component"
2. Fill Name, Category, Description, Stock, Location
3. Component immediately visible to students

---

## 📞 Support Resources

- **Node.js docs**: https://nodejs.org/docs
- **React docs**: https://react.dev
- **ExcelJS**: https://github.com/exceljs/exceljs
- **Nodemailer**: https://nodemailer.com
- **PM2**: https://pm2.keymetrics.io

---

## 📝 License

MIT License — Free for academic and educational use.
