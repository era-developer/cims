const express = require('express');
const path = require('path');
const { getInventory, getOrders, getUsers, addUser, updateUser, deleteUser, FILES, logActivity, getWhatsappMessages } = require('../utils/excel');
const { verifyWhatsAppConnection } = require('../utils/whatsapp');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET dashboard stats
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [inventory, orders, users] = await Promise.all([getInventory(), getOrders(), getUsers()]);
    const stats = {
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
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET all users
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    res.json(await getUsers());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/whatsapp/messages', authMiddleware, adminOnly, async (req, res) => {
  try {
    const messages = await getWhatsappMessages();
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

// POST create user
router.post('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    await addUser(req.body);
    await logActivity('CREATE_USER', req.user.username, { role: 'admin', info: `Created user: ${req.body.username}` });
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT update user
router.put('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const updated = await updateUser(req.params.id, req.body);
    await logActivity('UPDATE_USER', req.user.username, { role: 'admin', info: `Updated user: ${updated.username}` });
    res.json({ message: 'User updated', user: updated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE user
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const ok = await deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ message: 'User not found' });
    await logActivity('DELETE_USER', req.user.username, { role: 'admin', info: `Deleted user: ${req.params.id}` });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET download Excel files
router.get('/download/:type', authMiddleware, adminOnly, async (req, res) => {
  const { type } = req.params;
  const { startDate, endDate } = req.query;

  if (type === 'orders') {
    const orders = await getOrders();
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
    const ws = wb.addWorksheet('Orders');
    ws.columns = [
      { header: 'Order ID', key: 'orderId', width: 20 },
      { header: 'Date & Time', key: 'createdAt', width: 20 },
      { header: 'Student Name', key: 'studentName', width: 22 },
      { header: 'Username', key: 'username', width: 18 },
      { header: 'Mobile', key: 'mobile', width: 15 },
      { header: 'College', key: 'college', width: 30 },
      { header: 'Department', key: 'department', width: 22 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Total Items', key: 'totalItems', width: 14 },
      { header: 'Admin Remarks', key: 'adminRemarks', width: 30 },
    ];

    filteredOrders.forEach(order => {
      ws.addRow({
        orderId: order.orderId,
        createdAt: order.createdAt,
        studentName: order.studentName,
        username: order.username,
        mobile: order.mobile,
        college: order.college,
        department: order.department,
        status: order.status,
        totalItems: order.totalItems,
        adminRemarks: order.adminRemarks,
      });
    });

    res.setHeader('Content-Disposition', `attachment; filename=CIMS_Orders_${startDate || 'all'}-${endDate || 'all'}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return wb.xlsx.write(res).then(() => res.end());
  }

  const map = {
    inventory: { file: FILES.inventory, name: 'CIMS_Inventory.xlsx' },
    users: { file: FILES.users, name: 'CIMS_Users.xlsx' },
    logs: { file: FILES.logs, name: 'CIMS_Activity_Logs.xlsx' },
  };
  if (!map[type]) return res.status(400).json({ message: 'Invalid file type' });
  res.download(map[type].file, map[type].name, err => {
    if (err) res.status(500).json({ message: 'File not available' });
  });
});

module.exports = router;
