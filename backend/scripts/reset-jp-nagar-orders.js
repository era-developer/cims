// Clears all rows from JP Nagar's orders.xlsx (keeping the header/styling
// exactly as-is) and resets its order_meta.json to empty -- part of the
// July 2026 audit reset (removes the 2 real student orders placed through
// the portal, per instruction to keep JP Nagar as spreadsheet-only data).
const path = require('path');
const fs = require('fs/promises');
const ExcelJS = require('exceljs');

async function resetOrders(centerDir, centerId, { apply = false } = {}) {
  const ordersPath = path.join(centerDir, `${centerId}_orders.xlsx`);
  const metaPath = path.join(centerDir, `${centerId}_order_meta.json`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(ordersPath);
  const sheet = workbook.getWorksheet('Orders');
  const before = sheet.rowCount;

  // Remove every row except the header (row 1), from the bottom up so
  // indices stay valid as rows are removed.
  for (let r = sheet.rowCount; r > 1; r -= 1) {
    sheet.spliceRows(r, 1);
  }

  if (apply) {
    await workbook.xlsx.writeFile(ordersPath);
    await fs.writeFile(metaPath, JSON.stringify({}, null, 2), 'utf8');
  }

  return { ordersFile: ordersPath, rowsBefore: before, rowsAfter: sheet.rowCount, applied: apply };
}

module.exports = { resetOrders };

if (require.main === module) {
  const [, , centerDir, centerId, flag] = process.argv;
  if (!centerDir || !centerId) {
    console.error('Usage: node reset-jp-nagar-orders.js <center-data-dir> <center-id> [--apply]');
    process.exit(1);
  }
  resetOrders(centerDir, centerId, { apply: flag === '--apply' })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error(err); process.exit(1); });
}
