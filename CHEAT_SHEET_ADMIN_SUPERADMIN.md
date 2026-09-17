# KIMS Admin and Super Admin Quick Cheat Sheet

**Kalam Pragati Inventory Management System.** Use this one-page version for daily operations.

## 1) Role boundaries

Admin:
- Works on own center only.
- Handles users, inventory, orders, and My Center.

Super Admin:
- Works across all centers.
- Handles transfer approvals in `Transfers`.
- Uses global analytics and center-wide exports.
- Manages centers and notification contacts in `Settings`.

## 2) Start-of-day checklist

1. Check `Users` -> approve pending student registrations.
2. Check `Orders` -> process `Pending` requests.
3. Check returns (`Return Requested`, `Partially Returned`).
4. Review low stock in `Inventory`.
5. Review `My Center` / `Transfers` updates.

## 3) Orders workflow (student requests)

From `Orders`:
- `Pending` -> `Approved` / `Rejected`
- `Approved` -> `Return Requested` -> `Partially Returned` / `Returned`

Important:
- During approval, you can reduce/remove quantities.
- Reduced quantity returns back to live stock automatically.

## 4) Return processing

1. Open order return entry.
2. Enter returned qty and damaged qty per component.
3. Save update.

System auto-updates:
- stock increases for good returned qty
- damaged count increases for damaged qty

## 5) Inventory essentials

When adding/updating component, keep:
- component name (consistent)
- category/unit/location
- stock and procured values
- invoice number
- vendor name
- project/purpose
- purchased for (for example `ERA Foundation` or `Kalam Pragati`)

## 6) Center-to-center flow

Admin (`My Center`):
1. Raise request (component list + program/contact details).
2. Track in `Requested` and `Sent` history.
3. Raise return request after work completion.

Super Admin (`Transfers`):
1. Review pending transfer.
2. Optionally adjust qty.
3. Assign supply center.
4. Approve transfer (stock moves both centers).
5. On return request, mark returned (stock reverses back).

## 7) Settings (super admin)

From `Settings`:
- Change the order-notification email / admin WhatsApp number when the
  responsible admin changes. Effective immediately.
- Add a new center: enter the name, check the suggested code, create.
  It appears in login and every dropdown at once.
- A center with records is deactivated, never deleted.

## 8) Downloads for reporting

From dashboard:
- Inventory report
- Orders report (with date range)
- Center transfer report
- Users report
- Activity logs

## 9) Common issue checks

- Request not visible: verify center filter + status filter.
- Insufficient stock in transfer approve: choose another center or reduce qty.
- Student cannot login after register: user still pending approval.
- Order emails to the wrong person: fix the address in `Settings`.
