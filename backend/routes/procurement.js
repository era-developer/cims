// A center asking the super admin to procure new components -- distinct
// from Transfers, which moves existing stock between centers. Status is
// Requested -> Approved/Rejected -> Order Placed -> In Transit -> Received.
// "Received" is tracking only; real stock still comes in through Invoice
// Entry, which already handles vendor/GST/business-head correctly.
const express = require('express');
const { getDb } = require('../utils/db');
const { authMiddleware, adminOnly, superAdminOnly } = require('../middleware/auth');
const { requireCenter } = require('../utils/centers');
const { sendProcurementNotification, getAdminRecipient } = require('../utils/email');

const router = express.Router();

const ADMIN_RECIPIENTS = [process.env.ADMIN_EMAIL].filter(Boolean);
const STATUS_TIMESTAMP_COLUMN = {
  Approved: 'approved_at', 'Order Placed': 'order_placed_at', 'In Transit': 'in_transit_at', Received: 'received_at',
};

function getScopedCenterId(req) {
  if (req.user.role === 'super_admin') {
    return String(req.query.centerId || req.body.centerId || '').trim();
  }
  return req.user.centerId;
}

// Matches the same get-or-create pattern used for a student order's Program
// (routes/orders.js) -- picking "Other" and typing a name creates a real,
// reusable Program rather than leaving the request unlinked.
function getOrCreateProject(db, centerId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = db.prepare('SELECT id FROM projects WHERE center_id = ? AND name = ?').get(centerId, trimmed);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO projects (name, center_id) VALUES (?, ?)').run(trimmed, centerId).lastInsertRowid;
}

function loadRequestDetail(db, id) {
  const row = db.prepare('SELECT * FROM procurement_requests WHERE id = ?').get(id);
  if (!row) return null;
  const center = requireCenter(row.center_id);
  const program = row.project_id ? db.prepare('SELECT name FROM projects WHERE id = ?').get(row.project_id) : null;
  const rawItems = db.prepare(`
    SELECT id, component_name AS componentName, qty_requested AS qtyRequested, qty_approved AS qtyApproved, reason
    FROM procurement_request_items WHERE procurement_request_id = ?
  `).all(id);
  // Best-effort match against the requesting center's own catalog by name --
  // lets the super admin see whether this is really a shortage or the
  // center already has stock, before approving. No match (null) means this
  // is a genuinely new component, not in the catalog at all yet.
  const items = rawItems.map(item => {
    const catalogRow = db.prepare(`
      SELECT pc.id FROM product_catalog pc WHERE pc.center_id = ? AND LOWER(pc.name) = LOWER(?)
    `).get(row.center_id, item.componentName);
    const currentStock = catalogRow
      ? db.prepare("SELECT COUNT(*) c FROM assets WHERE catalog_id = ? AND status = 'available'").get(catalogRow.id).c
      : null;
    return { ...item, currentStock };
  });
  return {
    id: row.id, centerId: row.center_id, centerName: center.name, requestedBy: row.requested_by,
    projectId: row.project_id, programName: program?.name || '',
    studentCount: row.student_count, teamCount: row.team_count, instituteName: row.institute_name,
    status: row.status, adminRemarks: row.admin_remarks, createdAt: row.created_at,
    approvedAt: row.approved_at, orderPlacedAt: row.order_placed_at, inTransitAt: row.in_transit_at,
    receivedAt: row.received_at, items,
  };
}

router.post('/', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getScopedCenterId(req);
  let center;
  try {
    center = requireCenter(centerId);
  } catch {
    return res.status(400).json({ message: 'A valid center is required' });
  }

  const items = Array.isArray(req.body?.items) ? req.body.items.filter(i => String(i.name || '').trim() && Number(i.qty) > 0) : [];
  if (!items.length) return res.status(400).json({ message: 'Add at least one component with a name and quantity' });

  const { projectId, otherProgramName, studentCount, teamCount, instituteName } = req.body || {};
  const normalizedStudentCount = studentCount !== undefined && studentCount !== '' ? Number(studentCount) : null;
  const normalizedTeamCount = teamCount !== undefined && teamCount !== '' ? Number(teamCount) : null;
  const trimmedInstituteName = String(instituteName || '').trim() || null;
  let resolvedProjectId = null;
  if (otherProgramName && String(otherProgramName).trim()) {
    resolvedProjectId = getOrCreateProject(db, center.id, otherProgramName);
  } else if (projectId) {
    const program = db.prepare('SELECT id FROM projects WHERE id = ? AND center_id = ?').get(projectId, center.id);
    if (!program) return res.status(400).json({ message: 'Program not found for this center' });
    resolvedProjectId = program.id;
  }
  if (!resolvedProjectId) return res.status(400).json({ message: 'Select which program this request is for' });

  db.exec('BEGIN TRANSACTION');
  try {
    const requestId = db.prepare(`
      INSERT INTO procurement_requests (center_id, requested_by, project_id, status, student_count, team_count, institute_name)
      VALUES (?, ?, ?, 'Requested', ?, ?, ?)
    `).run(center.id, req.user.username, resolvedProjectId, normalizedStudentCount, normalizedTeamCount, trimmedInstituteName).lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO procurement_request_items (procurement_request_id, component_name, qty_requested, reason) VALUES (?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(requestId, String(item.name).trim(), Number(item.qty), String(item.reason || '').trim() || null);
    }

    db.exec('COMMIT');
    const detail = loadRequestDetail(db, requestId);
    sendProcurementNotification({ request: detail, type: 'request', recipients: ADMIN_RECIPIENTS }).catch(() => {});
    res.status(201).json(detail);
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ message: err.message });
  }
});

router.get('/', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = req.user.role === 'super_admin' ? String(req.query.centerId || '').trim() : req.user.centerId;
  const ids = centerId
    ? db.prepare('SELECT id FROM procurement_requests WHERE center_id = ? ORDER BY created_at DESC').all(centerId).map(r => r.id)
    : db.prepare('SELECT id FROM procurement_requests ORDER BY created_at DESC').all().map(r => r.id);
  res.json(ids.map(id => loadRequestDetail(db, id)));
});

router.get('/:id', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const detail = loadRequestDetail(db, req.params.id);
  if (!detail) return res.status(404).json({ message: 'Request not found' });
  if (req.user.role !== 'super_admin' && detail.centerId !== req.user.centerId) {
    return res.status(403).json({ message: 'You cannot access a request from another center' });
  }
  res.json(detail);
});

router.put('/:id/status', authMiddleware, superAdminOnly, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM procurement_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ message: 'Request not found' });

  const { status, adminRemarks, items } = req.body || {};
  const validStatuses = ['Requested', 'Approved', 'Rejected', 'Order Placed', 'In Transit', 'Received'];
  if (!validStatuses.includes(status)) return res.status(400).json({ message: 'Invalid status' });

  db.exec('BEGIN TRANSACTION');
  try {
    // Quantities are only adjustable at the moment of approval -- same rule
    // Transfers already uses ("approve once, lock it in"). Any item not
    // given an explicit override is approved exactly as requested.
    if (status === 'Approved') {
      const existingItems = db.prepare('SELECT id, qty_requested FROM procurement_request_items WHERE procurement_request_id = ?').all(row.id);
      const overrides = new Map((Array.isArray(items) ? items : []).map(i => [Number(i.itemId), i.qtyApproved]));
      const updateQty = db.prepare('UPDATE procurement_request_items SET qty_approved = ? WHERE id = ?');
      for (const item of existingItems) {
        const override = overrides.get(item.id);
        const qty = override !== undefined && override !== null && override !== '' ? Number(override) : item.qty_requested;
        if (!Number.isFinite(qty) || qty < 0) throw new Error('Approved quantity must be a valid non-negative number');
        updateQty.run(qty, item.id);
      }
    }

    const timestampColumn = STATUS_TIMESTAMP_COLUMN[status];
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE procurement_requests SET status = ?, admin_remarks = ?${timestampColumn ? `, ${timestampColumn} = ?` : ''} WHERE id = ?
    `).run(...(timestampColumn ? [status, adminRemarks ?? row.admin_remarks, now, row.id] : [status, adminRemarks ?? row.admin_remarks, row.id]));

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ message: err.message });
  }

  const detail = loadRequestDetail(db, row.id);
  const centerRecipient = getAdminRecipient(row.center_id);
  if (centerRecipient) {
    sendProcurementNotification({ request: detail, type: 'status-update', recipients: [centerRecipient] }).catch(() => {});
  }
  res.json(detail);
});

module.exports = router;
