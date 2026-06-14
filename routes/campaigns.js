// routes/campaigns.js
const router = require('express').Router();
const pool = require('../db/pool');
const { segmentCustomers, composeMessages, generateDebrief } = require('../services/aiService');
const { sendToChannel } = require('../services/channelClient');

// GET /api/campaigns — list all campaigns
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    const where = status ? `WHERE status = $1` : '';
    if (status) params.push(status);

    const result = await pool.query(
      `SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 50`,
      params
    );
    res.json({ campaigns: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/:id — single campaign with comms
router.get('/:id', async (req, res) => {
  try {
    const campaign = await pool.query(
      `SELECT c.*,
         (SELECT COUNT(*) FROM communications WHERE campaign_id = c.id AND status = 'converted') as total_conversions,
         (SELECT COALESCE(SUM(amount), 0) FROM orders WHERE campaign_id = c.id) as total_revenue
       FROM campaigns c WHERE c.id = $1`,
      [req.params.id]
    );
    if (!campaign.rows.length) return res.status(404).json({ error: 'Campaign not found' });

    const comms = await pool.query(
      `SELECT cm.*, c.name as customer_name, c.channel_affinity
       FROM communications cm
       JOIN customers c ON cm.customer_id = c.id
       WHERE cm.campaign_id = $1
       ORDER BY cm.created_at DESC`,
      [req.params.id]
    );

    // Stats breakdown by channel
    const channelStats = await pool.query(
      `SELECT channel,
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
         COUNT(*) FILTER (WHERE status = 'opened')    as opened,
         COUNT(*) FILTER (WHERE status = 'clicked')   as clicked,
         COUNT(*) FILTER (WHERE status = 'converted') as converted,
         COUNT(*) FILTER (WHERE status = 'failed')    as failed
       FROM communications WHERE campaign_id = $1
       GROUP BY channel`,
      [req.params.id]
    );

    res.json({
      campaign: campaign.rows[0],
      communications: comms.rows,
      channelStats: channelStats.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/create — AI creates campaign plan (no send yet)
router.post('/create', async (req, res) => {
  const { goal, name } = req.body;
  if (!goal) return res.status(400).json({ error: 'goal is required' });

  try {
    // 1. AI segments customers
    const segment = await segmentCustomers(goal);

    // 2. Fetch selected customers with full data
    const { rows: selectedCustomers } = await pool.query(
      `SELECT id, name, email, phone, channel_affinity,
              churn_risk, purchase_propensity, total_orders,
              total_spent, avg_order_value,
              EXTRACT(DAY FROM NOW() - last_order_at)::int AS days_since_order
       FROM customers
       WHERE id = ANY($1::uuid[])`,
      [segment.selectedIds]
    );

    // 3. AI composes per-customer messages
    const messages = await composeMessages(goal, selectedCustomers);

    // 4. Save campaign as draft
    const campaign = await pool.query(
      `INSERT INTO campaigns (name, goal, status, ai_reasoning, total_targeted)
       VALUES ($1, $2, 'draft', $3, $4) RETURNING *`,
      [
        name || segment.segmentName,
        goal,
        segment.reasoning,
        selectedCustomers.length
      ]
    );
    const campaignId = campaign.rows[0].id;

    // 5. Save communications (queued, not sent yet)
    const msgMap = {};
    messages.forEach(m => { msgMap[m.customerId] = m; });

    const commInserts = selectedCustomers.map(c => {
      const msg = msgMap[c.id] || { channel: c.channel_affinity, message: `Hi ${c.name}!`, reason: 'Default' };
      return pool.query(
        `INSERT INTO communications (campaign_id, customer_id, channel, message, ai_reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [campaignId, c.id, msg.channel, msg.message, msg.reason]
      );
    });
    await Promise.all(commInserts);

    res.status(201).json({
      campaign: campaign.rows[0],
      segment: {
        reasoning: segment.reasoning,
        estimatedImpact: segment.estimatedImpact,
        count: selectedCustomers.length
      },
      preview: messages.slice(0, 3)   // show first 3 messages as preview
    });
  } catch (err) {
    console.error('POST /campaigns/create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/launch — actually send the campaign
router.post('/:id/launch', async (req, res) => {
  const { id } = req.params;
  try {
    // Fetch campaign + queued comms
    const campaign = await pool.query(
      `SELECT * FROM campaigns WHERE id = $1 AND status = 'draft'`, [id]
    );
    if (!campaign.rows.length) return res.status(404).json({ error: 'Draft campaign not found' });

    const comms = await pool.query(
      `SELECT cm.*, c.name, c.email, c.phone
       FROM communications cm
       JOIN customers c ON cm.customer_id = c.id
       WHERE cm.campaign_id = $1 AND cm.status = 'queued'`,
      [id]
    );

    if (!comms.rows.length) return res.status(400).json({ error: 'No queued communications' });

    // Mark campaign as running
    await pool.query(
      `UPDATE campaigns SET status = 'running', launched_at = NOW() WHERE id = $1`, [id]
    );

    // Mark all comms as sent
    await pool.query(
      `UPDATE communications SET status = 'sent', sent_at = NOW() WHERE campaign_id = $1 AND status = 'queued'`,
      [id]
    );
    await pool.query(
      `UPDATE campaigns SET total_sent = $1 WHERE id = $2`,
      [comms.rows.length, id]
    );

    // Send to channel service (fire and forget — callbacks come async)
    const commPayloads = comms.rows.map(c => ({
      id: c.id,
      campaign_id: id,
      channel: c.channel,
      message: c.message,
      recipient: { name: c.name, email: c.email, phone: c.phone }
    }));

    // Don't await — channel service responds asynchronously via callbacks
    sendToChannel(commPayloads).catch(err =>
      console.error('Channel dispatch error:', err.message)
    );

    res.json({
      message: 'Campaign launched',
      dispatched: comms.rows.length
    });
  } catch (err) {
    console.error('POST /campaigns/:id/launch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/debrief — generate AI post-mortem
router.post('/:id/debrief', async (req, res) => {
  try {
    const campaign = await pool.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    if (!campaign.rows.length) return res.status(404).json({ error: 'Campaign not found' });

    const debrief = await generateDebrief(campaign.rows[0]);

    await pool.query(
      `UPDATE campaigns SET ai_debrief = $1 WHERE id = $2`,
      [debrief, req.params.id]
    );

    res.json({ debrief });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const geminiService = require('../services/geminiService');

// POST /api/campaigns/planner-chat — Conversational AI Planner
router.post('/planner-chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  try {
    // Fetch basic customer stats to feed into planner
    const statsRes = await pool.query(`
      SELECT 
        COUNT(*)::int as total_customers,
        COALESCE(ROUND(AVG(total_spent)::numeric, 2), 0.00) as avg_spend,
        COALESCE(ROUND(AVG(total_orders)::numeric, 1), 0) as avg_orders
      FROM customers
    `);
    
    const customerAggregates = statsRes.rows[0];

    // If Gemini is active
    if (geminiService.isGeminiEnabled()) {
      try {
        console.log(`[AI Planner] Requesting Gemini planner recommendation for: "${message}"`);
        const recommendation = await geminiService.planCampaignChat(message, customerAggregates);
        return res.json(recommendation);
      } catch (err) {
        console.error('[AI Planner] Gemini plan chat failed, falling back. Error:', err.message);
      }
    }

    // Local Mock Fallback Planner
    console.log('[AI Planner] Running rule-based fallback planner...');
    const msgLower = message.toLowerCase();
    let responseText = '';
    let recommendedSegment = '';
    let suggestedChannel = 'whatsapp';
    let suggestedTiming = 'Friday at 6:00 PM';
    let messageTemplate = '';

    if (msgLower.includes('diwali') || msgLower.includes('festival') || msgLower.includes('festive')) {
      responseText = `For the festive season, I suggest re-engaging customers who haven't bought anything in the last 30 days. Highlighting special deals via WhatsApp historically converts best.`;
      recommendedSegment = `Lapsed customers who ordered previously but have not purchased in the last 30 days`;
      suggestedChannel = 'whatsapp';
      suggestedTiming = '2 days before Diwali at 6:00 PM';
      messageTemplate = 'Hello {name}! Celebrate the festive season with our exclusive new arrivals. Enjoy 20% off with code DIWALI20 at checkout: bit.ly/festive-deal';
    } else if (msgLower.includes('win') || msgLower.includes('churn') || msgLower.includes('lapse') || msgLower.includes('lost')) {
      responseText = `Winning back lost customers is our top priority. I recommend reaching out to high-risk churn customers via email, offering an exclusive loyalty discount.`;
      recommendedSegment = `Customers with churn risk score higher than 0.6`;
      suggestedChannel = 'email';
      suggestedTiming = 'Tuesday morning at 10:00 AM';
      messageTemplate = `Dear {name},\n\nWe miss having you with us. We have credited a special 15% discount to your account. Use code WELCOMEBACK on your next checkout.\n\nWarm regards,\nCustomer Success Team`;
    } else if (msgLower.includes('vip') || msgLower.includes('high') || msgLower.includes('spent') || msgLower.includes('upsell')) {
      responseText = `To maximize average order value, we should target our high-value customers with a premium upgrade. RCS provides the richest experience for this segment.`;
      recommendedSegment = `VIP customers who spent more than ₹1,500 in total`;
      suggestedChannel = 'rcs';
      suggestedTiming = 'Thursday afternoon at 3:00 PM';
      messageTemplate = 'Hey {name}! As a VIP customer, you are eligible for early access to our luxury collection. Claim your private preview here: bit.ly/vip-access';
    } else {
      responseText = `Based on your goal, I recommend a balanced campaign segment using SMS for maximum delivery coverage. This nudge will help drive immediate interest.`;
      recommendedSegment = `Active customers who purchased in the last 60 days`;
      suggestedChannel = 'sms';
      suggestedTiming = 'Wednesday at 5:30 PM';
      messageTemplate = 'Hi {name}, checkout our new arrivals today! Enjoy free shipping on orders above ₹500 with code FREESHIP: bit.ly/brand-deals';
    }

    res.json({
      responseText,
      recommendedSegment,
      suggestedChannel,
      suggestedTiming,
      messageTemplate
    });
  } catch (err) {
    console.error('POST /campaigns/planner-chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;