# KIMS Admin and Super Admin Quick Cheat Sheet

**Kalam Pragati Inventory Management System.** Use this one-page version for daily operations.

## 1) Role boundaries

Admin:
- Works on own center only.
- Handles users, inventory, orders, and My Center.

Super Admin:
- Works across all centers.
- Handles procurement requests in `Requests`.
- Uses global analytics and center-wide exports.
- Manages centers and notification contacts in `Settings`.

## 2) Start-of-day checklist

1. Check `Users` -> approve pending student registrations.
2. Check `Orders` -> process `Pending` requests.
3. Check returns (`Return Requested`, `Partially Returned`).
4. Review low stock in `Inventory`.
5. Review `Orders -> Internal use` for anything still out.

## 3) Orders workflow (student requests)

From `Orders`:
- `Pending` -> `Approved` / `Rejected`
- `Approved` -> `Return Requested` -> `Partially Returned` / `Returned`

Approve = checkout: set the issuing quantity per component, then **scan** or
**tick** exactly those units. Confirm is enabled only when every component
has its full count selected. Reduced quantity returns to stock automatically.

## 4) Return processing

1. Open the order -> **Record Returned Items**.
2. One **Scan QR code** for the whole order: scan a unit -> **Good / Damaged** -> scan the next (progress per component shown). Or use the buttons beside each tag.
3. Damaged needs a reason. **Save Return Update**.
4. Staff pulls: **Orders -> Internal use** tab -> **Record return** (same scanner).

## 5) Inventory essentials

When adding/updating component, keep:
- component name (consistent)
- category/unit/location
- stock and procured values
- invoice number
- vendor name
- project/purpose
- purchased for (for example `ERA Foundation` or `Kalam Pragati`)

## 5b) QR labels and scanning

- Print: `Inventory` -> `QR labels` on the component -> tick units -> Print.
- New stock: save the invoice -> `Print N QR labels now` (or `QR labels for
  this invoice` on the invoice later).
- Internal use: `Scan QR code` or type the tag -> **Add unit** to pick exact units; Program is optional. History: **Orders -> Internal use** tab.
- Look up any unit: `Scan` in the top bar.
- Returns: `Scan returned unit` marks it Good; tap `Damaged` for the rest.
- Swap: `Scan` inside the Swap dialog picks the unit in hand.

## 6) Settings (super admin)

From `Settings`:
- Change the order-notification email / admin WhatsApp number when the
  responsible admin changes. Effective immediately.
- Add a new center: enter the name, check the suggested code, create.
  It appears in login and every dropdown at once.
- A center with records is deactivated, never deleted.
- Add / rename business heads (funding entities on invoices). Launch
  default is `ERA Foundation`.

## 6a) Notifications
- **Bell** (top bar): unread count; **See all** = full history with read status for every update sent to you.
- Dashboard yellow bar → **Enable** to get new orders, return requests and registrations instantly.
- Manage / test: **My Center** (admin) or **Settings** (super admin).
- You never get a notification for an action you took yourself.

## 7) Downloads for reporting

From dashboard:
- Inventory report
- Orders report (with date range)
- Internal use report
- Users report
- Activity logs

## 8) Common issue checks

- Request not visible: verify center filter + status filter.
- Student cannot login after register: user still pending approval.
- Order emails to the wrong person: fix the address in `Settings`.
