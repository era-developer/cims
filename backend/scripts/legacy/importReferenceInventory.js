const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');

const DATA_DIR = path.resolve(__dirname, '../data');
const DEFAULT_SOURCE_FILE = path.join(
  os.homedir(),
  'Downloads',
  'ComedKares Innovation Hub - JP Nagar center - store.link.xlsx',
);

const INVENTORY_COLUMNS = [
  { header: 'Component ID', key: 'id', width: 18 },
  { header: 'Name', key: 'name', width: 32 },
  { header: 'Category', key: 'category', width: 22 },
  { header: 'Description', key: 'description', width: 48 },
  { header: 'Current Stock', key: 'stock', width: 16 },
  { header: 'Total Procured', key: 'totalProcured', width: 18 },
  { header: 'Total Issued', key: 'totalIssued', width: 16 },
  { header: 'Unit', key: 'unit', width: 12 },
  { header: 'Location/Bin', key: 'location', width: 18 },
  { header: 'Added Date', key: 'addedDate', width: 20 },
  { header: 'Image URL', key: 'image', width: 48 },
  { header: 'Active', key: 'active', width: 10 },
  { header: 'Damaged Count', key: 'damagedCount', width: 16 },
];

const ORDER_COLUMNS = [
  { header: 'Order ID', key: 'orderId', width: 20 },
  { header: 'Date & Time', key: 'createdAt', width: 20 },
  { header: 'Student Name', key: 'studentName', width: 22 },
  { header: 'Username', key: 'username', width: 18 },
  { header: 'Mobile', key: 'mobile', width: 15 },
  { header: 'College', key: 'college', width: 30 },
  { header: 'Department', key: 'department', width: 22 },
  { header: 'Course Name', key: 'courseName', width: 22 },
  { header: 'Project Name', key: 'projectName', width: 30 },
  { header: 'Team Name', key: 'teamName', width: 20 },
  { header: 'Faculty Guide', key: 'facultyGuide', width: 22 },
  { header: 'Purpose', key: 'purpose', width: 35 },
  { header: 'Components (JSON)', key: 'components', width: 50 },
  { header: 'Total Items', key: 'totalItems', width: 14 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Admin Remarks', key: 'adminRemarks', width: 30 },
  { header: 'Status Updated At', key: 'resolvedAt', width: 22 },
  { header: 'Student Email', key: 'studentEmail', width: 35 },
  { header: 'Items JSON', key: 'itemsJson', width: 60 },
  { header: 'Stock Reserved', key: 'stockReserved', width: 14 },
  { header: 'Issued Counted', key: 'issuedCounted', width: 14 },
  { header: 'Reserved At', key: 'reservedAt', width: 22 },
  { header: 'Issued At', key: 'issuedAt', width: 22 },
  { header: 'Return Requested At', key: 'returnRequestedAt', width: 22 },
  { header: 'Returned At', key: 'returnedAt', width: 22 },
  { header: 'Return Summary JSON', key: 'returnSummaryJson', width: 70 },
  { header: 'Last Return At', key: 'lastReturnAt', width: 22 },
];

function normalizeCellValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value.result !== undefined) return normalizeCellValue(value.result);
  if (value.text !== undefined) return value.text;
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  return value;
}

function toText(value) {
  const normalized = normalizeCellValue(value);
  if (normalized === null || normalized === undefined) return '';
  return String(normalized).trim();
}

function toNumber(value) {
  const normalized = normalizeCellValue(value);
  if (normalized === null || normalized === undefined || normalized === '') return 0;
  const parsed = Number(String(normalized).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractImageFormulaUrl(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/IMAGE\("([^"]+)"\)/i);
    return match ? match[1] : trimmed;
  }

  if (typeof value === 'object' && value.formula) {
    const match = String(value.formula).match(/IMAGE\("([^"]+)"\)/i);
    return match ? match[1] : '';
  }

  return '';
}

function extractDriveFileId(url) {
  if (!url) return '';
  const fileMatch = url.match(/\/file\/d\/([^/]+)/i);
  if (fileMatch) return fileMatch[1];

  const openMatch = url.match(/[?&]id=([^&]+)/i);
  if (openMatch) return openMatch[1];

  const ucMatch = url.match(/[?&]export=view&id=([^&]+)/i);
  if (ucMatch) return ucMatch[1];

  return '';
}

function toPortalImageUrl(url) {
  if (!url) return '';
  const driveId = extractDriveFileId(url);
  return driveId ? `https://lh3.googleusercontent.com/d/${driveId}=w1600` : url;
}

function styleHeader(row) {
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
  row.height = 22;
}

function styleDataRow(row, isEven) {
  row.eachCell(cell => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isEven ? 'FFF5F5F5' : 'FFFFFFFF' },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'hair' },
      left: { style: 'hair' },
      bottom: { style: 'hair' },
      right: { style: 'hair' },
    };
  });
}

function applyColumns(worksheet, columns) {
  columns.forEach((column, index) => {
    const target = worksheet.getColumn(index + 1);
    target.header = column.header;
    target.key = column.key;
    target.width = column.width;
  });
  styleHeader(worksheet.getRow(1));
}

function createWorksheet(workbook, name, columns) {
  const worksheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  applyColumns(worksheet, columns);
  return worksheet;
}

function mergeProducts(current, incoming) {
  current.stock += incoming.stock;
  current.totalProcured += incoming.stock;

  if (!current.category && incoming.category) current.category = incoming.category;
  if (!current.description && incoming.description) current.description = incoming.description;
  if (!current.image && incoming.image) current.image = incoming.image;
}

async function loadProducts(sourceFile) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourceFile);

  const worksheet = workbook.getWorksheet('Products');
  if (!worksheet) {
    throw new Error('Products sheet not found in reference workbook');
  }

  const products = new Map();
  let rawRowCount = 0;
  let blankStockCount = 0;
  let withImageCount = 0;
  let duplicateMergedCount = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const name = toText(row.getCell(1).value);
    if (!name) return;

    rawRowCount += 1;

    const stockCell = normalizeCellValue(row.getCell(6).value);
    if (stockCell === null || stockCell === undefined || String(stockCell).trim() === '') {
      blankStockCount += 1;
    }

    const image = toPortalImageUrl(extractImageFormulaUrl(row.getCell(7).value));
    if (image) withImageCount += 1;

    const product = {
      id: uuidv4(),
      name,
      category: toText(row.getCell(2).value),
      description: toText(row.getCell(3).value),
      stock: toNumber(row.getCell(6).value),
      totalProcured: toNumber(row.getCell(6).value),
      totalIssued: 0,
      unit: 'pcs',
      location: '',
      addedDate: new Date(),
      image,
      active: true,
      damagedCount: 0,
    };

    if (products.has(name)) {
      mergeProducts(products.get(name), product);
      duplicateMergedCount += 1;
      return;
    }

    products.set(name, product);
  });

  return {
    products: [...products.values()],
    stats: {
      rawRowCount,
      uniqueRowCount: products.size,
      blankStockCount,
      withImageCount,
      duplicateMergedCount,
    },
  };
}

async function writeInventory(products, inventoryFile) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = createWorksheet(workbook, 'Inventory', INVENTORY_COLUMNS);

  products.forEach((product, index) => {
    const row = worksheet.addRow(product);
    styleDataRow(row, index % 2 === 0);
  });

  await workbook.xlsx.writeFile(inventoryFile);
}

async function resetOrders(ordersFile) {
  const workbook = new ExcelJS.Workbook();
  createWorksheet(workbook, 'Orders', ORDER_COLUMNS);
  await workbook.xlsx.writeFile(ordersFile);
}

async function main() {
  const sourceFile = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SOURCE_FILE;
  const centerId = process.argv[3] || 'jp_nagar';
  const centerDir = path.join(DATA_DIR, centerId);
  await fs.mkdir(centerDir, { recursive: true });
  const inventoryFile = path.join(centerDir, `${centerId}_inventory.xlsx`);
  const ordersFile = path.join(centerDir, `${centerId}_orders.xlsx`);
  const { products, stats } = await loadProducts(sourceFile);

  await writeInventory(products, inventoryFile);
  await resetOrders(ordersFile);

  console.log(
    JSON.stringify(
      {
        sourceFile,
        inventoryFile,
        ordersFile,
        importedProducts: stats.uniqueRowCount,
        rawSourceRows: stats.rawRowCount,
        duplicateRowsMerged: stats.duplicateMergedCount,
        blankSourceStockRows: stats.blankStockCount,
        productsWithImages: products.filter(product => product.image).length,
        ordersReset: true,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
