const express = require('express');
const {
  saveOrder,
  getOrders,
  updateOrderStatus,
  getInventory,
  updateInventoryItem,
  logActivity,
} = require('../utils/excel');
const { sendOrderNotification, sendStatusUpdate } = require('../utils/email');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

const ADMIN_STATUSES = new Set(['Approved', 'Rejected', 'Returned']);

function getScopedCenterId(req) {
  if (req.user.role === 'super_admin') {
    return String(req.query.centerId || req.body.centerId || '').trim();
  }
  return req.user.centerId;
}

function parseOrderItems(order) {
  try {
    const parsed = JSON.parse(order.itemsJson || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function aggregateItems(items = []) {
  const aggregated = new Map();
  for (const rawItem of items) {
    const id = String(rawItem.id || '').trim();
    const qty = Number(rawItem.qty) || 0;
    if (!id || qty <= 0) continue;
    const existing = aggregated.get(id) || {
      id,
      name: rawItem.name || 'Component',
      qty: 0,
      unit: rawItem.unit || 'pcs',
    };
    existing.qty += qty;
    if (rawItem.name) existing.name = rawItem.name;
    if (rawItem.unit) existing.unit = rawItem.unit;
    aggregated.set(id, existing);
  }
  return Array.from(aggregated.values());
}

function parseReturnSummary(order, items = parseOrderItems(order)) {
  let parsedSummary = [];
  try {
    const parsed = JSON.parse(order.returnSummaryJson || '[]');
    parsedSummary = Array.isArray(parsed) ? parsed : [];
  } catch {
    parsedSummary = [];
  }

  const savedMap = new Map(parsedSummary.map(entry => [String(entry.id || '').trim(), entry]));
  return aggregateItems(items).map(item => {
    const saved = savedMap.get(item.id) || {};
    const orderedQty = Number(item.qty) || 0;
    let returnedQty = Math.max(0, Number(saved.returnedQty) || 0);
    let damagedQty = Math.max(0, Number(saved.damagedQty) || 0);

    if (returnedQty > orderedQty) returnedQty = orderedQty;
    if (returnedQty + damagedQty > orderedQty) {
      damagedQty = Math.max(0, orderedQty - returnedQty);
    }

    return {
      id: item.id,
      name: item.name,
      unit: item.unit || 'pcs',
      orderedQty,
      returnedQty,
      damagedQty,
      pendingQty: Math.max(0, orderedQty - returnedQty - damagedQty),
    };
  });
}

function serializeReturnSummary(summary = []) {
  return JSON.stringify(summary.map(item => ({
    id: item.id,
    name: item.name,
    unit: item.unit || 'pcs',
    orderedQty: Number(item.orderedQty) || 0,
    returnedQty: Number(item.returnedQty) || 0,
    damagedQty: Number(item.damagedQty) || 0,
  })));
}

function buildOrderForNotifications(order) {
  const items = parseOrderItems(order);
  const returnSummary = parseReturnSummary(order, items);
  return {
    ...order,
    items,
    returnSummary,
    outstandingItems: returnSummary
      .filter(item => item.pendingQty > 0)
      .map(item => ({ id: item.id, name: item.name, unit: item.unit, qty: item.pendingQty })),
  };
}

function determineReturnStatus(returnSummary = []) {
  if (!returnSummary.length) return 'Returned';
  const hasPending = returnSummary.some(item => item.pendingQty > 0);
  const hasAnyProcessed = returnSummary.some(item => item.returnedQty > 0 || item.damagedQty > 0);
  if (!hasPending && hasAnyProcessed) return 'Returned';
  if (hasPending && hasAnyProcessed) return 'Partially Returned';
  return 'Return Requested';
}

function normalizeReturnItemsPayload(rawItems, returnSummary) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return returnSummary
      .filter(item => item.pendingQty > 0)
      .map(item => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        returnedQty: item.pendingQty,
        damagedQty: 0,
      }));
  }

  const summaryMap = new Map(returnSummary.map(item => [item.id, item]));
  const normalized = [];

  for (const rawItem of rawItems) {
    const id = String(rawItem.id || '').trim();
    const summaryItem = summaryMap.get(id);
    if (!summaryItem) continue;

    const returnedQty = Number(rawItem.returnedQty) || 0;
    const damagedQty = Number(rawItem.damagedQty) || 0;

    if (returnedQty < 0 || damagedQty < 0) {
      throw new Error(`Return quantities cannot be negative for ${summaryItem.name}`);
    }

    if (returnedQty + damagedQty > summaryItem.pendingQty) {
      throw new Error(`Return quantity exceeds pending balance for ${summaryItem.name}`);
    }

    if (returnedQty === 0 && damagedQty === 0) continue;

    normalized.push({
      id,
      name: summaryItem.name,
      unit: summaryItem.unit,
      returnedQty,
      damagedQty,
    });
  }

  if (!normalized.length) {
    throw new Error('Enter returned or damaged quantity for at least one component');
  }

  return normalized;
}

function applyReturnSummaryUpdates(returnSummary, updates) {
  const updateMap = new Map(updates.map(item => [item.id, item]));
  return returnSummary.map(item => {
    const update = updateMap.get(item.id);
    const returnedQty = (Number(item.returnedQty) || 0) + (Number(update?.returnedQty) || 0);
    const damagedQty = (Number(item.damagedQty) || 0) + (Number(update?.damagedQty) || 0);
    return {
      ...item,
      returnedQty,
      damagedQty,
      pendingQty: Math.max(0, (Number(item.orderedQty) || 0) - returnedQty - damagedQty),
    };
  });
}

function processApprovedItems(originalItems, approvedItemsPayload) {
  if (!Array.isArray(approvedItemsPayload)) {
    throw new Error('approvedItems must be an array.');
  }

  const approvedMap = new Map(approvedItemsPayload.map(item => [item.id, item.qty]));
  const updatedItems = [];
  const returnedToStockItems = [];
  const rejectedItems = [];

  for (const originalItem of originalItems) {
    // If an item is not in the payload, assume its quantity is unchanged.
    // This makes the feature optional from the frontend.
    const approvedQty = approvedMap.has(originalItem.id)
      ? Number(approvedMap.get(originalItem.id))
      : originalItem.qty;

    if (Number.isNaN(approvedQty) || approvedQty < 0) {
      throw new Error(`Invalid quantity provided for ${originalItem.name}.`);
    }
    if (approvedQty > originalItem.qty) {
      throw new Error(`Approved quantity for ${originalItem.name} cannot exceed requested quantity (${originalItem.qty}).`);
    }

    if (approvedQty > 0) {
      updatedItems.push({ ...originalItem, qty: approvedQty });
    }

    const diff = originalItem.qty - approvedQty;
    if (diff > 0) {
      const returnedItem = { ...originalItem, qty: diff };
      returnedToStockItems.push(returnedItem);
      rejectedItems.push(returnedItem);
    }
  }

  return { updatedItems, returnedToStockItems, rejectedItems };
}

async function reserveStock(items, centerId) {
  const aggregatedItems = aggregateItems(items);
  const inventory = await getInventory(centerId);

  for (const item of aggregatedItems) {
    const component = inventory.find(entry => entry.id === item.id);
    if (!component) throw new Error(`Component not found: ${item.name}`);
    if (component.stock < item.qty) {
      throw new Error(`Insufficient stock for: ${component.name} (Available: ${component.stock})`);
    }
  }

  for (const item of aggregatedItems) {
    const component = inventory.find(entry => entry.id === item.id);
    await updateInventoryItem(component.id, {
      stock: Math.max(0, component.stock - item.qty),
    }, centerId);
  }

  return aggregatedItems;
}

async function restoreStock(items, centerId) {
  const aggregatedItems = aggregateItems(items);
  const inventory = await getInventory(centerId);

  for (const item of aggregatedItems) {
    const component = inventory.find(entry => entry.id === item.id);
    if (!component) continue;
    await updateInventoryItem(component.id, {
      stock: (component.stock || 0) + item.qty,
    }, centerId);
  }
}

async function countIssuedItems(items, centerId) {
  const aggregatedItems = aggregateItems(items);
  const inventory = await getInventory(centerId);

  for (const item of aggregatedItems) {
    const component = inventory.find(entry => entry.id === item.id);
    if (!component) continue;
    await updateInventoryItem(component.id, {
      totalIssued: (component.totalIssued || 0) + item.qty,
    }, centerId);
  }
}

async function applyInventoryReturnUpdates(returnItems, centerId) {
  const inventory = await getInventory(centerId);

  for (const item of returnItems) {
    const component = inventory.find(entry => entry.id === item.id);
    if (!component) continue;

    await updateInventoryItem(component.id, {
      stock: (component.stock || 0) + (Number(item.returnedQty) || 0),
      damagedCount: (component.damagedCount || 0) + (Number(item.damagedQty) || 0),
    }, centerId);
  }
}

// POST place new order (student)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const centerId = req.user.centerId;
    const reservedItems = await reserveStock(req.body.items || [], centerId);
    if (!reservedItems.length) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    const now = new Date().toISOString();
    const studentDetails = req.body.studentDetails || {};
    const expectedReturnDateRaw = String(studentDetails.expectedReturnDate || '').trim();
    if (!expectedReturnDateRaw) {
      await restoreStock(reservedItems, centerId).catch(console.error);
      return res.status(400).json({ message: 'Expected return date is required' });
    }

    const expectedReturnDate = new Date(expectedReturnDateRaw);
    if (Number.isNaN(expectedReturnDate.getTime())) {
      await restoreStock(reservedItems, centerId).catch(console.error);
      return res.status(400).json({ message: 'Expected return date is invalid' });
    }

    const initialReturnSummary = parseReturnSummary({ itemsJson: JSON.stringify(reservedItems) }, reservedItems);
    const order = {
      orderId: `CIMS-${Date.now().toString(36).toUpperCase()}`,
      centerId,
      centerName: req.user.centerName,
      createdAt: now,
      username: req.user.username,
      studentEmail: String(studentDetails.email || req.user.email || '').trim(),
      studentDetails: {
        ...studentDetails,
        expectedReturnDate: expectedReturnDate.toISOString(),
      },
      items: reservedItems,
      status: 'Pending',
      stockReserved: true,
      issuedCounted: false,
      reservedAt: now,
      returnSummaryJson: serializeReturnSummary(initialReturnSummary),
      expectedReturnDate: expectedReturnDate.toISOString(),
      reminderSentAt: '',
    };

    try {
      await saveOrder(order);
    } catch (err) {
      await restoreStock(reservedItems, centerId).catch(console.error);
      throw err;
    }

    await logActivity('PLACE_ORDER', req.user.username, {
      role: 'student',
      centerId,
      info: `Order ${order.orderId}: ${reservedItems.length} component type(s) reserved`,
    });

    sendOrderNotification(buildOrderForNotifications(order), centerId).catch(console.error);
    // sendOrderWhatsAppNotifications(buildOrderForNotifications(order)).catch(console.error); // Removed - using manual WhatsApp button instead

    res.status(201).json({ message: 'Order placed successfully', orderId: order.orderId });
  } catch (err) {
    console.error(err);
    const isValidationError = /cart is empty|component not found|insufficient stock/i.test(err.message || '');
    res.status(isValidationError ? 400 : 500).json({ message: err.message || 'Error placing order' });
  }
});

// GET all orders (admin) or own orders (student)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const scopedCenterId = getScopedCenterId(req);
    const orders = (await getOrders(scopedCenterId || undefined)).map(order => {
      const items = parseOrderItems(order);
      const returnSummary = parseReturnSummary(order, items);
      return {
        ...order,
        items,
        returnSummary,
        outstandingItems: returnSummary
          .filter(item => item.pendingQty > 0)
          .map(item => ({ id: item.id, name: item.name, unit: item.unit, qty: item.pendingQty })),
      };
    });
    if (['admin', 'super_admin'].includes(req.user.role)) return res.json(orders);
    res.json(orders.filter(order => order.username === req.user.username));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// Student requests a return after using the components
router.put('/:orderId/return-request', authMiddleware, async (req, res) => {
  try {
    const orders = await getOrders(req.user.centerId);
    const order = orders.find(entry => entry.orderId === req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.username !== req.user.username && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only update your own orders' });
    }
    if (order.status !== 'Approved') {
      return res.status(400).json({ message: 'Only approved orders can be marked for return' });
    }

    const now = new Date().toISOString();
    await updateOrderStatus(order.orderId, 'Return Requested', undefined, {
      returnRequestedAt: now,
    }, order.centerId);
    await logActivity('RETURN_REQUESTED', req.user.username, {
      role: req.user.role,
      centerId: order.centerId,
      info: `${order.orderId} marked for return`,
    });

    sendStatusUpdate(buildOrderForNotifications({
      ...order,
      status: 'Return Requested',
      returnRequestedAt: now,
    }), 'Return Requested', req.body?.remarks || '', order.centerId).catch(console.error);
    // sendStatusWhatsAppNotifications(buildOrderForNotifications({ // Removed - using manual WhatsApp button instead
    //   ...order,
    //   status: 'Return Requested',
    //   returnRequestedAt: now,
    // }), 'Return Requested', req.body?.remarks || '').catch(console.error);

    res.json({ message: 'Return request submitted. Please hand the components back to the lab/admin.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Error requesting return' });
  }
});

// PUT approve/reject/process returns (admin only)
router.put('/:orderId/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status, remarks } = req.body;
    if (!ADMIN_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const orders = await getOrders(getScopedCenterId(req) || undefined);
    const order = orders.find(entry => entry.orderId === req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    
    const originalItems = parseOrderItems(order);
    const now = new Date().toISOString();
    const meta = {};
    let finalStatus = status;
    let finalItems = originalItems;

    if (status === 'Approved') {
      if (order.status !== 'Pending') {
        return res.status(400).json({ message: 'Only pending orders can be approved' });
      }

      // If admin provides edited quantities, process them.
      if (req.body.approvedItems) {
        const { updatedItems, returnedToStockItems, rejectedItems } = processApprovedItems(originalItems, req.body.approvedItems);

        if (updatedItems.length === 0) {
          // If all items are set to 0 qty, treat it as a rejection.
          finalStatus = 'Rejected';
        } else {
          finalItems = updatedItems;
          meta.itemsJson = JSON.stringify(finalItems); // Update the order's items

          // Update the return summary to match the items being issued
          const newReturnSummary = parseReturnSummary({ itemsJson: meta.itemsJson });
          meta.returnSummaryJson = serializeReturnSummary(newReturnSummary);

          // Restore stock for items that were not issued or had reduced quantity.
          if (returnedToStockItems.length > 0) {
            await restoreStock(returnedToStockItems, order.centerId);
          }
          if (rejectedItems.length > 0) {
            meta.rejectedItems = rejectedItems;
          }
        }
      }

      if (finalStatus === 'Approved' && !order.issuedCounted) {
        await countIssuedItems(finalItems, order.centerId); // Count only what's being issued
        meta.issuedCounted = true;
        meta.issuedAt = now;
      }
    }
    
    if (status === 'Rejected') {
      if (order.status !== 'Pending') {
        return res.status(400).json({ message: 'Only pending orders can be rejected' });
      }
      if (order.stockReserved) {
        await restoreStock(originalItems, order.centerId);
        meta.stockReserved = false;
      }
      meta.returnRequestedAt = '';
      meta.returnedAt = '';
      meta.lastReturnAt = '';
      meta.returnSummaryJson = serializeReturnSummary(parseReturnSummary(order, originalItems));
    }
    
    // Handle the case where approval was changed to rejection
    if (finalStatus === 'Rejected' && status === 'Approved') {
      if (order.stockReserved) {
        await restoreStock(originalItems, order.centerId);
        meta.stockReserved = false;
      }
      meta.returnRequestedAt = '';
      meta.returnedAt = '';
      meta.lastReturnAt = '';
      meta.returnSummaryJson = serializeReturnSummary(parseReturnSummary(order, originalItems));
    }

    if (status === 'Returned') {
      if (!['Approved', 'Return Requested', 'Partially Returned'].includes(order.status)) {
        return res.status(400).json({ message: 'This order is not ready for return processing' });
      }

      const currentReturnSummary = parseReturnSummary(order, originalItems);
      const returnUpdates = normalizeReturnItemsPayload(req.body.returnItems, currentReturnSummary);
      await applyInventoryReturnUpdates(returnUpdates, order.centerId);

      const updatedReturnSummary = applyReturnSummaryUpdates(currentReturnSummary, returnUpdates);
      finalStatus = determineReturnStatus(updatedReturnSummary);

      meta.returnSummaryJson = serializeReturnSummary(updatedReturnSummary);
      meta.lastReturnAt = now;
      meta.returnRequestedAt = order.returnRequestedAt || now;
      meta.returnedAt = finalStatus === 'Returned' ? now : '';
      meta.stockReserved = updatedReturnSummary.some(item => item.pendingQty > 0);
    }

    await updateOrderStatus(order.orderId, finalStatus, remarks, meta, order.centerId);
    await logActivity('ORDER_STATUS', req.user.username, {
      role: req.user.role,
      centerId: order.centerId,
      info: `${order.orderId} -> ${finalStatus}`,
    });

    sendStatusUpdate(buildOrderForNotifications({
      ...order,
      ...meta,
      items: finalItems,
      status: finalStatus,
      adminRemarks: remarks !== undefined ? remarks : order.adminRemarks,
    }), finalStatus, remarks, order.centerId).catch(console.error);
    // sendStatusWhatsAppNotifications(buildOrderForNotifications({ // Removed - using manual WhatsApp button instead
    //   ...order,
    //   ...meta,
    //   status: finalStatus,
    //   adminRemarks: remarks !== undefined ? remarks : order.adminRemarks,
    // }), finalStatus, remarks).catch(console.error);

    res.json({
      message: `Order ${finalStatus}`,
      status: finalStatus,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Error updating order status' });
  }
});

module.exports = router;
