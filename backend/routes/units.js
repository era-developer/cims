const express = require('express');
const { getDb } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// What a scanned QR label resolves to, for whoever scanned it.
//
// Labels encode a link to the portal with the unit's tag, so a student's
// phone camera lands here just as an admin's does. The same endpoint serves
// both, shaped by role:
//
//   student  - the component (photo, description, how many are free), this
//              unit's status, whether it is issued to *them*, and their own
//              past orders that included it. Never other students' names.
//   admin    - all of the above plus the current holder, the full lifecycle
//              history, every order the unit has been on, and the status
//              changes they are allowed to make from here.
//
// Center admins are scoped to their own center's units; students see basic
// component facts for any center but holder details only for themselves.

const STATUS_ACTIONS = {
  available: [{ toStatus: 'damaged', label: 'Mark damaged / consumed' }, { toStatus: 'under_repair', label: 'Send for repair' }],
  damaged: [{ toStatus: 'available', label: 'Mark available (corrected)' }, { toStatus: 'under_repair', label: 'Send for repair' }, { toStatus: 'disposed', label: 'Dispose' }],
  under_repair: [{ toStatus: 'available', label: 'Mark repaired' }, { toStatus: 'disposed', label: 'Dispose (beyond repair)' }],
  disposed: [{ toStatus: 'available', label: 'Restore (disposed by mistake)' }],
};

router.get('/:tag', authMiddleware, (req, res) => {
  const db = getDb();
  const tag = String(req.params.tag || '').trim();
  if (!tag) return res.status(400).json({ message: 'No tag given' });

  const asset = db.prepare(`
    SELECT a.*, c.name AS classification_name, ctr.name AS center_name,
           pc.id AS pc_id, pc.name AS pc_name, pc.description AS pc_description, pc.image AS pc_image,
           pc.reference_videos AS pc_videos
    FROM assets a
    JOIN classifications c ON c.id = a.classification_id
    JOIN centers ctr ON ctr.id = a.center_id
    LEFT JOIN product_catalog pc ON pc.id = a.catalog_id
    WHERE UPPER(a.asset_tag) = UPPER(?)
  `).get(tag);
  if (!asset) return res.status(404).json({ message: `No unit with tag "${tag}"` });

  const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
  if (req.user.role === 'admin' && asset.center_id !== req.user.centerId) {
    return res.status(403).json({ message: `This unit belongs to ${asset.center_name}, not your center.` });
  }

  const counts = asset.catalog_id
    ? db.prepare(`
        SELECT SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available, COUNT(*) AS total
        FROM assets WHERE catalog_id = ? AND status != 'disposed'
      `).get(asset.catalog_id)
    : { available: 0, total: 0 };

  // Open order holding this unit, if any.
  const holderRow = db.prepare(`
    SELECT ir.order_id, ir.status, ir.expected_return_date, ir.issued_at, ir.student_id,
           s.user_id AS holder_user_id, COALESCE(s.full_name, u.full_name) AS student_name, u.username AS student_username
    FROM issue_record_assets ira
    JOIN issue_record_items iri ON iri.id = ira.issue_record_item_id
    JOIN issue_records ir ON ir.id = iri.issue_record_id
    LEFT JOIN students s ON s.id = ir.student_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE ira.asset_id = ? AND ir.status NOT IN ('Returned', 'Rejected')
    ORDER BY ir.created_at DESC LIMIT 1
  `).get(asset.id);

  const payload = {
    role: req.user.role,
    unit: {
      id: asset.id,
      assetTag: asset.asset_tag,
      status: asset.status,
      serialNumber: asset.serial_number || '',
      location: asset.location || '',
      centerId: asset.center_id,
      centerName: asset.center_name,
      classification: asset.classification_name,
      hasWarranty: !!asset.has_warranty,
      warrantyUntil: asset.warranty_until || '',
      addedDate: asset.added_date || '',
    },
    component: {
      catalogId: asset.pc_id || asset.catalog_id || null,
      name: asset.pc_name || asset.name,
      description: asset.pc_description || asset.description || '',
      image: asset.pc_image || asset.image || '',
      referenceVideos: asset.pc_videos || '',
      available: Number(counts.available || 0),
      total: Number(counts.total || 0),
    },
    holder: null,
    myOrders: [],
  };

  if (isAdmin) {
    payload.unit.unitValue = asset.unit_value;
    payload.holder = holderRow ? {
      orderId: holderRow.order_id, status: holderRow.status, expectedReturnDate: holderRow.expected_return_date,
      issuedAt: holderRow.issued_at, studentName: holderRow.student_name, studentUsername: holderRow.student_username,
    } : null;
    payload.history = db.prepare(
      'SELECT event_type, from_status, to_status, occurred_at, performed_by, notes FROM asset_lifecycle_events WHERE asset_id = ? ORDER BY occurred_at DESC LIMIT 50'
    ).all(asset.id);
    payload.orders = db.prepare(`
      SELECT DISTINCT ir.order_id, ir.status, ir.issued_at, ir.returned_at, ir.expected_return_date,
             COALESCE(s.full_name, u.full_name) AS student_name
      FROM issue_record_assets ira
      JOIN issue_record_items iri ON iri.id = ira.issue_record_item_id
      JOIN issue_records ir ON ir.id = iri.issue_record_id
      LEFT JOIN students s ON s.id = ir.student_id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE ira.asset_id = ?
      ORDER BY ir.created_at DESC LIMIT 20
    `).all(asset.id);
    payload.actions = STATUS_ACTIONS[asset.status] || [];
  } else {
    // Student: only their own relationship with this unit.
    const me = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
    const mine = Boolean(holderRow && me && holderRow.student_id === me.id);
    payload.holder = holderRow
      ? { mine, orderId: mine ? holderRow.order_id : null, status: holderRow.status, expectedReturnDate: mine ? holderRow.expected_return_date : null }
      : null;
    if (me) {
      payload.myOrders = db.prepare(`
        SELECT DISTINCT ir.order_id, ir.status, ir.issued_at, ir.returned_at, ir.expected_return_date
        FROM issue_record_assets ira
        JOIN issue_record_items iri ON iri.id = ira.issue_record_item_id
        JOIN issue_records ir ON ir.id = iri.issue_record_id
        WHERE ira.asset_id = ? AND ir.student_id = ?
        ORDER BY ir.created_at DESC LIMIT 20
      `).all(asset.id, me.id);
    }
  }

  res.json(payload);
});

module.exports = router;
