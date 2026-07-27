# CIMS Student User Manual

This guide explains how students register, place component requests, and complete the return flow in CIMS.

## 1) Login and registration

### 1.1 First-time registration
1. Open the CIMS URL (for example `http://localhost:5000` or your ngrok URL).
2. On the login page, click `Student Register`.
3. Fill all required fields:
   - Full name
   - Username
   - Email
   - Mobile
   - College
   - Center
   - Password and confirm password
4. Click `Submit Registration`.
5. Wait for center admin approval before signing in.

Notes:
- You can also register through the center registration link/QR.
- If login says approval is pending, contact your center admin.

### 1.2 Sign in
1. Open the login page.
2. Enter `Username or Email` and `Password`.
3. Click `Sign In`.

After sign in, you will see:
- `Browse`
- `My Orders`
- `My Profile`
- `Cart`

## 2) Browse and select components

1. Go to `Browse`.
2. Use:
   - Search bar (`Search components...`)
   - Category chips
3. Open `View Details` to see full component information.
4. Click `Add to Cart` for available components.

Stock behavior:
- `In Stock`: available
- `Low Stock`: limited quantity
- `Out of Stock`: cannot be added

## 3) Place an order

1. Open `Cart`.
2. In `Cart Review`, verify item quantities.
3. Click `Continue to Details`.
4. Fill required project fields:
   - Student Name
   - Email
   - Mobile
   - College
   - Department
   - Course Name
   - Project Name
   - Expected Date of Return
   - Purpose
5. Click `Submit Request`.

What happens on submit:
- Order is created with status `Pending`.
- The requested quantity is reserved from live stock.
- Admin gets notification for review.

## 4) Track order status

Go to `My Orders` to track each order.

Order statuses:
- `Pending`: waiting for admin review
- `Approved`: components are issued
- `Rejected`: request was not approved
- `Return Requested`: you asked to return; admin verification pending
- `Partially Returned`: some items returned, some still pending
- `Returned`: order fully closed

Important:
- Admin may reduce quantities during approval if full quantity is not available.
- If reduced, only approved quantities are issued.

## 5) Return flow for students

1. In `My Orders`, open an `Approved` order.
2. Click `Request Return` after your work is complete.
3. Hand components physically to the lab/admin.
4. Admin records received and damaged quantities.
5. Order closes as `Returned` (or `Partially Returned` until complete).

## 6) My Profile

Use `My Profile` to keep your details updated. Updated data helps future checkout auto-fill and cleaner order records.

## 7) Student best practices

- Request only what is required for your project.
- Keep expected return date realistic.
- Mention clear project purpose.
- Return all components on time.
- Inform admin immediately about damaged/missing parts.

## 8) Common student issues

### "Your registration is awaiting admin approval."
Your account exists but is not yet activated by admin.

### "Insufficient stock"
Requested quantity is above current available stock.

### Cannot place order
Check required fields in cart details, especially expected return date and purpose.

### No components visible
Your center inventory may have no active components; contact admin.
