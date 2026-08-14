const express = require('express');
const { createInventoryExportWorkbook } = require('../utils/excel');
const { logActivity, getLogs } = require('../utils/logsDb');
const { getWhatsappMessages } = require('../utils/whatsappDb');
const { listUsers, createUser, updateUser, deleteUser, serializeUser, findUserById } = require('../utils/usersDb');
const { verifyWhatsAppConnection } = require('../utils/whatsapp');
const { CENTERS, getCenterById } = require('../utils/centers');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { getDb } = require('../utils/db');
const { getOrdersForCenter } = require('./orders');
const { getAllTransfers } = require('./transfers');
const { extractDamageProgram, extractDamageReason } = require('./assets');

// Pre-aggregates assets by catalog_id BEFORE joining to product_catalog
// (see routes/assets.js's catalog-summary comment for why) -- this powers
// /api/admin/stats, which for a "whole organization" (no centerId) view
// calls this once per center, then AGAIN for the byCenter breakdown, so an
// unfixed fan-out here means every Dashboard load walks the full assets
// table across all 9 centers twice.
function getInventoryItemsForCenter(centerId) {
  return getDb().prepare(`
    SELECT pc.id AS id, c.name AS category, pc.classification_id AS classificationId,
           COALESCE(ag.stock, 0) AS stock
    FROM product_catalog pc
    LEFT JOIN classifications c ON c.id = pc.classification_id
    LEFT JOIN (
      SELECT a.catalog_id, SUM(CASE WHEN a.status = 'available' THEN 1 ELSE 0 END) AS stock
      FROM assets a
      JOIN product_catalog pc2 ON pc2.id = a.catalog_id
      WHERE pc2.center_id = ?
      GROUP BY a.catalog_id
    ) ag ON ag.catalog_id = pc.id
    WHERE pc.center_id = ?
  `).all(centerId, centerId);
}

function getInventoryExportItemsForCenter(centerId) {
  const db = getDb();
  const center = getCenterById(centerId);
  const rows = db.prepare(`
    SELECT pc.id AS id, pc.name AS name, cl.name AS category, pc.description AS description,
           pc.unit AS unit, pc.image AS image,
           COALESCE(ag.stock, 0) AS stock,
           COALESCE(ag.totalProcured, 0) AS totalProcured,
           COALESCE(ag.totalIssued, 0) AS totalIssued,
           COALESCE(ag.damagedCount, 0) AS damagedCount,
           ag.addedDate AS addedDate
    FROM product_catalog pc
    LEFT JOIN classifications cl ON cl.id = pc.classification_id
    LEFT JOIN (
      SELECT a.catalog_id,
             SUM(CASE WHEN a.status = 'available' THEN 1 ELSE 0 END) AS stock,
             COUNT(*) AS totalProcured,
             SUM(CASE WHEN a.status = 'issued' THEN 1 ELSE 0 END) AS totalIssued,
             SUM(CASE WHEN a.status = 'damaged' THEN 1 ELSE 0 END) AS damagedCount,
             MIN(a.added_date) AS addedDate
      FROM assets a
      JOIN product_catalog pc2 ON pc2.id = a.catalog_id
      WHERE pc2.center_id = ?
      GROUP BY a.catalog_id
    ) ag ON ag.catalog_id = pc.id
    WHERE pc.center_id = ?
  `).all(centerId, centerId);

  const invoiceInfo = new Map();
  const invoiceRows = db.prepare(`
    SELECT a.catalog_id AS catalogId, i.invoice_number AS invoiceNumber, v.name AS vendorName,
           p.name AS purchasePurpose, ili.purchased_for AS purchasedFor
    FROM assets a
    JOIN invoice_line_items ili ON ili.id = a.invoice_line_item_id
    JOIN invoices i ON i.id = ili.invoice_id
    LEFT JOIN vendors v ON v.id = i.vendor_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE a.center_id = ?
    ORDER BY i.created_at DESC
  `).all(centerId);
  for (const row of invoiceRows) {
    if (!invoiceInfo.has(row.catalogId)) invoiceInfo.set(row.catalogId, row);
  }

  return rows.map(row => {
    const inv = invoiceInfo.get(row.id) || {};
    return {
      id: row.id,
      centerId,
      centerName: center?.name || centerId,
      name: row.name,
      category: row.category || '',
      description: row.description || '',
      stock: row.stock || 0,
      totalProcured: row.totalProcured || 0,
      totalIssued: row.totalIssued || 0,
      unit: row.unit || 'pcs',
      location: '',
      addedDate: row.addedDate || '',
      image: row.image || '',
      active: true,
      damagedCount: row.damagedCount || 0,
      invoiceNumber: inv.invoiceNumber || '',
      vendorName: inv.vendorName || '',
      purchasePurpose: inv.purchasePurpose || '',
      purchasedFor: inv.purchasedFor || '',
    };
  });
}

const router = express.Router();

const IST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

const IST_DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

function formatDateTimeIST(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return IST_DATE_TIME_FORMATTER.format(date);
}

function formatDateIST(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return IST_DATE_FORMATTER.format(date);
}

function parseJsonArray(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue;
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getOrderItems(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items;
  return parseJsonArray(order.itemsJson);
}

// No single "status updated" column exists on an order -- pick whichever
// lifecycle timestamp is most recent so exports show the true last-change time.
function latestStatusTimestamp(order) {
  const candidates = [order.returnedAt, order.returnRequestedAt, order.issuedAt, order.reservedAt].filter(Boolean);
  if (!candidates.length) return '';
  return candidates.reduce((latest, current) => (new Date(current) > new Date(latest) ? current : latest));
}

function getScopedCenterId(req) {
  if (req.user.role === 'super_admin') {
    return String(req.query.centerId || req.body.centerId || '').trim();
  }
  return req.user.centerId;
}

function ensureCenterAccess(req, centerId) {
  if (!centerId) return null;
  if (req.user.role !== 'super_admin' && req.user.centerId !== centerId) {
    throw new Error('You do not have access to this center');
  }
  return getCenterById(centerId);
}

router.get('/centers', authMiddleware, adminOnly, async (req, res) => {
  res.json(CENTERS);
});

// GET dashboard stats
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const centerId = getScopedCenterId(req);
    if (centerId) ensureCenterAccess(req, centerId);
    // Scopes the catalog-derived counts (line items, stock, low stock) to one
    // classification. Orders/students deliberately stay unscoped -- an order
    // or student isn't tied to a single classification the way a catalog
    // item is, so filtering them would misrepresent the numbers.
    const classificationId = String(req.query.classificationId || '').trim();
    const [inventoryAll, orders, users] = await Promise.all([
      centerId
        ? getInventoryItemsForCenter(centerId)
        : Promise.all(CENTERS.map(center => getInventoryItemsForCenter(center.id))).then(results => results.flat()),
      Promise.resolve(getOrdersForCenter(centerId || undefined)),
      Promise.resolve(listUsers(centerId ? { centerId } : {})),
    ]);
    const inventory = classificationId
      ? inventoryAll.filter(i => String(i.classificationId) === classificationId)
      : inventoryAll;
    const stats = {
      centerId: centerId || '',
      centerName: centerId ? getCenterById(centerId)?.name || '' : 'All Centers',
      centers: centerId ? 1 : CENTERS.length,
      totalComponents: inventory.length,
      totalStock: inventory.reduce((s, i) => s + (i.stock || 0), 0),
      lowStock: inventory.filter(i => i.stock < 5).length,
      totalOrders: orders.length,
      pendingOrders: orders.filter(o => o.status === 'Pending').length,
      approvedOrders: orders.filter(o => o.status === 'Approved').length,
      rejectedOrders: orders.filter(o => o.status === 'Rejected').length,
      totalStudents: users.filter(u => u.role === 'student').length,
      pendingStudents: users.filter(u => u.role === 'student' && !u.active && u.source === 'self').length,
      categories: [...new Set(inventory.map(i => i.category))].length,
    };
    if (!centerId) {
      stats.byCenter = await Promise.all(CENTERS.map(async center => {
        const [centerInventoryAll, centerOrders, centerUsers] = await Promise.all([
          getInventoryItemsForCenter(center.id),
          Promise.resolve(getOrdersForCenter(center.id)),
          Promise.resolve(listUsers({ centerId: center.id })),
        ]);
        const centerInventory = classificationId
          ? centerInventoryAll.filter(i => String(i.classificationId) === classificationId)
          : centerInventoryAll;
        return {
          centerId: center.id,
          centerName: center.name,
          totalComponents: centerInventory.length,
          totalStock: centerInventory.reduce((sum, item) => sum + (item.stock || 0), 0),
          pendingOrders: centerOrders.filter(order => order.status === 'Pending').length,
          approvedOrders: centerOrders.filter(order => order.status === 'Approved').length,
          students: centerUsers.filter(user => user.role === 'student').length,
        };
      }));
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET all users
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const centerId = getScopedCenterId(req);
    if (centerId) ensureCenterAccess(req, centerId);
    res.json(listUsers(centerId ? { centerId } : {}).map(serializeUser));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/whatsapp/messages', authMiddleware, adminOnly, async (req, res) => {
  try {
    const centerId = getScopedCenterId(req);
    if (!centerId) return res.json([]);
    ensureCenterAccess(req, centerId);
    const messages = await getWhatsappMessages(centerId);
    res.json(messages.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/whatsapp/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const status = await verifyWhatsAppConnection();
    res.json(status);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/logs', authMiddleware, adminOnly, async (req, res) => {
  try {
    const centerId = getScopedCenterId(req);
    if (!centerId) return res.json([]);
    ensureCenterAccess(req, centerId);
    const logs = await getLogs(centerId);
    res.json(logs.sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create user
router.post('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const payload = { ...req.body };
    if (req.user.role !== 'super_admin') {
      payload.centerId = req.user.centerId;
      // The role select in the UI hides "Super Admin" for non-super-admins, but
      // that's a client-side nicety only -- without this check, anyone with an
      // admin token could grant themselves org-wide access by calling the API directly.
      if (payload.role === 'super_admin') {
        return res.status(403).json({ message: 'Only a super admin can create a super admin account' });
      }
    }
    await createUser(payload);
    await logActivity('CREATE_USER', req.user.username, { role: req.user.role, centerId: payload.centerId || req.user.centerId, info: `Created user: ${req.body.username}` });
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT update user
router.put('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const current = findUserById(req.params.id);
    if (!current) return res.status(404).json({ message: 'User not found' });
    if (req.user.role !== 'super_admin' && current.centerId !== req.user.centerId) {
      return res.status(403).json({ message: 'You do not have access to this user' });
    }
    const payload = { ...req.body };
    if (req.user.role !== 'super_admin') {
      payload.centerId = current.centerId || req.user.centerId;
      if (payload.role === 'super_admin') {
        return res.status(403).json({ message: 'Only a super admin can grant super admin access' });
      }
    }
    const updated = await updateUser(req.params.id, payload);
    await logActivity('UPDATE_USER', req.user.username, { role: req.user.role, centerId: updated.centerId || current.centerId || req.user.centerId, info: `Updated user: ${updated.username}` });
    res.json({ message: 'User updated', user: serializeUser(updated) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE user
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const current = findUserById(req.params.id);
    if (!current) return res.status(404).json({ message: 'User not found' });
    if (req.user.role !== 'super_admin' && current.centerId !== req.user.centerId) {
      return res.status(403).json({ message: 'You do not have access to this user' });
    }
    const ok = deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ message: 'User not found' });
    await logActivity('DELETE_USER', req.user.username, { role: req.user.role, centerId: current.centerId || req.user.centerId, info: `Deleted user: ${req.params.id}` });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET analytics
router.get('/analytics', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') return res.status(403).json({ message: 'Access denied' });
    const db = getDb();
    const stats = { totalUsers: 0, totalOrders: 0, totalInventory: 0, totalDamagedUnits: 0, totalDamagedComponents: 0, centers: {} };
    for (const center of CENTERS) {
      const users = listUsers({ centerId: center.id }).length;
      const orders = getOrdersForCenter(center.id).length;
      const inventory = db.prepare('SELECT COUNT(*) c FROM product_catalog WHERE center_id = ?').get(center.id).c;
      const damagedUnits = db.prepare("SELECT COUNT(*) c FROM assets WHERE center_id = ? AND status = 'damaged'").get(center.id).c;
      const damagedComponents = db.prepare("SELECT COUNT(DISTINCT catalog_id) c FROM assets WHERE center_id = ? AND status = 'damaged'").get(center.id).c;
      stats.centers[center.id] = { name: center.name, users, orders, inventory, damagedUnits, damagedComponents };
      stats.totalUsers += users;
      stats.totalOrders += orders;
      stats.totalInventory += inventory;
      stats.totalDamagedUnits += damagedUnits;
      stats.totalDamagedComponents += damagedComponents;
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET download Excel files
router.get('/download/:type', authMiddleware, adminOnly, async (req, res) => {
  const { type } = req.params;
  const { startDate, endDate } = req.query;
  const centerId = getScopedCenterId(req);
  const isSuperAdmin = req.user.role === 'super_admin';

  try {
    if (centerId) ensureCenterAccess(req, centerId);
    if (!centerId && !isSuperAdmin) {
      return res.status(400).json({ message: 'Center is required for downloads' });
    }
    if (!centerId && !['transfers', 'assets', 'internal-issues'].includes(type)) {
      return res.status(400).json({ message: 'Select a center to download this report' });
    }

    if (type === 'orders') {
      const orders = getOrdersForCenter(centerId);
      let filteredOrders = orders;

      if (startDate || endDate) {
        const s = startDate ? new Date(startDate) : new Date('1970-01-01');
        const e = endDate ? new Date(endDate) : new Date();
        e.setHours(23, 59, 59, 999);
        filteredOrders = orders.filter(order => {
          const d = order.createdAt ? new Date(order.createdAt) : null;
          return d && d >= s && d <= e;
        });
      }

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();

      const infoSheet = wb.addWorksheet('Report Info');
      infoSheet.columns = [
        { header: 'Field', key: 'field', width: 34 },
        { header: 'Value', key: 'value', width: 52 },
      ];
      infoSheet.addRow({ field: 'Generated At (IST)', value: formatDateTimeIST(new Date()) });
      infoSheet.addRow({ field: 'Center', value: getCenterById(centerId)?.name || centerId });
      infoSheet.addRow({ field: 'Date Filter From', value: startDate || 'All' });
      infoSheet.addRow({ field: 'Date Filter To', value: endDate || 'All' });
      infoSheet.addRow({ field: 'Total Orders Exported', value: filteredOrders.length });

      const summarySheet = wb.addWorksheet('Orders Summary');
      summarySheet.columns = [
        { header: 'Order ID', key: 'orderId', width: 20 },
        { header: 'Created At (IST)', key: 'createdAt', width: 24 },
        { header: 'Status Updated At (IST)', key: 'resolvedAt', width: 24 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Student Name', key: 'studentName', width: 24 },
        { header: 'Username', key: 'username', width: 18 },
        { header: 'Student Email', key: 'studentEmail', width: 34 },
        { header: 'Mobile', key: 'mobile', width: 16 },
        { header: 'College', key: 'college', width: 32 },
        { header: 'Department', key: 'department', width: 22 },
        { header: 'Course Name', key: 'courseName', width: 24 },
        { header: 'Project Name', key: 'projectName', width: 30 },
        { header: 'Team Name', key: 'teamName', width: 20 },
        { header: 'Faculty Guide', key: 'facultyGuide', width: 24 },
        { header: 'Purpose', key: 'purpose', width: 36 },
        { header: 'Expected Return Date (IST)', key: 'expectedReturnDate', width: 24 },
        { header: 'Issued Components Summary', key: 'issuedComponents', width: 70 },
        { header: 'Issued Total Qty', key: 'issuedTotalQty', width: 16 },
        { header: 'Return Requested At (IST)', key: 'returnRequestedAt', width: 24 },
        { header: 'Returned At (IST)', key: 'returnedAt', width: 24 },
        { header: 'Admin Remarks', key: 'adminRemarks', width: 40 },
      ];

      const componentsSheet = wb.addWorksheet('Order Components');
      componentsSheet.columns = [
        { header: 'Order ID', key: 'orderId', width: 20 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Student Name', key: 'studentName', width: 24 },
        { header: 'Created At (IST)', key: 'createdAt', width: 24 },
        { header: 'Component ID', key: 'componentId', width: 24 },
        { header: 'Component Name', key: 'componentName', width: 34 },
        { header: 'Issued Qty', key: 'issuedQty', width: 12 },
        { header: 'Unit', key: 'unit', width: 10 },
        { header: 'Returned Qty', key: 'returnedQty', width: 12 },
        { header: 'Damaged/Consumed Qty', key: 'damagedQty', width: 12 },
        { header: 'Pending Qty', key: 'pendingQty', width: 12 },
      ];

      filteredOrders.forEach(order => {
        const items = getOrderItems(order);
        const returnById = new Map(
          (Array.isArray(order.returnSummary) ? order.returnSummary : []).map(item => [
            String(item.id || '').trim(),
            {
              returnedQty: Number(item.returnedQty) || 0,
              damagedQty: Number(item.damagedQty) || 0,
            },
          ]),
        );
        const issuedTotalQty = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
        const issuedComponents = items.length
          ? items.map(item => `${item.name || item.id || 'Component'} x ${Number(item.qty) || 0} ${item.unit || 'pcs'}`).join('; ')
          : 'No issued components';

        summarySheet.addRow({
          orderId: order.orderId,
          createdAt: formatDateTimeIST(order.createdAt),
          resolvedAt: formatDateTimeIST(latestStatusTimestamp(order)),
          status: order.status || '',
          studentName: order.studentName || '',
          username: order.username || '',
          studentEmail: order.studentEmail || '',
          mobile: order.mobile || '',
          college: order.college || '',
          department: order.department || '',
          courseName: order.courseName || '',
          projectName: order.projectName || '',
          teamName: order.teamName || '',
          facultyGuide: order.facultyGuide || '',
          purpose: order.purpose || '',
          expectedReturnDate: formatDateIST(order.expectedReturnDate),
          issuedComponents,
          issuedTotalQty,
          returnRequestedAt: formatDateTimeIST(order.returnRequestedAt),
          returnedAt: formatDateTimeIST(order.returnedAt),
          adminRemarks: order.adminRemarks || '',
        });

        if (!items.length) {
          componentsSheet.addRow({
            orderId: order.orderId,
            status: order.status || '',
            studentName: order.studentName || '',
            createdAt: formatDateTimeIST(order.createdAt),
            componentName: 'No issued components',
            issuedQty: 0,
            unit: '',
            returnedQty: 0,
            damagedQty: 0,
            pendingQty: 0,
          });
          return;
        }

        items.forEach(item => {
          const componentId = String(item.id || '').trim();
          const issuedQty = Number(item.qty) || 0;
          const returnEntry = returnById.get(componentId) || { returnedQty: 0, damagedQty: 0 };
          const pendingQty = Math.max(0, issuedQty - returnEntry.returnedQty - returnEntry.damagedQty);
          componentsSheet.addRow({
            orderId: order.orderId,
            status: order.status || '',
            studentName: order.studentName || '',
            createdAt: formatDateTimeIST(order.createdAt),
            componentId: componentId || '',
            componentName: item.name || '',
            issuedQty,
            unit: item.unit || 'pcs',
            returnedQty: returnEntry.returnedQty,
            damagedQty: returnEntry.damagedQty,
            pendingQty,
          });
        });
      });

      res.setHeader('Content-Disposition', `attachment; filename=${centerId}_orders_${startDate || 'all'}-${endDate || 'all'}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return wb.xlsx.write(res).then(() => res.end());
    }

    if (type === 'users') {
      const users = listUsers({ centerId });
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Users');
      ws.columns = [
        { header: 'Center', key: 'centerName', width: 28 },
        { header: 'Username', key: 'username', width: 20 },
        { header: 'Full Name', key: 'fullName', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Mobile', key: 'mobile', width: 16 },
        { header: 'College', key: 'college', width: 24 },
        { header: 'Department', key: 'department', width: 18 },
        { header: 'Role', key: 'role', width: 14 },
        { header: 'Active', key: 'active', width: 10 },
        { header: 'Source', key: 'source', width: 14 },
        { header: 'Created At', key: 'createdAt', width: 20 },
      ];
      users.forEach(user => ws.addRow(user));
      res.setHeader('Content-Disposition', `attachment; filename=${centerId}_users.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return wb.xlsx.write(res).then(() => res.end());
    }

    if (type === 'transfers') {
      const transfers = getAllTransfers().filter(transfer =>
        !centerId || transfer.requestingCenterId === centerId || transfer.supplyCenterId === centerId);
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const summarySheet = wb.addWorksheet('Center Transfers');
      summarySheet.columns = [
        { header: 'Transfer ID', key: 'id', width: 24 },
        { header: 'Direction', key: 'direction', width: 14 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Requesting Center', key: 'requestingCenterName', width: 28 },
        { header: 'Supply Center', key: 'supplyCenterName', width: 28 },
        { header: 'Requested By', key: 'requestedBy', width: 20 },
        { header: 'Requested At', key: 'requestDate', width: 22 },
        { header: 'Approved At', key: 'approvedAt', width: 22 },
        { header: 'Return Requested At', key: 'returnRequestedAt', width: 22 },
        { header: 'Returned At', key: 'returnedAt', width: 22 },
        { header: 'Program Name', key: 'programName', width: 30 },
        { header: 'Responsible Person', key: 'responsiblePerson', width: 24 },
        { header: 'Responsible Email', key: 'responsibleEmail', width: 30 },
        { header: 'Purpose', key: 'purpose', width: 36 },
        { header: 'Desired Return Date', key: 'desiredReturnDate', width: 22 },
        { header: 'Request Notes', key: 'notes', width: 34 },
        { header: 'Supplier Remarks', key: 'supplierRemarks', width: 34 },
        { header: 'Return Notes', key: 'returnNotes', width: 34 },
        { header: 'Total Qty', key: 'totalQty', width: 12 },
        { header: 'Component Summary', key: 'componentSummary', width: 65 },
      ];

      const componentSheet = wb.addWorksheet('Transfer Components');
      componentSheet.columns = [
        { header: 'Transfer ID', key: 'transferId', width: 24 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Direction', key: 'direction', width: 14 },
        { header: 'Requesting Center', key: 'requestingCenterName', width: 28 },
        { header: 'Supply Center', key: 'supplyCenterName', width: 28 },
        { header: 'Requested At', key: 'requestDate', width: 22 },
        { header: 'Component ID', key: 'componentId', width: 24 },
        { header: 'Component Name', key: 'componentName', width: 32 },
        { header: 'Qty', key: 'qty', width: 10 },
        { header: 'Unit', key: 'unit', width: 10 },
        { header: 'Reference Link', key: 'link', width: 42 },
      ];

      transfers.forEach(transfer => {
        const components = Array.isArray(transfer.components) ? transfer.components : [];
        const direction = centerId
          ? (transfer.requestingCenterId === centerId ? 'Requested' : 'Sent')
          : (transfer.supplyCenterId ? 'Center Transfer' : 'Requested');
        const totalQty = components.reduce((sum, component) => sum + (Number(component.qty) || 0), 0);
        const componentSummary = components
          .map(component => `${component.name || component.id || 'Component'} x ${Number(component.qty) || 0} ${component.unit || 'pcs'}`)
          .join('; ');

        summarySheet.addRow({
          id: transfer.id,
          direction,
          status: transfer.status || '',
          requestingCenterName: transfer.requestingCenterName || '',
          supplyCenterName: transfer.supplyCenterName || '',
          requestedBy: transfer.requestedBy || '',
          requestDate: transfer.requestDate || '',
          approvedAt: transfer.approvedAt || '',
          returnRequestedAt: transfer.returnRequestedAt || '',
          returnedAt: transfer.returnedAt || '',
          programName: transfer.programName || '',
          responsiblePerson: transfer.responsiblePerson || '',
          responsibleEmail: transfer.responsibleEmail || '',
          purpose: transfer.purpose || '',
          desiredReturnDate: transfer.desiredReturnDate || '',
          notes: transfer.notes || '',
          supplierRemarks: transfer.supplierRemarks || '',
          returnNotes: transfer.returnNotes || '',
          totalQty,
          componentSummary,
        });

        if (!components.length) {
          componentSheet.addRow({
            transferId: transfer.id,
            status: transfer.status || '',
            direction,
            requestingCenterName: transfer.requestingCenterName || '',
            supplyCenterName: transfer.supplyCenterName || '',
            requestDate: transfer.requestDate || '',
            componentName: 'No components listed',
          });
          return;
        }

        components.forEach(component => {
          componentSheet.addRow({
            transferId: transfer.id,
            status: transfer.status || '',
            direction,
            requestingCenterName: transfer.requestingCenterName || '',
            supplyCenterName: transfer.supplyCenterName || '',
            requestDate: transfer.requestDate || '',
            componentId: component.id || '',
            componentName: component.name || '',
            qty: Number(component.qty) || 0,
            unit: component.unit || 'pcs',
            link: component.link || '',
          });
        });
      });

      res.setHeader('Content-Disposition', `attachment; filename=${centerId || 'all_centers'}_center_transfers.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return wb.xlsx.write(res).then(() => res.end());
    }

    if (type === 'inventory') {
      const items = getInventoryExportItemsForCenter(centerId);
      const workbook = createInventoryExportWorkbook(items);
      res.setHeader('Content-Disposition', `attachment; filename=${centerId || 'all_centers'}_inventory.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return workbook.xlsx.write(res).then(() => res.end());
    }

    if (type === 'assets') {
      const businessHeadParam = String(req.query.businessHead || 'all').trim().toLowerCase();
      const db = getDb();
      const clauses = [];
      const params = [];
      if (centerId) { clauses.push('a.center_id = ?'); params.push(centerId); }
      if (businessHeadParam !== 'all') {
        clauses.push('LOWER(bh.name) = ?');
        params.push(businessHeadParam === 'comedk' ? 'comedk' : businessHeadParam === 'era' ? 'era foundation' : businessHeadParam);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

      const assets = db.prepare(`
        SELECT a.asset_tag, a.name, cl.name AS classification, ctr.name AS centerName, a.status,
               COALESCE(bh.name, 'Unspecified') AS businessHead, v.name AS vendorName,
               inv.invoice_number AS invoiceNumber, inv.invoice_date AS invoiceDate,
               a.unit_value AS unitValue, ili.gst_percent AS gstPercent,
               a.unit_value * (1 + COALESCE(ili.gst_percent, 0) / 100.0) AS unitValueWithGst,
               a.serial_number AS serialNumber, a.location, a.added_date AS addedDate,
               (SELECT e.notes FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type = 'damaged' ORDER BY e.occurred_at DESC LIMIT 1) AS lastDamageNotes,
               (SELECT e.occurred_at FROM asset_lifecycle_events e WHERE e.asset_id = a.id AND e.event_type = 'damaged' ORDER BY e.occurred_at DESC LIMIT 1) AS damagedAt
        FROM assets a
        LEFT JOIN classifications cl ON cl.id = a.classification_id
        LEFT JOIN centers ctr ON ctr.id = a.center_id
        LEFT JOIN invoice_line_items ili ON ili.id = a.invoice_line_item_id
        LEFT JOIN invoices inv ON inv.id = ili.invoice_id
        LEFT JOIN vendors v ON v.id = inv.vendor_id
        LEFT JOIN business_heads bh ON bh.id = inv.business_head_id
        ${where}
        ORDER BY ctr.name, cl.name, a.name
      `).all(...params).map(row => ({
        ...row,
        damagedInProgram: extractDamageProgram(row.lastDamageNotes),
        damagedReason: extractDamageReason(row.lastDamageNotes),
      }));

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Assets', { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Asset Tag', key: 'asset_tag', width: 22 },
        { header: 'Component Name', key: 'name', width: 30 },
        { header: 'Classification', key: 'classification', width: 22 },
        { header: 'Center', key: 'centerName', width: 24 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Damaged/Consumed In Program', key: 'damagedInProgram', width: 26 },
        { header: 'Damaged/Consumed Reason', key: 'damagedReason', width: 34 },
        { header: 'Damaged/Consumed On', key: 'damagedAt', width: 18 },
        { header: 'Business Head', key: 'businessHead', width: 18 },
        { header: 'Vendor', key: 'vendorName', width: 26 },
        { header: 'Invoice Number', key: 'invoiceNumber', width: 20 },
        { header: 'Invoice Date', key: 'invoiceDate', width: 16 },
        { header: 'Unit Value (Base)', key: 'unitValue', width: 16 },
        { header: 'GST %', key: 'gstPercent', width: 10 },
        { header: 'Unit Value (incl. GST)', key: 'unitValueWithGst', width: 18 },
        { header: 'Serial Number', key: 'serialNumber', width: 20 },
        { header: 'Location', key: 'location', width: 18 },
        { header: 'Added Date', key: 'addedDate', width: 16 },
      ];
      ws.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
      ws.getRow(1).height = 30;
      ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };

      const STATUS_FILL = {
        available: 'FFE8F5E9', issued: 'FFE3F2FD', reserved: 'FFF3E5F5',
        under_repair: 'FFFFF9C4', damaged: 'FFFCE4EC', disposed: 'FFECEFF1',
        return_requested: 'FFFFF3E0',
      };
      // under_repair/return_requested fonts were darkened from their original
      // amber/orange shades -- those read at ~2.5:1 and ~2.8:1 contrast against
      // their pale fills (fails WCAG AA's 4.5:1 minimum), while every other
      // status pair here already cleared ~4.6:1+.
      const STATUS_FONT = {
        available: 'FF2E7D32', issued: 'FF1565C0', reserved: 'FF6A1B9A',
        under_repair: 'FF8D4E00', damaged: 'FFC62828', disposed: 'FF546E7A',
        return_requested: 'FFBF360C',
      };
      assets.forEach(asset => {
        const row = ws.addRow(asset);
        const fill = STATUS_FILL[asset.status];
        if (fill) {
          row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
          row.getCell('status').font = { bold: true, color: { argb: STATUS_FONT[asset.status] || 'FF000000' } };
        }
        if (asset.damagedInProgram) {
          row.getCell('damagedInProgram').font = { bold: true, color: { argb: 'FFC62828' } };
        }
        row.eachCell(cell => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }; });
      });

      const totalBase = assets.reduce((s, a) => s + (Number(a.unitValue) || 0), 0);
      const totalWithGst = assets.reduce((s, a) => s + (Number(a.unitValueWithGst) || 0), 0);
      const damagedAssets = assets.filter(a => a.status === 'damaged');
      const damagedByProgram = new Map();
      damagedAssets.forEach(a => {
        const key = a.damagedInProgram || 'Not recorded';
        const entry = damagedByProgram.get(key) || { count: 0, value: 0 };
        entry.count += 1;
        entry.value += Number(a.unitValue) || 0;
        damagedByProgram.set(key, entry);
      });

      const infoSheet = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
      infoSheet.mergeCells('A1:C1');
      const titleCell = infoSheet.getCell('A1');
      titleCell.value = 'CIMS Asset Value Report';
      titleCell.font = { bold: true, size: 18, color: { argb: 'FF1A237E' } };
      infoSheet.getRow(1).height = 30;
      infoSheet.mergeCells('A2:C2');
      infoSheet.getCell('A2').value = `Generated ${new Date().toLocaleString('en-IN')}`;
      infoSheet.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF64748B' } };

      infoSheet.getColumn(1).width = 32;
      infoSheet.getColumn(2).width = 24;
      infoSheet.getColumn(3).width = 24;

      const summaryRows = [
        ['Business Head Filter', businessHeadParam === 'all' ? 'All (ComedK + ERA Foundation)' : businessHeadParam],
        ['Center', centerId ? (getCenterById(centerId)?.name || centerId) : 'All Centers'],
        ['Total Assets', assets.length],
        ['Total Value (Base)', totalBase],
        ['Total Value (incl. GST)', totalWithGst],
        ['Damaged/Consumed Units', damagedAssets.length],
      ];
      let r = 4;
      summaryRows.forEach(([field, value]) => {
        infoSheet.getCell(`A${r}`).value = field;
        infoSheet.getCell(`A${r}`).font = { bold: true, color: { argb: 'FF334155' } };
        infoSheet.getCell(`B${r}`).value = value;
        r += 1;
      });

      r += 1;
      infoSheet.mergeCells(`A${r}:C${r}`);
      infoSheet.getCell(`A${r}`).value = 'Damaged/Consumed by Program';
      infoSheet.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: 'FF1A237E' } };
      r += 1;
      ['Program', 'Units', 'Value (Base)'].forEach((h, i) => {
        const cell = infoSheet.getCell(r, i + 1);
        cell.value = h;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      });
      r += 1;
      if (damagedByProgram.size === 0) {
        infoSheet.mergeCells(`A${r}:C${r}`);
        infoSheet.getCell(`A${r}`).value = 'No damaged/consumed units in this selection.';
        infoSheet.getCell(`A${r}`).font = { italic: true, color: { argb: 'FF64748B' } };
      } else {
        [...damagedByProgram.entries()].sort((a, b) => b[1].value - a[1].value).forEach(([program, entry]) => {
          infoSheet.getCell(r, 1).value = program;
          infoSheet.getCell(r, 2).value = entry.count;
          infoSheet.getCell(r, 3).value = entry.value;
          if (r % 2 === 0) {
            for (let c = 1; c <= 3; c++) infoSheet.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } };
          }
          r += 1;
        });
      }

      const filenameBh = businessHeadParam === 'all' ? 'combined' : businessHeadParam;
      res.setHeader('Content-Disposition', `attachment; filename=${centerId || 'all_centers'}_assets_${filenameBh}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return wb.xlsx.write(res).then(() => res.end());
    }

    // Catalog-level (one row per component type) export mirroring exactly
    // what AdminInventory's table shows, including whatever
    // search/classification/stock-status filter and column sort the admin
    // currently has applied -- "download based on the filter" rather than
    // always dumping the full unfiltered catalog.
    if (type === 'inventory-catalog') {
      if (!centerId) return res.status(400).json({ message: 'Select a center to download this report' });
      const db = getDb();
      const classificationFilter = String(req.query.classification || 'All').trim();
      const search = String(req.query.search || '').trim().toLowerCase();
      const stockStatus = String(req.query.stockStatus || 'all').trim().toLowerCase();
      const sortField = String(req.query.sortField || 'name').trim();
      const sortDir = String(req.query.sortDirection || 'asc').trim().toLowerCase() === 'desc' ? -1 : 1;

      let rows = db.prepare(`
        SELECT pc.id AS catalog_id, pc.name, pc.reorder_point, c.name AS classification_name,
               COALESCE(ag.available, 0) AS available,
               COALESCE(ag.issued, 0) AS issued,
               COALESCE(ag.under_repair, 0) AS under_repair,
               COALESCE(ag.damaged, 0) AS damaged,
               COALESCE(ag.disposed, 0) AS disposed,
               COALESCE(ag.total, 0) AS total,
               COALESCE(ag.available_value, 0) AS available_value,
               COALESCE(ag.damaged_value, 0) AS damaged_value,
               COALESCE(ag.total_value, 0) AS total_value
        FROM product_catalog pc
        LEFT JOIN classifications c ON c.id = pc.classification_id
        LEFT JOIN (
          SELECT a.catalog_id,
                 SUM(CASE WHEN a.status = 'available' THEN 1 ELSE 0 END) AS available,
                 SUM(CASE WHEN a.status = 'issued' THEN 1 ELSE 0 END) AS issued,
                 SUM(CASE WHEN a.status = 'under_repair' THEN 1 ELSE 0 END) AS under_repair,
                 SUM(CASE WHEN a.status = 'damaged' THEN 1 ELSE 0 END) AS damaged,
                 SUM(CASE WHEN a.status = 'disposed' THEN 1 ELSE 0 END) AS disposed,
                 COUNT(*) AS total,
                 SUM(CASE WHEN a.status = 'available' THEN a.unit_value ELSE 0 END) AS available_value,
                 SUM(CASE WHEN a.status = 'damaged' THEN a.unit_value ELSE 0 END) AS damaged_value,
                 SUM(CASE WHEN a.status != 'disposed' THEN a.unit_value ELSE 0 END) AS total_value
          FROM assets a
          JOIN product_catalog pc2 ON pc2.id = a.catalog_id
          WHERE pc2.center_id = ?
          GROUP BY a.catalog_id
        ) ag ON ag.catalog_id = pc.id
        WHERE pc.center_id = ?
      `).all(centerId, centerId);

      if (classificationFilter !== 'All') {
        rows = rows.filter(r => (r.classification_name || 'Unclassified') === classificationFilter);
      }
      if (search) {
        rows = rows.filter(r => r.name?.toLowerCase().includes(search));
      }
      if (stockStatus !== 'all') {
        rows = rows.filter(r => {
          const lowThreshold = r.reorder_point || 5;
          if (stockStatus === 'out') return r.available === 0;
          if (stockStatus === 'low') return r.available > 0 && r.available < lowThreshold;
          if (stockStatus === 'in') return r.available >= lowThreshold;
          return true;
        });
      }
      const SORT_KEYS = {
        name: r => (r.name || '').toLowerCase(), classification_name: r => (r.classification_name || '').toLowerCase(),
        available: r => r.available, issued: r => r.issued, under_repair: r => r.under_repair,
        damaged: r => r.damaged, disposed: r => r.disposed, total: r => r.total,
        available_value: r => r.available_value, damaged_value: r => r.damaged_value, total_value: r => r.total_value,
      };
      const sortKey = SORT_KEYS[sortField] || SORT_KEYS.name;
      rows.sort((a, b) => {
        const av = sortKey(a); const bv = sortKey(b);
        if (av < bv) return -1 * sortDir;
        if (av > bv) return 1 * sortDir;
        return 0;
      });

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Inventory', { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Component', key: 'name', width: 32 },
        { header: 'Classification', key: 'classification_name', width: 22 },
        { header: 'Available', key: 'available', width: 12 },
        { header: 'Issued', key: 'issued', width: 10 },
        { header: 'Under Repair', key: 'under_repair', width: 14 },
        { header: 'Damaged/Consumed', key: 'damaged', width: 16 },
        { header: 'Disposed', key: 'disposed', width: 10 },
        { header: 'Total', key: 'total', width: 10 },
        { header: 'Available Value', key: 'available_value', width: 16 },
        { header: 'Damaged/Consumed Value', key: 'damaged_value', width: 18 },
        { header: 'Total Value', key: 'total_value', width: 16 },
      ];
      ws.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
      ws.getRow(1).height = 30;
      ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };

      rows.forEach((r, i) => {
        const row = ws.addRow(r);
        if (i % 2 === 1) row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFBFF' } }; });
        row.eachCell(cell => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }; });
        ['available_value', 'damaged_value', 'total_value'].forEach(key => { row.getCell(key).numFmt = '#,##0.00'; });
      });

      const totalAvailable = rows.reduce((s, r) => s + (Number(r.available_value) || 0), 0);
      const totalDamaged = rows.reduce((s, r) => s + (Number(r.damaged_value) || 0), 0);
      const totalAll = rows.reduce((s, r) => s + (Number(r.total_value) || 0), 0);
      const totalsRow = ws.addRow({ name: `TOTAL (${rows.length} component${rows.length === 1 ? '' : 's'})`, available_value: totalAvailable, damaged_value: totalDamaged, total_value: totalAll });
      totalsRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FF1A237E' } }; cell.border = { top: { style: 'thin', color: { argb: 'FF1A237E' } } }; });
      ['available_value', 'damaged_value', 'total_value'].forEach(key => { totalsRow.getCell(key).numFmt = '#,##0.00'; });

      const filterSuffix = [
        classificationFilter !== 'All' ? classificationFilter.replace(/\s+/g, '') : null,
        stockStatus !== 'all' ? stockStatus : null,
      ].filter(Boolean).join('_');
      res.setHeader('Content-Disposition', `attachment; filename=${centerId}_inventory${filterSuffix ? `_${filterSuffix}` : ''}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return wb.xlsx.write(res).then(() => res.end());
    }

    if (type === 'internal-issues') {
      const db = getDb();
      const clauses = [];
      const params = [];
      if (centerId) { clauses.push('ii.center_id = ?'); params.push(centerId); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const issues = db.prepare(`
        SELECT ii.id, ii.issue_code, ctr.name AS centerName, ii.taken_by, p.name AS programName, ii.reason,
               ii.student_count, ii.team_count, ii.institute_name, ii.status,
               ii.issued_by, ii.issued_at, ii.returned_at
        FROM internal_issues ii
        LEFT JOIN centers ctr ON ctr.id = ii.center_id
        LEFT JOIN projects p ON p.id = ii.project_id
        ${where}
        ORDER BY ii.issued_at DESC
      `).all(...params);

      const rows = issues.map(issue => {
        const items = db.prepare(`
          SELECT id, name, qty, unit FROM internal_issue_items WHERE internal_issue_id = ?
        `).all(issue.id);
        const itemsWithAssetsAndReturns = items.map(item => {
          const assets = db.prepare(`
            SELECT a.asset_tag AS assetTag, a.serial_number AS serialNumber FROM internal_issue_assets iia
            JOIN assets a ON a.id = iia.asset_id WHERE iia.internal_issue_item_id = ?
          `).all(item.id);
          const returns = db.prepare(`
            SELECT COALESCE(SUM(returned_good_qty), 0) AS returnedGoodQty, COALESCE(SUM(returned_damaged_qty), 0) AS returnedDamagedQty
            FROM internal_issue_return_items WHERE internal_issue_item_id = ?
          `).get(item.id);
          return { ...item, assets, ...returns };
        });
        return {
          issueCode: issue.issue_code, centerName: issue.centerName, takenBy: issue.taken_by,
          programName: issue.programName || '', reason: issue.reason,
          studentCount: issue.student_count, teamCount: issue.team_count, instituteName: issue.institute_name,
          status: issue.status, issuedBy: issue.issued_by, issuedAt: issue.issued_at, returnedAt: issue.returned_at,
          itemsSummary: itemsWithAssetsAndReturns.map(i => `${i.name} x${i.qty}`).join(', '),
          assetTagsSummary: itemsWithAssetsAndReturns.flatMap(i => i.assets.map(a => a.assetTag + (a.serialNumber ? ` (SN: ${a.serialNumber})` : ''))).join(', '),
          returnedGoodSummary: itemsWithAssetsAndReturns.filter(i => i.returnedGoodQty > 0).map(i => `${i.name} x${i.returnedGoodQty}`).join(', '),
          returnedDamagedSummary: itemsWithAssetsAndReturns.filter(i => i.returnedDamagedQty > 0).map(i => `${i.name} x${i.returnedDamagedQty}`).join(', '),
        };
      });

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Internal Use');
      ws.columns = [
        { header: 'Issue Code', key: 'issueCode', width: 20 },
        { header: 'Center', key: 'centerName', width: 20 },
        { header: 'Taken By', key: 'takenBy', width: 20 },
        { header: 'Program', key: 'programName', width: 22 },
        { header: 'Reason', key: 'reason', width: 30 },
        { header: 'Students', key: 'studentCount', width: 12 },
        { header: 'Teams', key: 'teamCount', width: 10 },
        { header: 'Institute', key: 'instituteName', width: 24 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Items (name x qty)', key: 'itemsSummary', width: 40 },
        { header: 'Asset Tags / Serials', key: 'assetTagsSummary', width: 40 },
        { header: 'Returned Good', key: 'returnedGoodSummary', width: 25 },
        { header: 'Returned Damaged', key: 'returnedDamagedSummary', width: 25 },
        { header: 'Issued By', key: 'issuedBy', width: 16 },
        { header: 'Issued At', key: 'issuedAt', width: 20 },
        { header: 'Returned At', key: 'returnedAt', width: 20 },
      ];
      ws.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
      ws.getRow(1).height = 30;
      ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };
      rows.forEach(row => ws.addRow(row));

      res.setHeader('Content-Disposition', `attachment; filename=${centerId || 'all_centers'}_internal_use.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return wb.xlsx.write(res).then(() => res.end());
    }

    if (type === 'logs') {
      const logs = getLogs(centerId);
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Activity Log');
      ws.columns = [
        { header: 'Timestamp', key: 'ts', width: 22 },
        { header: 'Center', key: 'centerName', width: 28 },
        { header: 'User', key: 'user', width: 20 },
        { header: 'Role', key: 'role', width: 14 },
        { header: 'Action', key: 'action', width: 25 },
        { header: 'Details', key: 'details', width: 60 },
      ];
      logs.forEach(log => ws.addRow(log));
      res.setHeader('Content-Disposition', `attachment; filename=${centerId}_logs.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return wb.xlsx.write(res).then(() => res.end());
    }

    if (type === 'whatsapp') {
      const messages = getWhatsappMessages(centerId);
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('WhatsApp Messages');
      ws.columns = [
        { header: 'Message ID', key: 'messageId', width: 40 },
        { header: 'Center', key: 'centerName', width: 28 },
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
      messages.forEach(message => ws.addRow(message));
      res.setHeader('Content-Disposition', `attachment; filename=${centerId}_whatsapp_messages.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return wb.xlsx.write(res).then(() => res.end());
    }

    return res.status(400).json({ message: 'Invalid file type' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
