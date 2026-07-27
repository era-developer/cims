const express = require('express');
const { getInventory, getOrders, getUsers, addUser, updateUser, deleteUser, logActivity, getWhatsappMessages, getWorkbookFile, getAnalytics, getLogs, getTransferRequests, createInventoryExportWorkbook } = require('../utils/excel');
const { verifyWhatsAppConnection } = require('../utils/whatsapp');
const { CENTERS, getCenterById } = require('../utils/centers');
const { authMiddleware, adminOnly } = require('../middleware/auth');

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
    const [inventory, orders, users] = await Promise.all([
      centerId ? getInventory(centerId) : Promise.all(CENTERS.map(center => getInventory(center.id))).then(results => results.flat()),
      getOrders(centerId || undefined),
      getUsers(centerId ? { centerId } : {}),
    ]);
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
        const [centerInventory, centerOrders, centerUsers] = await Promise.all([
          getInventory(center.id),
          getOrders(center.id),
          getUsers({ centerId: center.id }),
        ]);
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
    res.json(await getUsers(centerId ? { centerId } : {}));
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
    if (req.user.role !== 'super_admin') payload.centerId = req.user.centerId;
    await addUser(payload);
    await logActivity('CREATE_USER', req.user.username, { role: req.user.role, centerId: payload.centerId || req.user.centerId, info: `Created user: ${req.body.username}` });
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT update user
router.put('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const existingUsers = await getUsers();
    const current = existingUsers.find(user => user.id === req.params.id);
    if (!current) return res.status(404).json({ message: 'User not found' });
    if (req.user.role !== 'super_admin' && current.centerId !== req.user.centerId) {
      return res.status(403).json({ message: 'You do not have access to this user' });
    }
    const payload = { ...req.body };
    if (req.user.role !== 'super_admin') payload.centerId = current.centerId || req.user.centerId;
    const updated = await updateUser(req.params.id, payload);
    await logActivity('UPDATE_USER', req.user.username, { role: req.user.role, centerId: updated.centerId || current.centerId || req.user.centerId, info: `Updated user: ${updated.username}` });
    res.json({ message: 'User updated', user: updated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE user
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const existingUsers = await getUsers();
    const current = existingUsers.find(user => user.id === req.params.id);
    if (!current) return res.status(404).json({ message: 'User not found' });
    if (req.user.role !== 'super_admin' && current.centerId !== req.user.centerId) {
      return res.status(403).json({ message: 'You do not have access to this user' });
    }
    const ok = await deleteUser(req.params.id);
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
    res.json(await getAnalytics());
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
    if (!centerId && type !== 'transfers') {
      return res.status(400).json({ message: 'Select a center to download this report' });
    }

    if (type === 'orders') {
      const orders = await getOrders(centerId);
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
        { header: 'Damaged Qty', key: 'damagedQty', width: 12 },
        { header: 'Pending Qty', key: 'pendingQty', width: 12 },
      ];

      filteredOrders.forEach(order => {
        const items = getOrderItems(order);
        const returnSummary = parseJsonArray(order.returnSummaryJson);
        const returnById = new Map(
          returnSummary.map(item => [
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
          resolvedAt: formatDateTimeIST(order.resolvedAt),
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
      const users = await getUsers({ centerId });
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
      const transfers = (await getTransferRequests()).filter(transfer =>
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
      const items = await getInventory(centerId);
      const workbook = createInventoryExportWorkbook(items);
      res.setHeader('Content-Disposition', `attachment; filename=${centerId || 'all_centers'}_inventory.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return workbook.xlsx.write(res).then(() => res.end());
    }

    const map = {
      logs: { file: getWorkbookFile('logs', centerId), name: `${centerId}_logs.xlsx` },
      whatsapp: { file: getWorkbookFile('whatsapp', centerId), name: `${centerId}_whatsapp_messages.xlsx` },
    };
    if (!map[type]) return res.status(400).json({ message: 'Invalid file type' });
    res.download(map[type].file, map[type].name, err => {
      if (err) res.status(500).json({ message: 'File not available' });
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
