// Every flow that auto-assigns specific asset units (Orders, Internal Use,
// Transfers) picks them the same simple way -- the first N available rows
// for that catalog item. If the physical unit the system picked can't
// actually be found (mislabeled, misplaced, whatever), this lets an admin
// swap in a different available unit of the same component instead of
// being stuck. The original unit goes back to Available (assumed misplaced,
// not confirmed lost -- if it really is lost, that's handled separately via
// the existing Dispose flow).

// Other available units of the same component, for the swap picker.
function findSwapCandidates(db, catalogId, excludeAssetId) {
  return db.prepare(`
    SELECT id, asset_tag AS assetTag, serial_number AS serialNumber
    FROM assets WHERE catalog_id = ? AND status = 'available' AND id != ?
    ORDER BY asset_tag
  `).all(catalogId, excludeAssetId);
}

// Caller must already be inside a transaction (or not care about atomicity
// with whatever else it's doing) -- this issues two UPDATEs and two INSERTs
// with no transaction control of its own, matching how the rest of this
// codebase's shared helpers (e.g. applyCatalogEdit) work.
//
// allowedOldStatuses defaults to Orders/Internal Use's world (a unit that's
// reserved/issued against a line item). Transfers is the odd one out --
// transferred units stay "available" the whole time (only center_id/
// catalog_id move), so its endpoint passes ['available'] instead. Either
// way the old unit ends up back at 'available' and the new one takes over
// whatever the old one's status was.
function swapAsset(db, { oldAssetId, newAssetId, centerId, performedBy, reason }, allowedOldStatuses = ['reserved', 'issued']) {
  const oldAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(oldAssetId);
  if (!oldAsset) throw new Error('Original asset not found');
  if (!allowedOldStatuses.includes(oldAsset.status)) {
    throw new Error(`Original asset is currently "${oldAsset.status}", not ${allowedOldStatuses.join('/')} -- cannot swap`);
  }
  const newAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(newAssetId);
  if (!newAsset) throw new Error('Replacement asset not found');
  if (newAsset.id === oldAsset.id) throw new Error('Replacement must be a different unit');
  if (newAsset.catalog_id !== oldAsset.catalog_id) throw new Error('Replacement must be the same component');
  if (newAsset.status !== 'available') throw new Error(`Replacement asset is currently "${newAsset.status}", not available`);

  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw new Error('A reason is required for the swap');

  const now = new Date().toISOString();
  const targetStatus = oldAsset.status;

  db.prepare('UPDATE assets SET status = ? WHERE id = ?').run(targetStatus, newAssetId);
  db.prepare('UPDATE assets SET status = ? WHERE id = ?').run('available', oldAssetId);

  db.prepare(`
    INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
    VALUES (?, 'adjusted', ?, 'available', ?, ?, ?, ?)
  `).run(oldAssetId, targetStatus, centerId, `Swapped out -- not found (${trimmedReason}). Replaced by ${newAsset.asset_tag}.`, performedBy, now);
  db.prepare(`
    INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
    VALUES (?, 'adjusted', 'available', ?, ?, ?, ?, ?)
  `).run(newAssetId, targetStatus, centerId, `Swapped in to replace ${oldAsset.asset_tag} -- not found (${trimmedReason}).`, performedBy, now);

  return { oldAsset, newAsset: { ...newAsset, status: targetStatus } };
}

module.exports = { findSwapCandidates, swapAsset };
