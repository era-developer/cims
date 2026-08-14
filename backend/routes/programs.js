const express = require('express');
const ExcelJS = require('exceljs');
const { getDb } = require('../utils/db');
const { authMiddleware, adminOnly, superAdminOnly } = require('../middleware/auth');
const { requireCenter } = require('../utils/centers');
const { getTransfersForCenter } = require('./transfers');
const { getOrdersForCenter } = require('./orders');

const router = express.Router();

const VALID_STATUSES = ['planning', 'ongoing', 'completed'];

function getRequestedCenterId(req) {
  if (req.user.role === 'super_admin') {
    return String(req.query.centerId || req.body.centerId || '').trim();
  }
  return req.user.centerId;
}

function canAccessProgram(req, program) {
  return req.user.role === 'super_admin' || program.center_id === req.user.centerId;
}

// Open to any authenticated role (not just admins) -- students need this
// same list at checkout to pick their program, matched exactly to what
// admins report against instead of typing a free-text project name.
router.get('/', authMiddleware, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  if (!centerId) return res.json([]);
  const rows = db.prepare(`
    SELECT * FROM projects WHERE center_id = ? ORDER BY name
  `).all(centerId);
  res.json(rows);
});

router.get('/:id', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const program = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!program) return res.status(404).json({ message: 'Program not found' });
  if (!canAccessProgram(req, program)) {
    return res.status(403).json({ message: 'You cannot access a program from another center' });
  }
  res.json(program);
});

router.post('/', authMiddleware, superAdminOnly, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  let center;
  try {
    center = requireCenter(centerId);
  } catch {
    return res.status(400).json({ message: 'A valid center is required' });
  }

  const { name, handledBy, startDate, expectedEndDate, instituteName, notes, status } = req.body || {};
  const trimmedName = String(name || '').trim();
  const trimmedHandledBy = String(handledBy || '').trim();
  if (!trimmedName || !trimmedHandledBy) {
    return res.status(400).json({ message: 'Program name and who is handling it are required' });
  }
  const resolvedStatus = VALID_STATUSES.includes(status) ? status : 'planning';

  const existing = db.prepare('SELECT id FROM projects WHERE center_id = ? AND name = ?').get(center.id, trimmedName);
  if (existing) {
    return res.status(409).json({ message: `A program named "${trimmedName}" already exists for ${center.name}` });
  }

  const id = db.prepare(`
    INSERT INTO projects (name, center_id, handled_by, start_date, expected_end_date, institute_name, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(trimmedName, center.id, trimmedHandledBy, startDate || null, expectedEndDate || null,
         instituteName || null, notes || null, resolvedStatus).lastInsertRowid;

  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
});

router.put('/:id', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ message: 'Program not found' });

  if (!canAccessProgram(req, existing)) {
    return res.status(403).json({ message: 'You cannot edit a program from another center' });
  }

  const { name, handledBy, startDate, expectedEndDate, instituteName, notes, completionDate, status } = req.body || {};
  const trimmedName = String(name || '').trim();
  const trimmedHandledBy = String(handledBy || '').trim();
  if (!trimmedName || !trimmedHandledBy) {
    return res.status(400).json({ message: 'Program name and who is handling it are required' });
  }
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ message: 'Status must be planning, ongoing, or completed' });
  }
  const resolvedStatus = status !== undefined ? status : existing.status;

  const duplicate = db.prepare('SELECT id FROM projects WHERE center_id = ? AND name = ? AND id != ?')
    .get(existing.center_id, trimmedName, existing.id);
  if (duplicate) {
    return res.status(409).json({ message: `A program named "${trimmedName}" already exists for this center` });
  }

  db.prepare(`
    UPDATE projects SET name = ?, handled_by = ?, start_date = ?, expected_end_date = ?,
      institute_name = ?, notes = ?, completion_date = ?, status = ?
    WHERE id = ?
  `).run(trimmedName, trimmedHandledBy, startDate || null, expectedEndDate || null,
         instituteName || null, notes || null, completionDate || null, resolvedStatus, existing.id);

  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(existing.id));
});

// Everything that has happened under a program: procurement (invoices),
// damaged units (with each affected asset's full lifecycle), student
// issue/return activity, and center-to-center transfer requests. Student
// orders and transfers are still tracked in the legacy per-center Excel
// workbooks (not yet migrated to SQLite), so they're matched by program
// name rather than a foreign key.
async function buildProgramReport(db, program) {
  const invoices = db.prepare(`
    SELECT i.*, v.name AS vendor_name
    FROM invoices i
    LEFT JOIN vendors v ON v.id = i.vendor_id
    WHERE i.project_id = ?
    ORDER BY i.invoice_date
  `).all(program.id);

  const lineItemsByInvoice = new Map();
  if (invoices.length) {
    const placeholders = invoices.map(() => '?').join(',');
    const lineItems = db.prepare(`
      SELECT li.*, c.name AS classification_name
      FROM invoice_line_items li
      JOIN classifications c ON c.id = li.classification_id
      WHERE li.invoice_id IN (${placeholders})
    `).all(...invoices.map(inv => inv.id));
    for (const li of lineItems) {
      if (!lineItemsByInvoice.has(li.invoice_id)) lineItemsByInvoice.set(li.invoice_id, []);
      lineItemsByInvoice.get(li.invoice_id).push(li);
    }
  }
  const invoicesWithItems = invoices.map(inv => ({ ...inv, lineItems: lineItemsByInvoice.get(inv.id) || [] }));
  const invoicedValue = invoices.reduce((sum, inv) => sum + (Number(inv.total_bill_value) || 0), 0);

  const damageEvents = db.prepare(`
    SELECT e.*, a.asset_tag, a.name AS asset_name, a.unit_value, a.serial_number, a.location
    FROM asset_lifecycle_events e
    JOIN assets a ON a.id = e.asset_id
    WHERE e.project_id = ? AND e.event_type = 'damaged'
    ORDER BY e.occurred_at DESC
  `).all(program.id);
  const damagedValue = damageEvents.reduce((sum, ev) => sum + (Number(ev.unit_value) || 0), 0);

  const assetIds = [...new Set(damageEvents.map(ev => ev.asset_id))];
  const lifecycleByAsset = new Map();
  for (const assetId of assetIds) {
    lifecycleByAsset.set(assetId, db.prepare(`
      SELECT event_type, from_status, to_status, notes, performed_by, occurred_at
      FROM asset_lifecycle_events WHERE asset_id = ? ORDER BY occurred_at
    `).all(assetId));
  }
  const damagedAssets = damageEvents.map(ev => ({
    assetId: ev.asset_id,
    assetTag: ev.asset_tag,
    name: ev.asset_name,
    unitValue: ev.unit_value,
    serialNumber: ev.serial_number,
    location: ev.location,
    occurredAt: ev.occurred_at,
    notes: ev.notes,
    performedBy: ev.performed_by,
    lifecycle: lifecycleByAsset.get(ev.asset_id) || [],
  }));

  const programNameKey = program.name.trim().toLowerCase();

  const centerOrders = getOrdersForCenter(program.center_id);
  const studentOrders = centerOrders
    .filter(order => order.programId === program.id)
    .map(order => ({
      orderId: order.orderId,
      createdAt: order.createdAt,
      status: order.status,
      studentName: order.studentName,
      mobile: order.mobile,
      studentEmail: order.studentEmail,
      college: order.college,
      department: order.department,
      courseName: order.courseName,
      teamName: order.teamName,
      teamMembers: order.teamMembers,
      facultyGuide: order.facultyGuide,
      purpose: order.purpose,
      projectName: order.projectName,
      items: order.items,
      returnSummary: order.returnSummary,
    }))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  // Transfer requests only live in the requesting center's own workbook, so
  // scoping to the program's center already captures every request it made.
  const centerTransfers = getTransfersForCenter(program.center_id);
  const transfers = centerTransfers
    .filter(t => String(t.programName || '').trim().toLowerCase() === programNameKey)
    .map(t => ({
      id: t.id,
      status: t.status,
      requestDate: t.requestDate,
      supplyCenterName: t.supplyCenterName,
      responsiblePerson: t.responsiblePerson,
      purpose: t.purpose,
      components: t.components,
    }));

  const internalIssueRows = db.prepare(`
    SELECT id, issue_code, taken_by, reason, status, issued_by, issued_at, returned_at, student_count, team_count, institute_name
    FROM internal_issues WHERE project_id = ? ORDER BY issued_at DESC
  `).all(program.id);
  const internalIssues = internalIssueRows.map(row => {
    const items = db.prepare('SELECT id, name, qty, unit FROM internal_issue_items WHERE internal_issue_id = ?').all(row.id);
    const itemsWithReturns = items.map(item => {
      const returns = db.prepare(`
        SELECT COALESCE(SUM(returned_good_qty), 0) AS returnedGoodQty, COALESCE(SUM(returned_damaged_qty), 0) AS returnedDamagedQty
        FROM internal_issue_return_items WHERE internal_issue_item_id = ?
      `).get(item.id);
      // Per-asset lifecycle detail was previously only visible for
      // regular-order damage events, never for internal use -- so a
      // program's "what happened to my components" view was incomplete.
      const assets = db.prepare(`
        SELECT a.id, a.asset_tag AS assetTag, a.serial_number AS serialNumber, a.status
        FROM internal_issue_assets iia JOIN assets a ON a.id = iia.asset_id
        WHERE iia.internal_issue_item_id = ? ORDER BY a.asset_tag
      `).all(item.id);
      return { ...item, ...returns, assets };
    });
    return {
      id: row.id, issueCode: row.issue_code, takenBy: row.taken_by, reason: row.reason, status: row.status,
      studentCount: row.student_count, teamCount: row.team_count, instituteName: row.institute_name,
      issuedBy: row.issued_by, issuedAt: row.issued_at, returnedAt: row.returned_at, items: itemsWithReturns,
    };
  });

  const procurementRows = db.prepare(`
    SELECT id, requested_by, status, admin_remarks, created_at, approved_at, order_placed_at, in_transit_at, received_at, student_count, team_count, institute_name
    FROM procurement_requests WHERE project_id = ? ORDER BY created_at DESC
  `).all(program.id);
  const procurementRequests = procurementRows.map(row => ({
    id: row.id, requestedBy: row.requested_by, status: row.status, adminRemarks: row.admin_remarks,
    studentCount: row.student_count, teamCount: row.team_count, instituteName: row.institute_name,
    createdAt: row.created_at, approvedAt: row.approved_at, orderPlacedAt: row.order_placed_at,
    inTransitAt: row.in_transit_at, receivedAt: row.received_at,
    items: db.prepare(`
      SELECT component_name AS componentName, qty_requested AS qtyRequested, qty_approved AS qtyApproved, reason
      FROM procurement_request_items WHERE procurement_request_id = ?
    `).all(row.id),
  }));

  return {
    program,
    invoices: invoicesWithItems,
    damagedAssets,
    studentOrders,
    transfers,
    internalIssues,
    procurementRequests,
    totals: {
      invoicedValue,
      invoiceCount: invoices.length,
      damagedCount: damageEvents.length,
      damagedValue,
      studentOrderCount: studentOrders.length,
      transferCount: transfers.length,
      internalIssueCount: internalIssues.length,
      procurementRequestCount: procurementRequests.length,
    },
  };
}

router.get('/:id/report', authMiddleware, adminOnly, async (req, res) => {
  const db = getDb();
  const program = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!program) return res.status(404).json({ message: 'Program not found' });
  if (!canAccessProgram(req, program)) {
    return res.status(403).json({ message: 'You cannot access a program from another center' });
  }
  try {
    res.json(await buildProgramReport(db, program));
  } catch (err) {
    res.status(500).json({ message: 'Unable to build the program report right now.' });
  }
});

router.get('/:id/report.xlsx', authMiddleware, adminOnly, async (req, res) => {
  const db = getDb();
  const program = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!program) return res.status(404).json({ message: 'Program not found' });
  if (!canAccessProgram(req, program)) {
    return res.status(403).json({ message: 'You cannot access a program from another center' });
  }

  let report;
  try {
    report = await buildProgramReport(db, program);
  } catch (err) {
    return res.status(500).json({ message: 'Unable to build the program report right now.' });
  }

  const workbook = new ExcelJS.Workbook();

  const summary = workbook.addWorksheet('Summary');
  summary.columns = [{ header: 'Field', key: 'field', width: 28 }, { header: 'Value', key: 'value', width: 50 }];
  summary.addRows([
    { field: 'Program name', value: program.name },
    { field: 'Status', value: program.status },
    { field: 'Handled by', value: program.handled_by || '' },
    { field: 'Institute', value: program.institute_name || '' },
    { field: 'Start date', value: program.start_date || '' },
    { field: 'Expected end date', value: program.expected_end_date || '' },
    { field: 'Completion date', value: program.completion_date || '' },
    { field: 'Notes', value: program.notes || '' },
    { field: 'Total invoiced value', value: report.totals.invoicedValue },
    { field: 'Damaged unit count', value: report.totals.damagedCount },
    { field: 'Damaged unit value', value: report.totals.damagedValue },
    { field: 'Student orders under this program', value: report.totals.studentOrderCount },
    { field: 'Transfer requests under this program', value: report.totals.transferCount },
    { field: 'Internal component issues under this program', value: report.totals.internalIssueCount },
    { field: 'Component requests under this program', value: report.totals.procurementRequestCount },
  ]);
  summary.getRow(1).font = { bold: true };

  const invoiceSheet = workbook.addWorksheet('Invoices');
  invoiceSheet.columns = [
    { header: 'Invoice #', key: 'invoice_number', width: 20 },
    { header: 'Date', key: 'invoice_date', width: 14 },
    { header: 'Vendor', key: 'vendor_name', width: 24 },
    { header: 'Taxable value', key: 'taxable_value', width: 16 },
    { header: 'GST', key: 'gst_value', width: 14 },
    { header: 'Total bill value', key: 'total_bill_value', width: 16 },
  ];
  invoiceSheet.addRows(report.invoices);
  invoiceSheet.getRow(1).font = { bold: true };

  const lineItemSheet = workbook.addWorksheet('Invoice Line Items');
  lineItemSheet.columns = [
    { header: 'Invoice #', key: 'invoice_number', width: 20 },
    { header: 'Component', key: 'asset_name', width: 26 },
    { header: 'Classification', key: 'classification_name', width: 20 },
    { header: 'Qty', key: 'bill_quantity', width: 10 },
    { header: 'Unit price', key: 'unit_price', width: 14 },
    { header: 'Total value', key: 'total_value', width: 14 },
  ];
  for (const inv of report.invoices) {
    for (const li of inv.lineItems) {
      lineItemSheet.addRow({ invoice_number: inv.invoice_number, ...li });
    }
  }
  lineItemSheet.getRow(1).font = { bold: true };

  const damagedSheet = workbook.addWorksheet('Damaged Components');
  damagedSheet.columns = [
    { header: 'Asset Tag', key: 'assetTag', width: 20 },
    { header: 'Component', key: 'name', width: 26 },
    { header: 'Serial #', key: 'serialNumber', width: 18 },
    { header: 'Location', key: 'location', width: 16 },
    { header: 'Unit value', key: 'unitValue', width: 14 },
    { header: 'Damaged on', key: 'occurredAt', width: 20 },
    { header: 'Recorded by', key: 'performedBy', width: 18 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  damagedSheet.addRows(report.damagedAssets);
  damagedSheet.getRow(1).font = { bold: true };

  const lifecycleSheet = workbook.addWorksheet('Component Lifecycle');
  lifecycleSheet.columns = [
    { header: 'Asset Tag', key: 'assetTag', width: 20 },
    { header: 'Event', key: 'event_type', width: 16 },
    { header: 'From status', key: 'from_status', width: 14 },
    { header: 'To status', key: 'to_status', width: 14 },
    { header: 'When', key: 'occurred_at', width: 20 },
    { header: 'Performed by', key: 'performed_by', width: 18 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  for (const asset of report.damagedAssets) {
    for (const event of asset.lifecycle) {
      lifecycleSheet.addRow({ assetTag: asset.assetTag, ...event });
    }
  }
  lifecycleSheet.getRow(1).font = { bold: true };

  const ordersSheet = workbook.addWorksheet('Student Orders');
  ordersSheet.columns = [
    { header: 'Order ID', key: 'orderId', width: 20 },
    { header: 'Date', key: 'createdAt', width: 20 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Student', key: 'studentName', width: 22 },
    { header: 'Mobile', key: 'mobile', width: 14 },
    { header: 'Email', key: 'studentEmail', width: 26 },
    { header: 'College', key: 'college', width: 26 },
    { header: 'Department', key: 'department', width: 18 },
    { header: 'Team', key: 'teamName', width: 18 },
    { header: 'Team Members', key: 'teamMembersSummary', width: 34 },
    { header: 'Faculty guide', key: 'facultyGuide', width: 18 },
    { header: 'Project (student-entered)', key: 'projectName', width: 24 },
    { header: 'Items (name x qty)', key: 'itemsSummary', width: 45 },
    { header: 'Damaged qty (any item)', key: 'damagedSummary', width: 30 },
  ];
  for (const order of report.studentOrders) {
    ordersSheet.addRow({
      ...order,
      teamMembersSummary: (order.teamMembers || []).map(m => `${m.name}${m.mobile ? ` (${m.mobile})` : ''}`).join(', '),
      itemsSummary: (order.items || []).map(i => `${i.name} x${i.qty}`).join(', '),
      damagedSummary: (order.returnSummary || [])
        .filter(i => Number(i.damagedQty) > 0)
        .map(i => `${i.name} x${i.damagedQty}`)
        .join(', '),
    });
  }
  ordersSheet.getRow(1).font = { bold: true };

  const transferSheet = workbook.addWorksheet('Transfers');
  transferSheet.columns = [
    { header: 'Transfer ID', key: 'id', width: 24 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Requested on', key: 'requestDate', width: 20 },
    { header: 'Supply center', key: 'supplyCenterName', width: 22 },
    { header: 'Responsible person', key: 'responsiblePerson', width: 22 },
    { header: 'Purpose', key: 'purpose', width: 30 },
    { header: 'Components', key: 'components', width: 40 },
  ];
  transferSheet.addRows(report.transfers);
  transferSheet.getRow(1).font = { bold: true };

  const internalSheet = workbook.addWorksheet('Internal Issues');
  internalSheet.columns = [
    { header: 'Issue Code', key: 'issueCode', width: 20 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Taken By', key: 'takenBy', width: 20 },
    { header: 'Reason', key: 'reason', width: 30 },
    { header: 'Students', key: 'studentCount', width: 12 },
    { header: 'Teams', key: 'teamCount', width: 10 },
    { header: 'Institute', key: 'instituteName', width: 24 },
    { header: 'Issued By', key: 'issuedBy', width: 16 },
    { header: 'Issued At', key: 'issuedAt', width: 20 },
    { header: 'Returned At', key: 'returnedAt', width: 20 },
    { header: 'Items (name x qty)', key: 'itemsSummary', width: 40 },
    { header: 'Returned Good', key: 'returnedGoodSummary', width: 25 },
    { header: 'Returned Damaged', key: 'returnedDamagedSummary', width: 25 },
  ];
  for (const issue of report.internalIssues) {
    internalSheet.addRow({
      ...issue,
      itemsSummary: issue.items.map(i => `${i.name} x${i.qty}`).join(', '),
      returnedGoodSummary: issue.items.filter(i => i.returnedGoodQty > 0).map(i => `${i.name} x${i.returnedGoodQty}`).join(', '),
      returnedDamagedSummary: issue.items.filter(i => i.returnedDamagedQty > 0).map(i => `${i.name} x${i.returnedDamagedQty}`).join(', '),
    });
  }
  internalSheet.getRow(1).font = { bold: true };

  const procurementSheet = workbook.addWorksheet('Procurement Requests');
  procurementSheet.columns = [
    { header: 'Request ID', key: 'id', width: 12 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Requested By', key: 'requestedBy', width: 20 },
    { header: 'Students', key: 'studentCount', width: 12 },
    { header: 'Teams', key: 'teamCount', width: 10 },
    { header: 'Institute', key: 'instituteName', width: 24 },
    { header: 'Items Requested (name x qty)', key: 'itemsSummary', width: 40 },
    { header: 'Items Approved (name x qty)', key: 'approvedSummary', width: 40 },
    { header: 'Reasons', key: 'reasonsSummary', width: 30 },
    { header: 'Remarks', key: 'adminRemarks', width: 26 },
    { header: 'Requested On', key: 'createdAt', width: 20 },
    { header: 'Received On', key: 'receivedAt', width: 20 },
  ];
  for (const request of report.procurementRequests) {
    procurementSheet.addRow({
      ...request,
      itemsSummary: request.items.map(i => `${i.componentName} x${i.qtyRequested}`).join(', '),
      approvedSummary: request.items.filter(i => i.qtyApproved != null).map(i => `${i.componentName} x${i.qtyApproved}`).join(', '),
      reasonsSummary: request.items.filter(i => i.reason).map(i => `${i.componentName}: ${i.reason}`).join('; '),
    });
  }
  procurementSheet.getRow(1).font = { bold: true };

  const safeName = program.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="program-${safeName}-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
