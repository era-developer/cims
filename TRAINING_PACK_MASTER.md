# CIMS Training Pack (Master)

This single document combines:
- student quick flow
- admin/super admin quick flow
- demo talk track

Use this for trainer-led sessions and center rollout.

## 1) Student flow (quick)

1. Register from login page (`Student Register`).
2. Wait for admin approval.
3. Login and open `Browse`.
4. Add components to cart.
5. Fill project details in `Cart`.
6. Submit request.
7. Track status in `My Orders`.
8. Raise return request after project usage.

Status meanings:
- `Pending` = waiting admin review
- `Approved` = issued
- `Rejected` = not approved
- `Return Requested` = waiting admin return verification
- `Partially Returned` = balance pending
- `Returned` = closed

## 2) Admin flow (quick)

1. Open `Users` and approve new student registrations.
2. Open `Orders` and review pending orders.
3. During approval, edit qty if required:
   - reduce qty
   - remove item (set qty to 0)
4. Approve/reject.
5. Process return requests:
   - enter returned qty
   - enter damaged qty
6. Verify stock and damaged tracking update.

## 3) Super admin flow (quick)

1. Open `Transfers`.
2. Review center-to-center pending requests.
3. Optionally edit component qty.
4. Assign supply center.
5. Approve transfer.
6. On return request, mark transfer returned.

Stock movement rules:
- approval: supply center stock decreases, requesting center increases
- return closure: requesting center decreases, supply center increases back

## 4) Demo script (recommended 20-30 mins)

## 4.1 Student part
1. Show registration.
2. Login as student.
3. Add components and submit order.
4. Show `Pending` in `My Orders`.

## 4.2 Admin part
1. Approve pending student in `Users`.
2. Open pending order in `Orders`.
3. Edit qty and approve.
4. Show student-side status update.
5. Trigger return request and process return.

## 4.3 Transfer part
1. From center admin (`My Center`), raise transfer request.
2. From super admin (`Transfers`), assign supply center and approve.
3. From requesting center, raise return request.
4. From super admin, mark returned.

## 4.4 Reporting part
From `Dashboard`, show exports:
- orders report
- transfer report
- inventory report
- users report
- logs report

## 5) Trainer closing points

- All stock movement is status-driven and auditable.
- Partial approvals are supported.
- Damaged quantities are tracked separately.
- Center-to-center flow is controlled by super admin.

## 6) Pre-demo checklist

- Backend running on `http://localhost:5000`
- Frontend build available
- Test accounts ready (student/admin/super admin)
- At least one component with stock in each demo center
- Email settings configured (if notification demo needed)
