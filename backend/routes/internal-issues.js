// Internal component usage: staff pulling stock for a session/project rather
// than a student checkout. Stock reduces immediately on submission -- the
// admin recording it is doing the pull themselves, no separate approval
// step. Returns split into good/damaged, same shape as the student return flow.
const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { swapAsset } = require('../utils/assetSwap');

const router = express.Router();

function getScopedCenterId(req) {
  if (req.user.role === 'super_admin') {
    return String(req.query.centerId || req.body.centerId || '').trim();
  }
  return req.user.centerId;
}

// See orders.js's identical helper for why: the reason shown is either a
// later admin correction ('adjusted') or the reason given when the unit was
// marked damaged at return time ('damaged') -- whichever happened most
// recently, with any descriptive prefix on the stored note stripped off.
function reasonFromNotes(notes) {
  if (!notes) return null;
  const idx = String(notes).indexOf(' -- ');
  return idx === -1 ? notes : notes.slice(idx + 4).trim();
}

function loadIssueDetail(db, id) {
  const issue = db.prepare(`
    SELECT ii.*, p.name AS program_name
    FROM internal_issues ii LEFT JOIN projects p ON p.id = ii.project_id
    WHERE ii.id = ?
  `).get(id);
  if (!issue) return null;

  const items = db.prepare('SELECT * FROM internal_issue_items WHERE internal_issue_id = ?').all(id);
  const itemsWithDetail = items.map(item => {
    const assets = db.prepare(`
      SELECT a.id, a.asset_tag AS assetTag, a.serial_number AS serialNumber, a.status,
             (SELECT e.notes FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type IN ('adjusted', 'damaged') ORDER BY e.occurred_at DESC LIMIT 1) AS correctionReason,
             (SELECT e.performed_by FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type IN ('adjusted', 'damaged') ORDER BY e.occurred_at DESC LIMIT 1) AS correctionBy,
             (SELECT e.occurred_at FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type IN ('adjusted', 'damaged') ORDER BY e.occurred_at DESC LIMIT 1) AS correctionAt
      FROM internal_issue_assets iia
      JOIN assets a ON a.id = iia.asset_id WHERE iia.internal_issue_item_id = ?
    `).all(item.id).map(r => ({ ...r, correctionReason: reasonFromNotes(r.correctionReason) }));
    const returns = db.prepare(`
      SELECT COALESCE(SUM(returned_good_qty), 0) AS returnedGoodQty, COALESCE(SUM(returned_damaged_qty), 0) AS returnedDamagedQty
      FROM internal_issue_return_items WHERE internal_issue_item_id = ?
    `).get(item.id);
    const returnedTotal = returns.returnedGoodQty + returns.returnedDamagedQty;
    return {
      id: item.id, catalogId: item.catalog_id, name: item.name, qty: item.qty, unit: item.unit,
      assets, returnedGoodQty: returns.returnedGoodQty, returnedDamagedQty: returns.returnedDamagedQty,
      outstandingQty: Math.max(0, item.qty - returnedTotal),
    };
  });

  return {
    id: issue.id, issueCode: issue.issue_code, centerId: issue.center_id, takenBy: issue.taken_by,
    projectId: issue.project_id, programName: issue.program_name, reason: issue.reason, status: issue.status,
    studentCount: issue.student_count, teamCount: issue.team_count, instituteName: issue.institute_name,
    issuedBy: issue.issued_by, issuedAt: issue.issued_at, returnedAt: issue.returned_at,
    items: itemsWithDetail,
  };
}

router.post('/', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getScopedCenterId(req);
  if (!centerId) return res.status(400).json({ message: 'A valid center is required' });

  const { takenBy, projectId, otherProgramName, reason, items, studentCount, teamCount, instituteName } = req.body || {};
  const trimmedTakenBy = String(takenBy || '').trim();
  const trimmedReason = String(reason || '').trim();
  const normalizedStudentCount = studentCount !== undefined && studentCount !== '' ? Number(studentCount) : null;
  const normalizedTeamCount = teamCount !== undefined && teamCount !== '' ? Number(teamCount) : null;
  const trimmedInstituteName = String(instituteName || '').trim() || null;
  if (!trimmedTakenBy) return res.status(400).json({ message: 'Who is taking the components is required' });
  if (!projectId && !String(otherProgramName || '').trim()) return res.status(400).json({ message: 'Select which program this is for' });
  if (!trimmedReason) return res.status(400).json({ message: 'A reason is required' });
  const requestedItems = Array.isArray(items) ? items.filter(i => Number(i.qty) > 0) : [];
  if (!requestedItems.length) return res.status(400).json({ message: 'Add at least one component' });

  db.exec('BEGIN TRANSACTION');
  try {
    // Matches the get-or-create pattern used for a student order's Program
    // (routes/orders.js) -- picking "Other" and typing a name creates a
    // real, reusable Program rather than leaving the issue unlinked.
    let resolvedProjectId = null;
    if (otherProgramName && String(otherProgramName).trim()) {
      const trimmed = String(otherProgramName).trim();
      const existing = db.prepare('SELECT id FROM projects WHERE center_id = ? AND name = ?').get(centerId, trimmed);
      resolvedProjectId = existing ? existing.id
        : db.prepare('INSERT INTO projects (name, center_id) VALUES (?, ?)').run(trimmed, centerId).lastInsertRowid;
    } else {
      const program = db.prepare('SELECT id FROM projects WHERE id = ? AND center_id = ?').get(projectId, centerId);
      if (!program) throw new Error('Program not found for this center');
      resolvedProjectId = program.id;
    }

    // An item may pin specific units (assetIds) -- the ones the admin
    // scanned at the shelf. Those must be available units of that component;
    // any remaining quantity is filled from whatever else is available.
    for (const item of requestedItems) {
      const catalog = db.prepare('SELECT id, name FROM product_catalog WHERE id = ? AND center_id = ?').get(item.catalogId, centerId);
      if (!catalog) throw new Error(`Component not found: ${item.name || item.catalogId}`);
      // Asset ids are UUID strings -- never coerce them to numbers.
      const pinned = Array.isArray(item.assetIds) ? [...new Set(item.assetIds.map(v => String(v || '').trim()).filter(Boolean))] : [];
      if (pinned.length > item.qty) throw new Error(`${catalog.name}: ${pinned.length} units scanned but quantity is ${item.qty}`);
      for (const assetId of pinned) {
        const unit = db.prepare('SELECT id, asset_tag, status, catalog_id FROM assets WHERE id = ?').get(assetId);
        if (!unit || unit.catalog_id !== catalog.id) throw new Error(`Scanned unit ${assetId} is not a ${catalog.name}`);
        if (unit.status !== 'available') throw new Error(`${unit.asset_tag} is ${unit.status.replace('_', ' ')}, not available`);
      }
      const available = db.prepare("SELECT COUNT(*) c FROM assets WHERE catalog_id = ? AND status = 'available'").get(catalog.id);
      if (available.c < item.qty) throw new Error(`Insufficient stock for ${catalog.name} (Available: ${available.c})`);
      item.pinnedAssetIds = pinned;
    }

    const issueCode = `INT-${Date.now().toString(36).toUpperCase()}`;
    const now = new Date().toISOString();
    const issueId = db.prepare(`
      INSERT INTO internal_issues (center_id, issue_code, taken_by, project_id, reason, status, issued_by, issued_at, student_count, team_count, institute_name)
      VALUES (?, ?, ?, ?, ?, 'Issued', ?, ?, ?, ?, ?)
    `).run(centerId, issueCode, trimmedTakenBy, resolvedProjectId, trimmedReason, req.user.username, now,
           normalizedStudentCount, normalizedTeamCount, trimmedInstituteName).lastInsertRowid;

    for (const item of requestedItems) {
      const catalog = db.prepare('SELECT id, name FROM product_catalog WHERE id = ?').get(item.catalogId);
      const itemId = db.prepare(`
        INSERT INTO internal_issue_items (internal_issue_id, catalog_id, name, qty, unit) VALUES (?, ?, ?, ?, ?)
      `).run(issueId, catalog.id, catalog.name, item.qty, item.unit || 'pcs').lastInsertRowid;

      const pinned = item.pinnedAssetIds || [];
      const remaining = item.qty - pinned.length;
      const filler = remaining > 0
        ? db.prepare(`SELECT id FROM assets WHERE catalog_id = ? AND status = 'available'${pinned.length ? ` AND id NOT IN (${pinned.map(() => '?').join(',')})` : ''} LIMIT ?`).all(catalog.id, ...pinned, remaining)
        : [];
      const toIssue = [...pinned.map(id => ({ id })), ...filler];
      for (const asset of toIssue) {
        db.prepare("UPDATE assets SET status = 'issued' WHERE id = ?").run(asset.id);
        db.prepare(`
          INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
          VALUES (?, 'issued', 'available', 'issued', ?, ?, ?, ?)
        `).run(asset.id, centerId, `Internal use (${issueCode}): ${trimmedReason}`, req.user.username, now);
        db.prepare('INSERT INTO internal_issue_assets (internal_issue_item_id, asset_id) VALUES (?, ?)').run(itemId, asset.id);
      }
    }

    db.exec('COMMIT');
    res.status(201).json(loadIssueDetail(db, issueId));
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ message: err.message });
  }
});

router.get('/', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getScopedCenterId(req);
  if (!centerId) return res.json([]);
  const ids = db.prepare('SELECT id FROM internal_issues WHERE center_id = ? ORDER BY issued_at DESC').all(centerId).map(r => r.id);
  res.json(ids.map(id => loadIssueDetail(db, id)));
});

router.get('/:id', authMiddleware, adminOnly, (req, res) => {
  const detail = loadIssueDetail(getDb(), req.params.id);
  if (!detail) return res.status(404).json({ message: 'Internal issue not found' });
  res.json(detail);
});

router.post('/:id/return', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const issue = db.prepare('SELECT * FROM internal_issues WHERE id = ?').get(req.params.id);
  if (!issue) return res.status(404).json({ message: 'Internal issue not found' });

  const returns = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!returns.length) return res.status(400).json({ message: 'Nothing to return' });
  const anyDamaged = returns.some(entry => Array.isArray(entry.damagedAssetIds) && entry.damagedAssetIds.length);
  const damageReason = String(req.body?.damageReason || '').trim();
  if (anyDamaged && !damageReason) {
    return res.status(400).json({ message: 'A reason is required for any unit being returned damaged' });
  }

  db.exec('BEGIN TRANSACTION');
  try {
    const now = new Date().toISOString();
    for (const entry of returns) {
      // Admin picks exactly which physical asset tags came back good vs
      // damaged, not just quantities -- so the lifecycle record reflects
      // reality instead of an arbitrary "first N" guess.
      const returnedAssetIds = Array.isArray(entry.returnedAssetIds) ? [...new Set(entry.returnedAssetIds)] : [];
      const damagedAssetIds = Array.isArray(entry.damagedAssetIds) ? [...new Set(entry.damagedAssetIds)] : [];
      if (!returnedAssetIds.length && !damagedAssetIds.length) continue;

      const item = db.prepare('SELECT * FROM internal_issue_items WHERE id = ? AND internal_issue_id = ?').get(entry.itemId, issue.id);
      if (!item) throw new Error(`Item ${entry.itemId} does not belong to this internal issue`);
      if (returnedAssetIds.some(id => damagedAssetIds.includes(id))) {
        throw new Error(`${item.name}: a unit can't be marked both good and damaged`);
      }

      // Every asset named must actually be an 'issued' unit linked to this
      // item -- structurally guarantees the selection can't exceed the
      // real outstanding balance, no separate qty check needed.
      const issuedAssetIds = new Set(db.prepare(`
        SELECT a.id FROM internal_issue_assets iia JOIN assets a ON a.id = iia.asset_id
        WHERE iia.internal_issue_item_id = ? AND a.status = 'issued'
      `).all(item.id).map(r => r.id));
      for (const assetId of [...returnedAssetIds, ...damagedAssetIds]) {
        if (!issuedAssetIds.has(assetId)) {
          throw new Error(`${item.name}: one of the selected units is not currently issued on this internal use`);
        }
      }

      returnedAssetIds.forEach(assetId => {
        db.prepare("UPDATE assets SET status = 'available' WHERE id = ?").run(assetId);
        db.prepare('UPDATE internal_issue_assets SET condition_on_return = ? WHERE internal_issue_item_id = ? AND asset_id = ?')
          .run('good', item.id, assetId);
        db.prepare(`
          INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
          VALUES (?, 'returned', 'issued', 'available', ?, ?, ?, ?)
        `).run(assetId, issue.center_id, `Returned from internal use (${issue.issue_code})`, req.user.username, now);
      });
      damagedAssetIds.forEach(assetId => {
        db.prepare("UPDATE assets SET status = 'damaged' WHERE id = ?").run(assetId);
        db.prepare(`
          INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
          VALUES (?, 'damaged', 'issued', 'damaged', ?, ?, ?, ?)
        `).run(assetId, issue.center_id, `Damaged during internal use (${issue.issue_code}) -- ${damageReason}`, req.user.username, now);
        db.prepare('UPDATE internal_issue_assets SET condition_on_return = ? WHERE internal_issue_item_id = ? AND asset_id = ?')
          .run('damaged', item.id, assetId);
      });

      db.prepare(`
        INSERT INTO internal_issue_return_items (internal_issue_item_id, returned_good_qty, returned_damaged_qty, recorded_at)
        VALUES (?, ?, ?, ?)
      `).run(item.id, returnedAssetIds.length, damagedAssetIds.length, now);
    }

    const totals = db.prepare(`
      SELECT SUM(ii.qty) AS totalQty, COALESCE(SUM(r.returnedQty), 0) AS totalReturned
      FROM internal_issue_items ii
      LEFT JOIN (
        SELECT internal_issue_item_id, SUM(returned_good_qty + returned_damaged_qty) AS returnedQty
        FROM internal_issue_return_items GROUP BY internal_issue_item_id
      ) r ON r.internal_issue_item_id = ii.id
      WHERE ii.internal_issue_id = ?
    `).get(issue.id);

    const nextStatus = totals.totalReturned >= totals.totalQty ? 'Returned'
      : totals.totalReturned > 0 ? 'Partially Returned' : issue.status;
    db.prepare('UPDATE internal_issues SET status = ?, returned_at = ? WHERE id = ?')
      .run(nextStatus, nextStatus === 'Returned' ? now : issue.returned_at, issue.id);

    db.exec('COMMIT');
    res.json(loadIssueDetail(db, issue.id));
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ message: err.message });
  }
});

// If the system-assigned unit for a line item can't be physically found,
// swap in a different available unit of the same component. :itemId is the
// real internal_issue_items.id, already exposed as "id" per item.
router.put('/:issueId/items/:itemId/swap-asset', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const { oldAssetId, newAssetId, reason } = req.body || {};
  if (!oldAssetId || !newAssetId) return res.status(400).json({ message: 'oldAssetId and newAssetId are required' });

  const issue = db.prepare('SELECT * FROM internal_issues WHERE id = ?').get(req.params.issueId);
  if (!issue) return res.status(404).json({ message: 'Internal issue not found' });
  if (req.user.role !== 'super_admin' && issue.center_id !== req.user.centerId) {
    return res.status(403).json({ message: 'You cannot access an internal issue from another center' });
  }

  const item = db.prepare('SELECT id FROM internal_issue_items WHERE id = ? AND internal_issue_id = ?').get(req.params.itemId, issue.id);
  if (!item) return res.status(404).json({ message: 'Line item not found on this internal issue' });

  const link = db.prepare('SELECT id FROM internal_issue_assets WHERE internal_issue_item_id = ? AND asset_id = ?').get(item.id, oldAssetId);
  if (!link) return res.status(400).json({ message: 'That unit is not assigned to this line item' });

  db.exec('BEGIN TRANSACTION');
  try {
    swapAsset(db, { oldAssetId, newAssetId, centerId: issue.center_id, performedBy: req.user.username, reason });
    db.prepare('UPDATE internal_issue_assets SET asset_id = ? WHERE id = ?').run(newAssetId, link.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(400).json({ message: err.message });
  }

  res.json({ message: 'Unit swapped', issueId: issue.id });
});

module.exports = router;
