const express = require('express');
const { getDb } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { CENTERS } = require('../utils/centers');

const router = express.Router();
// Only Electronic components can actually be requested/checked out by
// students; every other classification shows up for browsing/information
// only (view details, no Add to Cart) -- keep in sync with orders.js.
const CHECKOUT_ELIGIBLE_CLASSIFICATION = 'Electronic components';
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

// Stored as a JSON array of {title, url} -- curated by hand, not user input,
// but parsed defensively since a malformed/missing value shouldn't break
// the whole component listing.
function parseReferenceVideos(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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

// Student/admin browse view -- one row per component type, live available
// count from real physical assets (not a spreadsheet stock number).
router.get('/', authMiddleware, async (req, res) => {
  try {
    let centerId = getRequestedCenterId(req);
    if (!centerId) {
      centerId = req.user.role === 'super_admin' ? (CENTERS[0]?.id || '') : (req.user.centerId || '');
    }
    if (!centerId) return res.json([]);

    const db = getDb();
    // Stock is pre-aggregated per catalog_id in a subquery (using the
    // existing idx_assets_catalog index) before joining to product_catalog,
    // rather than joining assets straight on and aggregating after -- the
    // latter fans out to one row per physical unit first (tens of thousands
    // per center) and only collapses back down at the end, which is the
    // same query-shape bug found and fixed in the admin catalog-summary
    // endpoint (see routes/assets.js's comment there for the full story).
    const rows = db.prepare(`
      SELECT pc.id AS id, pc.name AS name, c.name AS category, pc.description AS description,
             pc.image AS image, pc.unit AS unit, pc.reference_videos AS referenceVideos,
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
      ORDER BY pc.name
    `).all(centerId, centerId);

    const shaped = rows.map(row => ({
      id: String(row.id),
      name: row.name,
      category: row.category || 'General',
      description: row.description || '',
      image: row.image || '',
      unit: row.unit || 'pcs',
      stock: row.stock || 0,
      location: null,
      active: true,
      checkoutEligible: row.category === CHECKOUT_ELIGIBLE_CLASSIFICATION,
      referenceVideos: parseReferenceVideos(row.referenceVideos),
    }));

    res.json(shaped);
  } catch (err) {
    console.error('Error fetching components:', err);
    res.status(500).json({ message: 'Error fetching inventory' });
  }
});

module.exports = router;
