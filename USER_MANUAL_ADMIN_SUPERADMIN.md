# KIMS Admin and Super Admin User Manual

**KIMS - Kalam Pragati Inventory Management System** (ERA Foundation)

This guide covers daily operations for center admins and super admins:
- student orders
- inventory control
- user approvals
- internal use (staff pulls)
- reporting and exports
- centers and notification settings (super admin)

## 1) Roles and scope

## 1.1 Admin (center admin)
- Access to own center data.
- Can manage inventory, student orders, users, and My Center requests.
- Can approve/reject student orders and process returns.

## 1.2 Super Admin
- Access to all centers.
- Can switch center context in dashboard/inventory/orders/users.
- Reviews procurement requests raised by centers in `Requests`.
- Can access global analytics and cross-center reports.
- Can add and manage centers, and change the order-notification email and
  WhatsApp number, in `Settings` (see section 9).

## 1.3 Changing passwords
- Any user: `Forgot password` on the sign-in page sends a reset code by email.
- Admin / super admin: `Users` -> `Edit` -> set a new password for any account
  in scope, including your own (super admin).

Change a password immediately after receiving an account from someone else,
and never let a shared lab browser save an admin password.

## 2) Daily menu map

Top navigation:
- `Dashboard`
- `Inventory`
- `Invoices`
- `Orders`
- `My Center`
- `Users`
- `Requests` (super admin only) - procurement requests raised by centers
- `Settings` (super admin only) - centers and notification contacts

## 3) Dashboard usage

Dashboard provides:
- Total components
- Total stock units
- Low stock alerts
- Pending/approved orders
- Pending students
- Download buttons for reports

Downloads available:
- Inventory report
- Orders report (with date filter)
- Internal use report
- Users report
- Activity logs

## 4) Inventory management

Open `Inventory` to add/edit components.

### 4.1 Add component fields
- Component name
- Category
- Description
- Unit
- Location / bin
- Stock
- Photo (optional)

Additional procurement fields (new):
- Invoice number
- Vendor name
- Project / purpose
- Purchased for (for example `ERA Foundation` or `Kalam Pragati`)

### 4.2 Key inventory controls
- Quick `+ / -` stock buttons
- Category filter dropdown
- Search box
- `Visible to students` toggle (Active/Hidden)
- Damaged count tracking

Rules:
- Keep component names consistent across centers.
- Add new components (via an invoice) before they can be issued.

## 4.3 QR labels and scanning

**Print labels:** `Inventory` -> `QR labels` on a component row. Tick the units,
pick a label size (38x21, 50x30 or 70x40 mm), and `Print`. Each label carries a
QR code, the asset tag and the component name.

**The QR is a link.** Any phone camera -- no app needed -- opens the unit's
page in KIMS. Whoever scans it signs in (if not already) and sees what their
role allows:
- **Student:** the component (photo, description, how many are free), this
  unit's status, whether it is issued to *them* (with a link to their order),
  and their own history with it. Never other students' names.
- **Admin:** all of that plus who currently has it, every order it has been on,
  the full lifecycle, and status actions (mark damaged, send for repair, mark
  repaired, dispose, restore) -- each asks for a reason.

**Scan button** (top bar, all roles): opens the camera inside the portal and
goes to the same unit page. Type the tag if the camera is unavailable.

Inside workflows:
- **Recording a return** (`Orders`, internal use): a single `Scan QR code`
  for the whole return; each scanned unit appears in the scanner window with
  **Good / Damaged** buttons -- you choose, then scan the next. Scanning never
  decides the condition.
- **Internal Use** (`Inventory` -> `Internal Use`): `Scan QR code` adds each
  unit you pick off the shelf, or **type the asset tag** in the box beside it
  and press **Add unit**; exactly those units are issued, any extra quantity
  is filled from stock.
- **Swapping a unit**: `Scan QR code` on the label of the unit in hand.

**New stock:** after saving an invoice, the success message offers
**Print N QR labels now** for exactly the units just created. The same is
available later from the invoice's detail view (`QR labels for this invoice`).
Stick the labels on before shelving.

## 4.4 Internal use (staff pulling components)
`Inventory` -> `Internal Use`: who is taking them, an optional **Program**,
the reason, optional session details, and the components -- scan units, type
tags, or just enter a quantity. Stock reduces immediately. Return them from
`Orders` -> **Internal use** tab (or `Inventory` -> `Return`).

## 5) Student registration approval and user management

Open `Users`.

You can:
- Approve self-registered students (`Pending Approval`)
- Create manual users (student/admin)
- Edit user details
- Activate/disable accounts
- Delete users

Creating an account manually:
1. `Users` -> `Create`, fill the details and a temporary password.
2. The person receives a welcome email with a **Set my password** link
   (single use, valid 72 hours). They choose their own password there.
3. If the link expires, they use `Forgot password` on the sign-in page.
The password you typed is never emailed.

Registration flow:
1. Student submits self-registration.
2. User appears with source `Self Register` and `Pending Approval`.
3. Admin clicks `Approve`.
4. Student can sign in.

## 6) Student order workflow

Open `Orders`.

### 6.1 Status definitions
- `Pending`
- `Approved`
- `Rejected`
- `Return Requested`
- `Partially Returned`
- `Returned`

### 6.2 Approve & issue (the checkout)
Click `Approve` on a pending order. For each component:
1. Set **Issuing** -- how many you are handing over (0 removes it; less than
   requested is allowed).
2. Pick **exactly those units**, either:
   - **Scan QR code** (top right): keep the scanner open and scan each unit as
     you hand it over -- it ticks itself under its component and the progress
     pills update (`Arduino UNO R3: 2/2`, `Buzzer: 1/2`); or
   - **Pick from list**: tick units from the component's available units
     (the ones reserved when the order was placed are listed first); or
   - **Auto-pick remaining** for bulk consumables where the specific unit
     does not matter.
3. `Confirm & issue` becomes available only when every component has exactly
   its quantity selected.

System behavior:
- The units you chose are the ones recorded as issued -- the stock record
  matches what physically left the room.
- Units reserved at order time that you did not choose go back to available.
- If every quantity is 0, the order is rejected.

### 6.3 Reject order
Use rejection when request cannot be fulfilled.
Reserved stock is restored automatically.

### 6.4 Process return
For `Return Requested` or `Partially Returned`, open the order and click
**Record Returned Items** (or **Continue Return Entry**). There is **one
Scan QR code button for the whole order**:
1. Tap **Scan QR code**. Scan the first unit the student hands over.
2. The scanner shows the unit and its component and asks **Good / Damaged**
   (or Skip). Choose; the scanner is immediately ready for the next unit. A
   numbered list in the scanner window shows progress per component
   (e.g. *1 Raspberry Pi 1/2*). **Done** closes it.
3. Units can also be set by hand with the **Not returned / Good / Damaged**
   buttons beside each tag.
4. If any unit is Damaged, a reason is required.
5. **Save Return Update**.

System behavior:
- Good units go back to `available`; Damaged units become `damaged` (fix
  later with **Fix Status** on the order if it was a mistake).
- Status becomes `Partially Returned` while anything is still out and
  `Returned` once every unit is back.
- **Swap** appears beside a unit only while it is still out; use it when the
  physical unit in hand is not the one the system assigned.

### 6.5 Internal use tab (staff pulls, not student orders)
The **Internal use** tab on `Orders` is the full register of components pulled
by staff for sessions, demos and repairs -- open and closed -- with who took
them, when, the program, each unit's tag and return state. Filter with
**All / Still out / Returned** and the search box. Anything still out has a
**Record return** button that opens the same one-scanner return dialog as
above. To pull components, use `Inventory` -> `Internal Use` (see 4.4).

## 7) Settings: centers and notification contacts (super admin only)

Open `Settings`. Changes take effect immediately - no restart, no developer.

### 7.1 Order notifications
- `Order notification email`: where new-order alerts go when a center has no
  address of its own.
- `Admin WhatsApp number`: the number students are handed to after placing an
  order, when the center has none of its own. Entering 10 digits assumes `+91`.

Each field has a **Send test** button. It sends to whatever is typed in the
box (saved or not), so you can confirm a new address or number works before
saving it. The WhatsApp test reports clearly if WhatsApp is not yet configured.

Use this whenever the responsible admin changes.

### 7.2 Business heads
A business head is the funding entity an invoice is booked against (at launch:
`ERA Foundation`). Every active head is offered in the Invoices and Add
Component forms and gets its own column in the dashboard's asset-value
breakdown.

- `Add business head`: enter the name and save. Available immediately.
- `Rename`: changes the name everywhere, including past invoices.
- `Deactivate`: hides it from new invoices; past invoices keep it.
- `Remove`: deletes a head nothing is booked against; otherwise deactivates it.
- The last active head cannot be removed - the invoice form requires one.

### 7.3 Centers
The table lists every center with its code, contact details and status.

Add a center:
1. Enter the `Center name` (for example `AKTU, Lucknow`). The code and ID are
   suggested automatically; adjust the code if needed.
2. Optionally set an order email and WhatsApp number for this center. Leave
   blank to inherit the org-wide values above.
3. Click `Create center`.

The new center appears at once in the login registration dropdown, every
center selector, and inventory scoping.

Edit / deactivate / remove:
- `Edit` changes the name, code or contacts.
- `Deactivate` hides the center from new orders and dropdowns; its records stay.
- `Remove` deletes a center that has never been used. A center that owns
  users, stock, orders or invoices is deactivated instead - history is never
  destroyed. The confirmation tells you which it will be.
- The last active center cannot be removed.

Rules:
- Center codes are printed on asset tags - keep them stable once tags exist.
- Center IDs are permanent.

### 7.4 Email and notification behavior
Every email is sent as **"Kalam Pragati - KIMS"** with the KIMS logo. Who
receives what:

| Event | Student | Center admin / super admin |
|---|---|---|
| Student registers | Registration received | New registration to approve |
| Admin approves registration | Account is approved | - |
| Admin creates an account | Welcome with set-password link (72 h, single use) | - |
| Order confirmation code (OTP) | Code | - |
| Order placed | Order received | New order (full details) |
| Order approved / rejected | Status update | Status update |
| Return requested / partial / returned | Status + return summary | Status + return summary |
| Day before expected return | Return reminder (e-mail with component list + push + bell; once per order, checked hourly) | - |
| Password reset code | Code | - |
| Password changed or reset | Security notice | - |
| Procurement request / status | - | Super admin, then the requesting center |

Admin emails go to the center's own notification email if set in
`Settings`, otherwise the org-wide order notification email. No email ever
contains a password.

### 7.5 The bell (notification centre) and phone notifications
Every user and admin has a **bell** in the top bar. It shows the unread count,
the latest entries on tap, and **See all** opens `/notifications`: the full
history with sent time, read time and an *Unread only* filter. Every event in
the table below is written there for each recipient regardless of e-mail or
push, so the bell is the complete record of what the portal told a person.
Entries are kept 180 days after being read (a year if never read).

Alongside e-mail and the bell, KIMS sends instant push notifications to any
device where the person enabled them. Nothing is pushed to anyone who has not
opted in.

| Event | Student gets | Admins of that center + super admins get |
|---|---|---|
| Student places an order | Order received | New order (who, what) |
| Order approved | Approved, what to collect, return-by date | - |
| Order rejected | Rejected, with the reason | - |
| Student requests a return | - | Return requested (what is coming back) |
| Partial / full return recorded | What is still outstanding / order closed | - |
| Day before expected return | Return reminder | - |
| Student self-registers | - | New registration to approve |
| Admin approves a registration | Account approved (waiting in the bell at first sign-in) | - |

The admin who performs an action never receives their own notification.
Tapping a notification opens the order on the right page.

**Enabling:** a yellow bar on the dashboard offers **Enable** while a device is
not yet enabled. The full switch (**Enable / Turn off / Send me a test**, plus
the number of enabled devices) is on **My Center** for admins and on
**Settings** for the super admin; students have it on **My Profile**. Each
browser/phone is enabled separately. iPhone/iPad requires the portal to be
added to the Home Screen first.

**Housekeeping:** subscriptions are stored per user and removed automatically
when the browser drops them or the user is deleted. The server keys live in
`backend.env` (`VAPID_*`, see KIMS_DEPLOYMENT.md); regenerating them
silently invalidates every device, so leave them alone.

## 8) Report downloads and audit

Use Dashboard download section for exports:

1. `Orders Report`
   - detailed student/order fields
   - issued component-level sheet
   - return and damaged quantities
2. `Internal Use Report`
   - every staff pull with units, return state and program
3. `Inventory`, `Users`, and `Logs` reports

Tip:
- Use date filters before orders export for monthly reporting.

## 9) Recommended daily checklist

Admin:
1. Approve pending student registrations.
2. Review pending orders.
3. Process return requests and damaged entries.
4. Check low stock list.
5. Review My Center request history.

Super admin:
1. Review procurement requests from centers.
2. Approve student registrations still pending.
3. Check the Internal use tab for anything out too long.
4. Export daily/weekly order and internal-use reports.

## 10) Common admin issues

### Center dropdown appears empty
- Check `Settings` -> Centers: at least one center must be active.
- Reload the page after login/session refresh.

### Order emails going to the wrong person
- Update the address in `Settings` -> Order notifications, or the center's own
  email in the Centers table. No restart needed.

### Frontend build missing page appears
Build frontend and restart backend:
- `cd frontend && npm run build`
- `cd ../backend && node server.js`
