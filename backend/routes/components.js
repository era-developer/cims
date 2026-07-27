const express = require('express');
const { getInventory, addInventoryItem, updateInventoryItem, deleteInventoryItem, logActivity } = require('../utils/excel');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { CENTERS } = require('../utils/centers');

const router = express.Router();
const ALLOWED_IMAGE_HOSTS = new Set([
  'drive.google.com',
  'drive.usercontent.google.com',
  'lh3.googleusercontent.com',
]);

function isAllowedImageUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    return parsed.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

router.get('/image', async (req, res) => {
  const src = String(req.query.src || '').trim();
  if (!src || !isAllowedImageUrl(src)) {
    return res.status(400).json({ message: 'Invalid image source' });
  }

  try {
    const response = await fetch(src, { redirect: 'follow' });
    if (!response.ok) {
      return res.status(response.status).json({ message: 'Unable to fetch image' });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({ message: 'Unsupported image response' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (err) {
    return res.status(502).json({ message: 'Image proxy failed' });
  }
});

function getRequestedCenterId(req) {
  if (req.user.role === 'super_admin') {
    return String(req.query.centerId || req.body.centerId || '').trim();
  }
  return req.user.centerId;
}

// GET all components (all authenticated users)
router.get('/', authMiddleware, async (req, res) => {
  try {
    let centerId = getRequestedCenterId(req);
    
    // Default to user's center if not specified, or first center for super_admin if no center selected
    if (!centerId) {
      if (req.user.role === 'super_admin') {
        // For super_admin, use first center if none specified
        centerId = CENTERS.length > 0 ? CENTERS[0].id : '';
      } else {
        // For other admins, use their own center
        centerId = req.user.centerId || '';
      }
    }
    
    if (!centerId) return res.json([]);
    
    let items = [];
    try {
      items = (await getInventory(centerId)) || [];
    } catch (err) {
      console.error(`Inventory read error for ${centerId}:`, err.message);
    }
    
    const active = req.user.role === 'student' ? items.filter(i => i?.active) : items;
    res.json(active);
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ message: 'Error fetching inventory' });
  }
});

// POST add component (admin only)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const centerId = getRequestedCenterId(req);
    const item = await addInventoryItem(req.body, centerId);
    await logActivity('ADD_COMPONENT', req.user.username, { role: req.user.role, centerId, info: `Added: ${item.name}` });
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT update component (admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const centerId = getRequestedCenterId(req);
    const ok = await updateInventoryItem(req.params.id, req.body, centerId);
    if (!ok) return res.status(404).json({ message: 'Component not found' });
    await logActivity('UPDATE_COMPONENT', req.user.username, { role: req.user.role, centerId, info: `Updated ID: ${req.params.id}` });
    res.json({ message: 'Updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE component (admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const centerId = getRequestedCenterId(req);
    const ok = await deleteInventoryItem(req.params.id, centerId);
    if (!ok) return res.status(404).json({ message: 'Component not found' });
    await logActivity('DELETE_COMPONENT', req.user.username, { role: req.user.role, centerId, info: `Deleted ID: ${req.params.id}` });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
