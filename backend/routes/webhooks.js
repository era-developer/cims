const express = require('express');

const { logActivity } = require('../utils/logsDb');
const { recordIncomingWhatsAppMessage, isAuthorizedInboundRequest } = require('../utils/whatsapp');

const router = express.Router();

router.post('/whatsapp', async (req, res) => {
  try {
    if (!isAuthorizedInboundRequest(req)) {
      return res.status(401).json({ message: 'Unauthorized webhook' });
    }

    const details = await recordIncomingWhatsAppMessage(req.body || {});
    await logActivity('WHATSAPP_INBOUND', details.from || 'whatsapp', {
      role: 'external',
      centerId: details.centerId,
      info: `Incoming WhatsApp message${details.orderId ? ` for ${details.orderId}` : ''}: ${details.body.slice(0, 80)}`,
    });

    res.json({
      ok: true,
      message: 'CIMS received the WhatsApp payload.',
      orderId: details.orderId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Webhook error' });
  }
});

module.exports = router;
