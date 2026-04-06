console.log('excel.js loaded');

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { CENTERS, getCenterById, requireCenter } = require('./centers');
console.log('__dirname:', __dirname);

const DATA_DIR = path.join(__dirname, '../data');
const getUsersFile = (centerId) => path.join(DATA_DIR, centerId, 'users.xlsx');

const FILES = {
  dataDir: DATA_DIR,
};

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
  { header: 'Damaged Count', key: 'damagedCount', width: 16 },
];

const ORDER_COLUMNS = [
  { header: 'Order ID', key: 'orderId', width: 20 },
  { header: 'Center ID', key: 'centerId', width: 18 },
  { header: 'Center Name', key: 'centerName', width: 28 },
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
  { header: 'Expected Return Date', key: 'expectedReturnDate', width: 18 },
  { header: 'Reminder Sent At', key: 'reminderSentAt', width: 22 },
];

const USER_COLUMNS = [
  { header: 'User ID', key: 'id', width: 18 },
  { header: 'Center ID', key: 'centerId', width: 18 },
  { header: 'Center Name', key: 'centerName', width: 28 },
  { header: 'Username', key: 'username', width: 20 },
  { header: 'Password Hash', key: 'passwordHash', width: 65 },
  { header: 'Full Name', key: 'fullName', width: 25 },
  { header: 'Email', key: 'email', width: 35 },
  { header: 'Mobile (WhatsApp)', key: 'mobile', width: 16 },
  { header: 'Alternative Mobile', key: 'altMobile', width: 16 },
  { header: 'College', key: 'college', width: 30 },
  { header: 'Year of Graduation', key: 'graduationYear', width: 16 },
  { header: 'Degree', key: 'degree', width: 16 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Role', key: 'role', width: 14 },
  { header: 'Active', key: 'active', width: 10 },
  { header: 'Created At', key: 'createdAt', width: 20 },
  { header: 'Source', key: 'source', width: 14 },
];

const LOG_COLUMNS = [
  { header: 'Timestamp', key: 'ts', width: 22 },
  { header: 'Center ID', key: 'centerId', width: 18 },
  { header: 'Center Name', key: 'centerName', width: 28 },
  { header: 'User', key: 'user', width: 20 },
  { header: 'Role', key: 'role', width: 12 },
  { header: 'Action', key: 'action', width: 25 },
  { header: 'Details', key: 'details', width: 60 },
];

const WHATSAPP_COLUMNS = [
  { header: 'Message ID', key: 'messageId', width: 40 },
  { header: 'Center ID', key: 'centerId', width: 18 },
  { header: 'Center Name', key: 'centerName', width: 28 },
  { header: 'Timestamp', key: 'ts', width: 22 },
  { header: 'Direction', key: 'direction', width: 12 },
  { header: 'From', key: 'from', width: 24 },
  { header: 'To', key: 'to', width: 24 },
  { header: 'Profile Name', key: 'profileName', width: 24 },
  { header: 'Body', key: 'body', width: 80 },
  { header: 'Channel', key: 'channel', width: 18 },
  { header: 'Order ID', key: 'orderId', width: 24 },
  { header: 'Status', key: 'status', width: 18 },
];

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function getCenterPaths(centerId) {
  const center = requireCenter(centerId);
  const baseDir = path.join(DATA_DIR, center.id);
  return {
    baseDir,
    inventory: path.join(baseDir, `${center.id}_inventory.xlsx`),
    orders: path.join(baseDir, `${center.id}_orders.xlsx`),
    logs: path.join(baseDir, `${center.id}_logs.xlsx`),
    whatsapp: path.join(baseDir, `${center.id}_whatsapp_messages.xlsx`),
  };
}

function getOrderMetaPath(centerId) {
  return path.join(getCenterPaths(centerId).baseDir, `${centerId}_order_meta.json`);
}

function getWorkbookFile(type, centerId) {
  if (type === 'users') return getUsersFile(centerId);
  return getCenterPaths(centerId)[type];
}

async function loadWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch {
    // first run
  }
  return workbook;
}

async function saveWorkbook(workbook, filePath) {
  await ensureDir(path.dirname(filePath));
  await workbook.xlsx.writeFile(filePath);
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  if (value.result !== undefined) return normalizeCellValue(value.result);
  if (value.text !== undefined) return value.text;
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  return value;
}

function normalizeBoolean(value) {
  const normalized = normalizeCellValue(value);
  return normalized === true || normalized === 'true' || normalized === 1 || normalized === '1';
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

function applyWorksheetColumns(sheet, columns) {
  sheet.columns = columns;
  styleHeader(sheet.getRow(1));
}

function createStyledWorksheet(workbook, name, columns, options = {}) {
  const sheet = workbook.addWorksheet(name, options);
  applyWorksheetColumns(sheet, columns);
  return sheet;
}

function buildSeedInventory(center) {
  const prefix = center.code;
  return [
    { id: uuidv4(), centerId: center.id, centerName: center.name, name: `Arduino Uno R3 - ${prefix}`, category: 'Microcontroller', description: 'ATmega328P based microcontroller board', stock: 25, totalProcured: 25, totalIssued: 0, unit: 'pcs', location: 'Bin-A1', addedDate: new Date(), image: '', active: true, damagedCount: 0 },
    { id: uuidv4(), centerId: center.id, centerName: center.name, name: `ESP32 Dev Board - ${prefix}`, category: 'Microcontroller', description: 'Dual-core WiFi + Bluetooth development board', stock: 30, totalProcured: 30, totalIssued: 0, unit: 'pcs', location: 'Bin-A2', addedDate: new Date(), image: '', active: true, damagedCount: 0 },
    { id: uuidv4(), centerId: center.id, centerName: center.name, name: `Breadboard 830 Tie - ${prefix}`, category: 'Prototyping', description: 'Full-size solderless breadboard', stock: 40, totalProcured: 40, totalIssued: 0, unit: 'pcs', location: 'Bin-B1', addedDate: new Date(), image: '', active: true, damagedCount: 0 },
    { id: uuidv4(), centerId: center.id, centerName: center.name, name: `Servo Motor SG90 - ${prefix}`, category: 'Actuators', description: '9g micro servo motor', stock: 20, totalProcured: 20, totalIssued: 0, unit: 'pcs', location: 'Bin-C1', addedDate: new Date(), image: '', active: true, damagedCount: 0 },
    { id: uuidv4(), centerId: center.id, centerName: center.name, name: `Ultrasonic Sensor HC-SR04 - ${prefix}`, category: 'Sensors', description: 'Ultrasonic distance sensor module', stock: 18, totalProcured: 18, totalIssued: 0, unit: 'pcs', location: 'Bin-D1', addedDate: new Date(), image: '', active: true, damagedCount: 0 },
  ];
}

function legacyUserFromRow(row) {
  const firstCenter = CENTERS[0];
  return {
    id: normalizeCellValue(row.getCell(1).value),
    centerId: firstCenter.id,
    centerName: firstCenter.name,
    username: normalizeCellValue(row.getCell(2).value),
    passwordHash: normalizeCellValue(row.getCell(3).value),
    fullName: normalizeCellValue(row.getCell(4).value),
    email: normalizeCellValue(row.getCell(5).value),
    mobile: normalizeCellValue(row.getCell(6).value),
    altMobile: normalizeCellValue(row.getCell(7).value),
    college: normalizeCellValue(row.getCell(8).value),
    graduationYear: normalizeCellValue(row.getCell(9).value),
    degree: normalizeCellValue(row.getCell(10).value),
    department: normalizeCellValue(row.getCell(11).value),
    role: normalizeCellValue(row.getCell(12).value),
    active: normalizeBoolean(row.getCell(13).value),
    createdAt: normalizeCellValue(row.getCell(14).value),
    source: normalizeCellValue(row.getCell(15).value) || 'manual',
  };
}

async function rewriteUsersWorkbook(users, centerId) {
  const workbook = new ExcelJS.Workbook();
  const sheet = createStyledWorksheet(workbook, 'Users', USER_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
  users.forEach((user, index) => {
    const row = sheet.addRow(user);
    styleDataRow(row, index % 2 === 0);
  });
  await saveWorkbook(workbook, getUsersFile(centerId));
}

async function buildDefaultUsers(centerId) {
  const center = requireCenter(centerId);
  const users = [];

  // Add super_admin to the first center
  if (centerId === CENTERS[0].id) {
    users.push({
      id: uuidv4(),
      centerId: centerId,
      centerName: center.name,
      username: 'superadmin',
      passwordHash: await bcrypt.hash('superadmin123', 10),
      fullName: 'Central Super Admin',
      email: 'superadmin@cims.edu',
      mobile: '',
      altMobile: '',
      college: '',
      graduationYear: '',
      degree: '',
      department: '',
      role: 'super_admin',
      active: true,
      createdAt: new Date(),
      source: 'manual',
    });
  }

  users.push({
    id: uuidv4(),
    centerId: center.id,
    centerName: center.name,
    username: `${center.id}_admin`,
    passwordHash: await bcrypt.hash('admin123', 10),
    fullName: `${center.name} Admin`,
    email: `${center.id}@cims.edu`,
    mobile: '',
    altMobile: '',
    college: center.name,
    graduationYear: '',
    degree: '',
    department: '',
    role: 'admin',
    active: true,
    createdAt: new Date(),
    source: 'manual',
  });

  // Add sample students
  users.push({
    id: uuidv4(),
    centerId: center.id,
    centerName: center.name,
    username: `${center.id}_student1`,
    passwordHash: await bcrypt.hash('student123', 10),
    fullName: 'Sample Student 1',
    email: `student1@${center.id}.cims.edu`,
    mobile: '',
    altMobile: '',
    college: center.name,
    graduationYear: '',
    degree: '',
    department: '',
    role: 'student',
    active: true,
    createdAt: new Date(),
    source: 'manual',
  });

  return users;
}

async function ensureInventoryWorkbook(centerId) {
  const center = requireCenter(centerId);
  const filePath = getWorkbookFile('inventory', center.id);
  if (fsSync.existsSync(filePath)) return;

  const workbook = new ExcelJS.Workbook();
  const sheet = createStyledWorksheet(workbook, 'Inventory', INVENTORY_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
  buildSeedInventory(center).forEach((item, index) => {
    const row = sheet.addRow(item);
    styleDataRow(row, index % 2 === 0);
  });
  await saveWorkbook(workbook, filePath);
}

async function ensureUsersWorkbook(centerId) {
  const filePath = getUsersFile(centerId);
  if (!fsSync.existsSync(filePath)) {
    await rewriteUsersWorkbook(await buildDefaultUsers(centerId), centerId);
    return;
  }

  const workbook = await loadWorkbook(filePath);
  const sheet = workbook.getWorksheet('Users');
  if (!sheet) {
    await rewriteUsersWorkbook(await buildDefaultUsers(centerId), centerId);
    return;
  }
  // Users file already exists with Users sheet, no need to recreate
}

async function initInventory(centerId) {
  await ensureInventoryWorkbook(centerId);
  return getInventory(centerId);
}

async function initUsers() {
  await ensureUsersWorkbook();
  return getUsers();
}

async function initCenterFiles(centerId) {
  const paths = getCenterPaths(centerId);
  await ensureDir(paths.baseDir);
  await ensureInventoryWorkbook(centerId);
}

async function initAllCenterData() {
  console.log('CENTERS length:', CENTERS.length);
  console.log('First center:', CENTERS[0]);
  await ensureDir(DATA_DIR);
  for (const center of CENTERS) {
    console.log('Processing center:', center.id);
    await ensureUsersWorkbook(center.id);
    await initCenterFiles(center.id);
  }
}

async function getInventory(centerId) {
  const center = requireCenter(centerId);
  await ensureInventoryWorkbook(center.id);
  const workbook = await loadWorkbook(getWorkbookFile('inventory', center.id));
  const sheet = workbook.getWorksheet('Inventory');
  if (!sheet) return [];

  const items = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    try {
      const value = index => normalizeCellValue(row.getCell(index).value);

      // Validate that we have required fields in correct positions
      const id = value(1);
      if (!id) return; // Skip rows without an ID

      // Check if this is old format (missing Center ID/Name columns)
      const col2Value = value(2);
      const col3Value = value(3);
      const col4Value = value(4);

      let item;

      // If col2 looks like a real center ID, it's new format
      if (col2Value && typeof col2Value === 'string' &&
          (col2Value.includes('_') || ['jp_nagar', 'yelahanka', 'gopalan_mall', 'mysore', 'tumkur', 'mangalore', 'hubballi', 'belagavi', 'kalaburagi'].includes(col2Value))) {
        // New format: cols 2,3 are centerId, centerName
        item = {
          id,
          centerId: col2Value || center.id,
          centerName: col3Value || center.name,
          name: col4Value,
          category: value(5),
          description: value(6),
          stock: Number(value(7)) || 0,
          totalProcured: Number(value(8)) || 0,
          totalIssued: Number(value(9)) || 0,
          unit: value(10) || 'pcs',
          location: value(11) || '',
          addedDate: value(12),
          image: value(13) || '',
          active: normalizeBoolean(row.getCell(14).value),
          damagedCount: Number(value(15)) || 0,
        };
      } else {
        // Old format: col2 is name (no centerId/centerName columns)
        item = {
          id,
          centerId: center.id,
          centerName: center.name,
          name: col2Value,
          category: col3Value,
          description: col4Value,
          stock: Number(value(5)) || 0,
          totalProcured: Number(value(6)) || 0,
          totalIssued: Number(value(7)) || 0,
          unit: value(8) || 'pcs',
          location: value(9) || '',
          addedDate: value(10),
          image: value(11) || '',
          active: normalizeBoolean(row.getCell(12).value),
          damagedCount: Number(value(13)) || 0,
        };
      }

      if (item.name) {
        items.push(item);
      }
    } catch (err) {
      console.error(`Error reading row ${rowNum} for ${center.id}:`, err.message);
    }
  });
  return items.filter(item => item.id && item.name);
}

async function addInventoryItem(item, centerId) {
  const center = requireCenter(centerId);
  await ensureInventoryWorkbook(center.id);
  const filePath = getWorkbookFile('inventory', center.id);
  const workbook = await loadWorkbook(filePath);
  let sheet = workbook.getWorksheet('Inventory');
  if (!sheet) {
    sheet = createStyledWorksheet(workbook, 'Inventory', INVENTORY_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
  } else {
    applyWorksheetColumns(sheet, INVENTORY_COLUMNS);
  }

  const newItem = {
    id: uuidv4(),
    centerId: center.id,
    centerName: center.name,
    name: item.name,
    category: item.category,
    description: item.description || '',
    stock: Number(item.stock) || 0,
    totalProcured: Number(item.totalProcured ?? item.stock) || 0,
    totalIssued: 0,
    unit: item.unit || 'pcs',
    location: item.location || '',
    addedDate: new Date(),
    image: item.image || '',
    active: item.active !== false,
    damagedCount: Number(item.damagedCount) || 0,
  };

  const row = sheet.addRow(newItem);
  styleDataRow(row, sheet.rowCount % 2 === 0);
  await saveWorkbook(workbook, filePath);
  return newItem;
}

async function updateInventoryItem(id, updates, centerId) {
  const center = requireCenter(centerId);
  const filePath = getWorkbookFile('inventory', center.id);
  const workbook = await loadWorkbook(filePath);
  const sheet = workbook.getWorksheet('Inventory');
  if (!sheet) return false;

  let found = false;
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    if (normalizeCellValue(row.getCell(1).value) !== id) return;
    if (updates.name !== undefined) row.getCell(4).value = updates.name;
    if (updates.category !== undefined) row.getCell(5).value = updates.category;
    if (updates.description !== undefined) row.getCell(6).value = updates.description;
    if (updates.stock !== undefined) row.getCell(7).value = Number(updates.stock) || 0;
    if (updates.totalProcured !== undefined) row.getCell(8).value = Number(updates.totalProcured) || 0;
    if (updates.totalIssued !== undefined) row.getCell(9).value = Number(updates.totalIssued) || 0;
    if (updates.unit !== undefined) row.getCell(10).value = updates.unit;
    if (updates.location !== undefined) row.getCell(11).value = updates.location;
    if (updates.image !== undefined) row.getCell(13).value = updates.image;
    if (updates.active !== undefined) row.getCell(14).value = !!updates.active;
    if (updates.damagedCount !== undefined) row.getCell(15).value = Number(updates.damagedCount) || 0;
    found = true;
  });

  if (found) await saveWorkbook(workbook, filePath);
  return found;
}

async function deleteInventoryItem(id, centerId) {
  const center = requireCenter(centerId);
  const filePath = getWorkbookFile('inventory', center.id);
  const workbook = await loadWorkbook(filePath);
  const sheet = workbook.getWorksheet('Inventory');
  if (!sheet) return false;

  let rowToDelete = null;
  sheet.eachRow((row, rowNum) => {
    if (rowNum > 1 && normalizeCellValue(row.getCell(1).value) === id) {
      rowToDelete = rowNum;
    }
  });
  if (!rowToDelete) return false;

  sheet.spliceRows(rowToDelete, 1);
  await saveWorkbook(workbook, filePath);
  return true;
}

async function loadOrderMetaStore(centerId) {
  try {
    const raw = await fs.readFile(getOrderMetaPath(centerId), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveOrderMetaStore(centerId, store) {
  await ensureDir(path.dirname(getOrderMetaPath(centerId)));
  await fs.writeFile(getOrderMetaPath(centerId), JSON.stringify(store, null, 2), 'utf8');
}

async function saveOrder(order) {
  const center = requireCenter(order.centerId);
  const filePath = getWorkbookFile('orders', center.id);
  const workbook = await loadWorkbook(filePath);
  let sheet = workbook.getWorksheet('Orders');
  if (!sheet) {
    sheet = createStyledWorksheet(workbook, 'Orders', ORDER_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
  } else {
    applyWorksheetColumns(sheet, ORDER_COLUMNS);
  }

  const componentSummary = (order.items || []).map(item => `${item.name}(x${item.qty})`).join(', ');
  const row = sheet.addRow({
    orderId: order.orderId,
    centerId: center.id,
    centerName: center.name,
    createdAt: new Date(order.createdAt),
    studentName: order.studentDetails.studentName,
    username: order.username,
    mobile: order.studentDetails.mobile,
    college: order.studentDetails.college,
    department: order.studentDetails.department,
    courseName: order.studentDetails.courseName,
    projectName: order.studentDetails.projectName,
    teamName: order.studentDetails.teamName,
    facultyGuide: order.studentDetails.facultyGuide,
    purpose: order.studentDetails.purpose,
    components: componentSummary,
    totalItems: (order.items || []).reduce((sum, item) => sum + (item.qty || 0), 0),
    status: order.status,
    adminRemarks: order.adminRemarks || '',
    resolvedAt: '',
    studentEmail: order.studentEmail || '',
    itemsJson: JSON.stringify(order.items || []),
    stockReserved: order.stockReserved === true,
    issuedCounted: order.issuedCounted === true,
    reservedAt: order.reservedAt ? new Date(order.reservedAt) : '',
    issuedAt: order.issuedAt ? new Date(order.issuedAt) : '',
    returnRequestedAt: order.returnRequestedAt ? new Date(order.returnRequestedAt) : '',
    returnedAt: order.returnedAt ? new Date(order.returnedAt) : '',
    returnSummaryJson: order.returnSummaryJson || '',
    lastReturnAt: order.lastReturnAt ? new Date(order.lastReturnAt) : '',
    expectedReturnDate: order.expectedReturnDate ? new Date(order.expectedReturnDate) : '',
    reminderSentAt: order.reminderSentAt ? new Date(order.reminderSentAt) : '',
  });
  styleDataRow(row, sheet.rowCount % 2 === 0);
  await saveWorkbook(workbook, filePath);

  const store = await loadOrderMetaStore(center.id);
  store[order.orderId] = {
    expectedReturnDate: order.expectedReturnDate || '',
    reminderSentAt: order.reminderSentAt || '',
  };
  await saveOrderMetaStore(center.id, store);
}

function orderFromRow(row) {
  const value = index => normalizeCellValue(row.getCell(index).value);
  return {
    orderId: value(1),
    centerId: value(2),
    centerName: value(3),
    createdAt: value(4),
    studentName: value(5),
    username: value(6),
    mobile: value(7),
    college: value(8),
    department: value(9),
    courseName: value(10),
    projectName: value(11),
    teamName: value(12),
    facultyGuide: value(13),
    purpose: value(14),
    components: value(15),
    totalItems: Number(value(16)) || 0,
    status: value(17),
    adminRemarks: value(18),
    resolvedAt: value(19),
    studentEmail: value(20),
    itemsJson: value(21),
    stockReserved: normalizeBoolean(row.getCell(22).value),
    issuedCounted: normalizeBoolean(row.getCell(23).value),
    reservedAt: value(24),
    issuedAt: value(25),
    returnRequestedAt: value(26),
    returnedAt: value(27),
    returnSummaryJson: value(28),
    lastReturnAt: value(29),
    expectedReturnDate: value(30),
    reminderSentAt: value(31),
  };
}

async function getOrders(centerId) {
  const centerIds = centerId ? [requireCenter(centerId).id] : CENTERS.map(center => center.id);
  const orders = [];

  for (const currentCenterId of centerIds) {
    const filePath = getWorkbookFile('orders', currentCenterId);
    if (!fsSync.existsSync(filePath)) continue;
    const workbook = await loadWorkbook(filePath);
    let sheet = workbook.getWorksheet('Orders');
    if (!sheet) sheet = workbook.worksheets[0];
    if (!sheet) continue;

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      orders.push(orderFromRow(row));
    });

    const store = await loadOrderMetaStore(currentCenterId);
    orders.forEach(order => {
      if (order.centerId !== currentCenterId) return;
      const meta = store[order.orderId] || {};
      if (!order.expectedReturnDate) order.expectedReturnDate = meta.expectedReturnDate || null;
      if (!order.reminderSentAt) order.reminderSentAt = meta.reminderSentAt || null;
    });
  }

  return orders.filter(order => order.orderId);
}

async function updateOrderStatus(orderId, status, remarks, meta = {}, centerId) {
  if (!centerId) {
    const allOrders = await getOrders();
    const found = allOrders.find(order => order.orderId === orderId);
    if (!found) return false;
    centerId = found.centerId;
  }

  const center = requireCenter(centerId);
  const filePath = getWorkbookFile('orders', center.id);
  const workbook = await loadWorkbook(filePath);
  const sheet = workbook.getWorksheet('Orders');
  if (!sheet) return false;

  let found = false;
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    if (normalizeCellValue(row.getCell(1).value) !== orderId) return;
    row.getCell(17).value = status;
    if (remarks !== undefined) row.getCell(18).value = remarks;
    row.getCell(19).value = meta.resolvedAt ? new Date(meta.resolvedAt) : new Date();
    if (meta.studentEmail !== undefined) row.getCell(20).value = meta.studentEmail;
    if (meta.itemsJson !== undefined) row.getCell(21).value = meta.itemsJson;
    if (meta.stockReserved !== undefined) row.getCell(22).value = meta.stockReserved;
    if (meta.issuedCounted !== undefined) row.getCell(23).value = meta.issuedCounted;
    if (meta.reservedAt !== undefined) row.getCell(24).value = meta.reservedAt ? new Date(meta.reservedAt) : '';
    if (meta.issuedAt !== undefined) row.getCell(25).value = meta.issuedAt ? new Date(meta.issuedAt) : '';
    if (meta.returnRequestedAt !== undefined) row.getCell(26).value = meta.returnRequestedAt ? new Date(meta.returnRequestedAt) : '';
    if (meta.returnedAt !== undefined) row.getCell(27).value = meta.returnedAt ? new Date(meta.returnedAt) : '';
    if (meta.returnSummaryJson !== undefined) row.getCell(28).value = meta.returnSummaryJson;
    if (meta.lastReturnAt !== undefined) row.getCell(29).value = meta.lastReturnAt ? new Date(meta.lastReturnAt) : '';
    if (meta.expectedReturnDate !== undefined) row.getCell(30).value = meta.expectedReturnDate ? new Date(meta.expectedReturnDate) : '';
    if (meta.reminderSentAt !== undefined) row.getCell(31).value = meta.reminderSentAt ? new Date(meta.reminderSentAt) : '';
    found = true;
  });

  if (!found) return false;

  await saveWorkbook(workbook, filePath);
  if (meta.expectedReturnDate !== undefined || meta.reminderSentAt !== undefined) {
    const store = await loadOrderMetaStore(center.id);
    store[orderId] = {
      ...(store[orderId] || {}),
      ...(meta.expectedReturnDate !== undefined ? { expectedReturnDate: meta.expectedReturnDate || '' } : {}),
      ...(meta.reminderSentAt !== undefined ? { reminderSentAt: meta.reminderSentAt || '' } : {}),
    };
    await saveOrderMetaStore(center.id, store);
  }
  return true;
}

function userFromRow(row) {
  const centerId = normalizeCellValue(row.getCell(2).value) || '';
  const centerName = normalizeCellValue(row.getCell(3).value) || (getCenterById(centerId)?.name || '');
  return {
    id: normalizeCellValue(row.getCell(1).value),
    centerId,
    centerName,
    username: normalizeCellValue(row.getCell(4).value),
    passwordHash: normalizeCellValue(row.getCell(5).value),
    fullName: normalizeCellValue(row.getCell(6).value),
    email: normalizeCellValue(row.getCell(7).value),
    mobile: normalizeCellValue(row.getCell(8).value),
    altMobile: normalizeCellValue(row.getCell(9).value),
    college: normalizeCellValue(row.getCell(10).value),
    graduationYear: normalizeCellValue(row.getCell(11).value),
    degree: normalizeCellValue(row.getCell(12).value),
    department: normalizeCellValue(row.getCell(13).value),
    role: normalizeCellValue(row.getCell(14).value),
    active: normalizeBoolean(row.getCell(15).value),
    createdAt: normalizeCellValue(row.getCell(16).value),
    source: normalizeCellValue(row.getCell(17).value) || 'manual',
  };
}

async function getUsers(options = {}) {
  if (options.centerId) {
    return await getUsersForCenter(options.centerId);
  }
  return await getAllUsers();
}

async function getUsersForCenter(centerId) {
  await ensureUsersWorkbook(centerId);
  const workbook = await loadWorkbook(getUsersFile(centerId));
  let sheet = workbook.getWorksheet('Users');
  if (!sheet) sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const users = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    users.push(userFromRow(row));
  });

  return users.filter(user => user.id);
}

async function getAllUsers() {
  const all = [];
  for (const center of CENTERS) {
    try {
      const users = await getUsersForCenter(center.id);
      all.push(...users);
    } catch (e) {
      // ignore if file not exists
    }
  }
  return all;
}

async function findUser(loginId) {
  const users = await getAllUsers();
  const needle = String(loginId || '').trim().toLowerCase();
  return users.find(user => {
    const username = String(user.username || '').trim().toLowerCase();
    const email = String(user.email || '').trim().toLowerCase();
    return username === needle || email === needle;
  }) || null;
}

async function findUserById(userId) {
  const users = await getAllUsers();
  return users.find(user => user.id === userId) || null;
}

async function addUser(userData) {
  const centerId = String(userData.centerId || '').trim();
  await ensureUsersWorkbook(centerId);
  const workbook = await loadWorkbook(getUsersFile(centerId));
  let sheet = workbook.getWorksheet('Users');
  if (!sheet) {
    sheet = createStyledWorksheet(workbook, 'Users', USER_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
  } else {
    applyWorksheetColumns(sheet, USER_COLUMNS);
  }

  const username = String(userData.username || '').trim();
  const fullName = String(userData.fullName || '').trim();
  const email = String(userData.email || '').trim();
  const password = String(userData.password || '');
  const role = userData.role || 'student';
  const centerName = centerId ? requireCenter(centerId).name : 'All Centers';

  if (!username || !fullName || !password) throw new Error('Username, full name and password are required');
  if (role !== 'super_admin' && !centerId) throw new Error('Center is required');

  const existing = await findUser(username);
  if (existing) throw new Error('Username already exists');

  const row = sheet.addRow({
    id: uuidv4(),
    centerId,
    centerName,
    username,
    passwordHash: await bcrypt.hash(password, 10),
    fullName,
    email,
    mobile: userData.mobile || '',
    altMobile: userData.altMobile || '',
    college: userData.college || '',
    graduationYear: userData.graduationYear || '',
    degree: userData.degree || '',
    department: userData.department || '',
    role,
    active: userData.active !== undefined ? !!userData.active : true,
    createdAt: new Date(),
    source: userData.source || 'manual',
  });
  styleDataRow(row, sheet.rowCount % 2 === 0);
  await saveWorkbook(workbook, getUsersFile(centerId));
}

async function updateUser(userId, userData) {
  const target = await findUserById(userId);
  if (!target) throw new Error('User not found');

  const centerId = target.centerId;
  const workbook = await loadWorkbook(getUsersFile(centerId));
  const sheet = workbook.getWorksheet('Users');
  if (!sheet) throw new Error('Users sheet not found');
  applyWorksheetColumns(sheet, USER_COLUMNS);

  const nextRole = userData.role !== undefined ? userData.role : target.role;
  const nextCenterId = nextRole === 'super_admin'
    ? ''
    : (userData.centerId !== undefined ? String(userData.centerId || '').trim() : target.centerId);

  if (nextRole !== 'super_admin' && !nextCenterId) throw new Error('Center is required');

  const username = userData.username !== undefined ? String(userData.username || '').trim() : target.username;
  const fullName = userData.fullName !== undefined ? String(userData.fullName || '').trim() : target.fullName;
  if (!username || !fullName) throw new Error('Username and full name are required');

  const existing = await findUser(username);
  if (existing && existing.id !== userId) throw new Error('Username already exists');

  let updated = null;
  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum += 1) {
    const row = sheet.getRow(rowNum);
    if (normalizeCellValue(row.getCell(1).value) !== userId) continue;
    row.getCell(2).value = nextCenterId;
    row.getCell(3).value = nextCenterId ? requireCenter(nextCenterId).name : 'All Centers';
    row.getCell(4).value = username;
    row.getCell(6).value = fullName;
    row.getCell(7).value = userData.email !== undefined ? String(userData.email || '').trim() : target.email;
    row.getCell(8).value = userData.mobile !== undefined ? String(userData.mobile || '').trim() : target.mobile;
    row.getCell(9).value = userData.altMobile !== undefined ? String(userData.altMobile || '').trim() : target.altMobile;
    row.getCell(10).value = userData.college !== undefined ? String(userData.college || '').trim() : target.college;
    row.getCell(11).value = userData.graduationYear !== undefined ? String(userData.graduationYear || '').trim() : target.graduationYear;
    row.getCell(12).value = userData.degree !== undefined ? String(userData.degree || '').trim() : target.degree;
    row.getCell(13).value = userData.department !== undefined ? String(userData.department || '').trim() : target.department;
    row.getCell(14).value = nextRole;
    if (userData.active !== undefined) row.getCell(15).value = !!userData.active;
    if (userData.source !== undefined) row.getCell(17).value = userData.source;
    if (userData.password) row.getCell(5).value = await bcrypt.hash(String(userData.password), 10);
    updated = userFromRow(row);
    break;
  }

  await saveWorkbook(workbook, getUsersFile(centerId));
  return updated;
}

async function deleteUser(userId) {
  const target = await findUserById(userId);
  if (!target) return false;

  const centerId = target.centerId;
  const workbook = await loadWorkbook(getUsersFile(centerId));
  const sheet = workbook.getWorksheet('Users');
  if (!sheet) return false;

  let rowToDelete = null;
  sheet.eachRow((row, rowNum) => {
    if (rowNum > 1 && normalizeCellValue(row.getCell(1).value) === userId) {
      rowToDelete = rowNum;
    }
  });
  if (!rowToDelete) return false;
  sheet.spliceRows(rowToDelete, 1);
  await saveWorkbook(workbook, getUsersFile(centerId));
  return true;
}

async function logActivity(action, user, details = {}) {
  const centerId = details.centerId || '';
  if (!centerId) return;

  const centerName = requireCenter(centerId).name;
  const filePath = getWorkbookFile('logs', centerId);
  const workbook = await loadWorkbook(filePath);
  let sheet = workbook.getWorksheet('Activity Log');
  if (!sheet) {
    sheet = createStyledWorksheet(workbook, 'Activity Log', LOG_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
  } else {
    applyWorksheetColumns(sheet, LOG_COLUMNS);
  }

  const row = sheet.addRow({
    ts: new Date(),
    centerId,
    centerName,
    user,
    role: details.role || '',
    action,
    details: details.info || '',
  });
  styleDataRow(row, sheet.rowCount % 2 === 0);
  await saveWorkbook(workbook, filePath);
}

async function getLogs(centerId) {
  const center = requireCenter(centerId);
  const filePath = getWorkbookFile('logs', center.id);
  if (!fsSync.existsSync(filePath)) return [];
  const workbook = await loadWorkbook(filePath);
  const sheet = workbook.getWorksheet('Activity Log');
  if (!sheet) return [];

  const logs = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    logs.push({
      ts: normalizeCellValue(row.getCell(1).value),
      centerId: normalizeCellValue(row.getCell(2).value) || center.id,
      centerName: normalizeCellValue(row.getCell(3).value) || center.name,
      user: normalizeCellValue(row.getCell(4).value),
      role: normalizeCellValue(row.getCell(5).value),
      action: normalizeCellValue(row.getCell(6).value),
      details: normalizeCellValue(row.getCell(7).value),
    });
  });
  return logs;
}

async function saveWhatsappMessage(message) {
  const centerId = String(message.centerId || '').trim();
  if (!centerId) return message;

  const center = requireCenter(centerId);
  const filePath = getWorkbookFile('whatsapp', center.id);
  const workbook = await loadWorkbook(filePath);
  let sheet = workbook.getWorksheet('WhatsApp Messages');
  if (!sheet) {
    sheet = createStyledWorksheet(workbook, 'WhatsApp Messages', WHATSAPP_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
  } else {
    applyWorksheetColumns(sheet, WHATSAPP_COLUMNS);
  }

  const row = sheet.addRow({
    messageId: message.messageId || uuidv4(),
    centerId: center.id,
    centerName: center.name,
    ts: message.ts ? new Date(message.ts) : new Date(),
    direction: message.direction || 'inbound',
    from: message.from || '',
    to: message.to || '',
    profileName: message.profileName || '',
    body: message.body || '',
    channel: message.channel || 'whatsapp',
    orderId: message.orderId || '',
    status: message.status || '',
  });
  styleDataRow(row, sheet.rowCount % 2 === 0);
  await saveWorkbook(workbook, filePath);
  return message;
}

async function getWhatsappMessages(centerId) {
  const center = requireCenter(centerId);
  const filePath = getWorkbookFile('whatsapp', center.id);
  if (!fsSync.existsSync(filePath)) return [];
  const workbook = await loadWorkbook(filePath);
  const sheet = workbook.getWorksheet('WhatsApp Messages');
  if (!sheet) return [];

  const messages = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const value = index => normalizeCellValue(row.getCell(index).value);
    messages.push({
      messageId: value(1),
      centerId: value(2) || center.id,
      centerName: value(3) || center.name,
      ts: value(4),
      direction: value(5),
      from: value(6),
      to: value(7),
      profileName: value(8),
      body: value(9),
      channel: value(10),
      orderId: value(11),
      status: value(12),
    });
  });
  return messages.filter(message => message.messageId);
}

async function getAnalytics() {
  const stats = {
    totalUsers: 0,
    totalOrders: 0,
    totalInventory: 0,
    centers: {}
  };

  for (const center of CENTERS) {
    const users = await getUsers({ centerId: center.id });
    const orders = await getOrders(center.id);
    const inventory = await getInventory(center.id);
    stats.centers[center.id] = {
      name: center.name,
      users: users.length,
      orders: orders.length,
      inventory: inventory.length,
    };
    stats.totalUsers += users.length;
    stats.totalOrders += orders.length;
    stats.totalInventory += inventory.length;
  }

  return stats;
}

module.exports = {
  CENTERS,
  DATA_DIR,
  FILES,
  addInventoryItem,
  addUser,
  deleteInventoryItem,
  deleteUser,
  findUser,
  findUserById,
  getCenterPaths,
  getInventory,
  getLogs,
  getOrders,
  getUsers,
  getWhatsappMessages,
  getWorkbookFile,
  initAllCenterData,
  initInventory,
  initUsers,
  logActivity,
  saveOrder,
  saveWhatsappMessage,
  updateInventoryItem,
  updateOrderStatus,
  updateUser,
  getAnalytics,
};
