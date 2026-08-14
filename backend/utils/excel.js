// All persistent CIMS data (users, inventory, orders, transfers, logs,
// WhatsApp messages) lives in SQLite -- see utils/db.js, utils/usersDb.js,
// utils/logsDb.js, utils/whatsappDb.js, and routes/*.js. This module only
// builds one-off .xlsx exports for admin downloads; it reads nothing from
// disk and keeps no state of its own.
const ExcelJS = require('exceljs');

const INVENTORY_COLUMNS = [
  { header: 'Component ID', key: 'id', width: 18 },
  { header: 'Center ID', key: 'centerId', width: 18 },
  { header: 'Center Name', key: 'centerName', width: 28 },
  { header: 'Name', key: 'name', width: 28 },
  { header: 'Category', key: 'category', width: 20 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'Current Stock', key: 'stock', width: 16 },
  { header: 'Total Procured', key: 'totalProcured', width: 18 },
  { header: 'Total Issued', key: 'totalIssued', width: 16 },
  { header: 'Unit', key: 'unit', width: 12 },
  { header: 'Location/Bin', key: 'location', width: 18 },
  { header: 'Added Date', key: 'addedDate', width: 16 },
  { header: 'Image URL', key: 'image', width: 30 },
  { header: 'Active', key: 'active', width: 10 },
  { header: 'Damaged/Consumed Count', key: 'damagedCount', width: 16 },
  { header: 'Invoice Number', key: 'invoiceNumber', width: 22 },
  { header: 'Vendor Name', key: 'vendorName', width: 28 },
  { header: 'Purchase Project/Purpose', key: 'purchasePurpose', width: 38 },
  { header: 'Purchased For', key: 'purchasedFor', width: 28 },
];

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

function applyWorksheetColumns(sheet, columns) {
  sheet.columns = columns;
  styleHeader(sheet.getRow(1));
}

function createStyledWorksheet(workbook, name, columns, options = {}) {
  const sheet = workbook.addWorksheet(name, options);
  applyWorksheetColumns(sheet, columns);
  return sheet;
}

function createInventoryExportWorkbook(items = []) {
  const workbook = new ExcelJS.Workbook();
  const sheet = createStyledWorksheet(workbook, 'Inventory', INVENTORY_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });

  (Array.isArray(items) ? items : []).forEach(item => {
    const row = sheet.addRow({
      id: item.id || '',
      centerId: item.centerId || '',
      centerName: item.centerName || '',
      name: item.name || '',
      category: item.category || '',
      description: item.description || '',
      stock: Number(item.stock) || 0,
      totalProcured: Number(item.totalProcured ?? item.stock) || 0,
      totalIssued: Number(item.totalIssued) || 0,
      unit: item.unit || 'pcs',
      location: item.location || '',
      addedDate: item.addedDate ? new Date(item.addedDate) : '',
      image: item.image || '',
      active: item.active !== false,
      damagedCount: Number(item.damagedCount) || 0,
      invoiceNumber: String(item.invoiceNumber || '').trim(),
      vendorName: String(item.vendorName || '').trim(),
      purchasePurpose: String(item.purchasePurpose || '').trim(),
      purchasedFor: String(item.purchasedFor || '').trim(),
    });
    styleDataRow(row, sheet.rowCount % 2 === 0);
  });

  return workbook;
}

module.exports = {
  createInventoryExportWorkbook,
};
