const express = require('express');
const { getDb } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { listCenters, getCenterById, requireCenter } = require('../utils/centers');
const { getAdminRecipient, sendTransferNotification } = require('../utils/email');
const { logActivity } = require('../utils/logsDb');
const { swapAsset } = require('../utils/assetSwap');
const push = require('../utils/push');

const router = express.Router();
// Super-admin recipients for org-level events. Resolved at send time from
// Settings (falls back to the legacy ADMIN_EMAIL / CENTER_EMAIL env vars), so
// changing the responsible admin in the UI takes effect without a restart.
function superAdminRecipients() {
  const settings = require('../utils/settings');
  const fromSettings = settings.getOrderEmail(null);
  return [...new Set([fromSettings, process.env.ADMIN_EMAIL].filter(Boolean))];
}

function loadTransferRow(db, code) {
  return db.prepare(`
    SELECT t.*, rc.name AS requestingCenterName, sc.name AS supplyCenterName
    FROM transfers t
    JOIN centers rc ON rc.id = t.requesting_center_id
    LEFT JOIN centers sc ON sc.id = t.supply_center_id
    WHERE t.transfer_code = ?
  `).get(code);
}

function loadTransferItems(db, transferId) {
  return db.prepare(`
    SELECT id, catalog_id AS catalogId, name, qty_requested AS qty, unit FROM transfer_items WHERE transfer_id = ?
  `).all(transferId);
}

// Only populated once a transfer is approved (that's when specific units
// get assigned) -- matches orders.js's per-item asset visibility.
function loadAssetsForTransferItem(db, itemId) {
  return db.prepare(`
    SELECT a.id, a.asset_tag AS assetTag, a.serial_number AS serialNumber, a.status
    FROM transfer_item_assets tia JOIN assets a ON a.id = tia.asset_id
    WHERE tia.transfer_item_id = ?
    ORDER BY a.asset_tag
  `).all(itemId);
}

function computeAvailableCenters(db, excludeCenterId, items) {
  const available = [];
  for (const center of listCenters()) {
    if (center.id === excludeCenterId) continue;
    const hasAll = items.every(item => {
      const catalogRow = db.prepare('SELECT id FROM product_catalog WHERE center_id = ? AND name = ?').get(center.id, item.name);
      if (!catalogRow) return false;
      const count = db.prepare("SELECT COUNT(*) c FROM assets WHERE catalog_id = ? AND status = 'available'").get(catalogRow.id).c;
      return count >= item.qty;
    });
    if (hasAll) available.push({ id: center.id, name: center.name });
  }
  return available;
}

function buildTransferResponse(db, row) {
  const items = loadTransferItems(db, row.id);
  const response = {
    id: row.transfer_code,
    requestingCenterId: row.requesting_center_id,
    requestingCenterName: row.requestingCenterName,
    requestedBy: row.requested_by,
    requestDate: row.request_date,
    status: row.status,
    statusUpdatedAt: row.status_updated_at,
    components: items.map(i => ({ id: String(i.catalogId), name: i.name, qty: i.qty, unit: i.unit, assets: loadAssetsForTransferItem(db, i.id) })),
    programName: row.program_name || '',
    responsiblePerson: row.responsible_person || '',
    responsibleEmail: row.responsible_email || '',
    purpose: row.purpose || '',
    desiredReturnDate: row.desired_return_date || '',
    notes: row.notes || '',
    supplyCenterId: row.supply_center_id || '',
    supplyCenterName: row.supplyCenterName || '',
    approvedAt: row.approved_at || '',
    supplierRemarks: row.supplier_remarks || '',
    returnRequestedAt: row.return_requested_at || '',
    returnedAt: row.returned_at || '',
    returnNotes: row.return_notes || '',
  };
  if (row.status === 'Pending') {
    response.availableCenters = computeAvailableCenters(db, row.requesting_center_id, items);
  }
  return response;
}

function normalizeComponent(raw) {
  const qty = Number(raw.qty || raw.quantity || 0);
  return {
    id: Number(raw.id || raw.componentId || 0),
    name: String(raw.name || '').trim(),
    qty: Number.isFinite(qty) ? qty : 0,
    unit: String(raw.unit || raw.uom || 'pcs').trim(),
  };
}

router.get('/', authMiddleware, adminOnly, (req, res) => {
  try {
    const db = getDb();
    const isSuper = req.user.role === 'super_admin';
    const scopedCenterId = isSuper ? String(req.query.centerId || '').trim() : req.user.centerId;

    const rows = scopedCenterId
      ? db.prepare(`
          SELECT t.*, rc.name AS requestingCenterName, sc.name AS supplyCenterName
          FROM transfers t
          JOIN centers rc ON rc.id = t.requesting_center_id
          LEFT JOIN centers sc ON sc.id = t.supply_center_id
          WHERE t.requesting_center_id = ? OR t.supply_center_id = ?
        `).all(scopedCenterId, scopedCenterId)
      : db.prepare(`
          SELECT t.*, rc.name AS requestingCenterName, sc.name AS supplyCenterName
          FROM transfers t
          JOIN centers rc ON rc.id = t.requesting_center_id
          LEFT JOIN centers sc ON sc.id = t.supply_center_id
        `).all();

    const requests = rows.map(row => buildTransferResponse(db, row))
      .sort((a, b) => new Date(b.requestDate || 0) - new Date(a.requestDate || 0));
    res.json(requests);
  } catch (err) {
    console.error('Transfer GET error:', err.message);
    res.status(500).json({ message: 'Unable to fetch transfer requests' });
  }
});

router.post('/', authMiddleware, adminOnly, async (req, res) => {
  const db = getDb();
  try {
    const centerId = req.user.centerId;
    if (!centerId) return res.status(400).json({ message: 'Center context is missing' });

    const rawComponents = Array.isArray(req.body.components) ? req.body.components : [];
    const components = rawComponents.map(normalizeComponent).filter(item => item.id && item.name && item.qty > 0);
    if (!components.length) return res.status(400).json({ message: 'At least one valid component is required' });

    const transferCode = `TRF-${Date.now().toString(36).toUpperCase()}`;
    const now = new Date().toISOString();

    db.exec('BEGIN TRANSACTION');
    let transferDbId;
    try {
      transferDbId = db.prepare(`
        INSERT INTO transfers
          (transfer_code, requesting_center_id, requested_by, status, program_name, responsible_person,
           responsible_email, purpose, desired_return_date, notes, request_date)
        VALUES (?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?)
      `).run(transferCode, centerId, req.user.username, String(req.body.programName || '').trim() || null,
             String(req.body.responsiblePerson || '').trim() || null, String(req.body.responsibleEmail || '').trim() || null,
             String(req.body.purpose || '').trim() || null, String(req.body.desiredReturnDate || '').trim() || null,
             String(req.body.notes || '').trim() || null, now).lastInsertRowid;

      for (const item of components) {
        db.prepare('INSERT INTO transfer_items (transfer_id, catalog_id, name, qty_requested, unit) VALUES (?, ?, ?, ?, ?)')
          .run(transferDbId, item.id, item.name, item.qty, item.unit);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const row = loadTransferRow(db, transferCode);
    const transfer = buildTransferResponse(db, row);

    await logActivity('TRANSFER_REQUEST', req.user.username, { role: req.user.role, centerId, info: `Requested ${components.length} components (Transfer ${transfer.id})` });
    await sendTransferNotification({ transfer, type: 'request', recipients: superAdminRecipients() });
    push.notifyTransfer(transfer, 'request', { excludeUserId: req.user.id });
    res.status(201).json(transfer);
  } catch (err) {
    console.error('Transfer POST error:', err.message);
    res.status(500).json({ message: err.message || 'Unable to create transfer request' });
  }
});

router.post('/:id/return-request', authMiddleware, adminOnly, async (req, res) => {
  const db = getDb();
  try {
    const row = loadTransferRow(db, req.params.id);
    if (!row) return res.status(404).json({ message: 'Transfer not found' });
    if (req.user.role !== 'super_admin' && req.user.centerId !== row.requesting_center_id) {
      return res.status(403).json({ message: 'Only the requesting center can ask for a return' });
    }
    if (row.status !== 'Approved') {
      return res.status(400).json({ message: 'Only approved transfers can be returned' });
    }

    const now = new Date().toISOString();
    const reason = String(req.body.reason || req.body.notes || '').trim();
    let returnNotes = reason || row.return_notes || '';
    if (String(req.body.courierName || '').trim()) returnNotes += `\nCourier: ${req.body.courierName.trim()}`;
    if (String(req.body.trackingId || '').trim()) returnNotes += `\nTracking ID: ${req.body.trackingId.trim()}`;

    db.prepare(`
      UPDATE transfers SET status = 'Return Requested', status_updated_at = ?, return_requested_at = ?, return_notes = ?
      WHERE id = ?
    `).run(now, now, returnNotes, row.id);

    const updated = buildTransferResponse(db, loadTransferRow(db, req.params.id));
    await logActivity('TRANSFER_RETURN_REQUESTED', req.user.username, { role: req.user.role, centerId: row.requesting_center_id, info: `Return requested for ${req.params.id}` });
    const recipients = [getAdminRecipient(row.supply_center_id), ...superAdminRecipients()].filter(Boolean);
    await sendTransferNotification({ transfer: updated, type: 'return-request', recipients });
    push.notifyTransfer(updated, 'return-request', { excludeUserId: req.user.id });
    res.json(updated);
  } catch (err) {
    console.error('Return request error:', err.message);
    res.status(500).json({ message: err.message || 'Unable to request return' });
  }
});

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ message: 'Super admin access required' });
  }
  const db = getDb();
  try {
    const row = loadTransferRow(db, req.params.id);
    if (!row) return res.status(404).json({ message: 'Transfer not found' });
    const status = String(req.body.status || '').trim();
    const now = new Date().toISOString();

    if (status === 'Approved') {
      if (row.status !== 'Pending') return res.status(400).json({ message: 'Only pending transfers can be approved' });
      const supplyCenterId = String(req.body.supplyCenterId || '').trim();
      if (!supplyCenterId) return res.status(400).json({ message: 'Supply center selection is required' });
      const supplyCenter = requireCenter(supplyCenterId);

      // loadTransferItems returns transfer_items rows (their own id, catalog
      // id under catalogId); normalise so `id` is the catalog id either way.
      const approvedComponents = (Array.isArray(req.body.components)
        ? req.body.components
        : loadTransferItems(db, row.id).map(item => ({ id: item.catalogId, name: item.name, qty: item.qty, unit: item.unit }))
      ).map(normalizeComponent).filter(item => item.id && item.qty > 0);
      if (!approvedComponents.length) return res.status(400).json({ message: 'At least one valid component is required for approval' });

      db.exec('BEGIN TRANSACTION');
      try {
        // Check availability for everything before moving anything.
        const plan = approvedComponents.map(comp => {
          const reqCatalog = db.prepare('SELECT id, name FROM product_catalog WHERE id = ?').get(comp.id);
          if (!reqCatalog) throw Object.assign(new Error(`Component ${comp.name || comp.id} not found`), { code: 'VALIDATION' });
          const supplyCatalog = db.prepare('SELECT id FROM product_catalog WHERE center_id = ? AND name = ?').get(supplyCenterId, reqCatalog.name);
          if (!supplyCatalog) throw Object.assign(new Error(`${reqCatalog.name} is not in ${supplyCenter.name}'s catalog`), { code: 'VALIDATION' });
          const availableAssets = db.prepare("SELECT id FROM assets WHERE catalog_id = ? AND status = 'available' LIMIT ?").all(supplyCatalog.id, comp.qty);
          if (availableAssets.length < comp.qty) {
            throw Object.assign(new Error(`Insufficient stock for ${reqCatalog.name} at ${supplyCenter.name} (Available: ${availableAssets.length})`), { code: 'VALIDATION' });
          }
          return { reqCatalogId: comp.id, name: reqCatalog.name, qty: comp.qty, unit: comp.unit, assetIds: availableAssets.map(a => a.id) };
        });

        db.prepare('DELETE FROM transfer_item_assets WHERE transfer_item_id IN (SELECT id FROM transfer_items WHERE transfer_id = ?)').run(row.id);
        db.prepare('DELETE FROM transfer_items WHERE transfer_id = ?').run(row.id);

        for (const item of plan) {
          const itemId = db.prepare('INSERT INTO transfer_items (transfer_id, catalog_id, name, qty_requested, unit) VALUES (?, ?, ?, ?, ?)')
            .run(row.id, item.reqCatalogId, item.name, item.qty, item.unit).lastInsertRowid;

          for (const assetId of item.assetIds) {
            db.prepare(`
              INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, transfer_id, notes, performed_by, occurred_at)
              VALUES (?, 'transferred_out', 'available', 'available', ?, ?, ?, ?, ?)
            `).run(assetId, supplyCenterId, row.id, `Transferred to ${row.requestingCenterName} (${row.transfer_code})`, req.user.username, now);
            db.prepare('UPDATE assets SET center_id = ?, catalog_id = ? WHERE id = ?').run(row.requesting_center_id, item.reqCatalogId, assetId);
            db.prepare(`
              INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, transfer_id, notes, performed_by, occurred_at)
              VALUES (?, 'transferred_in', 'available', 'available', ?, ?, ?, ?, ?)
            `).run(assetId, row.requesting_center_id, row.id, `Received via transfer ${row.transfer_code} from ${supplyCenter.name}`, req.user.username, now);
            db.prepare('INSERT INTO transfer_item_assets (transfer_item_id, asset_id) VALUES (?, ?)').run(itemId, assetId);
          }
        }

        db.prepare(`
          UPDATE transfers SET status = 'Approved', supply_center_id = ?, supplier_remarks = ?, approved_at = ?, status_updated_at = ?
          WHERE id = ?
        `).run(supplyCenterId, String(req.body.supplierRemarks || '').trim() || null, now, now, row.id);

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        if (err.code === 'VALIDATION') return res.status(400).json({ message: err.message });
        throw err;
      }

      const updated = buildTransferResponse(db, loadTransferRow(db, req.params.id));
      await Promise.all([
        logActivity('TRANSFER_APPROVED', req.user.username, { role: req.user.role, centerId: row.requesting_center_id, info: `Transfer ${req.params.id} approved (supplied by ${supplyCenterId})` }),
        logActivity('TRANSFER_SUPPLY', req.user.username, { role: req.user.role, centerId: supplyCenterId, info: `Supplied transfer ${req.params.id}` }),
      ]);
      const recipients = [getAdminRecipient(supplyCenterId), getAdminRecipient(row.requesting_center_id)].filter(Boolean);
      await sendTransferNotification({ transfer: updated, type: 'approved', recipients });
      push.notifyTransfer(updated, 'approved', { excludeUserId: req.user.id });
      return res.json(updated);
    }

    if (status === 'Returned') {
      if (!['Approved', 'Return Requested'].includes(row.status)) {
        return res.status(400).json({ message: 'Only approved/return-requested transfers can be marked returned' });
      }
      if (!row.supply_center_id) return res.status(400).json({ message: 'Supply center is not recorded for this transfer' });
      const supplyCenter = getCenterById(row.supply_center_id);

      db.exec('BEGIN TRANSACTION');
      try {
        const items = loadTransferItems(db, row.id);
        for (const item of items) {
          const supplyCatalog = db.prepare('SELECT id FROM product_catalog WHERE center_id = ? AND name = ?').get(row.supply_center_id, item.name);
          if (!supplyCatalog) throw Object.assign(new Error(`${item.name} is missing from ${supplyCenter?.name || 'the supply center'}'s catalog`), { code: 'VALIDATION' });

          const links = db.prepare('SELECT asset_id FROM transfer_item_assets WHERE transfer_item_id = ?').all(item.id);
          for (const link of links) {
            const asset = db.prepare('SELECT status FROM assets WHERE id = ?').get(link.asset_id);
            if (!asset || asset.status !== 'available') {
              throw Object.assign(new Error(`${item.name}: one unit is currently ${asset ? asset.status : 'missing'} and can't be returned yet`), { code: 'VALIDATION' });
            }
            db.prepare(`
              INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, transfer_id, notes, performed_by, occurred_at)
              VALUES (?, 'transferred_out', 'available', 'available', ?, ?, ?, ?, ?)
            `).run(link.asset_id, row.requesting_center_id, row.id, `Returned to ${supplyCenter?.name || row.supply_center_id} (${row.transfer_code})`, req.user.username, now);
            db.prepare('UPDATE assets SET center_id = ?, catalog_id = ? WHERE id = ?').run(row.supply_center_id, supplyCatalog.id, link.asset_id);
            db.prepare(`
              INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, transfer_id, notes, performed_by, occurred_at)
              VALUES (?, 'transferred_in', 'available', 'available', ?, ?, ?, ?, ?)
            `).run(link.asset_id, row.supply_center_id, row.id, `Returned via transfer ${row.transfer_code} from ${row.requestingCenterName}`, req.user.username, now);
          }
        }

        db.prepare(`
          UPDATE transfers SET status = 'Returned', returned_at = ?, status_updated_at = ?, return_notes = ?
          WHERE id = ?
        `).run(now, now, String(req.body.returnNotes || row.return_notes || '').trim() || null, row.id);

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        if (err.code === 'VALIDATION') return res.status(400).json({ message: err.message });
        throw err;
      }

      const updated = buildTransferResponse(db, loadTransferRow(db, req.params.id));
      await Promise.all([
        logActivity('TRANSFER_RETURNED', req.user.username, { role: req.user.role, centerId: row.requesting_center_id, info: `Transfer ${req.params.id} returned to ${row.supply_center_id}` }),
        logActivity('TRANSFER_RECEIVED_BACK', req.user.username, { role: req.user.role, centerId: row.supply_center_id, info: `Transfer ${req.params.id} components returned` }),
      ]);
      const recipients = [getAdminRecipient(row.supply_center_id), getAdminRecipient(row.requesting_center_id)].filter(Boolean);
      await sendTransferNotification({ transfer: updated, type: 'returned', recipients });
      push.notifyTransfer(updated, 'returned', { excludeUserId: req.user.id });
      return res.json(updated);
    }

    return res.status(400).json({ message: 'Unsupported status update' });
  } catch (err) {
    console.error('Transfer PUT error:', err.message);
    res.status(500).json({ message: err.message || 'Unable to update transfer request' });
  }
});

// If the system-assigned unit for a component can't be physically found,
// swap in a different available unit of the same component. :catalogId
// matches the "id" already exposed per component in the transfer response
// (the real transfer_items.id is internal and never sent to the frontend).
router.put('/:id/items/:catalogId/swap-asset', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const { oldAssetId, newAssetId, reason } = req.body || {};
  if (!oldAssetId || !newAssetId) return res.status(400).json({ message: 'oldAssetId and newAssetId are required' });

  const row = loadTransferRow(db, req.params.id);
  if (!row) return res.status(404).json({ message: 'Transfer not found' });
  if (req.user.role !== 'super_admin' && req.user.centerId !== row.requesting_center_id) {
    return res.status(403).json({ message: 'You cannot access a transfer from another center' });
  }

  const item = db.prepare('SELECT id FROM transfer_items WHERE transfer_id = ? AND catalog_id = ?').get(row.id, req.params.catalogId);
  if (!item) return res.status(404).json({ message: 'Component not found on this transfer' });

  const link = db.prepare('SELECT id FROM transfer_item_assets WHERE transfer_item_id = ? AND asset_id = ?').get(item.id, oldAssetId);
  if (!link) return res.status(400).json({ message: 'That unit is not assigned to this component' });

  db.exec('BEGIN TRANSACTION');
  try {
    // Transferred units stay 'available' the whole time (never reserved/
    // issued by the transfer itself), so the old unit must be 'available'
    // here rather than the reserved/issued default the other two flows use.
    swapAsset(db, { oldAssetId, newAssetId, centerId: row.requesting_center_id, performedBy: req.user.username, reason }, ['available']);
    db.prepare('UPDATE transfer_item_assets SET asset_id = ? WHERE id = ?').run(newAssetId, link.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: 'Unit swapped', transferId: row.transfer_code });
});

// Reused by admin.js (Excel export of all transfers) and programs.js
// (per-program report: which transfers a program's center itself requested).
function getAllTransfers() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.*, rc.name AS requestingCenterName, sc.name AS supplyCenterName
    FROM transfers t
    JOIN centers rc ON rc.id = t.requesting_center_id
    LEFT JOIN centers sc ON sc.id = t.supply_center_id
  `).all();
  return rows.map(row => buildTransferResponse(db, row));
}

function getTransfersForCenter(centerId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.*, rc.name AS requestingCenterName, sc.name AS supplyCenterName
    FROM transfers t
    JOIN centers rc ON rc.id = t.requesting_center_id
    LEFT JOIN centers sc ON sc.id = t.supply_center_id
    WHERE t.requesting_center_id = ?
  `).all(centerId);
  return rows.map(row => buildTransferResponse(db, row));
}

module.exports = router;
module.exports.getAllTransfers = getAllTransfers;
module.exports.getTransfersForCenter = getTransfersForCenter;
