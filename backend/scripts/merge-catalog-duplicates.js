// One-off cleanup: multiple catalog rows exist for what is really the same
// physical component (inconsistent capitalization/wording across the four
// separate procurement waves the July 2026 spreadsheet consolidated).
// Confirmed with the user group-by-group before running for real.
//
// Each group moves every asset (and any dormant transfer_items/
// issue_record_items rows) from the "merge from" catalog id(s) onto the
// "keep" id, backfills the keeper's description/image/tag_code from the
// merged-away rows if the keeper doesn't already have one, then deletes the
// now-empty duplicate rows. Nothing about individual assets' own invoice
// history, value, or lifecycle events changes -- they just point at one
// consolidated catalog row instead of several, so total quantity is
// preserved exactly (sum of all merged rows).
//
// Usage: node merge-catalog-duplicates.js <db-path> [--apply]

const { openDatabase } = require('../utils/db');

const MERGE_GROUPS = [
  { keepId: 6403, mergeFromIds: [5861, 6129] },                 // Buzzer 5V / Buzzer 5v / 5V Buzzer
  { keepId: 6564, mergeFromIds: [5910] },                       // Micro USB B Type
  { keepId: 5921, mergeFromIds: [5983] },                       // Raspberry Pi Heat Sink
  { keepId: 6088, mergeFromIds: [5929, 6402] },                 // Red LED / Red Led / LED Red
  { keepId: 6019, mergeFromIds: [5937] },                       // BO Wheels
  { keepId: 6563, mergeFromIds: [6093] },                       // Arduino UNO Cable
  { keepId: 5852, mergeFromIds: [6420], renameTo: 'Headless Nails 3/4 Inch' },
  { keepId: 5853, mergeFromIds: [6421], renameTo: 'Headless Nails 1 Inch' },
  { keepId: 6086, mergeFromIds: [6413] },                       // Green LED
  { keepId: 6087, mergeFromIds: [6412] },                       // Yellow LED
  { keepId: 5922, mergeFromIds: [5982] },                       // Raspberry Pi Fan
  { keepId: 6427, mergeFromIds: [5956] },                       // Wood Stain (Walnut)
  { keepId: 6355, mergeFromIds: [6310] },                       // Leather Hand Gloves
  { keepId: 6162, mergeFromIds: [5923] },                       // Raspberry Pi 4 Case
  { keepId: 6160, mergeFromIds: [5920] },                       // Raspberry Pi 4B 4GB Board
];

function run(dbPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const report = { groups: [], applied: false, fatalError: null };

  db.exec('BEGIN TRANSACTION');
  try {
    for (const group of MERGE_GROUPS) {
      const keeper = db.prepare('SELECT * FROM product_catalog WHERE id = ?').get(group.keepId);
      if (!keeper) throw new Error(`Keeper catalog id ${group.keepId} not found`);

      const groupReport = { keepId: group.keepId, keeperName: keeper.name, beforeAssetCount: null, merged: [] };
      groupReport.beforeAssetCount = db.prepare('SELECT COUNT(*) c FROM assets WHERE catalog_id = ?').get(group.keepId).c;

      let newDescription = keeper.description;
      let newImage = keeper.image;
      let newTagCode = keeper.tag_code;

      for (const fromId of group.mergeFromIds) {
        const fromRow = db.prepare('SELECT * FROM product_catalog WHERE id = ?').get(fromId);
        if (!fromRow) throw new Error(`Merge-from catalog id ${fromId} not found`);
        if (fromRow.center_id !== keeper.center_id) {
          throw new Error(`Center mismatch: catalog ${fromId} is ${fromRow.center_id}, keeper ${group.keepId} is ${keeper.center_id}`);
        }

        const assetsMoved = db.prepare('UPDATE assets SET catalog_id = ? WHERE catalog_id = ?').run(group.keepId, fromId).changes;
        const transferItemsMoved = db.prepare('UPDATE transfer_items SET catalog_id = ? WHERE catalog_id = ?').run(group.keepId, fromId).changes;
        const issueItemsMoved = db.prepare('UPDATE issue_record_items SET catalog_id = ? WHERE catalog_id = ?').run(group.keepId, fromId).changes;

        if (!newDescription && fromRow.description) newDescription = fromRow.description;
        if (!newImage && fromRow.image) newImage = fromRow.image;
        if (!newTagCode && fromRow.tag_code) newTagCode = fromRow.tag_code;

        db.prepare('DELETE FROM product_catalog WHERE id = ?').run(fromId);
        groupReport.merged.push({ id: fromId, name: fromRow.name, assetsMoved, transferItemsMoved, issueItemsMoved });
      }

      if (newDescription !== keeper.description || newImage !== keeper.image || newTagCode !== keeper.tag_code) {
        db.prepare('UPDATE product_catalog SET description = ?, image = ?, tag_code = ? WHERE id = ?')
          .run(newDescription, newImage, newTagCode, group.keepId);
      }
      if (group.renameTo && group.renameTo !== keeper.name) {
        db.prepare('UPDATE product_catalog SET name = ? WHERE id = ?').run(group.renameTo, group.keepId);
        groupReport.renamedTo = group.renameTo;
      }

      groupReport.afterAssetCount = db.prepare('SELECT COUNT(*) c FROM assets WHERE catalog_id = ?').get(group.keepId).c;
      report.groups.push(groupReport);
    }

    if (apply) {
      db.exec('COMMIT');
      report.applied = true;
    } else {
      db.exec('ROLLBACK');
    }
  } catch (err) {
    db.exec('ROLLBACK');
    report.fatalError = err.message;
  }

  return report;
}

module.exports = { run, MERGE_GROUPS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath] = args.filter(a => a !== '--apply');
  if (!dbPath) {
    console.error('Usage: node merge-catalog-duplicates.js <db-path> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, { apply }), null, 2));
}
