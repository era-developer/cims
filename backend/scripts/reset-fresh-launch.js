const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { CENTERS } = require('./legacy-centers');

const DATA_DIR = path.join(__dirname, '..', 'data');

function normalizeCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return value;
  if (value.result !== undefined) return normalizeCellValue(value.result);
  if (value.text !== undefined) return value.text;
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  return value;
}

function toNumber(value) {
  const parsed = Number(normalizeCellValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

async function resetInventory(centerId) {
  const inventoryPath = path.join(DATA_DIR, centerId, `${centerId}_inventory.xlsx`);
  if (!fsSync.existsSync(inventoryPath)) {
    return { centerId, stockRowsReset: 0 };
  }

  const workbook = await loadWorkbook(inventoryPath);
  const sheet = workbook.getWorksheet('Inventory');
  if (!sheet) {
    return { centerId, stockRowsReset: 0 };
  }

  let stockRowsReset = 0;
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const totalProcured = toNumber(row.getCell(8).value);
    const currentStock = toNumber(row.getCell(7).value);
    row.getCell(7).value = totalProcured || currentStock;
    row.getCell(9).value = 0;
    row.getCell(15).value = 0;
    stockRowsReset += 1;
  });

  await workbook.xlsx.writeFile(inventoryPath);
  return { centerId, stockRowsReset };
}

async function clearWorksheetRows(filePath, sheetName) {
  if (!fsSync.existsSync(filePath)) return 0;
  const workbook = await loadWorkbook(filePath);
  let sheet = workbook.getWorksheet(sheetName);
  if (!sheet) sheet = workbook.worksheets[0];
  if (!sheet) return 0;
  const rowsToRemove = Math.max(0, sheet.rowCount - 1);
  while (sheet.rowCount > 1) {
    sheet.spliceRows(2, 1);
  }
  await workbook.xlsx.writeFile(filePath);
  return rowsToRemove;
}

async function resetOrderMeta(centerId) {
  const metaPath = path.join(DATA_DIR, centerId, `${centerId}_order_meta.json`);
  if (!fsSync.existsSync(metaPath)) return false;
  await fs.writeFile(metaPath, '{}\n', 'utf8');
  return true;
}

async function run() {
  const summary = {
    centers: [],
    totalStockRowsReset: 0,
    totalOrdersCleared: 0,
    totalTransfersCleared: 0,
    totalMetaCleared: 0,
  };

  for (const center of CENTERS) {
    const inventoryResult = await resetInventory(center.id);
    const ordersPath = path.join(DATA_DIR, center.id, `${center.id}_orders.xlsx`);
    const transfersPath = path.join(DATA_DIR, center.id, `${center.id}_transfers.xlsx`);
    const ordersCleared = await clearWorksheetRows(ordersPath, 'Orders');
    const transfersCleared = await clearWorksheetRows(transfersPath, 'Transfers');
    const metaCleared = await resetOrderMeta(center.id);

    summary.totalStockRowsReset += inventoryResult.stockRowsReset;
    summary.totalOrdersCleared += ordersCleared;
    summary.totalTransfersCleared += transfersCleared;
    summary.totalMetaCleared += metaCleared ? 1 : 0;
    summary.centers.push({
      centerId: center.id,
      stockRowsReset: inventoryResult.stockRowsReset,
      ordersCleared,
      transfersCleared,
      metaCleared: metaCleared ? 'yes' : 'no',
    });
  }

  // Clean up legacy top-level files if they exist.
  const legacyOrders = path.join(DATA_DIR, 'orders.xlsx');
  const legacyOrderMeta = path.join(DATA_DIR, 'order_meta.json');
  const legacyOrdersCleared = await clearWorksheetRows(legacyOrders, 'Orders');
  if (fsSync.existsSync(legacyOrderMeta)) {
    await fs.writeFile(legacyOrderMeta, '{}\n', 'utf8');
  }

  console.log('Fresh launch reset complete.');
  console.table(summary.centers);
  console.log(`Stock rows reset: ${summary.totalStockRowsReset}`);
  console.log(`Orders cleared: ${summary.totalOrdersCleared + legacyOrdersCleared}`);
  console.log(`Transfers cleared: ${summary.totalTransfersCleared}`);
  console.log(`Order meta files reset: ${summary.totalMetaCleared + (fsSync.existsSync(legacyOrderMeta) ? 1 : 0)}`);
}

run().catch(err => {
  console.error('Reset failed:', err);
  process.exit(1);
});
