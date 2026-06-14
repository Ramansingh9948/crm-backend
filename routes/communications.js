// routes/communications.js
// KEY FILE: This is where channel service callbacks land and update comm state
const router = require('express').Router();
const pool = require('../db/pool');
const { sendToChannel } = require('../services/channelClient');

// POST /api/communications/receipt — channel service calls this with delivery status
// This is the callback endpoint — the heart of the async delivery loop
router.post('/receipt', async (req, res) => {
  const { commId, event, timestamp, reason } = req.body;

  // Allowed events in the delivery lifecycle
  const validEvents = ['delivered', 'opened', 'clicked', 'converted', 'failed'];
  if (!commId || !validEvents.includes(event)) {
    return res.status(400).json({ error: 'Invalid commId or event' });
  }

  try {
    // Fetch current comm to get campaign_id and avoid duplicate updates
    const { rows } = await pool.query(
      'SELECT * FROM communications WHERE id = $1',
      [commId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Communication not found' });

    const comm = rows[0];

    // Status transition guard — only allow forward transitions
    const order = ['queued', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'converted', 'failed'];
    const currentIdx = order.indexOf(comm.status);
    const newIdx = order.indexOf(event);

    // failed can happen from any state; other events must go forward
    if (event !== 'failed' && newIdx <= currentIdx) {
      return res.status(200).json({ message: 'Stale event, ignored' });
    }

    // Update communication status
    const eventTime = timestamp ? new Date(timestamp) : new Date();
    const timeField = `${event}_at`;

    await pool.query(
      `UPDATE communications
       SET status = $1, ${timeField} = $2 ${event === 'failed' ? ', failure_reason = $3' : ''}
       WHERE id = ${event === 'failed' ? '$4' : '$3'}`,
      event === 'failed'
        ? [event, eventTime, reason || 'Unknown', commId]
        : [event, eventTime, commId]
    );

    // If conversion, create order and update customer totals
    if (event === 'converted') {
      const orderAmount = parseFloat((Math.random() * 500 + 150).toFixed(2));
      await pool.query(
        `INSERT INTO orders (customer_id, campaign_id, amount, ordered_at)
         VALUES ($1, $2, $3, NOW())`,
        [comm.customer_id, comm.campaign_id, orderAmount]
      );
      await pool.query(
        `UPDATE customers
         SET total_spent = total_spent + $1,
             total_orders = total_orders + 1,
             avg_order_value = (total_spent + $1) / (total_orders + 1),
             purchase_propensity = LEAST(purchase_propensity + 0.1, 1.0)
         WHERE id = $2`,
        [orderAmount, comm.customer_id]
      );
      await pool.query(
        `UPDATE communications SET conversion_amount = $1 WHERE id = $2`,
        [orderAmount, commId]
      );
      console.log(`[Conversion Loop] Created attributed order for customer ${comm.customer_id} amount ₹${orderAmount} from campaign ${comm.campaign_id}`);
    }

    // Update campaign aggregate stats (except conversions which is computed/tracked differently)
    if (event !== 'converted') {
      const statField = `total_${event}`;
      await pool.query(
        `UPDATE campaigns SET ${statField} = ${statField} + 1 WHERE id = $1`,
        [comm.campaign_id]
      );
    }

    // Dynamic Learning Loop: Auto-update customer preferred channel when they interact
    if (event === 'opened' || event === 'clicked') {
      await pool.query(
        `UPDATE customers SET channel_affinity = $1 WHERE id = $2`,
        [comm.channel, comm.customer_id]
      );
      console.log(`[Affinity Auto-Update] Customer ${comm.customer_id} affinity set to ${comm.channel} due to ${event} callback`);
    }

    // Check if campaign is fully complete (all comms have a terminal status)
    const { rows: pending } = await pool.query(
      `SELECT COUNT(*) FROM communications
       WHERE campaign_id = $1 AND status NOT IN ('delivered','opened','clicked','failed')`,
      [comm.campaign_id]
    );

    if (parseInt(pending[0].count) === 0) {
      await pool.query(
        `UPDATE campaigns SET status = 'completed', completed_at = NOW() WHERE id = $1 AND status = 'running'`,
        [comm.campaign_id]
      );
    }

    res.json({ ok: true, commId, event });
  } catch (err) {
    console.error('POST /communications/receipt error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/communications — list comms (with optional campaign filter)
router.get('/', async (req, res) => {
  try {
    const { campaign_id, status, limit = 100 } = req.query;
    const params = [];
    const where = [];
    let i = 1;

    if (campaign_id) { where.push(`cm.campaign_id = $${i++}`); params.push(campaign_id); }
    if (status)      { where.push(`cm.status = $${i++}`);      params.push(status); }
    params.push(Math.min(parseInt(limit) || 100, 500));

    const result = await pool.query(
      `SELECT cm.*, c.name as customer_name, c.email as customer_email
       FROM communications cm
       JOIN customers c ON cm.customer_id = c.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY cm.created_at DESC
       LIMIT $${i}`,
      params
    );

    res.json({ communications: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/communications/live — recent events feed (for live page)
router.get('/live', async (req, res) => {
  try {
    const { since } = req.query; // ISO timestamp
    const params = since ? [new Date(since)] : [new Date(Date.now() - 10 * 60 * 1000)];

    const result = await pool.query(
      `SELECT cm.id, cm.status, cm.channel, cm.campaign_id,
              cm.delivered_at, cm.opened_at, cm.clicked_at, cm.failed_at, cm.replied_at, cm.customer_reply,
              cm.converted_at, cm.conversion_amount,
              c.name as customer_name,
              cp.name as campaign_name
       FROM communications cm
       JOIN customers c  ON cm.customer_id  = c.id
       JOIN campaigns cp ON cm.campaign_id  = cp.id
       WHERE GREATEST(COALESCE(cm.delivered_at, '1970-01-01'::timestamp), COALESCE(cm.opened_at, '1970-01-01'::timestamp), COALESCE(cm.clicked_at, '1970-01-01'::timestamp), COALESCE(cm.failed_at, '1970-01-01'::timestamp), COALESCE(cm.replied_at, '1970-01-01'::timestamp), COALESCE(cm.converted_at, '1970-01-01'::timestamp)) > $1
       ORDER BY GREATEST(COALESCE(cm.delivered_at, '1970-01-01'::timestamp), COALESCE(cm.opened_at, '1970-01-01'::timestamp), COALESCE(cm.clicked_at, '1970-01-01'::timestamp), COALESCE(cm.failed_at, '1970-01-01'::timestamp), COALESCE(cm.replied_at, '1970-01-01'::timestamp), COALESCE(cm.converted_at, '1970-01-01'::timestamp)) DESC
       LIMIT 50`,
      params
    );

    res.json({ events: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/communications/reply — simulate customer replying to a message
router.post('/reply', async (req, res) => {
  const { commId, replyText } = req.body;
  if (!commId || !replyText) {
    return res.status(400).json({ error: 'commId and replyText are required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM communications WHERE id = $1',
      [commId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Communication not found' });
    const comm = rows[0];

    // Update communications record with reply details
    await pool.query(
      `UPDATE communications
       SET customer_reply = $1, replied_at = NOW(), status = 'replied'
       WHERE id = $2`,
      [replyText, commId]
    );

    // Dynamic Learning Loop: set affinity and boost purchase propensity
    await pool.query(
      `UPDATE customers
       SET channel_affinity = $1, purchase_propensity = LEAST(purchase_propensity + 0.15, 1.0)
       WHERE id = $2`,
      [comm.channel, comm.customer_id]
    );

    console.log(`[Customer Reply] Customer ${comm.customer_id} replied via ${comm.channel}: "${replyText}"`);

    res.json({ ok: true, commId, reply: replyText });
  } catch (err) {
    console.error('POST /reply error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/communications/dispatch-adhoc — manually insert a communication record to test the simulator
router.post('/dispatch-adhoc', async (req, res) => {
  const { customerId, channel, message } = req.body;
  if (!customerId || !channel || !message) {
    return res.status(400).json({ error: 'customerId, channel, and message are required' });
  }

  try {
    // 1. Ensure a mock campaign exists for manual simulator dispatches
    let campaignId;
    const { rows: campaignRows } = await pool.query(
      "SELECT id FROM campaigns WHERE name = 'Transactional Sandbox Campaign' LIMIT 1"
    );
    
    if (campaignRows.length > 0) {
      campaignId = campaignRows[0].id;
    } else {
      const { rows: newCamp } = await pool.query(
        `INSERT INTO campaigns (name, goal, status, ai_reasoning, total_targeted)
         VALUES ('Transactional Sandbox Campaign', 'Test sandbox transactional gateway interactively', 'running', 'Manual override sandbox campaign', 9999)
         RETURNING id`
      );
      campaignId = newCamp[0].id;
    }

    // 2. Fetch customer info to populate receipt/timeline details
    const { rows: customerRows } = await pool.query(
      "SELECT name, email, phone FROM customers WHERE id = $1",
      [customerId]
    );
    if (!customerRows.length) return res.status(404).json({ error: 'Customer not found' });
    const customer = customerRows[0];

    // 3. Insert a communication record with status = 'sent' and sent_at = NOW
    const { rows: commRows } = await pool.query(
      `INSERT INTO communications (campaign_id, customer_id, channel, message, status, sent_at)
       VALUES ($1, $2, $3, $4, 'sent', NOW())
       RETURNING id`,
      [campaignId, customerId, channel, message]
    );
    const commId = commRows[0].id;

    // 4. Update campaign stats
    await pool.query(
      `UPDATE campaigns SET total_sent = total_sent + 1 WHERE id = $1`,
      [campaignId]
    );

    // 5. Send to channel-service to trigger the actual callback workflow
    sendToChannel([{
      id: commId,
      campaign_id: campaignId,
      channel: channel,
      message: message,
      recipient: { name: customer.name, email: customer.email, phone: customer.phone }
    }]).catch(err => console.error('[Sandbox Dispatch] sendToChannel failed:', err.message));

    res.status(201).json({
      ok: true,
      commId,
      campaignId,
      customerId,
      customerName: customer.name,
      channel,
      message,
      status: 'sent'
    });
  } catch (err) {
    console.error('POST /dispatch-adhoc error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;