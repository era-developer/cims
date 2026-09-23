# CIMS Admin and Super Admin Quick Cheat Sheet

**Comedkares Innovation Hub Inventory Management System.** Use this one-page version for daily operations.

## 1) Role boundaries

Admin:
- Works on own center only.
- Handles users, inventory, orders, and My Center (procurement requests
  and transfers from other centers).

Super Admin:
- Works across all centers.
- Approves center-to-center transfers in `Transfers`.
- Handles procurement requests in `Requests`.
- Uses global analytics and center-wide exports.
- Manages centers, business heads and notification contacts in `Settings`.

## 2) Start-of-day checklist

1. Check `Users` -> approve pending student registrations.
2. Check `Orders` -> process `Pending` requests.
3. Check returns (`Return Requested`, `Partially Returned`).
4. Review low stock in `Inventory`.
5. Review `Orders -> Internal use` for anything still out.
6. Super admin: check `Transfers` for `Pending` requests.

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
- purchased for (for example `ERA Foundation` or `ComedK`)

## 5b) QR labels and scanning

- Print: `Inventory` -> `QR labels` on the component -> tick units -> Print.
- New stock: save the invoice -> `Print N QR labels now` (or `QR labels for
  this invoice` on the invoice later). Per invoice line, *Unit tracking*:
  untick `Print QR labels` for bulk consumables (auto-unticks at 25+); tick
  `Record serial numbers` only when you want the maker's serials on file.
- Internal use: `Scan QR code`, type the tag -> **Add unit**, or **pick from the
  dropdown** under the component row; Program is optional. History: **Orders -> Internal use** tab.
- Look up any unit: `Scan` in the top bar. More than one camera on the PC?
  Use the **Camera** dropdown in the scanner (a virtual camera like DroidCam
  shows a frozen image and never scans); **Retry** restarts it.
- Returns: `Scan returned unit` marks it Good; tap `Damaged` for the rest.
- Swap: `Scan` inside the Swap dialog picks the unit in hand.

## 5c) Transfers between centers

- Ask: `My Center` -> **Request components from another center** -> add
  components (must already be in your catalog), program, responsible person,
  purpose -> submit. Super admins are emailed and notified.
- Approve (super admin): `Transfers` -> `Pending` -> check quantities ->
  pick the supply center (suggested ones have stock) -> `Approve transfer`.
  Units move to the requesting center immediately.
- Return: requesting admin -> **Return components** on the request (courier
  details optional); super admin -> `Mark as returned`. Units go back.
- Search on `Transfers`: by transfer ID, center, component, program, person.

## 6) Settings (super admin)

From `Settings`:
- Per-center order email / WhatsApp: `Edit` on the center's row. The WhatsApp
  number is what the student's **Send WhatsApp to Admin** button (5s auto-open)
  after placing an order points at; no number anywhere = no button. Org-wide
  fallbacks, the super admin email (transfer + procurement requests) and the
  student support contact are in the Notification contacts card. Effective
  immediately.
- Add a new center: enter the name, check the suggested code, create.
  It appears in login and every dropdown at once.
- A center with records is deactivated, never deleted.
- Add / rename business heads (funding entities on invoices): `ERA
  Foundation` and `ComedK` at launch.
- Centers table shows the order email actually in use; *(default)* means
  it comes from the `.env` hub mailbox or the org-wide address.

## 6a) Notifications
- **Bell** (top bar): unread count; **See all** = full history with read status for every update sent to you.
- Dashboard yellow bar → **Enable** to get new orders, return requests, registrations and transfer updates instantly.
- Manage / test: **My Center** (admin) or **Settings** (super admin).
- You never get a notification for an action you took yourself.

## 6b) Support inbox
- `Support` in the nav: questions students asked from the Help bubble (own
  center; super admin: all centers). Reply there -- the student gets it in
  their Help panel, bell, push and email. **Close question** when resolved.
- New questions also land in the center mailbox and your bell.

## 7) Downloads for reporting

From dashboard:
- Inventory report
- Orders report (with date range)
- Center transfer report
- Internal use report
- Users report
- Activity logs

## 8) Common issue checks

- Request not visible: verify center filter + status filter.
- Student cannot login after register: user still pending approval.
- Order emails to the wrong person: fix the address in `Settings`.
- Transfer will not approve ("not in X's catalog"): the supply center needs
  a component with exactly that name; pick a suggested center or add it there.
