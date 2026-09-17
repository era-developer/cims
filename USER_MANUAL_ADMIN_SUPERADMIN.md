# KIMS Admin and Super Admin User Manual

**KIMS - Kalam Pragati Inventory Management System** (ERA Foundation)

This guide covers daily operations for center admins and super admins:
- student orders
- inventory control
- user approvals
- center-to-center transfers
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
- Can review and approve center-to-center transfers in `Transfers`.
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
- `Transfers` (super admin only)
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
- Center transfer report
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
- Add new components before requesting them in transfer flow.

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
- **Recording a return** (`Orders`): `Scan a returned unit` finds and
  highlights that unit's row; **you** then tap Good or Damaged. Scanning never
  decides the condition.
- **Swapping a unit**: `Scan` the label of the unit in hand to select it.

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

### 6.2 Approve with quantity edits (important)
When reviewing a pending order, admin can:
- reduce quantity for any component
- remove a component (set issue qty to 0)
- approve remaining items

System behavior:
- Reduced/removed quantity is released back to live stock.
- Approved quantity is treated as issued.
- If all quantities become 0, order becomes rejected.

### 6.3 Reject order
Use rejection when request cannot be fulfilled.
Reserved stock is restored automatically.

### 6.4 Process return
For `Return Requested` or `Partially Returned`:
1. Open return entry.
2. Enter returned and damaged quantities per component.
3. Save update.

System behavior:
- Good returned quantity adds back to stock.
- Damaged quantity increments damaged count.
- Status closes as `Returned` when no pending balance remains.

## 7) My Center: center-to-center request flow (admin side)

Open `My Center`.

### 7.1 Raise request
1. Click `Request components from another center`.
2. Add components using inventory autocomplete suggestions.
3. Enter quantity for each component.
4. Fill program/contact details:
   - Program / project name
   - Responsible person
   - Responsible email
   - Purpose
   - Desired return date
   - Additional notes
5. Submit request.

After submit:
- Button state changes to waiting for super admin approval.
- Request appears in `Request history`.

### 7.2 Request history filters
- `Requested`: requests raised by your center
- `Sent`: requests supplied by your center

Each card includes:
- transfer id
- status
- requesting/supply center details
- responsible person/email
- requested components and quantities

### 7.3 Raise return request (requesting center)
For approved transfers:
1. Click `Return components`.
2. Fill optional popup details:
   - courier/transporter
   - tracking id
   - notes
3. Submit.

Return request goes to:
- super admin
- originally supplying center admin (via email)

## 8) Transfers page (super admin only)

Open `Transfers`.

### 8.1 Review queue
- Use center dropdown for scope
- Use status tabs/dropdown (`All`, `Pending`, `Approved`, `Return Requested`, etc.)

### 8.2 Approve transfer
For `Pending` transfer:
1. Review requested components and qty.
2. Optionally edit quantities.
3. Select supply center.
4. Add supplier remarks.
5. Click `Approve transfer`.

Stock movement on approval:
- Supplying center stock decreases.
- Requesting center stock increases.
- Supply center assignment is locked after approval.

### 8.3 Mark as returned
For `Return Requested` transfer:
1. Add return confirmation notes.
2. Click `Mark as returned`.

Stock movement on return:
- Requesting center stock decreases.
- Supplying center stock increases back.

## 9) Settings: centers and notification contacts (super admin only)

Open `Settings`. Changes take effect immediately - no restart, no developer.

### 9.1 Order notifications
- `Order notification email`: where new-order alerts go when a center has no
  address of its own.
- `Admin WhatsApp number`: the number students are handed to after placing an
  order, when the center has none of its own. Entering 10 digits assumes `+91`.

Each field has a **Send test** button. It sends to whatever is typed in the
box (saved or not), so you can confirm a new address or number works before
saving it. The WhatsApp test reports clearly if WhatsApp is not yet configured.

Use this whenever the responsible admin changes.

### 9.2 Business heads
A business head is the funding entity an invoice is booked against (at launch:
`ERA Foundation`). Every active head is offered in the Invoices and Add
Component forms and gets its own column in the dashboard's asset-value
breakdown.

- `Add business head`: enter the name and save. Available immediately.
- `Rename`: changes the name everywhere, including past invoices.
- `Deactivate`: hides it from new invoices; past invoices keep it.
- `Remove`: deletes a head nothing is booked against; otherwise deactivates it.
- The last active head cannot be removed - the invoice form requires one.

### 9.3 Centers
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

### 9.4 Email and notification behavior
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
| Day before expected return | Return reminder | - |
| Password reset code | Code | - |
| Password changed or reset | Security notice | - |
| Transfer request / approval / return | - | Super admin + centers involved |
| Procurement request / status | - | Super admin, then the requesting center |

Admin emails go to the center's own notification email if set in
`Settings`, otherwise the org-wide order notification email. No email ever
contains a password.

## 10) Report downloads and audit

Use Dashboard download section for exports:

1. `Orders Report`
   - detailed student/order fields
   - issued component-level sheet
   - return and damaged quantities
2. `Center Transfer Report`
   - summary sheet and component sheet
   - requested center, supply center, status, remarks
3. `Inventory`, `Users`, and `Logs` reports

Tip:
- Use date filters before orders export for monthly reporting.

## 11) Recommended daily checklist

Admin:
1. Approve pending student registrations.
2. Review pending orders.
3. Process return requests and damaged entries.
4. Check low stock list.
5. Review My Center request history.

Super admin:
1. Review pending transfer requests.
2. Assign supply center and approve.
3. Confirm return requests.
4. Export daily/weekly transfer and order reports.

## 12) Common admin issues

### Request not visible in super admin transfers
- Confirm request was submitted successfully from `My Center`.
- Refresh transfers page and check status tab/filter.

### Center dropdown appears empty
- Check `Settings` -> Centers: at least one center must be active.
- Reload the page after login/session refresh.

### Order emails going to the wrong person
- Update the address in `Settings` -> Order notifications, or the center's own
  email in the Centers table. No restart needed.

### "Insufficient stock" during transfer approve
- Supply center does not have enough stock for selected quantity.
- Reduce qty or choose another supply center.

### Frontend build missing page appears
Build frontend and restart backend:
- `cd frontend && npm run build`
- `cd ../backend && node server.js`
