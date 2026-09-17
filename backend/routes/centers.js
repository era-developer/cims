const express = require('express');
const { listCenters, getCenterById } = require('../utils/centers');
const { getOrgName, getOrgShortName, getOrgTagline, getWhatsAppAdmin } = require('../utils/settings');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Public, unauthenticated center list.
//
// The login screen and the student self-registration landing page both need
// to show a center picker before anyone has a token, and centers are now
// created at runtime rather than compiled into the bundle, so the list cannot
// come from a frontend constant any more.
//
// Deliberately narrow: id and name only, active centers only. Contact details
// (notification email, WhatsApp number) and the center code stay behind the
// authenticated /api/admin/centers endpoint -- there is no reason to publish
// staff contact details to anonymous visitors.
router.get('/', (req, res) => {
  try {
    const centers = listCenters().map(center => ({ id: center.id, name: center.name }));
    res.json(centers);
  } catch (error) {
    console.error('Public centers list failed:', error.message);
    res.status(500).json({ message: 'Unable to load centers' });
  }
});

// Branding the login screen needs before authentication. Lets a deployment be
// renamed from the Settings screen without a frontend rebuild.
router.get('/branding', (req, res) => {
  try {
    res.json({
      orgName: getOrgName(),
      orgShortName: getOrgShortName(),
      orgTagline: getOrgTagline(),
    });
  } catch (error) {
    console.error('Branding lookup failed:', error.message);
    res.status(500).json({ message: 'Unable to load branding' });
  }
});

// The admin WhatsApp number a student hands their order off to.
//
// Was a hardcoded map of nine phone numbers compiled into the student bundle
// (Cart.jsx), which meant a staffing change required a frontend rebuild.
// Requires a token, and a student may only read their own center's number --
// the point is to reach the admin who handles their orders, not to expose a
// staff directory.
router.get('/:centerId/contact', authMiddleware, (req, res) => {
  const { centerId } = req.params;

  if (req.user.role !== 'super_admin' && req.user.centerId !== centerId) {
    return res.status(403).json({ message: 'You do not have access to this center' });
  }

  const center = getCenterById(centerId);
  if (!center) return res.status(404).json({ message: 'Center not found' });

  res.json({
    id: center.id,
    name: center.name,
    whatsappNumber: center.whatsappNumber || getWhatsAppAdmin(center.id, center) || '',
  });
});

module.exports = router;
