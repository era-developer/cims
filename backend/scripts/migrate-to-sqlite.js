/**
 * Migrates v1 per-center Excel data (backend/data/<center>/*.xlsx) into the
 * v2 SQLite schema (backend/db/migrations/001_init.sql).
 *
 * SAFETY:
 * - By default reads from backend/data_v1_snapshot_for_migration_dryrun/
 *   (a copy), never the live backend/data/. Pass --live to read the real
 *   data directory -- this script never writes to *.xlsx files either way,
 *   it only reads them and writes a new .db file.
 * - Refuses to overwrite an existing target .db file.
 *
 * Usage:
 *   node scripts/migrate-to-sqlite.js [--out <path>] [--live]
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { openDatabase } = require('../utils/db');
const { CENTERS } = require('../utils/centers');
const { CLASSIFICATIONS, LEGACY_CLASSIFICATION } = require('../utils/classifications');

const args = process.argv.slice(2);
const liveMode = args.includes('--live');
const outIndex = args.indexOf('--out');

const SOURCE_DATA_DIR = liveMode
  ? path.join(__dirname, '..', 'data')
  : path.join(__dirname, '..', 'data_v1_snapshot_for_migration_dryrun');

const TARGET_DB_PATH = outIndex !== -1 && args[outIndex + 1]
  ? args[outIndex + 1]
  : path.join(__dirname, '..', 'data_v1_snapshot_for_migration_dryrun', 'cims_v2_dryrun.db');

if (!fs.existsSync(SOURCE_DATA_DIR)) {
  console.error(`[migrate] Source not found: ${SOURCE_DATA_DIR}`);
  process.exit(1);
}
if (fs.existsSync(TARGET_DB_PATH)) {
  console.error(`[migrate] Target already exists: ${TARGET_DB_PATH}. Delete it first to re-run.`);
  process.exit(1);
}

console.log(`[migrate] source: ${SOURCE_DATA_DIR}`);
console.log(`[migrate] target: ${TARGET_DB_PATH}`);
console.log(`[migrate] mode:   ${liveMode ? 'LIVE data dir (read-only)' : 'DRY RUN (snapshot copy)'}`);

// ---------- Excel reading helpers (mirrors backend/utils/excel.js) ----------

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

// Excel's day-0 epoch is 1899-12-30 (this accounts for Excel's 1900 leap-year bug).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

// node:sqlite can only bind numbers/strings/bigints/buffers/null -- ExcelJS
// hands back JS Date objects for cleanly-formatted date cells, but for cells
// where the date number format wasn't recognized it instead returns the raw
// Excel serial number (e.g. 46158.27 for a 2026 date). Only call this on
// fields that are known to be dates -- the serial-number heuristic would
// misfire on plain quantity fields.
function toDbValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return new Date(EXCEL_EPOCH_MS + value * 86400 * 1000).toISOString();
  }
  return value;
}

async function loadWorkbook(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

function readInventoryRows(sheet, center) {
  const items = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const value = index => normalizeCellValue(row.getCell(index).value);
    const id = value(1);
    if (!id) return;
    const col2 = value(2);
    const isNewFormat = col2 && typeof col2 === 'string' &&
      (col2.includes('_') || CENTERS.some(c => c.id === col2));
    let item;
    if (isNewFormat) {
      item = {
        id, centerId: col2 || center.id, centerName: value(3) || center.name, name: value(4),
        category: value(5), description: value(6), stock: Number(value(7)) || 0,
        totalProcured: Number(value(8)) || 0, totalIssued: Number(value(9)) || 0,
        unit: value(10) || 'pcs', location: value(11) || '', addedDate: value(12),
        image: value(13) || '', active: normalizeBoolean(row.getCell(14).value),
        damagedCount: Number(value(15)) || 0, invoiceNumber: value(16) || '',
        vendorName: value(17) || '', purchasePurpose: value(18) || '', purchasedFor: value(19) || '',
      };
    } else {
      item = {
        id, centerId: center.id, centerName: center.name, name: col2, category: value(3),
        description: value(4), stock: Number(value(5)) || 0, totalProcured: Number(value(6)) || 0,
        totalIssued: Number(value(7)) || 0, unit: value(8) || 'pcs', location: value(9) || '',
        addedDate: value(10), image: value(11) || '', active: normalizeBoolean(row.getCell(12).value),
        damagedCount: Number(value(13)) || 0, invoiceNumber: '', vendorName: '', purchasePurpose: '', purchasedFor: '',
      };
    }
    if (item.name) items.push(item);
  });
  return items;
}

function readOrderRows(sheet) {
  const orders = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const value = index => normalizeCellValue(row.getCell(index).value);
    orders.push({
      orderId: value(1), centerId: value(2), centerName: value(3), createdAt: value(4),
      studentName: value(5), username: value(6), mobile: value(7), college: value(8),
      department: value(9), courseName: value(10), projectName: value(11), teamName: value(12),
      facultyGuide: value(13), purpose: value(14), totalItems: Number(value(16)) || 0,
      status: value(17), adminRemarks: value(18), studentEmail: value(20), itemsJson: value(21),
      reservedAt: value(24), issuedAt: value(25), returnRequestedAt: value(26), returnedAt: value(27),
      returnSummaryJson: value(28), lastReturnAt: value(29), expectedReturnDate: value(30),
      reminderSentAt: value(31),
    });
  });
  return orders.filter(o => o.orderId);
}

function readTransferRows(sheet) {
  const transfers = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const value = index => normalizeCellValue(row.getCell(index).value);
    let components = [];
    try { components = JSON.parse(value(8) || '[]'); } catch { /* ignore malformed json */ }
    transfers.push({
      id: value(1), requestingCenterId: value(2), requestedBy: value(4), requestDate: value(5),
      status: value(6) || 'Pending', components, programName: value(9), responsiblePerson: value(10),
      responsibleEmail: value(11), purpose: value(12), desiredReturnDate: value(13), notes: value(14),
      supplyCenterId: value(15), approvedAt: value(17), supplierRemarks: value(18),
      returnRequestedAt: value(19), returnedAt: value(20), returnNotes: value(21),
    });
  });
  return transfers.filter(t => t.id);
}

function readUserRows(sheet) {
  const users = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const value = index => normalizeCellValue(row.getCell(index).value);
    users.push({
      id: value(1), centerId: value(2), username: value(4), passwordHash: value(5),
      fullName: value(6), email: value(7), mobile: value(8), altMobile: value(9), college: value(10),
      graduationYear: value(11), degree: value(12), department: value(13), role: value(14),
      active: normalizeBoolean(row.getCell(15).value), createdAt: value(16), source: value(17) || 'manual',
    });
  });
  return users.filter(u => u.id && u.username);
}

// ---------- Migration ----------

async function main() {
  const db = openDatabase(TARGET_DB_PATH);
  const warnings = [];
  const report = { centers: {} };

  // 1. Master/lookup data
  const insertCenter = db.prepare('INSERT INTO centers (id, code, name) VALUES (?, ?, ?)');
  for (const c of CENTERS) insertCenter.run(c.id, c.code, c.name);

  const insertClassification = db.prepare('INSERT INTO classifications (name, sort_order) VALUES (?, ?)');
  CLASSIFICATIONS.forEach((c, i) => insertClassification.run(c.name, i));
  const legacyClassificationId = insertClassification.run(LEGACY_CLASSIFICATION.name, 999).lastInsertRowid;

  const unknownVendorId = db.prepare('INSERT INTO vendors (name) VALUES (?)').run('Unknown / Legacy').lastInsertRowid;
  db.prepare('INSERT INTO business_heads (name) VALUES (?)').run('Unspecified');

  const vendorIdByName = new Map(); // normalized name -> id
  function getOrCreateVendor(rawName) {
    const name = String(rawName || '').trim();
    if (!name) return unknownVendorId;
    const key = name.toLowerCase();
    if (vendorIdByName.has(key)) return vendorIdByName.get(key);
    const id = db.prepare('INSERT INTO vendors (name) VALUES (?)').run(name).lastInsertRowid;
    vendorIdByName.set(key, id);
    return id;
  }

  const catalogIdByKey = new Map(); // centerId::name -> id
  function getOrCreateCatalog(centerId, item) {
    const key = `${centerId}::${item.name}`;
    if (catalogIdByKey.has(key)) return catalogIdByKey.get(key);
    const id = db.prepare(
      'INSERT INTO product_catalog (center_id, name, classification_id, category, unit) VALUES (?, ?, ?, ?, ?)'
    ).run(centerId, item.name, legacyClassificationId, item.category || null, item.unit || 'pcs').lastInsertRowid;
    catalogIdByKey.set(key, id);
    return id;
  }

  const projectIdByKey = new Map(); // centerId::name -> id
  function getOrCreateProject(centerId, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const key = `${centerId}::${trimmed.toLowerCase()}`;
    if (projectIdByKey.has(key)) return projectIdByKey.get(key);
    const id = db.prepare('INSERT INTO projects (name, center_id) VALUES (?, ?)').run(trimmed, centerId).lastInsertRowid;
    projectIdByKey.set(key, id);
    return id;
  }

  const studentIdByKey = new Map(); // centerId::mobile or centerId::name|college -> id
  function getOrCreateStudent(centerId, order) {
    const mobile = String(order.mobile || '').trim();
    const name = String(order.studentName || 'Unknown Student').trim();
    const college = String(order.college || '').trim();
    const key = mobile ? `${centerId}::m:${mobile}` : `${centerId}::n:${name.toLowerCase()}|${college.toLowerCase()}`;
    if (studentIdByKey.has(key)) return studentIdByKey.get(key);
    let id;
    try {
      id = db.prepare(`
        INSERT INTO students (full_name, college, department, course_name, mobile, email, center_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(name, college || null, order.department || null, order.courseName || null,
             mobile || null, order.studentEmail || null, centerId).lastInsertRowid;
    } catch (err) {
      // UNIQUE(center_id, mobile) collision from a differently-cased/spaced duplicate; reuse existing row
      const existing = db.prepare('SELECT id FROM students WHERE center_id = ? AND mobile = ?').get(centerId, mobile);
      id = existing ? existing.id : null;
      if (!id) warnings.push(`Could not create or find student for order in ${centerId}: ${err.message}`);
    }
    studentIdByKey.set(key, id);
    return id;
  }

  // 2. Per-center inventory -> catalog + invoices/line items + assets
  // Wrapped in a single transaction: without it, node:sqlite commits (and
  // fsyncs) every individual INSERT, which is orders of magnitude slower.
  db.exec('BEGIN TRANSACTION');
  try {
  for (const center of CENTERS) {
    const centerReport = { inventoryRowsIn: 0, assetsCreated: 0, ordersIn: 0, issueRecordsCreated: 0, usersIn: 0, usersCreated: 0, transfersIn: 0, transfersCreated: 0 };
    report.centers[center.id] = centerReport;

    const baseDir = path.join(SOURCE_DATA_DIR, center.id);
    console.log(`[migrate] ${center.id}: reading inventory...`);
    const invWb = await loadWorkbook(path.join(baseDir, `${center.id}_inventory.xlsx`));
    const invSheet = invWb && invWb.getWorksheet('Inventory');
    const items = invSheet ? readInventoryRows(invSheet, center) : [];
    centerReport.inventoryRowsIn = items.length;

    let assetSeq = 1;
    for (const item of items) {
      const catalogId = getOrCreateCatalog(center.id, item);
      const vendorId = item.vendorName ? getOrCreateVendor(item.vendorName) : null;

      let invoiceLineItemId = null;
      if (item.invoiceNumber) {
        let invoice = db.prepare('SELECT id FROM invoices WHERE center_id = ? AND invoice_number = ?')
          .get(center.id, item.invoiceNumber);
        let invoiceId;
        if (invoice) {
          invoiceId = invoice.id;
        } else {
          invoiceId = db.prepare(`
            INSERT INTO invoices (center_id, invoice_number, vendor_id, is_legacy)
            VALUES (?, ?, ?, 1)
          `).run(center.id, item.invoiceNumber, vendorId || unknownVendorId).lastInsertRowid;
        }
        invoiceLineItemId = db.prepare(`
          INSERT INTO invoice_line_items
            (invoice_id, classification_id, asset_name, bill_quantity, unit, purchased_for)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(invoiceId, legacyClassificationId, item.name, item.totalProcured || item.stock || 0,
               item.unit || 'pcs', item.purchasedFor || null).lastInsertRowid;
      }

      // CRASH_GUARD is only a backstop against a genuinely corrupted cell (e.g. an
      // Excel date serial landing in a quantity column, ~40-50k) -- it does not
      // truncate plausible bulk-consumable counts, which can legitimately run
      // into the thousands (e.g. a bag of jumper wires).
      const CRASH_GUARD = 100000;
      const REVIEW_THRESHOLD = 2000;
      const damaged = Math.max(0, Number(item.damagedCount) || 0);
      const available = Math.max(0, Number(item.stock) || 0);
      let totalUnits = Number(item.totalProcured) || 0;
      if (totalUnits < damaged + available) totalUnits = damaged + available; // reconcile inconsistent legacy counters
      if (totalUnits > REVIEW_THRESHOLD) {
        warnings.push(`${center.id}/${item.name}: totalProcured=${item.totalProcured} is unusually large -- please confirm this is a real bulk count, not a data entry error`);
      }
      if (totalUnits > CRASH_GUARD) {
        warnings.push(`${center.id}/${item.name}: totalProcured=${item.totalProcured} exceeds the ${CRASH_GUARD} safety ceiling, looks corrupted -- capped, needs manual fix in source data`);
        totalUnits = CRASH_GUARD;
      }
      const issued = Math.max(0, totalUnits - damaged - available);

      const unitsByStatus = [
        ...Array(damaged).fill('damaged'),
        ...Array(available).fill('available'),
        ...Array(issued).fill('issued'),
      ];

      const insertAsset = db.prepare(`
        INSERT INTO assets
          (id, asset_tag, center_id, catalog_id, invoice_line_item_id, classification_id, name, description,
           category, unit, location, status, is_legacy, legacy_source_sku_id, active, added_date, image)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `);
      const insertEvent = db.prepare(`
        INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, occurred_at)
        VALUES (?, 'procured', NULL, ?, ?, 'Migrated from legacy v1 stock count', ?)
      `);

      const addedDate = item.addedDate instanceof Date ? item.addedDate.toISOString() : (item.addedDate || new Date().toISOString());
      for (const status of unitsByStatus) {
        const assetId = require('crypto').randomUUID();
        const assetTag = `${center.code}-LEGACY-${String(assetSeq).padStart(5, '0')}`;
        assetSeq += 1;
        insertAsset.run(
          assetId, assetTag, center.id, catalogId, invoiceLineItemId, legacyClassificationId,
          item.name, item.description || null, item.category || null, item.unit || 'pcs',
          item.location || null, status, item.id, item.active === false ? 0 : 1, addedDate, item.image || null
        );
        insertEvent.run(assetId, status, center.id, addedDate);
        centerReport.assetsCreated += 1;
      }
    }

    console.log(`[migrate] ${center.id}: inventory done (${centerReport.inventoryRowsIn} rows -> ${centerReport.assetsCreated} assets)`);

    // 3. Orders -> students, projects, issue_records
    console.log(`[migrate] ${center.id}: reading orders...`);
    const ordWb = await loadWorkbook(path.join(baseDir, `${center.id}_orders.xlsx`));
    const ordSheet = ordWb && (ordWb.getWorksheet('Orders') || ordWb.worksheets[0]);
    const orders = ordSheet ? readOrderRows(ordSheet) : [];
    centerReport.ordersIn = orders.length;

    for (const order of orders) {
      const studentId = getOrCreateStudent(center.id, order);
      if (!studentId) continue;
      const projectId = getOrCreateProject(center.id, order.projectName);

      let issueRecordId;
      try {
        issueRecordId = db.prepare(`
          INSERT INTO issue_records
            (order_id, center_id, student_id, project_id, team_name, faculty_guide, purpose, status,
             admin_remarks, expected_return_date, reminder_sent_at, created_at, reserved_at, issued_at,
             return_requested_at, returned_at, last_return_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          order.orderId, center.id, studentId, projectId, order.teamName || null, order.facultyGuide || null,
          order.purpose || null, order.status || 'Pending', order.adminRemarks || null,
          toDbValue(order.expectedReturnDate), toDbValue(order.reminderSentAt), toDbValue(order.createdAt),
          toDbValue(order.reservedAt), toDbValue(order.issuedAt), toDbValue(order.returnRequestedAt),
          toDbValue(order.returnedAt), toDbValue(order.lastReturnAt)
        ).lastInsertRowid;
      } catch (err) {
        warnings.push(`Skipped order ${order.orderId} in ${center.id}: ${err.message}`);
        continue;
      }
      centerReport.issueRecordsCreated += 1;

      let requestedItems = [];
      try { requestedItems = JSON.parse(order.itemsJson || '[]'); } catch { /* ignore malformed json */ }
      let returnSummary = [];
      try {
        const parsed = JSON.parse(order.returnSummaryJson || '[]');
        returnSummary = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
      } catch { /* ignore malformed json */ }

      requestedItems.forEach((reqItem, idx) => {
        const catalogId = catalogIdByKey.get(`${center.id}::${reqItem.name}`) || null;
        const itemId = db.prepare(`
          INSERT INTO issue_record_items (issue_record_id, catalog_id, name, qty_requested, unit)
          VALUES (?, ?, ?, ?, ?)
        `).run(issueRecordId, catalogId, reqItem.name || 'Unknown item', Number(reqItem.qty) || 0, reqItem.unit || 'pcs').lastInsertRowid;

        const summary = returnSummary[idx] || returnSummary.find(s => s && s.id === reqItem.id);
        if (summary) {
          db.prepare(`
            INSERT INTO order_return_items (issue_record_item_id, returned_qty, damaged_qty, pending_qty)
            VALUES (?, ?, ?, ?)
          `).run(itemId, Number(summary.returnedQty) || 0, Number(summary.damagedQty) || 0, Number(summary.pendingQty) || 0);
        }
      });
    }

    console.log(`[migrate] ${center.id}: orders done (${centerReport.ordersIn} orders -> ${centerReport.issueRecordsCreated} issue records)`);

    // 4. Transfers (qty-level only, no asset linkage -- see VERSION_2_PLAN.md)
    console.log(`[migrate] ${center.id}: reading transfers...`);
    const trWb = await loadWorkbook(path.join(baseDir, `${center.id}_transfers.xlsx`));
    const trSheet = trWb && trWb.getWorksheet('Transfers');
    const transfers = trSheet ? readTransferRows(trSheet) : [];
    centerReport.transfersIn = transfers.length;

    for (const transfer of transfers) {
      let transferId;
      try {
        transferId = db.prepare(`
          INSERT INTO transfers
            (transfer_code, requesting_center_id, supply_center_id, requested_by, status, program_name,
             responsible_person, responsible_email, purpose, desired_return_date, notes, supplier_remarks,
             return_notes, request_date, approved_at, return_requested_at, returned_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          transfer.id, transfer.requestingCenterId || center.id, transfer.supplyCenterId || null,
          transfer.requestedBy || null, transfer.status || 'Pending', transfer.programName || null,
          transfer.responsiblePerson || null, transfer.responsibleEmail || null, transfer.purpose || null,
          toDbValue(transfer.desiredReturnDate), transfer.notes || null, transfer.supplierRemarks || null,
          transfer.returnNotes || null, toDbValue(transfer.requestDate), toDbValue(transfer.approvedAt),
          toDbValue(transfer.returnRequestedAt), toDbValue(transfer.returnedAt)
        ).lastInsertRowid;
      } catch (err) {
        warnings.push(`Skipped transfer ${transfer.id} in ${center.id}: ${err.message}`);
        continue;
      }
      centerReport.transfersCreated += 1;
      for (const comp of transfer.components) {
        db.prepare(`
          INSERT INTO transfer_items (transfer_id, catalog_id, name, qty_requested, unit)
          VALUES (?, ?, ?, ?, ?)
        `).run(transferId, catalogIdByKey.get(`${center.id}::${comp.name}`) || null, comp.name || 'Unknown item',
               Number(comp.qty) || 0, comp.unit || 'pcs');
      }
    }

    console.log(`[migrate] ${center.id}: transfers done (${centerReport.transfersIn} in -> ${centerReport.transfersCreated} created)`);

    // 5. Users
    console.log(`[migrate] ${center.id}: reading users...`);
    const usersWb = await loadWorkbook(path.join(baseDir, 'users.xlsx'));
    const usersSheet = usersWb && (usersWb.getWorksheet('Users') || usersWb.worksheets[0]);
    const users = usersSheet ? readUserRows(usersSheet) : [];
    centerReport.usersIn = users.length;

    for (const user of users) {
      try {
        db.prepare(`
          INSERT INTO users
            (id, center_id, username, password_hash, full_name, email, mobile, alt_mobile, college,
             graduation_year, degree, department, role, active, created_at, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.id, user.role === 'super_admin' ? null : (user.centerId || center.id), user.username,
          user.passwordHash, user.fullName, user.email || null, user.mobile || null, user.altMobile || null,
          user.college || null, user.graduationYear || null, user.degree || null, user.department || null,
          user.role || 'student', user.active === false ? 0 : 1, toDbValue(user.createdAt), user.source || 'manual'
        );
        centerReport.usersCreated += 1;
      } catch (err) {
        warnings.push(`Skipped user ${user.username} in ${center.id}: ${err.message}`);
      }
    }
    console.log(`[migrate] ${center.id}: users done (${centerReport.usersIn} in -> ${centerReport.usersCreated} created)`);
  }
  db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  db.close();

  // ---------- Validation report ----------
  console.log('\n=================== MIGRATION VALIDATION REPORT ===================\n');
  let totals = { inventoryRowsIn: 0, assetsCreated: 0, ordersIn: 0, issueRecordsCreated: 0, usersIn: 0, usersCreated: 0, transfersIn: 0, transfersCreated: 0 };
  for (const center of CENTERS) {
    const r = report.centers[center.id];
    console.log(`${center.name} (${center.id})`);
    console.log(`  Inventory rows (SKUs) in:  ${r.inventoryRowsIn}  ->  Assets created: ${r.assetsCreated}`);
    console.log(`  Orders in:                 ${r.ordersIn}  ->  Issue records created: ${r.issueRecordsCreated}`);
    console.log(`  Transfers in:               ${r.transfersIn}  ->  Transfers created: ${r.transfersCreated}`);
    console.log(`  Users in:                  ${r.usersIn}  ->  Users created: ${r.usersCreated}`);
    console.log('');
    for (const k of Object.keys(totals)) totals[k] += r[k];
  }
  console.log('TOTALS');
  console.log(`  Inventory rows in: ${totals.inventoryRowsIn}   Assets created: ${totals.assetsCreated}`);
  console.log(`  Orders in: ${totals.ordersIn}   Issue records created: ${totals.issueRecordsCreated}`);
  console.log(`  Transfers in: ${totals.transfersIn}   Transfers created: ${totals.transfersCreated}`);
  console.log(`  Users in: ${totals.usersIn}   Users created: ${totals.usersCreated}`);

  if (warnings.length) {
    console.log(`\n${warnings.length} WARNING(S):`);
    warnings.forEach(w => console.log(`  - ${w}`));
  } else {
    console.log('\nNo warnings.');
  }
  console.log(`\nDatabase written to: ${TARGET_DB_PATH}`);
  console.log('=====================================================================\n');
}

main().catch(err => {
  console.error('[migrate] FAILED:', err);
  process.exit(1);
});
