const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getDb } = require('../utils/db');
const { authMiddleware, adminOnly, superAdminOnly } = require('../middleware/auth');
const { requireCenter } = require('../utils/centers');
const { classificationAbbr } = require('../utils/assetTag');
const { logActivity } = require('../utils/logsDb');
const { findSwapCandidates } = require('../utils/assetSwap');

const router = express.Router();

// Catalog photos as actual files on disk, not base64 text stuffed into
// product_catalog.image -- mirrors the existing invoice-documents pattern
// in routes/invoices.js. A photo captured via PhotoInput's "Take Photo" is
// already resized/compressed client-side before it gets here, so 5MB is a
// generous ceiling, not an expected size.
const { COMPONENT_IMAGES_DIR, componentImagePath } = require('../utils/storage');
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Photos are saved as data/components/<component-name>.<ext> so the folder
// reads like the catalog. The form sends the component name as a `name`
// field ahead of the file; without it the file gets a short generic stem.
const catalogImageUpload = multer({
  storage: multer.diskStorage({
    destination: COMPONENT_IMAGES_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10) || (file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg');
      cb(null, path.basename(componentImagePath(req.body?.name, ext)));
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
    }
    cb(null, true);
  },
});

// Returns a short /catalog-images/<file> path -- the caller then submits
// that path as the catalog item's `image` value exactly like it already
// would for a pasted Google Drive URL. Nothing downstream (applyCatalogEdit,
// mergeCatalogInto, invoice line items) needs to know the difference; they
// already just store/pass around whatever string is in `image`.
router.post('/upload-image', authMiddleware, adminOnly, (req, res) => {
  catalogImageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
    res.status(201).json({ path: `/catalog-images/${req.file.filename}` });
  });
});

function getRequestedCenterId(req) {
  if (req.user.role === 'super_admin') {
    return String(req.query.centerId || req.body.centerId || '').trim();
  }
  return req.user.centerId;
}

// transitionAsset() records which program a damage/consumption event
// happened under as "Program: <name>" (or "Program: <name> (other)" for a
// free-text one), optionally followed by " -- <admin notes>". Pull just the
// program label back out for display -- a component bought for one program
// can easily be damaged later while in use on a different one, so this has
// to come from the damage EVENT, never from the purchasing invoice's program.
function extractDamageProgram(notes) {
  if (!notes) return '';
  const programPart = String(notes).split(' -- ')[0];
  const match = programPart.match(/^Program:\s*(.+)$/);
  return match ? match[1].trim() : '';
}

// Everything after the " -- " separator is the admin-entered reason for the
// damage/consumption -- empty for older records created before this field existed.
function extractDamageReason(notes) {
  if (!notes) return '';
  const idx = String(notes).indexOf(' -- ');
  return idx === -1 ? '' : String(notes).slice(idx + 4).trim();
}

router.get('/', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  if (!centerId) return res.json([]);

  const clauses = ['a.center_id = ?'];
  const params = [centerId];
  if (req.query.status) { clauses.push('a.status = ?'); params.push(req.query.status); }
  if (req.query.classificationId) { clauses.push('a.classification_id = ?'); params.push(req.query.classificationId); }
  if (req.query.catalogId) { clauses.push('a.catalog_id = ?'); params.push(req.query.catalogId); }
  // Units created by one invoice, for printing their labels as a batch.
  if (req.query.invoiceId) { clauses.push('i.id = ?'); params.push(req.query.invoiceId); }

  const assets = db.prepare(`
    SELECT a.*, c.name AS classification_name,
           v.name AS vendor_name, i.invoice_number, i.invoice_date,
           (SELECT e.notes FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type = 'damaged' ORDER BY e.occurred_at DESC LIMIT 1) AS last_damage_notes,
           (SELECT e.occurred_at FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type = 'damaged' ORDER BY e.occurred_at DESC LIMIT 1) AS last_damaged_at
    FROM assets a
    JOIN classifications c ON c.id = a.classification_id
    LEFT JOIN invoice_line_items li ON li.id = a.invoice_line_item_id
    LEFT JOIN invoices i ON i.id = li.invoice_id
    LEFT JOIN vendors v ON v.id = i.vendor_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY a.added_date DESC
    LIMIT 500
  `).all(...params);
  res.json(assets.map(asset => ({
    ...asset,
    damaged_in_program: extractDamageProgram(asset.last_damage_notes),
    damaged_reason: extractDamageReason(asset.last_damage_notes),
  })));
});

// Grouped-by-catalog view: what AdminInventory's list UI needs (one row per
// component type, with a live status breakdown instead of a single stock count).
router.get('/catalog-summary', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  if (!centerId) return res.json([]);

  // Images are deliberately NOT selected here -- product_catalog.image is a
  // base64 data URL that can run into the megabytes, and pulling it for
  // every row of a full-catalog summary (hundreds of rows per center) blew
  // this query up to 10+ seconds and, because node:sqlite's DatabaseSync
  // API is synchronous, blocked the entire server's event loop for that
  // whole duration on every request -- stalling every other user's request
  // in the meantime. has_image is a cheap flag (reads the row's NULL marker,
  // never the overflow pages holding the actual bytes); the frontend lazy
  // -fetches each thumbnail individually via GET /catalog/:id/image instead.
  //
  // The status/value aggregates are computed in a subquery that GROUPs the
  // assets table BEFORE joining to product_catalog, not after. Joining
  // assets straight onto product_catalog (one row per catalog item) fans
  // out to one row per PHYSICAL UNIT first (66k+ for a single center after
  // this session's full-history imports) and only collapses back down via
  // GROUP BY at the very end -- so every one of the dozen SUM/CASE/COALESCE
  // expressions here was being evaluated once per unit, not once per
  // catalog item. That fan-out was the actual dominant cost (7-14s per
  // request), independent of and on top of the image-payload issue above.
  // Pre-aggregating assets by catalog_id first (using the existing
  // idx_assets_catalog index) means those expressions run once per group,
  // and the join to product_catalog is against an already-small result.
  const rows = db.prepare(`
    SELECT pc.id AS catalog_id, pc.name, pc.unit, pc.reorder_point, pc.description, pc.classification_id, pc.tag_code, cl.name AS classification_name,
           COALESCE(ag.available, 0) AS available,
           COALESCE(ag.issued, 0) AS issued,
           COALESCE(ag.reserved, 0) AS reserved,
           COALESCE(ag.under_repair, 0) AS under_repair,
           COALESCE(ag.damaged, 0) AS damaged,
           COALESCE(ag.disposed, 0) AS disposed,
           COALESCE(ag.total, 0) AS total,
           CASE WHEN pc.image IS NOT NULL AND pc.image != '' THEN 1 ELSE 0 END AS has_image,
           COALESCE(ag.available_value, 0) AS available_value,
           COALESCE(ag.damaged_value, 0) AS damaged_value,
           COALESCE(ag.total_value, 0) AS total_value,
           COALESCE(ag.units_under_warranty, 0) AS units_under_warranty
    FROM product_catalog pc
    LEFT JOIN classifications cl ON cl.id = pc.classification_id
    LEFT JOIN (
      SELECT a.catalog_id,
             SUM(CASE WHEN a.status = 'available' THEN 1 ELSE 0 END) AS available,
             SUM(CASE WHEN a.status = 'issued' THEN 1 ELSE 0 END) AS issued,
             SUM(CASE WHEN a.status = 'reserved' THEN 1 ELSE 0 END) AS reserved,
             SUM(CASE WHEN a.status = 'under_repair' THEN 1 ELSE 0 END) AS under_repair,
             SUM(CASE WHEN a.status = 'damaged' THEN 1 ELSE 0 END) AS damaged,
             SUM(CASE WHEN a.status = 'disposed' THEN 1 ELSE 0 END) AS disposed,
             COUNT(*) AS total,
             SUM(CASE WHEN a.status = 'available' THEN a.unit_value ELSE 0 END) AS available_value,
             SUM(CASE WHEN a.status = 'damaged' THEN a.unit_value ELSE 0 END) AS damaged_value,
             SUM(CASE WHEN a.status != 'disposed' THEN a.unit_value ELSE 0 END) AS total_value,
             SUM(CASE WHEN a.has_warranty = 1 AND (a.warranty_until IS NULL OR a.warranty_until >= date('now')) THEN 1 ELSE 0 END) AS units_under_warranty
      FROM assets a
      JOIN product_catalog pc2 ON pc2.id = a.catalog_id
      WHERE pc2.center_id = ?
      GROUP BY a.catalog_id
    ) ag ON ag.catalog_id = pc.id
    WHERE pc.center_id = ?
    ORDER BY pc.name
  `).all(centerId, centerId);
  res.json(rows);
});

// Lazy per-item image fetch -- kept off the bulk catalog-summary payload
// (see the note above it) since a single catalog row's image is a cheap,
// single indexed lookup, but ALL of them together in one aggregate query
// is not.
router.get('/catalog/:catalogId/image', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  const row = db.prepare('SELECT image FROM product_catalog WHERE id = ? AND center_id = ?').get(req.params.catalogId, centerId);
  if (!row) return res.status(404).json({ message: 'Component not found.' });
  res.json({ image: row.image || null });
});

// Editable master details for a component type (name/description/photo/
// classification/tag code) -- shared across every physical unit under it.
// Renaming or reclassifying cascades to existing assets so displays stay
// consistent. asset_tag normally doesn't change once issued (it may already
// be printed on a physical label) -- but when a tag code is newly set or
// changed, the caller can opt in (retagExisting) to re-tag every existing
// unit under this catalog item to match, not just future ones.
// Applies the same name/description/image/classification/tag-code update to
// one product_catalog row and its assets, optionally retagging that row's
// units. Shared between the row being edited directly and every sibling row
// in other centers that needs to stay in sync.
// The ORIGINATING invoice line item for every asset currently grouped
// under this catalog id -- not just the assets' own .name column -- needs
// to carry the current name too. Without this, a renamed/merged
// component's invoice history (list, PDF, and the invoice detail's photo/
// description lookup) keeps showing the name it had at purchase time
// forever, AND -- more seriously -- increasing quantity on an old invoice
// later looks up its catalog row by that stale li.asset_name, finds
// nothing (the old name may no longer exist in product_catalog at all
// after a merge), and silently creates orphaned assets with catalog_id
// NULL that vanish from Inventory entirely.
function syncInvoiceLineItemNames(db, catalogId, name) {
  db.prepare(`
    UPDATE invoice_line_items SET asset_name = ?
    WHERE id IN (SELECT DISTINCT invoice_line_item_id FROM assets WHERE catalog_id = ? AND invoice_line_item_id IS NOT NULL)
  `).run(name, catalogId);
}

function applyCatalogEdit(db, row, fields) {
  db.prepare(`
    UPDATE product_catalog SET name = ?, description = ?, image = ?, classification_id = ?, tag_code = ?
      WHERE id = ?
  `).run(fields.name, fields.description || null, fields.image || null, fields.classificationId, fields.tagCode || null, row.id);
  db.prepare('UPDATE assets SET name = ?, classification_id = ? WHERE catalog_id = ?')
    .run(fields.name, fields.classificationId, row.id);
  if (fields.name !== row.name) syncInvoiceLineItemNames(db, row.id, fields.name);
}

// Two-phase rename of every unit under one catalog item to <TAGCODE>-01,
// -02, ... -- see the header comment on the retag block in the route below
// for why two-phase (placeholder first) is required at scale.
function retagCatalogUnits(db, catalogRow, fields) {
  const center = requireCenter(catalogRow.center_id);
  const classification = db.prepare('SELECT name FROM classifications WHERE id = ?').get(fields.classificationId);
  const abbr = classificationAbbr(classification.name);
  const units = db.prepare('SELECT id FROM assets WHERE catalog_id = ? ORDER BY added_date, id').all(catalogRow.id);
  const updateTag = db.prepare('UPDATE assets SET asset_tag = ? WHERE id = ?');
  units.forEach(unit => updateTag.run(`__retag_tmp__${unit.id}`, unit.id));
  units.forEach((unit, index) => {
    const newTag = `${center.code}/${abbr}/${fields.tagCode}-${String(index + 1).padStart(2, '0')}`;
    updateTag.run(newTag, unit.id);
  });
  return units.length;
}

// Renaming a component to a name that ALREADY belongs to another catalog
// item in the same center used to be rejected outright -- but that's
// exactly the situation an admin hits when cleaning up a duplicate (e.g.
// "Battery 9 V" and "Battery 9v" both exist and should be one component).
// Instead of blocking, merge: every physical unit under the row being
// renamed moves to the existing (surviving) row, which also picks up
// whatever other field changes (description/photo/classification/tag code)
// were part of this same edit, and the now-empty row is deleted. Each
// moved unit's own classification_id is left untouched (it's synced to
// that unit's own invoice, not the catalog -- see
// sync-classification-to-invoice.js) and its asset_tag doesn't change
// unless retagExisting is separately requested; only which catalog item
// groups it, and its display name, change. Returns how many units moved.
function mergeCatalogInto(db, fromRow, intoRow, fields, performedBy) {
  db.prepare(`
    UPDATE product_catalog SET description = ?, image = ?, classification_id = ?, tag_code = ? WHERE id = ?
  `).run(fields.description || null, fields.image || null, fields.classificationId, fields.tagCode || null, intoRow.id);

  const assets = db.prepare('SELECT id, status, center_id FROM assets WHERE catalog_id = ?').all(fromRow.id);
  const updateAsset = db.prepare('UPDATE assets SET catalog_id = ?, name = ? WHERE id = ?');
  const insertEvent = db.prepare(`
    INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by)
    VALUES (?, 'adjusted', ?, ?, ?, ?, ?)
  `);
  const note = `Merged from "${fromRow.name}" into "${fields.name}" (duplicate component names combined)`;
  for (const a of assets) {
    updateAsset.run(intoRow.id, fields.name, a.id);
    insertEvent.run(a.id, a.status, a.status, a.center_id, note, performedBy);
  }
  // The moved-in units' own originating invoices still say the OLD name --
  // relabel those line items too, same reasoning as syncInvoiceLineItemNames
  // above. The invoice line items that were already on intoRow are already
  // correctly named (that's the name being kept), so this only needs to
  // touch the ones that just moved over.
  db.prepare(`
    UPDATE invoice_line_items SET asset_name = ?
    WHERE id IN (SELECT DISTINCT invoice_line_item_id FROM assets WHERE id IN (${assets.map(() => '?').join(',')}) AND invoice_line_item_id IS NOT NULL)
  `).run(fields.name, ...assets.map(a => a.id));
  db.prepare('DELETE FROM product_catalog WHERE id = ?').run(fromRow.id);
  return assets.length;
}

router.put('/catalog/:catalogId', authMiddleware, superAdminOnly, (req, res) => {
  const db = getDb();
  const catalogId = Number(req.params.catalogId);
  const catalog = db.prepare('SELECT * FROM product_catalog WHERE id = ?').get(catalogId);
  if (!catalog) return res.status(404).json({ message: 'Component not found' });

  const { name, description, image, classificationId, tagCode, retagExisting } = req.body || {};
  const nextName = name !== undefined ? String(name).trim() : catalog.name;
  const nextDescription = description !== undefined ? description : catalog.description;
  const nextImage = image !== undefined ? image : catalog.image;
  const nextClassificationId = classificationId !== undefined ? Number(classificationId) : catalog.classification_id;
  const nextTagCode = tagCode !== undefined ? String(tagCode).trim().toUpperCase() : catalog.tag_code;
  const nameChanged = nextName !== catalog.name;

  if (!nextName) return res.status(400).json({ message: 'Name cannot be empty' });

  // All 9 centers currently mirror the same catalog structure -- a
  // component's definitional properties (name/description/photo/
  // classification/tag code) describe the physical item, not any one
  // center's copy of it, so editing them in one center must keep every
  // other center's matching row (found by the CURRENT, pre-edit name) in
  // sync too.
  const siblings = db.prepare('SELECT * FROM product_catalog WHERE name = ? AND center_id != ?').all(catalog.name, catalog.center_id);
  const fields = {
    name: nextName, description: nextDescription, image: nextImage, classificationId: nextClassificationId, tagCode: nextTagCode,
  };
  const propagatedCenters = [];
  const mergedCenters = [];
  let survivingCatalogId = catalogId;
  let mergedIntoName = null;
  let mergedAssetCount = 0;
  let retaggedCount = 0;

  db.exec('BEGIN TRANSACTION');
  try {
    const ownConflict = nameChanged
      ? db.prepare('SELECT * FROM product_catalog WHERE center_id = ? AND name = ? AND id != ?').get(catalog.center_id, nextName, catalogId)
      : null;
    if (ownConflict) {
      mergedAssetCount += mergeCatalogInto(db, catalog, ownConflict, fields, req.user.username);
      survivingCatalogId = ownConflict.id;
      mergedIntoName = ownConflict.name;
      if (retagExisting && fields.tagCode) retaggedCount += retagCatalogUnits(db, ownConflict, fields);
    } else {
      applyCatalogEdit(db, catalog, fields);
      if (retagExisting && fields.tagCode) retaggedCount += retagCatalogUnits(db, catalog, fields);
    }

    for (const sibling of siblings) {
      const siblingConflict = nameChanged
        ? db.prepare('SELECT * FROM product_catalog WHERE center_id = ? AND name = ? AND id != ?').get(sibling.center_id, nextName, sibling.id)
        : null;
      if (siblingConflict) {
        const moved = mergeCatalogInto(db, sibling, siblingConflict, fields, req.user.username);
        mergedCenters.push({ centerId: sibling.center_id, intoName: siblingConflict.name, assetsMoved: moved });
        if (retagExisting && fields.tagCode) retagCatalogUnits(db, siblingConflict, fields);
        continue;
      }
      applyCatalogEdit(db, sibling, fields);
      if (retagExisting && fields.tagCode) retagCatalogUnits(db, sibling, fields);
      propagatedCenters.push(sibling.center_id);
    }

    db.exec('COMMIT');
    res.json({
      ...db.prepare('SELECT * FROM product_catalog WHERE id = ?').get(survivingCatalogId),
      retaggedCount,
      propagatedCenters,
      mergedIntoName,
      mergedAssetCount,
      mergedCenters,
    });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ message: err.message });
  }
});

// Deletes a component from the catalog entirely -- every center's mirrored
// row, not just this one, since they're meant to describe the same physical
// item. Only allowed when NO center has any stock/history under it, so this
// can only clean up a mistakenly-created entry, never destroy real inventory
// or the audit trail behind it (use Dispose for that).
router.delete('/catalog/:catalogId', authMiddleware, superAdminOnly, async (req, res) => {
  const db = getDb();
  const catalog = db.prepare('SELECT * FROM product_catalog WHERE id = ?').get(req.params.catalogId);
  if (!catalog) return res.status(404).json({ message: 'Component not found' });

  const siblings = db.prepare('SELECT id, center_id FROM product_catalog WHERE name = ?').all(catalog.name);
  const centersWithStock = siblings
    .filter(sibling => db.prepare('SELECT COUNT(*) c FROM assets WHERE catalog_id = ?').get(sibling.id).c > 0)
    .map(sibling => sibling.center_id);
  if (centersWithStock.length) {
    return res.status(409).json({
      message: `Cannot delete "${catalog.name}": stock exists at ${centersWithStock.join(', ')}. Dispose those units first if they're no longer needed.`,
    });
  }

  db.exec('BEGIN TRANSACTION');
  try {
    for (const sibling of siblings) {
      db.prepare('DELETE FROM product_catalog WHERE id = ?').run(sibling.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ message: err.message });
  }

  await logActivity('DELETE_CATALOG_ITEM', req.user.username, {
    role: req.user.role, centerId: catalog.center_id, info: `Deleted component "${catalog.name}" from all centers`,
  });
  res.json({ message: `Deleted "${catalog.name}" from all centers`, deletedCenters: siblings.map(s => s.center_id) });
});

// Lifecycle transitions an admin can trigger directly from the inventory
// view. Issue/return/reserve transitions belong to the order flow, not here.
const ALLOWED_TRANSITIONS = {
  available: { damaged: 'damaged', under_repair: 'repair_started' },
  // available: a correction path for when a unit was marked damaged by
  // mistake, or the student came back later with it in good condition
  // after all -- distinct from the repair path (which implies real work
  // was done on it).
  damaged: { under_repair: 'repair_started', disposed: 'disposed', available: 'adjusted' },
  under_repair: { available: 'repair_completed', disposed: 'disposed' },
  // Disposal sometimes happens by mistake -- let an admin walk it back to
  // available rather than leaving "disposed" as a dead end.
  disposed: { available: 'adjusted' },
};

// A damaged -> available correction only changes assets.status -- it does
// NOT by itself fix the stale "Damaged" count an order/internal-issue keeps
// showing in its return summary (order_return_items / internal_issue_return_items
// are append-only ledgers, summed at read time; nothing else re-derives them
// from current asset status). This finds whichever order or internal-issue
// currently holds this asset and appends a compensating +1 returned / -1
// damaged row, so the summary the admin/student see actually reflects the
// correction. Returns the matched issue_record_id (for orders) so the
// lifecycle event can be tied back to it, or null if this asset isn't
// currently linked to any tracked order/internal-issue.
function reconcileReturnSummaryAfterCorrection(db, assetId, now) {
  const orderLink = db.prepare(`
    SELECT ira.id AS linkId, iri.id AS itemId, ir.id AS issueRecordId, ir.order_id AS orderId
    FROM issue_record_assets ira
    JOIN issue_record_items iri ON iri.id = ira.issue_record_item_id
    JOIN issue_records ir ON ir.id = iri.issue_record_id
    WHERE ira.asset_id = ?
    ORDER BY ir.created_at DESC LIMIT 1
  `).get(assetId);
  if (orderLink) {
    db.prepare("UPDATE issue_record_assets SET condition_on_return = 'good' WHERE id = ?").run(orderLink.linkId);
    db.prepare(`
      INSERT INTO order_return_items (issue_record_item_id, returned_qty, damaged_qty, pending_qty, recorded_at)
      VALUES (?, 1, -1, 0, ?)
    `).run(orderLink.itemId, now);
    return { issueRecordId: orderLink.issueRecordId, orderId: orderLink.orderId };
  }

  const internalLink = db.prepare(`
    SELECT iia.id AS linkId, iii.id AS itemId, ii.id AS issueId, ii.issue_code AS issueCode
    FROM internal_issue_assets iia
    JOIN internal_issue_items iii ON iii.id = iia.internal_issue_item_id
    JOIN internal_issues ii ON ii.id = iii.internal_issue_id
    WHERE iia.asset_id = ?
    ORDER BY ii.issued_at DESC LIMIT 1
  `).get(assetId);
  if (internalLink) {
    db.prepare("UPDATE internal_issue_assets SET condition_on_return = 'good' WHERE id = ?").run(internalLink.linkId);
    db.prepare(`
      INSERT INTO internal_issue_return_items (internal_issue_item_id, returned_good_qty, returned_damaged_qty, recorded_at)
      VALUES (?, 1, -1, ?)
    `).run(internalLink.itemId, now);
    return { internalIssueId: internalLink.issueId, internalIssueCode: internalLink.issueCode };
  }

  return null;
}

// Marking something damaged needs to say which program was responsible --
// either an existing tracked Program (projectId) or free text for one-off
// exceptional cases (otherProgram). Other transitions don't need this.
function transitionAsset(db, assetId, toStatus, performedBy, { notes, projectId, otherProgram } = {}) {
  const asset = db.prepare('SELECT id, status, center_id FROM assets WHERE id = ?').get(assetId);
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  const eventType = ALLOWED_TRANSITIONS[asset.status]?.[toStatus];
  if (!eventType) throw new Error(`Cannot move asset from "${asset.status}" to "${toStatus}"`);

  let resolvedProjectId = null;
  let programNote = null;
  if (toStatus === 'damaged') {
    if (projectId) {
      const program = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId);
      if (!program) throw new Error(`Program ${projectId} not found`);
      resolvedProjectId = program.id;
      programNote = `Program: ${program.name}`;
    } else if (otherProgram && String(otherProgram).trim()) {
      programNote = `Program: ${String(otherProgram).trim()} (other)`;
    } else {
      throw new Error('Select which program the damage happened in (or choose "Other" and describe it)');
    }
  }
  // A damaged -> available correction is reversing a prior determination --
  // require an explanation for the audit trail, same spirit as the
  // asset-swap feature's mandatory reason.
  const isReturnCorrection = asset.status === 'damaged' && toStatus === 'available';
  if (isReturnCorrection && !String(notes || '').trim()) {
    throw new Error('A reason is required to correct this unit back to available');
  }

  db.prepare('UPDATE assets SET status = ? WHERE id = ?').run(toStatus, assetId);

  const now = new Date().toISOString();
  const reconciled = isReturnCorrection ? reconcileReturnSummaryAfterCorrection(db, assetId, now) : null;
  const correctionNote = reconciled?.orderId ? `Corrected for order ${reconciled.orderId}`
    : reconciled?.internalIssueCode ? `Corrected for internal use ${reconciled.internalIssueCode}`
    : null;

  db.prepare(`
    INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, issue_record_id, center_id, notes, performed_by, project_id, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(assetId, eventType, asset.status, toStatus, reconciled?.issueRecordId || null, asset.center_id,
         [programNote, correctionNote, notes].filter(Boolean).join(' -- ') || null, performedBy || null, resolvedProjectId, now);
  return { id: assetId, from: asset.status, to: toStatus };
}

router.put('/:id/status', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const { toStatus, notes, projectId, otherProgram } = req.body || {};
  if (!toStatus) return res.status(400).json({ message: 'toStatus is required' });
  try {
    const result = transitionAsset(db, req.params.id, toStatus, req.user.username, { notes, projectId, otherProgram });
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Bulk transition: move N units of a catalog item from one status to another,
// e.g. "mark 3 available units as damaged" -- the inventory-page equivalent
// of the old stock +/- buttons, but as a real lifecycle event per unit.
router.put('/bulk-status', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  const { catalogId, fromStatus, toStatus, count, notes, projectId, otherProgram } = req.body || {};
  const n = Number(count);
  if (!centerId || !catalogId || !fromStatus || !toStatus || !n || n <= 0) {
    return res.status(400).json({ message: 'centerId, catalogId, fromStatus, toStatus and a positive count are required' });
  }

  // FIFO by invoice date, oldest first -- when a bulk action can't identify
  // which physical units are really damaged, the most defensible guess is
  // that older stock is the more likely candidate, not an arbitrary DB scan
  // order. Assets with no invoice on record (legacy/manual entries) sort
  // last, behind every dated unit. Single-unit transitions (PUT /:id/status)
  // are unaffected -- there the admin has already picked one exact tag.
  const candidates = db.prepare(`
    SELECT a.id FROM assets a
    LEFT JOIN invoice_line_items ili ON ili.id = a.invoice_line_item_id
    LEFT JOIN invoices inv ON inv.id = ili.invoice_id
    WHERE a.catalog_id = ? AND a.center_id = ? AND a.status = ?
    ORDER BY inv.invoice_date IS NULL ASC, inv.invoice_date ASC
    LIMIT ?
  `).all(catalogId, centerId, fromStatus, n);
  if (candidates.length < n) {
    return res.status(400).json({ message: `Only ${candidates.length} unit(s) are currently "${fromStatus}" -- cannot move ${n}.` });
  }

  db.exec('BEGIN TRANSACTION');
  try {
    for (const row of candidates) {
      transitionAsset(db, row.id, toStatus, req.user.username, { notes, projectId, otherProgram });
    }
    db.exec('COMMIT');
    res.json({ updated: candidates.length });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ message: err.message });
  }
});

// Other available units of the same component, for the swap picker shared
// by Orders, Internal Use, and Transfers.
router.get('/swap-candidates', authMiddleware, adminOnly, (req, res) => {
  const { catalogId, excludeAssetId } = req.query;
  if (!catalogId) return res.status(400).json({ message: 'catalogId is required' });
  res.json(findSwapCandidates(getDb(), catalogId, excludeAssetId || ''));
});

router.get('/critical', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  if (!centerId) return res.json([]);
  const rows = db.prepare(`
    SELECT id, asset_tag, name, serial_number, status FROM assets
    WHERE center_id = ? AND serial_number IS NOT NULL
    ORDER BY name
  `).all(centerId);
  res.json(rows);
});

// Live asset-value totals for the Dashboard. super_admin with no centerId
// gets the sum across every center; a fixed-center admin always gets their
// own center regardless of query params. Scoped by the asset's CURRENT
// center_id (not the originating invoice's center), so a transferred-in
// unit counts toward whichever center physically holds it today.
router.get('/value-summary', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = req.user.role === 'super_admin' ? String(req.query.centerId || '').trim() : req.user.centerId;

  const byHeadRows = db.prepare(`
    SELECT
      COALESCE(bh.id, 0) AS businessHeadId,
      COALESCE(bh.name, 'Unspecified') AS businessHeadName,
      COALESCE(SUM(CASE WHEN a.status = 'available' THEN a.unit_value ELSE 0 END), 0) AS available_value,
      COALESCE(SUM(CASE WHEN a.status = 'damaged' THEN a.unit_value ELSE 0 END), 0) AS damaged_value,
      COALESCE(SUM(CASE WHEN a.status != 'disposed' THEN a.unit_value ELSE 0 END), 0) AS total_value,
      COALESCE(SUM(CASE WHEN a.status = 'available' THEN a.unit_value * (1 + COALESCE(ili.gst_percent, 0) / 100.0) ELSE 0 END), 0) AS available_value_with_gst,
      COALESCE(SUM(CASE WHEN a.status = 'damaged' THEN a.unit_value * (1 + COALESCE(ili.gst_percent, 0) / 100.0) ELSE 0 END), 0) AS damaged_value_with_gst,
      COALESCE(SUM(CASE WHEN a.status != 'disposed' THEN a.unit_value * (1 + COALESCE(ili.gst_percent, 0) / 100.0) ELSE 0 END), 0) AS total_value_with_gst
    FROM assets a
    LEFT JOIN invoice_line_items ili ON ili.id = a.invoice_line_item_id
    LEFT JOIN invoices inv ON inv.id = ili.invoice_id
    LEFT JOIN business_heads bh ON bh.id = inv.business_head_id
    ${centerId ? 'WHERE a.center_id = ?' : ''}
    GROUP BY COALESCE(bh.id, 0)
  `).all(...(centerId ? [centerId] : []));

  const zeroTotals = () => ({
    available_value: 0, damaged_value: 0, total_value: 0,
    available_value_with_gst: 0, damaged_value_with_gst: 0, total_value_with_gst: 0,
  });
  const combined = byHeadRows.reduce((acc, row) => {
    acc.available_value += row.available_value;
    acc.damaged_value += row.damaged_value;
    acc.total_value += row.total_value;
    acc.available_value_with_gst += row.available_value_with_gst;
    acc.damaged_value_with_gst += row.damaged_value_with_gst;
    acc.total_value_with_gst += row.total_value_with_gst;
    return acc;
  }, zeroTotals());

  // Always surface every real business head (even at zero) so the dashboard
  // split-screen has a stable two-column layout; only show "Unspecified" if
  // something actually landed there (a real data-quality signal to fix).
  const realHeads = db.prepare("SELECT id, name FROM business_heads WHERE name != 'Unspecified' ORDER BY name").all();
  const byId = new Map(byHeadRows.map(r => [r.businessHeadId, r]));
  const byBusinessHead = realHeads.map(head => {
    const found = byId.get(head.id);
    return found
      ? { businessHeadId: head.id, businessHeadName: head.name, ...found }
      : { businessHeadId: head.id, businessHeadName: head.name, ...zeroTotals() };
  });
  const unspecified = byHeadRows.find(r => r.businessHeadName === 'Unspecified' && r.total_value > 0);
  if (unspecified) byBusinessHead.push(unspecified);

  // Same shape/pattern as byBusinessHead above, grouped by the asset's own
  // classification_id instead -- an independent breakdown of the same
  // totals, not crossed with business head.
  const byClassRows = db.prepare(`
    SELECT
      a.classification_id AS classificationId,
      COALESCE(SUM(CASE WHEN a.status = 'available' THEN a.unit_value ELSE 0 END), 0) AS available_value,
      COALESCE(SUM(CASE WHEN a.status = 'damaged' THEN a.unit_value ELSE 0 END), 0) AS damaged_value,
      COALESCE(SUM(CASE WHEN a.status != 'disposed' THEN a.unit_value ELSE 0 END), 0) AS total_value,
      COALESCE(SUM(CASE WHEN a.status = 'available' THEN a.unit_value * (1 + COALESCE(ili.gst_percent, 0) / 100.0) ELSE 0 END), 0) AS available_value_with_gst,
      COALESCE(SUM(CASE WHEN a.status = 'damaged' THEN a.unit_value * (1 + COALESCE(ili.gst_percent, 0) / 100.0) ELSE 0 END), 0) AS damaged_value_with_gst,
      COALESCE(SUM(CASE WHEN a.status != 'disposed' THEN a.unit_value * (1 + COALESCE(ili.gst_percent, 0) / 100.0) ELSE 0 END), 0) AS total_value_with_gst
    FROM assets a
    LEFT JOIN invoice_line_items ili ON ili.id = a.invoice_line_item_id
    ${centerId ? 'WHERE a.center_id = ?' : ''}
    GROUP BY a.classification_id
  `).all(...(centerId ? [centerId] : []));

  const allClassifications = db.prepare('SELECT id, name FROM classifications ORDER BY sort_order').all();
  const byClassId = new Map(byClassRows.map(r => [r.classificationId, r]));
  const byClassification = allClassifications.map(cls => {
    const found = byClassId.get(cls.id);
    return found
      ? { classificationId: cls.id, classificationName: cls.name, ...found }
      : { classificationId: cls.id, classificationName: cls.name, ...zeroTotals() };
  });

  res.json({ ...combined, byBusinessHead, byClassification });
});

// What a scanned QR label resolves to. Tags are unique across the org, so
// the lookup is by tag alone; a center admin only gets units of their own
// center back. Includes the order currently holding the unit, if issued, so
// the scan screen can jump straight to it.
router.get('/by-tag/:tag', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const tag = String(req.params.tag || '').trim();
  if (!tag) return res.status(400).json({ message: 'No tag scanned' });

  const asset = db.prepare(`
    SELECT a.*, c.name AS classification_name, ctr.name AS center_name, pc.image AS catalog_image
    FROM assets a
    JOIN classifications c ON c.id = a.classification_id
    JOIN centers ctr ON ctr.id = a.center_id
    LEFT JOIN product_catalog pc ON pc.id = a.catalog_id
    WHERE UPPER(a.asset_tag) = UPPER(?)
  `).get(tag);
  if (!asset) return res.status(404).json({ message: `No unit with tag "${tag}"` });
  if (req.user.role !== 'super_admin' && asset.center_id !== req.user.centerId) {
    return res.status(403).json({ message: `Tag "${tag}" belongs to ${asset.center_name}, not your center` });
  }

  // The open order holding this unit (issued / reserved), if any.
  const holder = db.prepare(`
    SELECT ir.order_id, ir.status, ir.expected_return_date, ir.issued_at,
           COALESCE(s.full_name, u.full_name) AS student_name, u.username AS student_username
    FROM issue_record_assets ira
    JOIN issue_record_items iri ON iri.id = ira.issue_record_item_id
    JOIN issue_records ir ON ir.id = iri.issue_record_id
    LEFT JOIN students s ON s.id = ir.student_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE ira.asset_id = ? AND ir.status NOT IN ('Returned', 'Rejected')
    ORDER BY ir.created_at DESC LIMIT 1
  `).get(asset.id);

  const lastEvent = db.prepare(
    'SELECT event_type, to_status, occurred_at, performed_by, notes FROM asset_lifecycle_events WHERE asset_id = ? ORDER BY occurred_at DESC LIMIT 1'
  ).get(asset.id);

  res.json({ ...asset, holder: holder || null, lastEvent: lastEvent || null });
});

router.get('/:id', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const asset = db.prepare(`
    SELECT a.*, c.name AS classification_name
    FROM assets a JOIN classifications c ON c.id = a.classification_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!asset) return res.status(404).json({ message: 'Asset not found' });

  const history = db.prepare(`
    SELECT * FROM asset_lifecycle_events WHERE asset_id = ? ORDER BY occurred_at ASC
  `).all(asset.id);
  res.json({ ...asset, history });
});

// Direct corrections to a single unit: serial number, location, unit price,
// and asset tag (e.g. once a center brings in its own tagging scheme via
// spreadsheet). Not for status/classification changes -- those go through
// dedicated lifecycle routes so history stays meaningful.
router.put('/:id', authMiddleware, superAdminOnly, (req, res) => {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ message: 'Asset not found' });

  const { assetTag, serialNumber, location, unitValue, notes, hasWarranty, warrantyUntil } = req.body || {};
  const nextAssetTag = assetTag !== undefined ? String(assetTag).trim() : asset.asset_tag;
  if (assetTag !== undefined && !nextAssetTag) {
    return res.status(400).json({ message: 'Asset tag cannot be empty' });
  }
  if (assetTag !== undefined && nextAssetTag !== asset.asset_tag) {
    const conflict = db.prepare('SELECT id FROM assets WHERE asset_tag = ? AND id != ?').get(nextAssetTag, asset.id);
    if (conflict) return res.status(409).json({ message: `Asset tag "${nextAssetTag}" is already in use by another unit` });
  }

  const changes = [];
  const nextSerial = serialNumber !== undefined ? (serialNumber || null) : asset.serial_number;
  const nextLocation = location !== undefined ? (location || null) : asset.location;
  const nextUnitValue = unitValue !== undefined ? (unitValue === null || unitValue === '' ? null : Number(unitValue)) : asset.unit_value;
  const nextHasWarranty = hasWarranty !== undefined ? !!hasWarranty : !!asset.has_warranty;
  const nextWarrantyUntil = nextHasWarranty
    ? String((warrantyUntil !== undefined ? warrantyUntil : asset.warranty_until) || '').trim()
    : null;
  if (hasWarranty !== undefined && nextHasWarranty && !nextWarrantyUntil) {
    return res.status(400).json({ message: 'Warranty end date is required when warranty is marked as yes' });
  }

  if (assetTag !== undefined && nextAssetTag !== asset.asset_tag) changes.push(`asset tag: "${asset.asset_tag}" -> "${nextAssetTag}"`);
  if (serialNumber !== undefined && nextSerial !== asset.serial_number) changes.push(`serial: "${asset.serial_number || '-'}" -> "${nextSerial || '-'}"`);
  if (location !== undefined && nextLocation !== asset.location) changes.push(`location: "${asset.location || '-'}" -> "${nextLocation || '-'}"`);
  if (unitValue !== undefined && nextUnitValue !== asset.unit_value) changes.push(`unit price: ${asset.unit_value ?? '-'} -> ${nextUnitValue ?? '-'}`);
  if (hasWarranty !== undefined && (nextHasWarranty !== !!asset.has_warranty || nextWarrantyUntil !== asset.warranty_until)) {
    changes.push(`warranty: "${asset.has_warranty ? asset.warranty_until : 'none'}" -> "${nextHasWarranty ? nextWarrantyUntil : 'none'}"`);
  }

  if (!changes.length) return res.json(asset);

  db.prepare('UPDATE assets SET asset_tag = ?, serial_number = ?, location = ?, unit_value = ?, has_warranty = ?, warranty_until = ? WHERE id = ?')
    .run(nextAssetTag, nextSerial, nextLocation, nextUnitValue, nextHasWarranty ? 1 : 0, nextWarrantyUntil, asset.id);
  db.prepare(`
    INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by)
    VALUES (?, 'adjusted', ?, ?, ?, ?, ?)
  `).run(asset.id, asset.status, asset.status, asset.center_id, notes || changes.join('; '), req.user.username);

  res.json(db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id));
});

// Removes a single physical unit entirely -- for a mistaken duplicate entry,
// not for retiring a real one (that's Dispose, which keeps the history).
// Blocked while the unit is part of a live transaction, or if it has ever
// been issued or transferred, so a deletion can never leave a dangling
// reference in someone's order/transfer history.
router.delete('/:id', authMiddleware, superAdminOnly, async (req, res) => {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ message: 'Asset not found' });

  if (['issued', 'reserved', 'return_requested'].includes(asset.status)) {
    return res.status(409).json({ message: `Cannot delete: this unit is currently ${asset.status}` });
  }
  const issueHistory = db.prepare('SELECT COUNT(*) c FROM issue_record_assets WHERE asset_id = ?').get(asset.id).c;
  const transferHistory = db.prepare('SELECT COUNT(*) c FROM transfer_item_assets WHERE asset_id = ?').get(asset.id).c;
  if (issueHistory > 0 || transferHistory > 0) {
    return res.status(409).json({ message: 'Cannot delete: this unit has issue/transfer history. Use Dispose instead to keep the record.' });
  }

  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('DELETE FROM asset_lifecycle_events WHERE asset_id = ?').run(asset.id);
    db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ message: err.message });
  }

  await logActivity('DELETE_ASSET', req.user.username, {
    role: req.user.role, centerId: asset.center_id, info: `Deleted unit ${asset.asset_tag} (${asset.name})`,
  });
  res.json({ message: `Deleted unit ${asset.asset_tag}` });
});

module.exports = router;
module.exports.extractDamageProgram = extractDamageProgram;
module.exports.extractDamageReason = extractDamageReason;
