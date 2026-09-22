# CIMS Demo Talk Track (Center Rollout)

Use this script for a 20-30 minute live demo with all centers.

## 0) Demo objective (30 seconds)

"Today we will walk through the complete CIMS flow: student request, admin approval with quantity control, return tracking, and center-to-center transfer management."

## 1) Student flow demo (7-10 minutes)

## 1.1 Student registration and login

1. Open login page.
2. Show `Student Register`.
3. Submit a sample registration.
4. Mention: "This requires admin approval before login."

## 1.2 Browse and add to cart

1. Login as approved student.
2. Open `Browse`.
3. Search component and add to cart.
4. Show live stock visibility.

## 1.3 Place order

1. Open `Cart`.
2. Fill project details and expected return date.
3. Submit request.
4. Show order appears in `My Orders` as `Pending`.

## 2) Admin flow demo (8-10 minutes)

## 2.1 Approve registration

1. Login as center admin.
2. Open `Users`.
3. Approve pending student.

## 2.2 Review and process student order

1. Open `Orders`.
2. Open pending order.
3. Demonstrate quantity edit:
   - reduce one component quantity
   - remove one component by setting qty to 0
4. Approve remaining items.
5. Explain: "Reduced quantity is restored to stock automatically."

## 2.3 Return lifecycle

1. Back in student account, click `Request Return`.
2. Return to admin account and open return entry.
3. Enter returned qty and one damaged qty example.
4. Save update and show status change (`Partially Returned` or `Returned`).

## 3) Center-to-center transfer flow (8-10 minutes)

## 3.1 Requesting center admin

1. Login as center admin (example: Yelahanka).
2. Open `My Center`.
3. Raise request with:
   - components + qty
   - program name
   - responsible person/email
   - purpose and return date
4. Submit and show history card.

## 3.2 Super admin approval

1. Login as super admin.
2. Open `Transfers`.
3. Filter `Pending`.
4. Select supply center (example: Gopalan Mall).
5. Optionally adjust qty.
6. Approve transfer.
7. Explain stock movement:
   - supply center decreases
   - requesting center increases

## 3.3 Return transfer

1. Requesting center admin opens `My Center` and clicks `Return components`.
2. Fill optional courier/tracking details.
3. Super admin marks as returned in `Transfers`.
4. Explain reverse stock movement back to supply center.

## 4) Reporting and audit close (3-4 minutes)

1. Open `Dashboard`.
2. Show Excel downloads:
   - orders
   - transfers
   - inventory
   - users
   - logs
3. Mention date filter in orders export.

## 5) Suggested speaking points

- "Every movement is tracked with status and timestamps."
- "No manual stock reconciliation is needed for approved and returned flows."
- "Center-to-center borrowing is auditable end-to-end."
- "Damaged quantity is tracked separately for analysis."

## 6) FAQ responses

Q: Can admin issue partial quantity?  
A: Yes, admin can edit qty before approval.

Q: Can supply center be changed after approval?  
A: No, assignment is locked after approval.

Q: Where is return courier info stored?  
A: In transfer return notes and notification trail.

Q: Is student involved in center-to-center requests?  
A: No, that flow is between admin and super admin.
