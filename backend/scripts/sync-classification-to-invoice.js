// Makes invoice_line_items.classification_id the single source of truth
// for classification everywhere, per explicit instruction: "put inventory
// as per the invoice only... everywhere price should match." Two layers
// were found out of sync with it:
//
//  1. fix-catalog-classification-mismatch.js (previous session) resolved
//     catalog-vs-asset disagreements by majority vote among an item's OWN
//     assets -- but never checked those assets against their own invoice
//     line item. Where an item's assets all agreed with EACH OTHER but not
//     with the invoice (e.g. JP Nagar's "Cat 6 Cable Accessories": every
//     asset says "Computer and accessories", but its own invoice line item
//     says "Center Infrastructure"), that fix had nothing to correct.
//  2. fix-classifications.js (an even earlier session) deliberately
//     reclassified 8 items for real-world semantic sense (Dust Mask ->
//     Safety tools, Cotton Waste -> Single use Consumables, etc.), updating
//     catalog+assets but not the invoice line items they came from. That
//     was a reasonable call at the time, but directly conflicts with the
//     current instruction to trust the invoice unconditionally -- so this
//     reverts those 8 back to whatever their invoice says too.
//
// Step 1: every asset's classification_id is set to match its own
// invoice_line_item's classification_id (unambiguous -- each asset has
// exactly one invoice line item).
// Step 2: each catalog item's classification_id is set by majority vote
// among its own (now invoice-accurate) assets, same mechanism as
// fix-catalog-classification-mismatch.js, so a catalog fed by multiple
// invoices over time with genuine disagreement still resolves sensibly.
// Never touches unit_value, quantities, or invoice amounts -- only which
// classification bucket everything is grouped under.
//
// Usage: node sync-classification-to-invoice.js <db-path> [--apply]

const { openDatabase } = require('../utils/db');

function run(dbPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const report = {
    assetsSyncedToInvoice: 0,
    catalogItemsChecked: 0,
    catalogItemsUpdated: 0,
    assetsUpdatedForCatalogMajority: 0,
    ties: [],
    valueBeforeTotal: 0,
    valueAfterTotal: 0,
    applied: false,
    fatalError: null,
  };

  db.exec('BEGIN TRANSACTION');
  try {
    report.valueBeforeTotal = db.prepare("SELECT COALESCE(SUM(unit_value),0) v FROM assets WHERE status != 'disposed'").get().v;

    // Step 1: asset classification must match its own invoice line item.
    const assetMismatches = db.prepare(`
      SELECT a.id, li.classification_id AS invoiceClassId
      FROM assets a JOIN invoice_line_items li ON li.id = a.invoice_line_item_id
      WHERE a.classification_id != li.classification_id
    `).all();
    const updateAssetClass = db.prepare('UPDATE assets SET classification_id = ? WHERE id = ?');
    for (const row of assetMismatches) {
      updateAssetClass.run(row.invoiceClassId, row.id);
      report.assetsSyncedToInvoice += 1;
    }

    // Step 2: catalog classification by majority vote among its own
    // (now invoice-accurate) assets -- same mechanism as
    // fix-catalog-classification-mismatch.js.
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
      if (runnerUp && runnerUp.c === top.c) {
        report.ties.push({ catalogId, center: catalog.center_id, name: catalog.name, votes });
        continue;
      }
      if (top.classification_id !== catalog.classification_id) {
        db.prepare('UPDATE product_catalog SET classification_id = ? WHERE id = ?').run(top.classification_id, catalogId);
        report.catalogItemsUpdated += 1;
      }
      const updated = db.prepare('UPDATE assets SET classification_id = ? WHERE catalog_id = ? AND classification_id != ?')
        .run(top.classification_id, catalogId, top.classification_id);
      report.assetsUpdatedForCatalogMajority += updated.changes;
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
    console.error('Usage: node sync-classification-to-invoice.js <db-path> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, { apply }), null, 2));
}
