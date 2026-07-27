const ExcelJS = require('exceljs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CENTER_SOURCES = [
  {
    id: 'gopalan_mall',
    name: 'Gopalan Mall, Bengaluru',
    source: 'D:/Gopalan.xlsx',
    sheetName: 'Gopalan',
  },
  {
    id: 'hubballi',
    name: 'Hubballi, Bengaluru',
    source: 'D:/Hubbali.xlsx',
    sheetName: 'Hubli',
  },
  {
    id: 'mangalore',
    name: 'Mangalore',
    source: 'D:/mangalore.xlsx',
    sheetName: 'Mangalore',
  },
  {
    id: 'mysore',
    name: 'Mysore',
    source: 'D:/Mysore.xlsx',
    sheetName: 'Mysore',
  },
  {
    id: 'tumkur',
    name: 'Tumkur',
    source: 'D:/Tumakur.xlsx',
    sheetName: 'Tumakuru',
  },
  {
    id: 'yelahanka',
    name: 'Yelahanka, Bengaluru',
    source: 'D:/Yelahanka.xlsx',
    sheetName: 'Yelahanka',
  },
];

const FALLBACK_METADATA = {
  category: 'MISC',
  description: 'Automatically imported component from the latest centre stock worksheet.',
};

const KNOWN_COMPONENT_METADATA = new Map([
  [
    'ROBOT WHEEL (7CM DIA \\u00d7 2CM WIDTH)',
    {
      category: 'WHEELS',
      description:
        'Slim robot wheel designed for compact robotics; narrow width improves sharp turns while still gripping well.',
    },
  ],
  [
    'ROBOT WHEEL (7CM DIA x 2CM WIDTH)',
    {
      category: 'WHEELS',
      description:
        'Slim robot wheel designed for compact robotics; narrow width improves sharp turns while still gripping well.',
    },
  ],
  [
    'IC HC595D (74HC595)',
    {
      category: 'INTEGRATED CIRCUITS',
      description:
        '74HC595 serial-in/parallel-out shift register that expands GPIO while latching stable output states.',
    },
  ],
]);

const metadataLookup = new Map();
KNOWN_COMPONENT_METADATA.forEach((metadata, name) => {
  metadataLookup.set(name.toUpperCase(), metadata);
});

function normalizeName(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.result !== undefined) return String(value.result);
    if (value.text !== undefined) return String(value.text);
  }
  return String(value).trim();
}

function parseStock(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  if (typeof value === 'object') {
    if (value.result !== undefined) return value.result;
    if (value.text !== undefined) return value.text;
  }
  const normalized = String(value).replace(/,/g, '').trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

async function loadCenterStock(center) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(center.source);
  const sheet = center.sheetName ? workbook.getWorksheet(center.sheetName) : workbook.worksheets[0];
  if (!sheet) {
    throw new Error(`Worksheet "${center.sheetName || '(first sheet)'}" not found in ${center.source}`);
  }

  const stockMap = new Map();
  const nameLookup = new Map();
  let processed = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = normalizeName(row.getCell(1).value);
    if (!name) return;
    const key = name.toUpperCase();
    stockMap.set(key, parseStock(row.getCell(2).value));
    if (!nameLookup.has(key)) {
      nameLookup.set(key, name);
    }
    processed += 1;
  });

  return { stockMap, nameLookup, processed };
}

async function updateCenterInventory(center, stockMap, nameLookup) {
  const inventoryPath = path.join(__dirname, '..', 'data', center.id, `${center.id}_inventory.xlsx`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inventoryPath);
  const sheet = workbook.getWorksheet('Inventory');
  if (!sheet) throw new Error(`Inventory worksheet missing for ${center.id}`);

  let updated = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = normalizeName(row.getCell(4).value);
    if (!name) return;
    const key = name.toUpperCase();
    if (!stockMap.has(key)) return;
    const targetStock = stockMap.get(key);
    row.getCell(7).value = targetStock;
    row.getCell(8).value = targetStock;
    updated += 1;
    stockMap.delete(key);
  });

  let added = 0;
  const remaining = [...stockMap.entries()];
  for (const [key, stock] of remaining) {
    const displayName = nameLookup.get(key) || key;
    const metadata = metadataLookup.get(key) || FALLBACK_METADATA;
    sheet.addRow([
      uuidv4(),
      center.id,
      center.name,
      displayName,
      metadata.category,
      metadata.description,
      stock,
      stock,
      0,
      'pcs',
      '',
      new Date().toISOString(),
      '',
      true,
      0,
    ]);
    added += 1;
    stockMap.delete(key);
  }

  await workbook.xlsx.writeFile(inventoryPath);
  return { updated, added };
}

async function main() {
  const requested = process.argv.slice(2).map(arg => arg.toLowerCase());
  const selected = requested.length
    ? CENTER_SOURCES.filter(center => requested.includes(center.id))
    : CENTER_SOURCES;

  const invalid = requested.filter(arg => !CENTER_SOURCES.some(center => center.id === arg));
  if (invalid.length) {
    console.warn('Skipping unknown center IDs:', invalid.join(', '));
  }

  if (!selected.length) {
    console.log('No centers selected for update.');
    return;
  }

  const summary = [];
  for (const center of selected) {
    try {
      const { stockMap, nameLookup, processed } = await loadCenterStock(center);
      const { updated, added } = await updateCenterInventory(center, stockMap, nameLookup);
      summary.push({ id: center.id, processed, updated, added });
      console.log(`${center.id}: processed ${processed} rows, updated ${updated}, added ${added}`);
    } catch (error) {
      console.error(`Error for ${center.id}:`, error.message || error);
    }
  }

  if (summary.length) {
    console.log('Summary:');
    summary.forEach(item => {
      console.log(`  - ${item.id}: processed ${item.processed}, updated ${item.updated}, added ${item.added}`);
    });
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
