const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../data');

const FILES = {
  inventory: path.join(DATA_DIR, 'inventory.xlsx'),
  orders: path.join(DATA_DIR, 'orders.xlsx'),
  users: path.join(DATA_DIR, 'users.xlsx'),
  logs: path.join(DATA_DIR, 'activity_logs.xlsx'),
  whatsapp: path.join(DATA_DIR, 'whatsapp_messages.xlsx'),
  orderMeta: path.join(DATA_DIR, 'order_meta.json'),
};

const INVENTORY_COLUMNS = [
  { header: 'Component ID', key: 'id', width: 18 },
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
  { header: 'Role', key: 'role', width: 12 },
  { header: 'Active', key: 'active', width: 10 },
  { header: 'Created At', key: 'createdAt', width: 20 },
  { header: 'Source', key: 'source', width: 14 },
];

const LOG_COLUMNS = [
  { header: 'Timestamp', key: 'ts', width: 22 },
  { header: 'User', key: 'user', width: 20 },
  { header: 'Role', key: 'role', width: 12 },
  { header: 'Action', key: 'action', width: 25 },
  { header: 'Details', key: 'details', width: 60 },
];

const WHATSAPP_COLUMNS = [
  { header: 'Message ID', key: 'messageId', width: 40 },
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

// ─── WORKBOOK HELPERS ───────────────────────────────────────────────────────

async function loadWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(filePath);
  } catch {
    // File doesn't exist yet — blank workbook
  }
  return wb;
}

async function saveWorkbook(wb, filePath) {
  await wb.xlsx.writeFile(filePath);
}

async function loadOrderMetaStore() {
  try {
    const raw = await fs.readFile(FILES.orderMeta, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveOrderMetaStore(store) {
  await fs.writeFile(FILES.orderMeta, JSON.stringify(store, null, 2), 'utf8');
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

function applyWorksheetColumns(ws, columns) {
  ws.columns = columns;
  styleHeader(ws.getRow(1));
}

function createStyledWorksheet(wb, name, columns, options = {}) {
  const ws = wb.addWorksheet(name, options);
  applyWorksheetColumns(ws, columns);
  return ws;
}

function styleHeader(row) {
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' }
    };
  });
  row.height = 22;
}

function styleDataRow(row, isEven) {
  row.eachCell(cell => {
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: isEven ? 'FFF5F5F5' : 'FFFFFFFF' }
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'hair' }, left: { style: 'hair' },
      bottom: { style: 'hair' }, right: { style: 'hair' }
    };
  });
}

function createUsersWorksheet(wb) {
  return createStyledWorksheet(wb, 'Users', USER_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
}

function createWhatsappWorksheet(wb) {
  return createStyledWorksheet(wb, 'WhatsApp Messages', WHATSAPP_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
}

// ─── INVENTORY ──────────────────────────────────────────────────────────────

async function initInventory() {
  const wb = new ExcelJS.Workbook();
  const ws = createStyledWorksheet(wb, 'Inventory', INVENTORY_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });

  const dummyComponents = [
    { id: uuidv4(), name: 'Arduino Uno R3', category: 'Microcontroller', description: 'ATmega328P based microcontroller board, 14 digital I/O pins, 6 analog inputs', stock: 25, totalProcured: 25, totalIssued: 0, unit: 'pcs', location: 'Bin-A1', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'Raspberry Pi 4 (4GB)', category: 'Single Board Computer', description: 'Quad-core ARM Cortex-A72, 4GB RAM, dual HDMI, USB 3.0', stock: 10, totalProcured: 10, totalIssued: 0, unit: 'pcs', location: 'Bin-A2', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'ESP32 Dev Board', category: 'Microcontroller', description: 'Dual-core Xtensa LX6, WiFi + Bluetooth, 38 GPIO pins', stock: 30, totalProcured: 30, totalIssued: 0, unit: 'pcs', location: 'Bin-A3', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'NodeMCU ESP8266', category: 'Microcontroller', description: 'WiFi enabled microcontroller, 11 digital GPIO pins, suitable for IoT projects', stock: 20, totalProcured: 20, totalIssued: 0, unit: 'pcs', location: 'Bin-A4', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'Breadboard 830 Tie', category: 'Prototyping', description: 'Full-size solderless breadboard with 830 tie points', stock: 40, totalProcured: 40, totalIssued: 0, unit: 'pcs', location: 'Bin-B1', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'Jumper Wires (M-M)', category: 'Prototyping', description: 'Male-Male dupont jumper wires, 20cm length, pack of 40', stock: 50, totalProcured: 50, totalIssued: 0, unit: 'packs', location: 'Bin-B2', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'Jumper Wires (M-F)', category: 'Prototyping', description: 'Male-Female dupont jumper wires, 20cm length, pack of 40', stock: 50, totalProcured: 50, totalIssued: 0, unit: 'packs', location: 'Bin-B3', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'HC-SR04 Ultrasonic Sensor', category: 'Sensors', description: 'Ultrasonic distance sensor, range 2cm - 400cm, 5V operation', stock: 20, totalProcured: 20, totalIssued: 0, unit: 'pcs', location: 'Bin-C1', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'DHT11 Temp & Humidity', category: 'Sensors', description: 'Digital temperature and humidity sensor, range 0-50°C, 20-90% RH', stock: 25, totalProcured: 25, totalIssued: 0, unit: 'pcs', location: 'Bin-C2', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'PIR Motion Sensor', category: 'Sensors', description: 'Passive infrared motion detector module, 3-7m range, 120° angle', stock: 18, totalProcured: 18, totalIssued: 0, unit: 'pcs', location: 'Bin-C3', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'LDR Light Sensor', category: 'Sensors', description: 'Light dependent resistor module with digital and analog output', stock: 30, totalProcured: 30, totalIssued: 0, unit: 'pcs', location: 'Bin-C4', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'MQ-2 Gas Sensor', category: 'Sensors', description: 'Smoke and combustible gas detection sensor module', stock: 15, totalProcured: 15, totalIssued: 0, unit: 'pcs', location: 'Bin-C5', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'Servo Motor SG90', category: 'Actuators', description: '9g micro servo motor, 180° rotation, 4.8-6V, 1.8 kg/cm torque', stock: 20, totalProcured: 20, totalIssued: 0, unit: 'pcs', location: 'Bin-D1', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'DC Gear Motor 12V', category: 'Actuators', description: '12V DC gear motor with metal gearbox, 150 RPM, 1.5 kg/cm', stock: 15, totalProcured: 15, totalIssued: 0, unit: 'pcs', location: 'Bin-D2', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'L298N Motor Driver', category: 'Motor Drivers', description: 'Dual H-Bridge motor driver, 2A per channel, 5-35V, supports 2 DC or 1 stepper motor', stock: 15, totalProcured: 15, totalIssued: 0, unit: 'pcs', location: 'Bin-D3', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: '16x2 LCD Display', category: 'Display', description: 'Character LCD with I2C backpack, blue backlight, 5V operation', stock: 12, totalProcured: 12, totalIssued: 0, unit: 'pcs', location: 'Bin-E1', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'OLED 0.96" I2C', category: 'Display', description: '128x64 OLED display module, I2C interface, 3.3-5V, SSD1306 driver', stock: 12, totalProcured: 12, totalIssued: 0, unit: 'pcs', location: 'Bin-E2', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'Resistor Kit (600pcs)', category: 'Passive Components', description: 'Assorted resistors 10Ω to 1MΩ, 1/4W, 1% tolerance, 30 values × 20pcs', stock: 20, totalProcured: 20, totalIssued: 0, unit: 'kits', location: 'Bin-F1', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'Capacitor Kit (300pcs)', category: 'Passive Components', description: 'Ceramic and electrolytic capacitors assortment, 0.1µF to 1000µF', stock: 15, totalProcured: 15, totalIssued: 0, unit: 'kits', location: 'Bin-F2', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'LED Assortment (100pcs)', category: 'Passive Components', description: '5mm LEDs in 5 colors (Red, Green, Blue, Yellow, White), 20 each', stock: 25, totalProcured: 25, totalIssued: 0, unit: 'packs', location: 'Bin-F3', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'Push Button Assortment', category: 'Input Devices', description: '12x12mm tactile push buttons, 4-pin, PCB mount, pack of 25', stock: 30, totalProcured: 30, totalIssued: 0, unit: 'packs', location: 'Bin-G1', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'Potentiometer 10K', category: 'Input Devices', description: '10K ohm rotary potentiometer, B10K, panel mount, linear taper', stock: 30, totalProcured: 30, totalIssued: 0, unit: 'pcs', location: 'Bin-G2', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: '4x4 Matrix Keypad', category: 'Input Devices', description: 'Membrane keypad 4x4 matrix, 16 keys, 8-pin connector', stock: 10, totalProcured: 10, totalIssued: 0, unit: 'pcs', location: 'Bin-G3', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: 'USB Type-A Cable', category: 'Cables & Power', description: 'USB-A to USB-B cable, 1m, for Arduino programming and power', stock: 20, totalProcured: 20, totalIssued: 0, unit: 'pcs', location: 'Bin-H1', addedDate: new Date(), image: '', active: true },
    { id: uuidv4(), name: '9V Battery Snap', category: 'Cables & Power', description: '9V battery connector with wire leads, 15cm length', stock: 40, totalProcured: 40, totalIssued: 0, unit: 'pcs', location: 'Bin-H2', addedDate: new Date(), image: '', active: true },
  ];

  dummyComponents.forEach((comp, i) => {
    const row = ws.addRow(comp);
    styleDataRow(row, i % 2 === 0);
  });

  await wb.xlsx.writeFile(FILES.inventory);
  return dummyComponents;
}

async function getInventory() {
  const wb = await loadWorkbook(FILES.inventory);
  const ws = wb.getWorksheet('Inventory');
  if (!ws) return [];
  const items = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const val = v => normalizeCellValue(row.getCell(v).value);
    items.push({
      id: val(1), name: val(2), category: val(3), description: val(4),
      stock: Number(val(5)) || 0, totalProcured: Number(val(6)) || 0,
      totalIssued: Number(val(7)) || 0, unit: val(8), location: val(9),
      addedDate: val(10), image: val(11) || '',
      active: normalizeBoolean(row.getCell(12).value),
      damagedCount: Number(val(13)) || 0,
    });
  });
  return items.filter(i => i.id);
}

async function updateInventoryItem(id, updates) {
  const wb = await loadWorkbook(FILES.inventory);
  const ws = wb.getWorksheet('Inventory');
  let found = false;
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    if (row.getCell(1).value === id) {
      if (updates.name !== undefined) row.getCell(2).value = updates.name;
      if (updates.category !== undefined) row.getCell(3).value = updates.category;
      if (updates.description !== undefined) row.getCell(4).value = updates.description;
      if (updates.stock !== undefined) row.getCell(5).value = Number(updates.stock);
      if (updates.totalProcured !== undefined) row.getCell(6).value = Number(updates.totalProcured);
      if (updates.totalIssued !== undefined) row.getCell(7).value = Number(updates.totalIssued);
      if (updates.unit !== undefined) row.getCell(8).value = updates.unit;
      if (updates.location !== undefined) row.getCell(9).value = updates.location;
      if (updates.image !== undefined) row.getCell(11).value = updates.image;
      if (updates.active !== undefined) row.getCell(12).value = updates.active;
      if (updates.damagedCount !== undefined) row.getCell(13).value = Number(updates.damagedCount);
      found = true;
    }
  });
  if (found) await saveWorkbook(wb, FILES.inventory);
  return found;
}

async function addInventoryItem(item) {
  const wb = await loadWorkbook(FILES.inventory);
  let ws = wb.getWorksheet('Inventory');
  if (!ws) {
    ws = createStyledWorksheet(wb, 'Inventory', INVENTORY_COLUMNS);
  } else {
    applyWorksheetColumns(ws, INVENTORY_COLUMNS);
  }
  const newItem = { id: uuidv4(), ...item, totalIssued: 0, addedDate: new Date(), damagedCount: Number(item.damagedCount) || 0 };
  const row = ws.addRow(newItem);
  const rowCount = ws.rowCount;
  styleDataRow(row, rowCount % 2 === 0);
  await saveWorkbook(wb, FILES.inventory);
  return newItem;
}

async function deleteInventoryItem(id) {
  const wb = await loadWorkbook(FILES.inventory);
  const ws = wb.getWorksheet('Inventory');
  let rowToDelete = null;
  ws.eachRow((row, rowNum) => {
    if (rowNum > 1 && row.getCell(1).value === id) rowToDelete = rowNum;
  });
  if (rowToDelete) {
    ws.spliceRows(rowToDelete, 1);
    await saveWorkbook(wb, FILES.inventory);
    return true;
  }
  return false;
}

// ─── ORDERS ─────────────────────────────────────────────────────────────────

async function saveOrder(order) {
  const wb = await loadWorkbook(FILES.orders);
  let ws = wb.getWorksheet('Orders');
  if (!ws) {
    ws = createStyledWorksheet(wb, 'Orders', ORDER_COLUMNS, { views: [{ state: 'frozen', ySplit: 1 }] });
  } else {
    applyWorksheetColumns(ws, ORDER_COLUMNS);
  }

  const componentSummary = order.items.map(i => `${i.name}(x${i.qty})`).join(', ');
  const row = ws.addRow({
    orderId: order.orderId,
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
    totalItems: order.items.reduce((s, i) => s + i.qty, 0),
    status: order.status,
    adminRemarks: '',
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
  });
  styleDataRow(row, ws.rowCount % 2 === 0);
  await saveWorkbook(wb, FILES.orders);

  const orderMetaStore = await loadOrderMetaStore();
  orderMetaStore[order.orderId] = {
    ...(orderMetaStore[order.orderId] || {}),
    expectedReturnDate: order.expectedReturnDate || '',
    reminderSentAt: order.reminderSentAt || '',
  };
  await saveOrderMetaStore(orderMetaStore);
}

async function getOrders() {
  const wb = await loadWorkbook(FILES.orders);
  const ws = wb.getWorksheet('Orders');
  if (!ws) return [];
  const orderMetaStore = await loadOrderMetaStore();
  const orders = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const val = (n) => normalizeCellValue(row.getCell(n).value);
    const baseOrder = {
      orderId: val(1), createdAt: val(2), studentName: val(3), username: val(4),
      mobile: val(5), college: val(6), department: val(7), courseName: val(8),
      projectName: val(9), teamName: val(10), facultyGuide: val(11), purpose: val(12),
      components: val(13), totalItems: val(14), status: val(15),
      adminRemarks: val(16), resolvedAt: val(17),
      studentEmail: val(18), itemsJson: val(19),
      stockReserved: normalizeBoolean(row.getCell(20).value),
      issuedCounted: normalizeBoolean(row.getCell(21).value),
      reservedAt: val(22), issuedAt: val(23), returnRequestedAt: val(24), returnedAt: val(25),
      returnSummaryJson: val(26), lastReturnAt: val(27),
    };
    const meta = orderMetaStore[baseOrder.orderId] || {};
    orders.push({
      ...baseOrder,
      expectedReturnDate: meta.expectedReturnDate || null,
      reminderSentAt: meta.reminderSentAt || null,
    });
  });
  return orders.filter(o => o.orderId);
}

async function updateOrderStatus(orderId, status, remarks, meta = {}) {
  const wb = await loadWorkbook(FILES.orders);
  const ws = wb.getWorksheet('Orders');
  let found = false;
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const cellVal = row.getCell(1).value;
    if (cellVal === orderId) {
      row.getCell(15).value = status;
      if (remarks !== undefined) row.getCell(16).value = remarks;
      row.getCell(17).value = meta.resolvedAt ? new Date(meta.resolvedAt) : new Date();
      if (meta.studentEmail !== undefined) row.getCell(18).value = meta.studentEmail;
      if (meta.itemsJson !== undefined) row.getCell(19).value = meta.itemsJson;
      if (meta.stockReserved !== undefined) row.getCell(20).value = meta.stockReserved;
      if (meta.issuedCounted !== undefined) row.getCell(21).value = meta.issuedCounted;
      if (meta.reservedAt !== undefined) row.getCell(22).value = meta.reservedAt ? new Date(meta.reservedAt) : '';
      if (meta.issuedAt !== undefined) row.getCell(23).value = meta.issuedAt ? new Date(meta.issuedAt) : '';
      if (meta.returnRequestedAt !== undefined) row.getCell(24).value = meta.returnRequestedAt ? new Date(meta.returnRequestedAt) : '';
      if (meta.returnedAt !== undefined) row.getCell(25).value = meta.returnedAt ? new Date(meta.returnedAt) : '';
      if (meta.returnSummaryJson !== undefined) row.getCell(26).value = meta.returnSummaryJson;
      if (meta.lastReturnAt !== undefined) row.getCell(27).value = meta.lastReturnAt ? new Date(meta.lastReturnAt) : '';
      const statusCell = row.getCell(15);
      statusCell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: {
          argb:
            status === 'Approved' ? 'FFE8F5E9' :
            status === 'Rejected' ? 'FFFCE4EC' :
            status === 'Return Requested' ? 'FFFFF3E0' :
            status === 'Partially Returned' ? 'FFE8F0FE' :
            status === 'Returned' ? 'FFE3F2FD' :
            'FFFFF9C4'
        }
      };
      found = true;
    }
  });
  if (found) {
    await saveWorkbook(wb, FILES.orders);
    if (meta.expectedReturnDate !== undefined || meta.reminderSentAt !== undefined) {
      const orderMetaStore = await loadOrderMetaStore();
      orderMetaStore[orderId] = {
        ...(orderMetaStore[orderId] || {}),
        ...(meta.expectedReturnDate !== undefined ? { expectedReturnDate: meta.expectedReturnDate || '' } : {}),
        ...(meta.reminderSentAt !== undefined ? { reminderSentAt: meta.reminderSentAt || '' } : {}),
      };
      await saveOrderMetaStore(orderMetaStore);
    }
  }
  return found;
}

// ─── USERS ──────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');

function userFromRow(row) {
  return {
    id: normalizeCellValue(row.getCell(1).value),
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

async function initUsers() {
  const wb = new ExcelJS.Workbook();
  const ws = createUsersWorksheet(wb);
  const adminHash = await bcrypt.hash('admin123', 10);
  const s1Hash = await bcrypt.hash('student123', 10);
  const s2Hash = await bcrypt.hash('pass123', 10);
  ws.addRow({ id: uuidv4(), username: 'admin', passwordHash: adminHash, fullName: 'System Administrator', email: 'admin@cims.edu', role: 'admin', active: true, createdAt: new Date(), source: 'manual' });
  ws.addRow({ id: uuidv4(), username: 'student1', passwordHash: s1Hash, fullName: 'Ravi Kumar', email: 'ravi.kumar@cims.edu', role: 'student', active: true, createdAt: new Date(), source: 'manual' });
  ws.addRow({ id: uuidv4(), username: 'student2', passwordHash: s2Hash, fullName: 'Priya Sharma', email: 'priya.sharma@cims.edu', role: 'student', active: true, createdAt: new Date(), source: 'manual' });
  await wb.xlsx.writeFile(FILES.users);
}

async function findUser(username) {
  const wb = await loadWorkbook(FILES.users);
  const ws = wb.getWorksheet('Users');
  if (!ws) return null;
  let user = null;
  const needle = String(username || '').trim().toLowerCase();
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const rowUsername = String(normalizeCellValue(row.getCell(2).value) || '').trim().toLowerCase();
    const rowEmail = String(normalizeCellValue(row.getCell(5).value) || '').trim().toLowerCase();
    if (rowUsername === needle || rowEmail === needle) {
      user = userFromRow(row);
    }
  });
  return user;
}

async function findUserById(userId) {
  const wb = await loadWorkbook(FILES.users);
  const ws = wb.getWorksheet('Users');
  if (!ws) return null;
  let user = null;
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    if (normalizeCellValue(row.getCell(1).value) === userId) {
      user = userFromRow(row);
    }
  });
  return user;
}

async function getUsers() {
  const wb = await loadWorkbook(FILES.users);
  const ws = wb.getWorksheet('Users');
  if (!ws) return [];
  const users = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    users.push(userFromRow(row));
  });
  return users.filter(u => u.id);
}

async function addUser(userData) {
  const wb = await loadWorkbook(FILES.users);
  let ws = wb.getWorksheet('Users');
  if (!ws) {
    ws = createUsersWorksheet(wb);
  } else {
    applyWorksheetColumns(ws, USER_COLUMNS);
  }
  const username = String(userData.username || '').trim();
  const fullName = String(userData.fullName || '').trim();
  const email = String(userData.email || '').trim();
  const password = String(userData.password || '');

  if (!username || !fullName || !password) {
    throw new Error('Username, full name and password are required');
  }

  const existing = await findUser(username);
  if (existing) throw new Error('Username already exists');
  const hash = await bcrypt.hash(password, 10);
  const row = ws.addRow({
    id: uuidv4(),
    username,
    passwordHash: hash,
    fullName,
    email,
    mobile: userData.mobile || '',
    altMobile: userData.altMobile || '',
    college: userData.college || '',
    graduationYear: userData.graduationYear || '',
    degree: userData.degree || '',
    department: userData.department || '',
    role: userData.role || 'student',
    active: userData.active !== undefined ? !!userData.active : true,
    createdAt: new Date(),
    source: userData.source || 'manual',
  });
  styleDataRow(row, ws.rowCount % 2 === 0);
  await saveWorkbook(wb, FILES.users);
}

async function updateUser(userId, userData) {
  const wb = await loadWorkbook(FILES.users);
  const ws = wb.getWorksheet('Users');
  if (!ws) throw new Error('Users sheet not found');
  applyWorksheetColumns(ws, USER_COLUMNS);

  const target = await findUserById(userId);
  if (!target) throw new Error('User not found');

  const username = userData.username !== undefined ? String(userData.username || '').trim() : target.username;
  const fullName = userData.fullName !== undefined ? String(userData.fullName || '').trim() : target.fullName;
  const email = userData.email !== undefined ? String(userData.email || '').trim() : target.email;
  const mobile = userData.mobile !== undefined ? String(userData.mobile || '').trim() : target.mobile || '';
  const altMobile = userData.altMobile !== undefined ? String(userData.altMobile || '').trim() : target.altMobile || '';
  const college = userData.college !== undefined ? String(userData.college || '').trim() : target.college || '';
  const graduationYear = userData.graduationYear !== undefined ? String(userData.graduationYear || '').trim() : target.graduationYear || '';
  const degree = userData.degree !== undefined ? String(userData.degree || '').trim() : target.degree || '';
  const department = userData.department !== undefined ? String(userData.department || '').trim() : target.department || '';

  if (!username || !fullName) {
    throw new Error('Username and full name are required');
  }

  const existing = await findUser(username);
  if (existing && existing.id !== userId) {
    throw new Error('Username already exists');
  }

  let updated = null;
  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum += 1) {
    const row = ws.getRow(rowNum);
    if (normalizeCellValue(row.getCell(1).value) !== userId) continue;

    row.getCell(2).value = username;
    row.getCell(4).value = fullName;
    row.getCell(5).value = email;
    row.getCell(6).value = mobile;
    row.getCell(7).value = altMobile;
    row.getCell(8).value = college;
    row.getCell(9).value = graduationYear;
    row.getCell(10).value = degree;
    row.getCell(11).value = department;
    if (userData.role !== undefined) row.getCell(12).value = userData.role;
    if (userData.active !== undefined) row.getCell(13).value = !!userData.active;
    if (userData.source !== undefined) row.getCell(15).value = userData.source;
    if (userData.password) {
      row.getCell(3).value = await bcrypt.hash(String(userData.password), 10);
    }

    updated = userFromRow(row);
    break;
  }

  await saveWorkbook(wb, FILES.users);
  return updated;
}

async function deleteUser(userId) {
  const wb = await loadWorkbook(FILES.users);
  const ws = wb.getWorksheet('Users');
  if (!ws) return false;

  let rowToDelete = null;
  ws.eachRow((row, rowNum) => {
    if (rowNum > 1 && normalizeCellValue(row.getCell(1).value) === userId) {
      rowToDelete = rowNum;
    }
  });

  if (rowToDelete) {
    ws.spliceRows(rowToDelete, 1);
    await saveWorkbook(wb, FILES.users);
    return true;
  }

  return false;
}

// ─── ACTIVITY LOG ───────────────────────────────────────────────────────────

async function logActivity(action, user, details) {
  const wb = await loadWorkbook(FILES.logs);
  let ws = wb.getWorksheet('Activity Log');
  if (!ws) {
    ws = createStyledWorksheet(wb, 'Activity Log', LOG_COLUMNS);
  } else {
    applyWorksheetColumns(ws, LOG_COLUMNS);
  }
  const row = ws.addRow({ ts: new Date(), user, role: details.role || '', action, details: details.info || '' });
  styleDataRow(row, ws.rowCount % 2 === 0);
  await saveWorkbook(wb, FILES.logs);
}

async function saveWhatsappMessage(message) {
  const wb = await loadWorkbook(FILES.whatsapp);
  let ws = wb.getWorksheet('WhatsApp Messages');
  if (!ws) {
    ws = createWhatsappWorksheet(wb);
  } else {
    applyWorksheetColumns(ws, WHATSAPP_COLUMNS);
  }

  const row = ws.addRow({
    messageId: message.messageId || uuidv4(),
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
  styleDataRow(row, ws.rowCount % 2 === 0);
  await saveWorkbook(wb, FILES.whatsapp);
  return message;
}

async function getWhatsappMessages() {
  const wb = await loadWorkbook(FILES.whatsapp);
  const ws = wb.getWorksheet('WhatsApp Messages');
  if (!ws) return [];

  const messages = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const val = n => normalizeCellValue(row.getCell(n).value);
    messages.push({
      messageId: val(1),
      ts: val(2),
      direction: val(3),
      from: val(4),
      to: val(5),
      profileName: val(6),
      body: val(7),
      channel: val(8),
      orderId: val(9),
      status: val(10),
    });
  });

  return messages.filter(message => message.messageId);
}

module.exports = {
  FILES, initInventory, getInventory, updateInventoryItem, addInventoryItem, deleteInventoryItem,
  saveOrder, getOrders, updateOrderStatus,
  initUsers, findUser, findUserById, getUsers, addUser, updateUser, deleteUser, logActivity,
  saveWhatsappMessage, getWhatsappMessages,
};
