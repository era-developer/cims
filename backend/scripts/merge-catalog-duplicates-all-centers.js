// Extends merge-catalog-duplicates.js's cleanup to the other 8 centers,
// which still mirror JP Nagar's PRE-merge catalog structure (623 items,
// including the same 17 duplicate rows) because that merge only ran
// against JP Nagar's specific catalog ids. Since these centers currently
// hold zero stock, this is just deleting the duplicate empty rows -- no
// assets to reassign in practice, but it's still done defensively via name
// lookup per center in case that ever changes.
//
// Usage: node merge-catalog-duplicates-all-centers.js <db-path> [--apply]

const { openDatabase } = require('../utils/db');
const { CENTERS } = require('./legacy-centers');

// Name-based version of merge-catalog-duplicates.js's MERGE_GROUPS (that
// script hardcodes JP Nagar's specific row ids, which differ per center).
const MERGE_GROUPS_BY_NAME = [
  { keepName: 'Buzzer 5V', mergeFromNames: ['Buzzer 5v', '5V Buzzer'] },
  { keepName: 'Micro USB B Type', mergeFromNames: ['Micro Usb B Type'] },
  { keepName: 'Raspberry Pi Heat Sink', mergeFromNames: ['Raspberry pi Heat Sink'] },
  { keepName: 'Red LED', mergeFromNames: ['Red Led', 'LED Red'] },
  { keepName: 'BO Wheels', mergeFromNames: ['Bo Wheels'] },
  { keepName: 'Arduino UNO Cable', mergeFromNames: ['Arduino Uno Cable'] },
  { keepName: 'Headless Nails   3/4 Inch', mergeFromNames: ['Headless Nails 3/4 Inch'], renameTo: 'Headless Nails 3/4 Inch' },
  { keepName: 'Headless Nails  1 Inch', mergeFromNames: ['Headless Nails 1 Inch'], renameTo: 'Headless Nails 1 Inch' },
  { keepName: 'Green LED', mergeFromNames: ['LED-Green'] },
  { keepName: 'Yellow LED', mergeFromNames: ['LED-Yellow'] },
  { keepName: 'Raspberry Pi Fan', mergeFromNames: ['Raspberry pi cooling fan'] },
  { keepName: 'Wood Stain (Walnut)', mergeFromNames: ['Wood Stain Walnut 100Ml'] },
  { keepName: 'Leather Hand Gloves', mergeFromNames: ['Leather Hand Gloves New'] },
  { keepName: 'Raspberry Pi 4 Case', mergeFromNames: ['Raspberry Pi Case'] },
  { keepName: 'Raspberry Pi 4B 4GB Board', mergeFromNames: ['Raspberry Pi Board'] },
];

function run(dbPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const report = { centers: [], applied: false, fatalError: null };

  db.exec('BEGIN TRANSACTION');
  try {
    for (const center of CENTERS) {
      if (center.id === 'jp_nagar') continue; // already merged
      const centerReport = { centerId: center.id, groups: [] };

      for (const group of MERGE_GROUPS_BY_NAME) {
        const keeper = db.prepare('SELECT * FROM product_catalog WHERE center_id = ? AND name = ?').get(center.id, group.keepName);
        if (!keeper) continue; // this center never had this name to begin with -- fine, skip

        const groupReport = { keepName: group.keepName, merged: [] };
        let newDescription = keeper.description;
        let newImage = keeper.image;
        let newTagCode = keeper.tag_code;

        for (const fromName of group.mergeFromNames) {
          const fromRow = db.prepare('SELECT * FROM product_catalog WHERE center_id = ? AND name = ?').get(center.id, fromName);
          if (!fromRow) continue;

          const assetsMoved = db.prepare('UPDATE assets SET catalog_id = ? WHERE catalog_id = ?').run(keeper.id, fromRow.id).changes;
          const transferItemsMoved = db.prepare('UPDATE transfer_items SET catalog_id = ? WHERE catalog_id = ?').run(keeper.id, fromRow.id).changes;
          const issueItemsMoved = db.prepare('UPDATE issue_record_items SET catalog_id = ? WHERE catalog_id = ?').run(keeper.id, fromRow.id).changes;

          if (!newDescription && fromRow.description) newDescription = fromRow.description;
          if (!newImage && fromRow.image) newImage = fromRow.image;
          if (!newTagCode && fromRow.tag_code) newTagCode = fromRow.tag_code;

          db.prepare('DELETE FROM product_catalog WHERE id = ?').run(fromRow.id);
          groupReport.merged.push({ name: fromName, assetsMoved, transferItemsMoved, issueItemsMoved });
        }

        if (!groupReport.merged.length) continue;

        if (newDescription !== keeper.description || newImage !== keeper.image || newTagCode !== keeper.tag_code) {
          db.prepare('UPDATE product_catalog SET description = ?, image = ?, tag_code = ? WHERE id = ?')
            .run(newDescription, newImage, newTagCode, keeper.id);
        }
        if (group.renameTo && group.renameTo !== keeper.name) {
          db.prepare('UPDATE product_catalog SET name = ? WHERE id = ?').run(group.renameTo, keeper.id);
          groupReport.renamedTo = group.renameTo;
        }

        centerReport.groups.push(groupReport);
      }

      centerReport.finalCatalogCount = db.prepare('SELECT COUNT(*) c FROM product_catalog WHERE center_id = ?').get(center.id).c;
      report.centers.push(centerReport);
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

module.exports = { run, MERGE_GROUPS_BY_NAME };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath] = args.filter(a => a !== '--apply');
  if (!dbPath) {
    console.error('Usage: node merge-catalog-duplicates-all-centers.js <db-path> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, { apply }), null, 2));
}
