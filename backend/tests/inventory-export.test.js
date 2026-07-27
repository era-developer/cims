const test = require('node:test');
const assert = require('node:assert/strict');
const { createInventoryExportWorkbook } = require('../utils/excel');

test('inventory export workbook includes the location column and values', () => {
  const workbook = createInventoryExportWorkbook([
    {
      id: 'cmp-1',
      centerId: 'jp_nagar',
      centerName: 'JP Nagar',
      name: 'Arduino Uno',
      category: 'Microcontroller',
      description: 'Starter board',
      stock: 5,
      totalProcured: 5,
      totalIssued: 0,
      unit: 'pcs',
      location: 'Bin-A1',
      addedDate: new Date('2026-01-01'),
      image: '',
      active: true,
      damagedCount: 0,
      invoiceNumber: 'INV-1',
      vendorName: 'Vendor A',
      purchasePurpose: 'Lab kit',
      purchasedFor: 'ERA Foundation',
    },
  ]);

  const sheet = workbook.getWorksheet('Inventory');
  assert.ok(sheet);
  const headers = sheet.columns.map(column => column.header);
  assert.ok(headers.includes('Location/Bin'));

  const firstDataRow = sheet.getRow(2);
  assert.equal(firstDataRow.getCell(11).value, 'Bin-A1');
});
