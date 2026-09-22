const express = require('express');
const { getOrgName, getOrgShortName } = require('../utils/settings');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { getDb } = require('../utils/db');
const { sendOrderNotification, sendStatusUpdate, sendOtpEmail } = require('../utils/email');
const push = require('../utils/push');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { swapAsset } = require('../utils/assetSwap');
const { createOtp, verifyOtp, consumeOtp, otpErrorMessage } = require('../utils/otp');

const router = express.Router();

// Falls back to a text header in the PDF if the logo file isn't present --
// see backend/assets/logo.png.
const LOGO_FILE_PATH = path.join(__dirname, '..', 'assets', 'logo.png');
const LOGO_PATH = fs.existsSync(LOGO_FILE_PATH) ? LOGO_FILE_PATH : null;

const ADMIN_STATUSES = new Set(['Approved', 'Rejected', 'Returned']);
// Only Electronic components can actually be checked out by students; every
// other classification is browse/view-only in the student portal.
const CHECKOUT_ELIGIBLE_CLASSIFICATION = 'Electronic components';

function getScopedCenterId(req) {
  if (req.user.role === 'super_admin') {
    return String(req.query.centerId || req.body.centerId || '').trim();
  }
  return req.user.centerId;
}

function aggregateItems(items = []) {
  const aggregated = new Map();
  for (const rawItem of items) {
    const id = String(rawItem.id || '').trim();
    const qty = Number(rawItem.qty) || 0;
    if (!id || qty <= 0) continue;
    const existing = aggregated.get(id) || { id, name: rawItem.name || 'Component', qty: 0, unit: rawItem.unit || 'pcs' };
    existing.qty += qty;
    if (rawItem.name) existing.name = rawItem.name;
    if (rawItem.unit) existing.unit = rawItem.unit;
    aggregated.set(id, existing);
  }
  return Array.from(aggregated.values());
}

function getOrCreateStudent(db, userId, centerId, details) {
  const existing = db.prepare('SELECT id FROM students WHERE user_id = ?').get(userId);
  const fields = [
    details.studentName || '', details.usn || null, details.college || null, details.degree || null,
    details.department || null, details.courseName || null, details.graduationYear || null,
    details.mobile || null, details.email || null,
  ];
  if (existing) {
    db.prepare(`
      UPDATE students SET full_name = ?, student_code = ?, college = ?, degree = ?, department = ?,
        course_name = ?, graduation_year = ?, mobile = ?, email = ? WHERE id = ?
    `).run(...fields, existing.id);
    return existing.id;
  }
  return db.prepare(`
    INSERT INTO students (user_id, full_name, student_code, college, degree, department, course_name,
      graduation_year, mobile, email, center_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, ...fields, centerId).lastInsertRowid;
}

function getOrCreateProject(db, centerId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = db.prepare('SELECT id FROM projects WHERE center_id = ? AND name = ?').get(centerId, trimmed);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO projects (name, center_id) VALUES (?, ?)').run(trimmed, centerId).lastInsertRowid;
}

function loadItemsForRecord(db, issueRecordId) {
  return db.prepare(`
    SELECT id, catalog_id AS catalogId, name, qty_requested AS qtyRequested, qty_approved AS qtyApproved, unit
    FROM issue_record_items WHERE issue_record_id = ?
  `).all(issueRecordId);
}

function loadReturnSummaryForItem(db, itemId) {
  return db.prepare(`
    SELECT COALESCE(SUM(returned_qty), 0) AS returnedQty, COALESCE(SUM(damaged_qty), 0) AS damagedQty
    FROM order_return_items WHERE issue_record_item_id = ?
  `).get(itemId);
}

function loadTeamMembersForRecord(db, issueRecordId) {
  return db.prepare('SELECT name, mobile FROM issue_record_team_members WHERE issue_record_id = ? ORDER BY id').all(issueRecordId);
}

// The specific physical units reserved/issued against one order line item --
// this is what actually tells a center admin which tagged unit to hand a
// student, not just "3x Raspberry Pi". Serial number is only populated for
// critical items (see isCriticalAssetName), asset tag always is.
// correctionReason/correctionBy/correctionAt surface *why* this unit is in
// its current state -- either an admin's later correction (via the
// Inventory "Fix Status" control, event_type 'adjusted') or the reason
// given when it was marked damaged at return time (event_type 'damaged').
// Whichever happened most recently wins, so a later correction always
// supersedes the original damage reason. Visible here so students and
// PDFs can see it too, not just buried in the asset's own lifecycle log.
function reasonFromNotes(notes) {
  if (!notes) return null;
  const idx = String(notes).indexOf(' -- ');
  return idx === -1 ? notes : notes.slice(idx + 4).trim();
}
function loadAssetsForItem(db, itemId) {
  const rows = db.prepare(`
    SELECT a.id, a.asset_tag AS assetTag, a.serial_number AS serialNumber, a.status,
           (SELECT e.notes FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type IN ('adjusted', 'damaged') ORDER BY e.occurred_at DESC LIMIT 1) AS correctionReason,
           (SELECT e.performed_by FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type IN ('adjusted', 'damaged') ORDER BY e.occurred_at DESC LIMIT 1) AS correctionBy,
           (SELECT e.occurred_at FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type IN ('adjusted', 'damaged') ORDER BY e.occurred_at DESC LIMIT 1) AS correctionAt
    FROM issue_record_assets ira JOIN assets a ON a.id = ira.asset_id
    WHERE ira.issue_record_item_id = ?
    ORDER BY a.asset_tag
  `).all(itemId);
  return rows.map(r => ({ ...r, correctionReason: reasonFromNotes(r.correctionReason) }));
}

// Reconstructs the same shape the old Excel-backed API returned, so the
// frontend (StudentDashboard/Cart/MyOrders/AdminOrders) needs no changes.
function buildOrderResponse(db, row) {
  const rawItems = loadItemsForRecord(db, row.id);
  const items = rawItems.map(i => ({
    id: String(i.catalogId), name: i.name, qty: i.qtyApproved ?? i.qtyRequested, unit: i.unit,
    assets: loadAssetsForItem(db, i.id),
  }));
  const returnSummary = rawItems.map(i => {
    const orderedQty = i.qtyApproved ?? i.qtyRequested;
    const { returnedQty, damagedQty } = loadReturnSummaryForItem(db, i.id);
    return {
      id: String(i.catalogId), name: i.name, unit: i.unit, orderedQty,
      returnedQty, damagedQty, pendingQty: Math.max(0, orderedQty - returnedQty - damagedQty),
    };
  });
  const outstandingItems = returnSummary
    .filter(item => item.pendingQty > 0)
    .map(item => ({ id: item.id, name: item.name, unit: item.unit, qty: item.pendingQty }));

  return {
    orderId: row.order_id,
    centerId: row.center_id,
    centerName: row.centerName,
    createdAt: row.created_at,
    username: row.username || '',
    studentName: row.studentName,
    mobile: row.mobile,
    college: row.college,
    degree: row.degree,
    department: row.department,
    courseName: row.courseName,
    programId: row.project_id || null,
    programName: row.programName || '',
    projectName: row.studentProjectName || '',
    teamName: row.team_name || '',
    teamMembers: loadTeamMembersForRecord(db, row.id),
    facultyGuide: row.faculty_guide || '',
    purpose: row.purpose || '',
    studentEmail: row.userEmail || row.studentEmailFallback || '',
    items,
    totalItems: items.length,
    status: row.status,
    adminRemarks: row.admin_remarks || '',
    returnSummary,
    outstandingItems,
    expectedReturnDate: row.expected_return_date,
    reservedAt: row.reserved_at,
    issuedAt: row.issued_at,
    returnRequestedAt: row.return_requested_at,
    returnedAt: row.returned_at,
    lastReturnAt: row.last_return_at,
    reminderSentAt: row.reminder_sent_at || '',
    termsAcceptedAt: row.terms_accepted_at || '',
  };
}

function loadOrderRows(db, centerId) {
  const clause = centerId ? 'WHERE ir.center_id = ?' : '';
  const params = centerId ? [centerId] : [];
  return db.prepare(`
    SELECT ir.*, s.full_name AS studentName, s.mobile, s.college, s.degree, s.department,
           s.course_name AS courseName, s.email AS studentEmailFallback, s.user_id AS studentUserId,
           u.username AS username, u.email AS userEmail,
           p.name AS programName, ir.student_project_name AS studentProjectName, c.name AS centerName
    FROM issue_records ir
    JOIN students s ON s.id = ir.student_id
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN projects p ON p.id = ir.project_id
    JOIN centers c ON c.id = ir.center_id
    ${clause}
    ORDER BY ir.created_at DESC
  `).all(...params);
}

// Used by utils/reminders.js too, so both read the exact same shape.
function getOrdersForCenter(centerId) {
  const db = getDb();
  return loadOrderRows(db, centerId).map(row => buildOrderResponse(db, row));
}

function markReminderSent(orderId, when) {
  getDb().prepare('UPDATE issue_records SET reminder_sent_at = ? WHERE order_id = ?').run(when, orderId);
}

// Sends an order-confirmation code to whatever email the student currently
// has on the checkout form -- not necessarily their saved profile email
// (they may have typed a different one for this order, or unchecked "save
// to profile"). This intentionally does NOT require the target email to
// match req.user's on-file email; the goal here is confirming the student
// actually reviewed and controls the address they're placing this specific
// order under, not re-authenticating who they are (they're already logged
// in for that).
router.post('/send-otp', authMiddleware, async (req, res) => {
  const targetEmail = String(req.body.email || '').trim();
  if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    return res.status(400).json({ message: 'Enter a valid email address to receive the confirmation code.' });
  }
  try {
    const db = getDb();
    const { code, cooldownRemaining, expiresInMinutes } = await createOtp(db, {
      userId: req.user.id, purpose: 'order_confirmation', targetEmail,
    });
    if (!code) {
      return res.json({ message: 'A code was already sent recently -- check your email.', cooldownRemaining, alreadySent: true });
    }
    const sent = await sendOtpEmail({ targetEmail, centerId: req.user.centerId, code, purpose: 'order_confirmation', expiresInMinutes });
    if (!sent.ok) {
      return res.status(502).json({ message: 'Unable to send the confirmation email right now. Please try again shortly.' });
    }
    res.json({ message: `A verification code was sent to ${targetEmail}.`, expiresInMinutes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Unable to send a confirmation code right now.' });
  }
});

// POST place new order (student) -- reserves real physical assets, not a
// spreadsheet stock count.
router.post('/', authMiddleware, async (req, res) => {
  const db = getDb();
  const centerId = req.user.centerId;
  const aggregated = aggregateItems(req.body.items || []);
  if (!aggregated.length) {
    return res.status(400).json({ message: 'Cart is empty' });
  }

  const studentDetails = req.body.studentDetails || {};
  const expectedReturnDateRaw = String(studentDetails.expectedReturnDate || '').trim();
  if (!expectedReturnDateRaw) {
    return res.status(400).json({ message: 'Expected return date is required' });
  }
  const expectedReturnDate = new Date(expectedReturnDateRaw);
  if (Number.isNaN(expectedReturnDate.getTime())) {
    return res.status(400).json({ message: 'Expected return date is invalid' });
  }
  // Enforced here, not just via a disabled button -- a client-side-only
  // checkbox can be bypassed by calling this endpoint directly, and this is
  // meant to be a real acceptance record, not UI decoration.
  if (req.body.agreedToTerms !== true) {
    return res.status(400).json({ message: 'You must agree to the Terms & Conditions before submitting a request' });
  }
  // Same reasoning as agreedToTerms -- checked server-side so a direct API
  // call can't skip confirmation, not just the UI step. Verified BEFORE the
  // transaction starts so an invalid/expired code never touches stock.
  const otpCode = String(req.body.otpCode || '').trim();
  if (!otpCode) {
    return res.status(400).json({ message: 'Enter the verification code sent to your email before submitting.' });
  }
  // Checked, not consumed: if the order then fails (stock ran out while the
  // student was typing) the same code still works on the retry.
  const otpResult = await verifyOtp(db, { userId: req.user.id, purpose: 'order_confirmation', code: otpCode, consume: false });
  if (!otpResult.ok) {
    return res.status(400).json({ message: otpErrorMessage(otpResult.reason) });
  }

  let orderId;
  db.exec('BEGIN TRANSACTION');
  try {
    for (const item of aggregated) {
      const catalogId = Number(item.id);
      const catalog = db.prepare(`
        SELECT pc.id, pc.name, c.name AS classificationName FROM product_catalog pc
        LEFT JOIN classifications c ON c.id = pc.classification_id
        WHERE pc.id = ? AND pc.center_id = ?
      `).get(catalogId, centerId);
      if (!catalog) throw new Error(`Component not found: ${item.name}`);
      if (catalog.classificationName !== CHECKOUT_ELIGIBLE_CLASSIFICATION) {
        throw new Error(`${catalog.name} is available for information only and can't be requested for checkout.`);
      }
      const available = db.prepare("SELECT COUNT(*) c FROM assets WHERE catalog_id = ? AND status = 'available'").get(catalogId);
      if (available.c < item.qty) {
        throw new Error(`Insufficient stock for: ${catalog.name} (Available: ${available.c})`);
      }
    }

    const studentId = getOrCreateStudent(db, req.user.id, centerId, {
      ...studentDetails, email: studentDetails.email || req.user.email,
    });
    // Program (admin-managed, selected from the Programs list) drives
    // traceability/reporting via project_id. Project Name is separate,
    // free-text, student-entered context -- not mandatory, no FK.
    const projectId = getOrCreateProject(db, centerId, studentDetails.programName);
    // Prefixed with the org short name (CIMS-...), so an order id says
    // which portal it came from when both programmes share a WhatsApp inbox.
    orderId = `${require('../utils/settings').getOrgShortName()}-${Date.now().toString(36).toUpperCase()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO issue_records
        (order_id, center_id, student_id, project_id, team_name, faculty_guide, purpose, status,
         expected_return_date, created_at, reserved_at, student_project_name, terms_accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?)
    `).run(orderId, centerId, studentId, projectId, studentDetails.teamName || null,
           studentDetails.facultyGuide || null, studentDetails.purpose || null,
           expectedReturnDate.toISOString(), now, now, String(studentDetails.projectName || '').trim() || null, now);
    const issueRecordId = db.prepare('SELECT id FROM issue_records WHERE order_id = ?').get(orderId).id;

    const teamMembers = Array.isArray(req.body.teamMembers) ? req.body.teamMembers : [];
    const insertTeamMember = db.prepare('INSERT INTO issue_record_team_members (issue_record_id, name, mobile) VALUES (?, ?, ?)');
    for (const member of teamMembers) {
      const memberName = String(member?.name || '').trim();
      if (!memberName) continue;
      insertTeamMember.run(issueRecordId, memberName, String(member?.mobile || '').trim() || null);
    }

    for (const item of aggregated) {
      const catalogId = Number(item.id);
      const itemId = db.prepare(`
        INSERT INTO issue_record_items (issue_record_id, catalog_id, name, qty_requested, unit)
        VALUES (?, ?, ?, ?, ?)
      `).run(issueRecordId, catalogId, item.name, item.qty, item.unit || 'pcs').lastInsertRowid;

      const toReserve = db.prepare("SELECT id FROM assets WHERE catalog_id = ? AND status = 'available' LIMIT ?")
        .all(catalogId, item.qty);
      for (const asset of toReserve) {
        db.prepare("UPDATE assets SET status = 'reserved' WHERE id = ?").run(asset.id);
        db.prepare(`
          INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id,
            issue_record_id, notes, performed_by, occurred_at)
          VALUES (?, 'reserved', 'available', 'reserved', ?, ?, ?, ?, ?)
        `).run(asset.id, centerId, issueRecordId, `Reserved for student order ${orderId}`, req.user.username, now);
        db.prepare('INSERT INTO issue_record_assets (issue_record_item_id, asset_id) VALUES (?, ?)').run(itemId, asset.id);
      }
    }

    consumeOtp(db, otpResult.otpId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    const isValidationError = /cart is empty|component not found|insufficient stock|expected return|information only/i.test(err.message || '');
    return res.status(isValidationError ? 400 : 500).json({ message: err.message || 'Error placing order' });
  }

  const row = loadOrderRows(db, centerId).find(r => r.order_id === orderId);
  const orderForNotification = buildOrderResponse(db, row);
  sendOrderNotification(orderForNotification, centerId).catch(console.error);
  push.notifyStudentOrderPlaced(orderForNotification);
  push.notifyAdminsNewOrder(orderForNotification, { excludeUserId: req.user.id });

  res.status(201).json({ message: 'Order placed successfully', orderId });
});

// GET all orders (admin) or own orders (student)
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const scopedCenterId = getScopedCenterId(req);
    const rows = loadOrderRows(db, scopedCenterId || undefined);
    const orders = rows.map(row => buildOrderResponse(db, row));
    if (['admin', 'super_admin'].includes(req.user.role)) return res.json(orders);
    res.json(orders.filter(order => order.username === req.user.username));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

function pdfDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pdfDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function pdfSectionTitle(doc, title) {
  doc.moveDown(0.7);
  const y = doc.y;
  doc.rect(50, y + 1, 3, 11).fill('#2d2a6e');
  doc.fillColor('#2d2a6e').font('Helvetica-Bold').fontSize(11).text(title, 60, y);
  doc.fillColor('#000');
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.5);
}

// Two fields per row, label above value -- a small "form" look rather than
// a plain "Label: value" line, closer to what a real document uses. Row
// height is measured from the actual value text (a long purpose/college
// name wraps to 2+ lines) -- a fixed row height would let a wrapped value
// overlap the row below it.
function pdfFieldGrid(doc, fields) {
  const col1X = 50, col1W = 220, col2X = 300, col2W = 245;
  for (let i = 0; i < fields.length; i += 2) {
    const rowY = doc.y;
    const [label1, value1] = fields[i];
    const val1Text = String(value1 || '-');
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(label1.toUpperCase(), col1X, rowY, { width: col1W, characterSpacing: 0.3 });
    doc.font('Helvetica-Bold').fontSize(10);
    const height1 = doc.heightOfString(val1Text, { width: col1W });
    doc.fillColor('#1a1a2e').text(val1Text, col1X, rowY + 12, { width: col1W });

    let height2 = 0;
    if (fields[i + 1]) {
      const [label2, value2] = fields[i + 1];
      const val2Text = String(value2 || '-');
      doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(label2.toUpperCase(), col2X, rowY, { width: col2W, characterSpacing: 0.3 });
      doc.font('Helvetica-Bold').fontSize(10);
      height2 = doc.heightOfString(val2Text, { width: col2W });
      doc.fillColor('#1a1a2e').text(val2Text, col2X, rowY + 12, { width: col2W });
    }
    doc.y = rowY + 12 + Math.max(height1, height2) + 10;
  }
  doc.fillColor('#000');
}

// Downloadable, letterhead-styled order summary -- the closest thing this
// system has to a formal "invoice" for a component issue (no pricing is
// shown to students elsewhere in the app, so none appears here either).
router.get('/:orderId/pdf', authMiddleware, (req, res) => {
  const db = getDb();
  const row = loadOrderRows(db, null).find(r => r.order_id === req.params.orderId);
  if (!row) return res.status(404).json({ message: 'Order not found' });

  const isOwner = req.user.role === 'student' && req.user.username === row.username;
  const isScopedAdmin = req.user.role === 'admin' && req.user.centerId === row.center_id;
  const isSuperAdmin = req.user.role === 'super_admin';
  if (!isOwner && !isScopedAdmin && !isSuperAdmin) {
    return res.status(403).json({ message: 'You cannot access this order' });
  }

  const order = buildOrderResponse(db, row);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${order.orderId}.pdf"`);
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const contentRight = pageWidth - 50;

  // White letterhead (not a filled color band) -- the real logo is dark
  // navy/orange on a transparent background, so it needs to sit on white,
  // not be stamped on top of a navy fill where it would vanish.
  if (LOGO_PATH) {
    doc.image(LOGO_PATH, 50, 30, { width: 170 });
  } else {
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#2d2a6e').text(getOrgName(), 50, 34);
  }
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#2d2a6e').text(order.orderId, 0, 30, { align: 'right', width: contentRight });
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#c2410c').text(order.status, 0, 50, { align: 'right', width: contentRight });
  doc.font('Helvetica').fontSize(7.5).fillColor('#9ca3af').text(`Generated ${pdfDateTime(new Date().toISOString())}`, 0, 66, { align: 'right', width: contentRight });
  doc.fillColor('#000');

  doc.rect(0, 92, pageWidth, 3).fill('#2d2a6e');
  doc.fillColor('#000');

  doc.y = 112;
  doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
    .text(`${order.centerName}   |   Placed on ${pdfDate(order.createdAt)}   |   Program: ${order.programName || '-'}`, 50, doc.y);
  doc.fillColor('#000');

  pdfSectionTitle(doc, 'Student Details');
  pdfFieldGrid(doc, [
    ['Student Name', order.studentName], ['Mobile', order.mobile],
    ['Email', order.studentEmail], ['College', order.college],
    ['Degree', order.degree], ['Department', order.department],
    ['Course', order.courseName],
  ]);

  pdfSectionTitle(doc, 'Team & Project Details');
  pdfFieldGrid(doc, [
    ['Program', order.programName], ['Project Name', order.projectName],
    ['Team Name', order.teamName], ['Faculty Guide', order.facultyGuide],
    ['Expected Return Date', pdfDate(order.expectedReturnDate)], ['Purpose', order.purpose],
  ]);
  if (order.teamMembers.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text('TEAM MEMBERS', 50, doc.y, { characterSpacing: 0.3 });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1a1a2e');
    order.teamMembers.forEach(m => doc.text(`-  ${m.name}${m.mobile ? `  (${m.mobile})` : ''}`, 50));
    doc.fillColor('#000');
    doc.moveDown(0.3);
  }

  pdfSectionTitle(doc, 'Components Issued');
  const colX = { name: 50, qty: 300, unit: 350, assets: 410 };
  const headY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#17355f');
  doc.text('Component', colX.name, headY, { width: 245 });
  doc.text('Qty', colX.qty, headY, { width: 45 });
  doc.text('Unit', colX.unit, headY, { width: 55 });
  doc.text('Assigned Unit(s)', colX.assets, headY, { width: 135 });
  doc.moveTo(50, doc.y + 13).lineTo(545, doc.y + 13).strokeColor('#dbe3f0').stroke();
  doc.moveDown(1.1);
  doc.fillColor('#000');

  order.items.forEach(item => {
    const rowY = doc.y;
    const assetText = item.assets?.length
      ? item.assets.map(a => a.assetTag).join(', ')
      : '-';
    // Why a unit is marked damaged (either the reason given at return time,
    // or a later correction) is surfaced here too -- an admin/student
    // reading the PDF later shouldn't have to dig through Inventory to
    // find out why a count changed.
    const correctionLines = (item.assets || [])
      .filter(a => a.correctionReason)
      .map(a => `${a.assetTag} – note${a.correctionBy ? ` by ${a.correctionBy}` : ''}: ${a.correctionReason}`);

    doc.font('Helvetica').fontSize(9);
    const nameHeight = doc.heightOfString(item.name, { width: 245 });
    doc.font('Helvetica').fontSize(7.5);
    const assetHeight = doc.heightOfString(assetText, { width: 135 });

    doc.font('Helvetica').fontSize(9).fillColor('#000');
    doc.text(item.name, colX.name, rowY, { width: 245 });
    doc.text(String(item.qty), colX.qty, rowY, { width: 45 });
    doc.text(item.unit || 'pcs', colX.unit, rowY, { width: 55 });
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text(assetText, colX.assets, rowY, { width: 135 });
    doc.fillColor('#000');

    let rowHeight = Math.max(nameHeight, assetHeight);
    if (correctionLines.length) {
      const noteY = rowY + rowHeight + 3;
      doc.font('Helvetica-Oblique').fontSize(7).fillColor('#92400e');
      correctionLines.forEach((line, i) => doc.text(line, colX.name, noteY + i * 10, { width: 495 }));
      doc.fillColor('#000');
      rowHeight += 3 + correctionLines.length * 10;
    }
    doc.y = rowY + rowHeight + 8;
  });

  const hasReturnActivity = order.returnSummary.some(item => item.returnedQty > 0 || item.damagedQty > 0);
  if (hasReturnActivity) {
    pdfSectionTitle(doc, 'Return Tracking');
    const rHeadY = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#17355f');
    doc.text('Component', 50, rHeadY, { width: 200 });
    doc.text('Ordered', 260, rHeadY, { width: 60 });
    doc.text('Returned', 330, rHeadY, { width: 60 });
    doc.text('Damaged', 400, rHeadY, { width: 60 });
    doc.text('Pending', 470, rHeadY, { width: 60 });
    doc.moveTo(50, doc.y + 13).lineTo(545, doc.y + 13).strokeColor('#dbe3f0').stroke();
    doc.moveDown(1.1);
    doc.fillColor('#000');
    order.returnSummary.forEach(item => {
      const rowY = doc.y;
      doc.font('Helvetica').fontSize(9);
      doc.text(item.name, 50, rowY, { width: 200 });
      doc.text(String(item.orderedQty), 260, rowY, { width: 60 });
      doc.text(String(item.returnedQty), 330, rowY, { width: 60 });
      doc.text(String(item.damagedQty), 400, rowY, { width: 60 });
      doc.text(String(item.pendingQty), 470, rowY, { width: 60 });
      doc.moveDown(1);
    });
  }

  pdfSectionTitle(doc, 'Status Timeline');
  pdfFieldGrid(doc, [
    ['Terms Accepted', pdfDateTime(order.termsAcceptedAt)], ['Reserved At', pdfDateTime(order.reservedAt)],
    ['Issued At', pdfDateTime(order.issuedAt)], ['Return Requested At', pdfDateTime(order.returnRequestedAt)],
    ['Returned At', pdfDateTime(order.returnedAt)], ['Admin Remarks', order.adminRemarks || '-'],
  ]);

  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(7.5).fillColor('#9ca3af')
    .text(`This is a system-generated record from ${getOrgShortName()} (${getOrgName()} Inventory Management System). Not a priced invoice -- no monetary value is assigned to issued components.`, 50, doc.y, { width: 495 });

  doc.end();
});

// Student requests a return after using the components
router.put('/:orderId/return-request', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT ir.*, s.user_id AS studentUserId FROM issue_records ir
      JOIN students s ON s.id = ir.student_id WHERE ir.order_id = ?
    `).get(req.params.orderId);
    if (!row) return res.status(404).json({ message: 'Order not found' });
    if (row.studentUserId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only update your own orders' });
    }
    if (row.status !== 'Approved') {
      return res.status(400).json({ message: 'Only approved orders can be marked for return' });
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE issue_records SET status = 'Return Requested', return_requested_at = ? WHERE id = ?")
      .run(now, row.id);

    const updatedRow = { ...row, status: 'Return Requested', return_requested_at: now };
    const returnOrder = buildOrderResponse(db, updatedRow);
    sendStatusUpdate(returnOrder, 'Return Requested', req.body?.remarks || '', row.center_id).catch(console.error);
    push.notifyAdminsReturnRequested(returnOrder, { excludeUserId: req.user.id });

    res.json({ message: 'Return request submitted. Please hand the components back to the lab/admin.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Error requesting return' });
  }
});

// PUT approve/reject/process returns (admin only)
// The units an admin may hand over for each line of a pending order: every
// available unit of that component in the order's center, plus the ones
// reserved for this order (listed first, since they are the natural pick).
router.get('/:orderId/issuable-units', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id, order_id, center_id, status FROM issue_records WHERE order_id = ?').get(req.params.orderId);
  if (!row) return res.status(404).json({ message: 'Order not found' });
  if (req.user.role !== 'super_admin' && row.center_id !== req.user.centerId) {
    return res.status(403).json({ message: 'You do not have access to this order' });
  }
  const items = loadItemsForRecord(db, row.id).map(item => {
    const units = db.prepare(`
      SELECT a.id, a.asset_tag AS assetTag, a.serial_number AS serialNumber, a.location, a.status,
             CASE WHEN ira.asset_id IS NULL THEN 0 ELSE 1 END AS reservedForThisOrder
      FROM assets a
      LEFT JOIN issue_record_assets ira ON ira.asset_id = a.id AND ira.issue_record_item_id = ?
      WHERE a.catalog_id = ? AND a.center_id = ?
        AND (a.status = 'available' OR (a.status = 'reserved' AND ira.asset_id IS NOT NULL))
      ORDER BY reservedForThisOrder DESC, a.asset_tag
    `).all(item.id, item.catalogId, row.center_id);
    return { catalogId: item.catalogId, name: item.name, qtyRequested: item.qtyRequested, units };
  });
  res.json({ orderId: row.order_id, status: row.status, items });
});

router.put('/:orderId/status', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  try {
    const { status, remarks } = req.body;
    if (!ADMIN_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const row = db.prepare(`
      SELECT ir.*, s.full_name AS studentName FROM issue_records ir
      JOIN students s ON s.id = ir.student_id WHERE ir.order_id = ?
    `).get(req.params.orderId);
    if (!row) return res.status(404).json({ message: 'Order not found' });

    const now = new Date().toISOString();
    let finalStatus = status;
    let rejectedItemsForEmail = [];

    db.exec('BEGIN TRANSACTION');
    try {
      if (status === 'Approved') {
        if (row.status !== 'Pending') throw Object.assign(new Error('Only pending orders can be approved'), { code: 'VALIDATION' });

        const items = loadItemsForRecord(db, row.id);
        const approvedMap = new Map((req.body.approvedItems || []).map(i => [String(i.id), Number(i.qty)]));
        let anyApproved = false;

        // Which physical units go out is decided HERE, by the admin who is
        // holding them -- either ticked from the list or scanned. The units
        // reserved when the order was placed only ever protected the stock
        // count; any of them not chosen now go back to available, and a
        // chosen unit that was merely available gets linked to the order.
        // Requests without assetIds (older clients) keep the old behaviour of
        // issuing the reserved units in order.
        const selectedMap = new Map((req.body.approvedItems || []).map(i => [String(i.id), Array.isArray(i.assetIds) ? i.assetIds.map(v => String(v || '').trim()).filter(Boolean) : null]));

        for (const item of items) {
          const requestedQty = item.qtyRequested;
          const approvedQty = approvedMap.has(String(item.catalogId)) ? approvedMap.get(String(item.catalogId)) : requestedQty;
          if (Number.isNaN(approvedQty) || approvedQty < 0 || approvedQty > requestedQty) {
            throw Object.assign(new Error(`Invalid quantity provided for ${item.name}.`), { code: 'VALIDATION' });
          }

          const reservedAssets = db.prepare(`
            SELECT ira.asset_id FROM issue_record_assets ira
            JOIN assets a ON a.id = ira.asset_id
            WHERE ira.issue_record_item_id = ? AND a.status = 'reserved'
          `).all(item.id).map(r => r.asset_id);

          const selected = selectedMap.get(String(item.catalogId));
          let toIssue;
          let toRelease;
          if (selected) {
            const unique = [...new Set(selected)];
            if (unique.length !== approvedQty) {
              throw Object.assign(new Error(`${item.name}: ${unique.length} unit(s) selected but issuing quantity is ${approvedQty}.`), { code: 'VALIDATION' });
            }
            for (const assetId of unique) {
              const unit = db.prepare('SELECT id, asset_tag, status, catalog_id, center_id FROM assets WHERE id = ?').get(assetId);
              if (!unit || unit.catalog_id !== item.catalogId || unit.center_id !== row.center_id) {
                throw Object.assign(new Error(`Selected unit is not a ${item.name} of this center.`), { code: 'VALIDATION' });
              }
              const reservedHere = reservedAssets.includes(unit.id);
              if (unit.status !== 'available' && !(unit.status === 'reserved' && reservedHere)) {
                throw Object.assign(new Error(`${unit.asset_tag} is ${unit.status.replace('_', ' ')} and cannot be issued.`), { code: 'VALIDATION' });
              }
              if (!reservedHere) {
                db.prepare('INSERT INTO issue_record_assets (issue_record_item_id, asset_id) VALUES (?, ?)').run(item.id, unit.id);
              }
            }
            toIssue = unique;
            toRelease = reservedAssets.filter(id => !unique.includes(id));
          } else {
            toIssue = reservedAssets.slice(0, approvedQty);
            toRelease = reservedAssets.slice(approvedQty);
          }

          for (const assetId of toIssue) {
            const from = db.prepare('SELECT status FROM assets WHERE id = ?').get(assetId)?.status || 'reserved';
            db.prepare("UPDATE assets SET status = 'issued' WHERE id = ?").run(assetId);
            db.prepare(`
              INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id,
                issue_record_id, notes, performed_by, occurred_at)
              VALUES (?, 'issued', ?, 'issued', ?, ?, ?, ?, ?)
            `).run(assetId, from, row.center_id, row.id, `Issued for order ${row.order_id}`, req.user.username, now);
          }
          for (const assetId of toRelease) {
            db.prepare("UPDATE assets SET status = 'available' WHERE id = ?").run(assetId);
            db.prepare('DELETE FROM issue_record_assets WHERE issue_record_item_id = ? AND asset_id = ?').run(item.id, assetId);
            db.prepare(`
              INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id,
                issue_record_id, notes, performed_by, occurred_at)
              VALUES (?, 'returned', 'reserved', 'available', ?, ?, ?, ?, ?)
            `).run(assetId, row.center_id, row.id, `Not issued -- released back to stock (order ${row.order_id})`, req.user.username, now);
          }

          db.prepare('UPDATE issue_record_items SET qty_approved = ? WHERE id = ?').run(approvedQty, item.id);
          if (approvedQty > 0) anyApproved = true;
          if (requestedQty - approvedQty > 0) {
            rejectedItemsForEmail.push({ id: String(item.catalogId), name: item.name, qty: requestedQty - approvedQty, unit: item.unit });
          }
        }

        finalStatus = anyApproved ? 'Approved' : 'Rejected';
        if (finalStatus === 'Approved') {
          db.prepare("UPDATE issue_records SET status = 'Approved', issued_at = ?, admin_remarks = ? WHERE id = ?")
            .run(now, remarks ?? row.admin_remarks, row.id);
        } else {
          db.prepare("UPDATE issue_records SET status = 'Rejected', admin_remarks = ? WHERE id = ?")
            .run(remarks ?? row.admin_remarks, row.id);
        }
      }

      if (status === 'Rejected') {
        if (row.status !== 'Pending') throw Object.assign(new Error('Only pending orders can be rejected'), { code: 'VALIDATION' });
        const reservedAssets = db.prepare(`
          SELECT a.id FROM assets a
          JOIN issue_record_assets ira ON ira.asset_id = a.id
          JOIN issue_record_items iri ON iri.id = ira.issue_record_item_id
          WHERE iri.issue_record_id = ? AND a.status = 'reserved'
        `).all(row.id);
        for (const asset of reservedAssets) {
          db.prepare("UPDATE assets SET status = 'available' WHERE id = ?").run(asset.id);
          db.prepare(`
            INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id,
              issue_record_id, notes, performed_by, occurred_at)
            VALUES (?, 'returned', 'reserved', 'available', ?, ?, ?, ?, ?)
          `).run(asset.id, row.center_id, row.id, `Order ${row.order_id} rejected -- released back to stock`, req.user.username, now);
        }
        db.prepare("UPDATE issue_records SET status = 'Rejected', admin_remarks = ? WHERE id = ?").run(remarks ?? row.admin_remarks, row.id);
        finalStatus = 'Rejected';
      }

      if (status === 'Returned') {
        if (!['Approved', 'Return Requested', 'Partially Returned'].includes(row.status)) {
          throw Object.assign(new Error('This order is not ready for return processing'), { code: 'VALIDATION' });
        }
        // Admin picks exactly which physical asset tags came back good vs
        // damaged (returnedAssetIds / damagedAssetIds), not just quantities
        // -- so the lifecycle record reflects reality instead of an
        // arbitrary "first N" guess.
        const returnItemsPayload = Array.isArray(req.body.returnItems) ? req.body.returnItems : [];
        if (!returnItemsPayload.length) {
          throw Object.assign(new Error('Select at least one returned or damaged unit'), { code: 'VALIDATION' });
        }
        const anyDamaged = returnItemsPayload.some(entry => Array.isArray(entry.damagedAssetIds) && entry.damagedAssetIds.length);
        const damageReason = String(req.body.damageReason || '').trim();
        if (anyDamaged && !damageReason) {
          throw Object.assign(new Error('A reason is required for any unit being returned damaged'), { code: 'VALIDATION' });
        }

        const items = loadItemsForRecord(db, row.id);
        const itemByCatalogId = new Map(items.map(i => [String(i.catalogId), i]));

        for (const entry of returnItemsPayload) {
          const item = itemByCatalogId.get(String(entry.id));
          if (!item) continue;
          const returnedAssetIds = Array.isArray(entry.returnedAssetIds) ? [...new Set(entry.returnedAssetIds)] : [];
          const damagedAssetIds = Array.isArray(entry.damagedAssetIds) ? [...new Set(entry.damagedAssetIds)] : [];
          if (!returnedAssetIds.length && !damagedAssetIds.length) continue;
          if (returnedAssetIds.some(id => damagedAssetIds.includes(id))) {
            throw Object.assign(new Error(`${item.name}: a unit can't be marked both good and damaged`), { code: 'VALIDATION' });
          }

          // Every asset named must actually be an 'issued' unit linked to
          // this line item -- structurally guarantees the selection can't
          // exceed the real pending balance, no separate qty check needed.
          const issuedAssetIds = new Set(db.prepare(`
            SELECT ira.asset_id FROM issue_record_assets ira
            JOIN assets a ON a.id = ira.asset_id
            WHERE ira.issue_record_item_id = ? AND a.status = 'issued'
          `).all(item.id).map(r => r.asset_id));
          for (const assetId of [...returnedAssetIds, ...damagedAssetIds]) {
            if (!issuedAssetIds.has(assetId)) {
              throw Object.assign(new Error(`${item.name}: one of the selected units is not currently issued on this order`), { code: 'VALIDATION' });
            }
          }

          for (const assetId of returnedAssetIds) {
            db.prepare("UPDATE assets SET status = 'available' WHERE id = ?").run(assetId);
            db.prepare('UPDATE issue_record_assets SET condition_on_return = ? WHERE issue_record_item_id = ? AND asset_id = ?')
              .run('good', item.id, assetId);
            db.prepare(`
              INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id,
                issue_record_id, notes, performed_by, occurred_at)
              VALUES (?, 'returned', 'issued', 'available', ?, ?, ?, ?, ?)
            `).run(assetId, row.center_id, row.id, `Returned in good condition (order ${row.order_id})`, req.user.username, now);
          }
          for (const assetId of damagedAssetIds) {
            db.prepare("UPDATE assets SET status = 'damaged' WHERE id = ?").run(assetId);
            db.prepare('UPDATE issue_record_assets SET condition_on_return = ? WHERE issue_record_item_id = ? AND asset_id = ?')
              .run('damaged', item.id, assetId);
            db.prepare(`
              INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id,
                issue_record_id, project_id, notes, performed_by, occurred_at)
              VALUES (?, 'damaged', 'issued', 'damaged', ?, ?, ?, ?, ?, ?)
            `).run(assetId, row.center_id, row.id, row.project_id, `Returned damaged (order ${row.order_id}) -- ${damageReason}`, req.user.username, now);
          }

          const returnedQty = returnedAssetIds.length;
          const damagedQty = damagedAssetIds.length;
          const { returnedQty: alreadyReturned, damagedQty: alreadyDamaged } = loadReturnSummaryForItem(db, item.id);
          const orderedQty = item.qtyApproved ?? item.qtyRequested;
          const alreadyPending = orderedQty - alreadyReturned - alreadyDamaged;

          db.prepare(`
            INSERT INTO order_return_items (issue_record_item_id, returned_qty, damaged_qty, pending_qty, recorded_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(item.id, returnedQty, damagedQty, Math.max(0, alreadyPending - returnedQty - damagedQty), now);
        }

        const refreshedItems = loadItemsForRecord(db, row.id);
        const stillPending = refreshedItems.some(i => {
          const { returnedQty, damagedQty } = loadReturnSummaryForItem(db, i.id);
          const orderedQty = i.qtyApproved ?? i.qtyRequested;
          return orderedQty - returnedQty - damagedQty > 0;
        });
        const anyProcessed = refreshedItems.some(i => {
          const { returnedQty, damagedQty } = loadReturnSummaryForItem(db, i.id);
          return returnedQty > 0 || damagedQty > 0;
        });
        finalStatus = stillPending ? (anyProcessed ? 'Partially Returned' : row.status) : 'Returned';

        db.prepare(`
          UPDATE issue_records SET status = ?, admin_remarks = ?, last_return_at = ?,
            return_requested_at = COALESCE(return_requested_at, ?), returned_at = ?
          WHERE id = ?
        `).run(finalStatus, remarks ?? row.admin_remarks, now,
               now, finalStatus === 'Returned' ? now : null, row.id);
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      if (err.code === 'VALIDATION') return res.status(400).json({ message: err.message });
      throw err;
    }

    const refreshedRow = loadOrderRows(db, null).find(r => r.order_id === row.order_id) || row;
    const orderForNotification = { ...buildOrderResponse(db, refreshedRow), rejectedItems: rejectedItemsForEmail };
    sendStatusUpdate(orderForNotification, finalStatus, remarks, row.center_id).catch(console.error);
    push.notifyStudentOrderStatus(orderForNotification, finalStatus);

    res.json({ message: `Order ${finalStatus}`, status: finalStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Error updating order status' });
  }
});

// If the system-assigned unit for a line item can't be physically found,
// swap in a different available unit of the same component. :catalogId
// matches the "id" already exposed per item in the order response (the
// real issue_record_items.id is internal and never sent to the frontend).
router.put('/:orderId/items/:catalogId/swap-asset', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const { oldAssetId, newAssetId, reason } = req.body || {};
  if (!oldAssetId || !newAssetId) return res.status(400).json({ message: 'oldAssetId and newAssetId are required' });

  const order = db.prepare('SELECT * FROM issue_records WHERE order_id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  if (req.user.role !== 'super_admin' && order.center_id !== req.user.centerId) {
    return res.status(403).json({ message: 'You cannot access an order from another center' });
  }

  const item = db.prepare('SELECT id FROM issue_record_items WHERE issue_record_id = ? AND catalog_id = ?')
    .get(order.id, req.params.catalogId);
  if (!item) return res.status(404).json({ message: 'Line item not found on this order' });

  const link = db.prepare('SELECT id FROM issue_record_assets WHERE issue_record_item_id = ? AND asset_id = ?').get(item.id, oldAssetId);
  if (!link) return res.status(400).json({ message: 'That unit is not assigned to this line item' });

  db.exec('BEGIN TRANSACTION');
  try {
    swapAsset(db, { oldAssetId, newAssetId, centerId: order.center_id, performedBy: req.user.username, reason });
    db.prepare('UPDATE issue_record_assets SET asset_id = ? WHERE id = ?').run(newAssetId, link.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: 'Unit swapped', orderId: order.order_id });
});

module.exports = router;
module.exports.getOrdersForCenter = getOrdersForCenter;
module.exports.markReminderSent = markReminderSent;
