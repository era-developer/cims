# CIMS Admin and Super Admin User Manual

This guide covers daily operations for center admins and super admins:
- student orders
- inventory control
- user approvals
- center-to-center transfers
- reporting and exports

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

## 2) Daily menu map

Top navigation:
- `Dashboard`
- `Inventory`
- `Orders`
- `My Center`
- `Users`
- `Transfers` (super admin only)

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
- Purchased for (`ERA Foundation` or `Comedkares`)

### 4.2 Key inventory controls
- Quick `+ / -` stock buttons
- Category filter dropdown
- Search box
- `Visible to students` toggle (Active/Hidden)
- Damaged count tracking

Rules:
- Keep component names consistent across centers.
- Add new components before requesting them in transfer flow.

## 5) Student registration approval and user management

Open `Users`.

You can:
- Approve self-registered students (`Pending Approval`)
- Create manual users (student/admin)
- Edit user details
- Activate/disable accounts
- Delete users

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

## 9) Email and notification behavior

Order and transfer lifecycle sends email notifications to configured recipients.

Center admin email routing uses center-specific env keys (for example `JP_NAGAR_EMAIL`, `YELAHANKA_EMAIL`, etc.) with fallback to `CENTER_EMAIL`.

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
- Verify center list in config and current user role.
- Reload the page after login/session refresh.

### "Insufficient stock" during transfer approve
- Supply center does not have enough stock for selected quantity.
- Reduce qty or choose another supply center.

### Frontend build missing page appears
Build frontend and restart backend:
- `cd frontend && npm run build`
- `cd ../backend && node server.js`
