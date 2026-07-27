const express = require('express');
const {
  addTransferRequest,
  getTransferRequests,
  updateTransferRequest,
  getInventory,
  updateInventoryItem,
  logActivity,
} = require('../utils/excel');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { CENTERS, getCenterById } = require('../utils/centers');
const { getAdminRecipient, sendTransferNotification } = require('../utils/email');

const router = express.Router();

const ADMIN_RECIPIENTS = [process.env.ADMIN_EMAIL].filter(Boolean);

function normalizeComponent(raw) {
  const qty = Number(raw.qty || raw.quantity || 0);
  return {
    id: String(raw.id || raw.componentId || '').trim(),
    name: String(raw.name || '').trim(),
    qty: Number.isFinite(qty) ? qty : 0,
    unit: String(raw.unit || raw.uom || 'pcs').trim(),
    link: String(raw.link || raw.url || '').trim(),
  };
}

async function findTransferById(transferId) {
  const all = await getTransferRequests();
  return all.find(request => request.id === transferId);
}

async function adjustStockForApproval(transfer, supplyCenterId) {
  const receivingCenterId = transfer.requestingCenterId;
  const components = transfer.components || [];
  const supplyInventory = await getInventory(supplyCenterId);
  const receivingInventory = await getInventory(receivingCenterId);

  for (const entry of components) {
    const supplyItem = supplyInventory.find(item => item.id === entry.id);
    if (!supplyItem) {
      throw new Error(`Component ${entry.name || entry.id} not found in supply center`);
    }
    if ((supplyItem.stock || 0) < entry.qty) {
      throw new Error(`Insufficient stock for ${entry.name || entry.id} at ${getCenterById(supplyCenterId).name}`);
    }
  }

  for (const entry of components) {
    const supplyItem = supplyInventory.find(item => item.id === entry.id);
    await updateInventoryItem(supplyItem.id, { stock: (supplyItem.stock || 0) - entry.qty }, supplyCenterId);
    const receivingItem = receivingInventory.find(item => item.id === entry.id);
    if (!receivingItem) {
      throw new Error(`Component ${entry.name || entry.id} missing in receiving center inventory`);
    }
    await updateInventoryItem(receivingItem.id, { stock: (receivingItem.stock || 0) + entry.qty }, receivingCenterId);
  }
}

async function adjustStockForReturn(transfer) {
  const supplyCenterId = transfer.supplyCenterId;
  const receivingCenterId = transfer.requestingCenterId;
  if (!supplyCenterId) {
    throw new Error('Supply center is not recorded for this transfer');
  }
  const components = transfer.components || [];
  const supplyInventory = await getInventory(supplyCenterId);
  const receivingInventory = await getInventory(receivingCenterId);

  for (const entry of components) {
    const receivingItem = receivingInventory.find(item => item.id === entry.id);
    if (!receivingItem) {
      throw new Error(`Component ${entry.name || entry.id} missing in receiving center inventory`);
    }
    await updateInventoryItem(receivingItem.id, {
      stock: Math.max(0, (receivingItem.stock || 0) - entry.qty),
    }, receivingCenterId);

    const supplyItem = supplyInventory.find(item => item.id === entry.id);
    if (!supplyItem) {
      throw new Error(`Component ${entry.name || entry.id} missing in supply center inventory`);
    }
    await updateInventoryItem(supplyItem.id, {
      stock: (supplyItem.stock || 0) + entry.qty,
    }, supplyCenterId);
  }
}

router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const isSuper = req.user.role === 'super_admin';
    let requests = [];

    if (isSuper) {
      const centerId = String(req.query.centerId || '').trim() || undefined;
      requests = await getTransferRequests(centerId, { includeAvailability: true });
    } else {
      const centerId = req.user.centerId;
      const allRequests = await getTransferRequests(undefined);
      requests = allRequests.filter(request =>
        request.requestingCenterId === centerId || request.supplyCenterId === centerId);
    }

    res.json(requests);
  } catch (err) {
    console.error('Transfer GET error:', err.message);
    res.status(500).json({ message: 'Unable to fetch transfer requests' });
  }
});

router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const centerId = req.user.centerId;
    if (!centerId) {
      return res.status(400).json({ message: 'Center context is missing' });
    }
    const rawComponents = Array.isArray(req.body.components) ? req.body.components : [];
    const components = rawComponents
      .map(normalizeComponent)
      .filter(item => item.id && item.name && item.qty > 0);
    if (!components.length) {
      return res.status(400).json({ message: 'At least one valid component is required' });
    }
    const payload = {
      components,
      programName: String(req.body.programName || '').trim(),
      responsiblePerson: String(req.body.responsiblePerson || '').trim(),
      responsibleEmail: String(req.body.responsibleEmail || '').trim(),
      purpose: String(req.body.purpose || '').trim(),
      desiredReturnDate: String(req.body.desiredReturnDate || '').trim(),
      notes: String(req.body.notes || '').trim(),
      requestedBy: req.user.username,
    };
    const transfer = await addTransferRequest(centerId, payload);
    await logActivity('TRANSFER_REQUEST', req.user.username, {
      role: req.user.role,
      centerId,
      info: `Requested ${components.length} components (Transfer ${transfer.id})`,
    });
    await sendTransferNotification({
      transfer,
      type: 'request',
      recipients: ADMIN_RECIPIENTS,
    });
    res.status(201).json(transfer);
  } catch (err) {
    console.error('Transfer POST error:', err.message);
    res.status(500).json({ message: err.message || 'Unable to create transfer request' });
  }
});

router.post('/:id/return-request', authMiddleware, adminOnly, async (req, res) => {
  try {
    const transferId = req.params.id;
    const request = await findTransferById(transferId);
    if (!request) {
      return res.status(404).json({ message: 'Transfer not found' });
    }
    if (req.user.role !== 'super_admin' && req.user.centerId !== request.requestingCenterId) {
      return res.status(403).json({ message: 'Only the requesting center can ask for a return' });
    }
    if (request.status !== 'Approved') {
      return res.status(400).json({ message: 'Only approved transfers can be returned' });
    }
    const now = new Date();
    const reason = String(req.body.reason || '').trim();
    const payload = {
      status: 'Return Requested',
      statusUpdatedAt: now,
      returnRequestedAt: now,
      returnNotes: reason || request.returnNotes || '',
    };
    if (String(req.body.courierName || '').trim()) {
      payload.returnNotes += `\nCourier: ${req.body.courierName.trim()}`;
    }
    if (String(req.body.trackingId || '').trim()) {
      payload.returnNotes += `\nTracking ID: ${req.body.trackingId.trim()}`;
    }
    const updated = await updateTransferRequest(transferId, payload);
    await logActivity('TRANSFER_RETURN_REQUESTED', req.user.username, {
      role: req.user.role,
      centerId: request.requestingCenterId,
      info: `Return requested for ${transferId}`,
    });
    const recipients = [
      getAdminRecipient(request.supplyCenterId),
      ...ADMIN_RECIPIENTS,
    ].filter(Boolean);
    await sendTransferNotification({ transfer: updated, type: 'return-request', recipients });
    res.json(updated);
  } catch (err) {
    console.error('Return request error:', err.message);
    res.status(500).json({ message: err.message || 'Unable to request return' });
  }
});

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ message: 'Super admin access required' });
  }
  try {
    const transferId = req.params.id;
    const request = await findTransferById(transferId);
    if (!request) {
      return res.status(404).json({ message: 'Transfer not found' });
    }
    const status = String(req.body.status || '').trim();
    const now = new Date();
    if (status === 'Approved') {
      if (request.status !== 'Pending') {
        return res.status(400).json({ message: 'Only pending transfers can be approved' });
      }
      const supplyCenterId = String(req.body.supplyCenterId || '').trim();
      if (!supplyCenterId) {
        return res.status(400).json({ message: 'Supply center selection is required' });
      }
      const approvedComponents = Array.isArray(req.body.components)
        ? req.body.components.map(normalizeComponent).filter(item => item.id && item.name && item.qty > 0)
        : (request.components || []);
      if (!approvedComponents.length) {
        return res.status(400).json({ message: 'At least one valid component is required for approval' });
      }
      await adjustStockForApproval({ ...request, components: approvedComponents }, supplyCenterId);
      const updated = await updateTransferRequest(transferId, {
        status: 'Approved',
        statusUpdatedAt: now,
        components: approvedComponents,
        supplyCenterId,
        supplyCenterName: getCenterById(supplyCenterId)?.name || '',
        approvedAt: now,
        supplierRemarks: String(req.body.supplierRemarks || '').trim(),
      });
      await logActivity('TRANSFER_APPROVED', req.user.username, {
        role: req.user.role,
        centerId: request.requestingCenterId,
        info: `Transfer ${transferId} approved (supplied by ${supplyCenterId})`,
      });
      await logActivity('TRANSFER_SUPPLY', req.user.username, {
        role: req.user.role,
        centerId: supplyCenterId,
        info: `Supplied transfer ${transferId}`,
      });
      const recipients = [
        getAdminRecipient(supplyCenterId),
        getAdminRecipient(request.requestingCenterId),
      ].filter(Boolean);
      await sendTransferNotification({ transfer: updated, type: 'approved', recipients });
      return res.json(updated);
    }

    if (status === 'Returned') {
      if (!['Approved', 'Return Requested'].includes(request.status)) {
        return res.status(400).json({ message: 'Only approved/return-requested transfers can be marked returned' });
      }
      await adjustStockForReturn(request);
      const updated = await updateTransferRequest(transferId, {
        status: 'Returned',
        statusUpdatedAt: now,
        returnedAt: now,
        returnNotes: String(req.body.returnNotes || request.returnNotes || '').trim(),
      });
      await logActivity('TRANSFER_RETURNED', req.user.username, {
        role: req.user.role,
        centerId: request.requestingCenterId,
        info: `Transfer ${transferId} returned to ${request.supplyCenterId}`,
      });
      await logActivity('TRANSFER_RECEIVED_BACK', req.user.username, {
        role: req.user.role,
        centerId: request.supplyCenterId,
        info: `Transfer ${transferId} components returned`,
      });
      const recipients = [
        getAdminRecipient(request.supplyCenterId),
        getAdminRecipient(request.requestingCenterId),
      ].filter(Boolean);
      await sendTransferNotification({ transfer: updated, type: 'returned', recipients });
      return res.json(updated);
    }

    return res.status(400).json({ message: 'Unsupported status update' });
  } catch (err) {
    console.error('Transfer PUT error:', err.message);
    res.status(500).json({ message: err.message || 'Unable to update transfer request' });
  }
});

module.exports = router;
