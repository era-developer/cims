// The 8-center full-history rebuild matched sheet rows to EXISTING catalog
// items by normalized name and reused whatever classification that
// pre-existing (JP-Nagar-mirrored) catalog row already had -- but each
// row's own assets were correctly tagged with THAT ROW's actual invoice
// classification. When the mirrored catalog's classification didn't match
// the invoice (a common case: the item existed in JP Nagar's original
// catalog under one classification, but this center's own invoice
// classifies it differently), the catalog item and its own assets ended
// up disagreeing -- e.g. "Cat 6 Cable Accessories" sitting under
// "Computer and accessories" in the catalog while its 50 assets are
// tagged "Center Infrastructure". This is exactly why "Center
// Infrastructure" items were reported missing from that classification in
// Inventory: the catalog-summary view groups by the catalog's
// classification, not each asset's.
//
// Fix: for every catalog item where its assets don't all agree with the
// catalog's own classification_id, set BOTH the catalog and all of its
// assets to whichever classification the MAJORITY of that catalog's own
// assets already carry (i.e. what the invoices actually say, resolved by
// vote when a handful of older/inconsistent batches disagree). Ties keep
// the catalog's current value. This only ever changes classification_id --
// never touches unit_value, tags, or invoice amounts, so total portfolio
// value is unaffected; only which classification bucket it's grouped
// under.
//
// Usage: node fix-catalog-classification-mismatch.js <db-path> [--apply]

const { openDatabase } = require('../utils/db');

function run(dbPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const report = {
    catalogItemsChecked: 0,
    catalogItemsUpdated: 0,
    assetsUpdated: 0,
    tiesKeptAsIs: [],
    changes: [],
    valueBeforeTotal: 0,
    valueAfterTotal: 0,
    applied: false,
    fatalError: null,
  };

  db.exec('BEGIN TRANSACTION');
  try {
    report.valueBeforeTotal = db.prepare("SELECT COALESCE(SUM(unit_value),0) v FROM assets WHERE status != 'disposed'").get().v;

    const affectedCatalogIds = db.prepare(`
      SELECT DISTINCT pc.id FROM assets a JOIN product_catalog pc ON pc.id = a.catalog_id
      WHERE pc.classification_id != a.classification_id
    `).all().map(r => r.id);
    report.catalogItemsChecked = affectedCatalogIds.length;

    for (const catalogId of affectedCatalogIds) {
      const catalog = db.prepare('SELECT id, center_id, name, classification_id FROM product_catalog WHERE id = ?').get(catalogId);
      const votes = db.prepare(`
        SELECT classification_id, COUNT(*) c FROM assets WHERE catalog_id = ? GROUP BY classification_id ORDER BY c DESC
      `).all(catalogId);
      const top = votes[0];
      const runnerUp = votes[1];
      const isTie = runnerUp && runnerUp.c === top.c;

      if (isTie) {
        // No clear majority -- leave the catalog's current classification
        // alone rather than guess, but still note it for visibility.
        report.tiesKeptAsIs.push({ catalogId, center: catalog.center_id, name: catalog.name, votes });
        continue;
      }

      if (top.classification_id === catalog.classification_id) {
        // Catalog is already the majority -- only the minority assets need
        // correcting, catalog row itself is untouched.
      } else {
        db.prepare('UPDATE product_catalog SET classification_id = ? WHERE id = ?').run(top.classification_id, catalogId);
        report.catalogItemsUpdated += 1;
      }

      const updated = db.prepare('UPDATE assets SET classification_id = ? WHERE catalog_id = ? AND classification_id != ?')
        .run(top.classification_id, catalogId, top.classification_id);
      report.assetsUpdated += updated.changes;
      report.changes.push({
        catalogId, center: catalog.center_id, name: catalog.name,
        oldClassificationId: catalog.classification_id, newClassificationId: top.classification_id,
        assetsCorrected: updated.changes, votes,
      });
    }

    report.valueAfterTotal = db.prepare("SELECT COALESCE(SUM(unit_value),0) v FROM assets WHERE status != 'disposed'").get().v;

    if (apply) {
      db.exec('COMMIT');
      report.applied = true;
    } else {
      db.exec('ROLLBACK');
    }
  } catch (err) {
    db.exec('ROLLBACK');
    report.fatalError = err.message;
    report.fatalStack = err.stack;
  }

  return report;
}

module.exports = { run };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath] = args.filter(a => a !== '--apply');
  if (!dbPath) {
    console.error('Usage: node fix-catalog-classification-mismatch.js <db-path> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, { apply }), null, 2));
}
