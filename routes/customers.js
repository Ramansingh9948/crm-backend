// routes/customers.js
const router = require('express').Router();
const pool = require('../db/pool');
const { recalculateCustomerScores } = require('../services/aiService');

// GET /api/customers — list all with filters
router.get('/', async (req, res) => {
  try {
    const { risk, channel, city, sort = 'churn_risk', order = 'desc', limit = 50 } = req.query;

    let where = [];
    let params = [];
    let i = 1;

    if (risk === 'high')   { where.push(`churn_risk > 0.6`); }
    if (risk === 'medium') { where.push(`churn_risk BETWEEN 0.3 AND 0.6`); }
    if (risk === 'low')    { where.push(`churn_risk < 0.3`); }
    if (channel) { where.push(`channel_affinity = $${i++}`); params.push(channel); }
    if (city)    { where.push(`city = $${i++}`); params.push(city); }

    const allowedSort = ['churn_risk', 'purchase_propensity', 'total_spent', 'last_order_at', 'total_orders'];
    const sortCol = allowedSort.includes(sort) ? sort : 'churn_risk';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(Math.min(parseInt(limit) || 50, 200));

    const result = await pool.query(
      `SELECT * FROM customers ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT $${i}`,
      params
    );

    res.json({ customers: result.rows, total: result.rowCount });
  } catch (err) {
    console.error('GET /customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/:id — single customer with order history
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
    if (!customer.rows.length) return res.status(404).json({ error: 'Customer not found' });

    const orders = await pool.query(
      'SELECT * FROM orders WHERE customer_id = $1 ORDER BY ordered_at DESC LIMIT 20',
      [id]
    );

    const campaigns = await pool.query(
      `SELECT c.id, c.name, c.goal, c.status, cm.channel, cm.message, cm.status as comm_status, cm.created_at
       FROM communications cm
       JOIN campaigns c ON cm.campaign_id = c.id
       WHERE cm.customer_id = $1
       ORDER BY cm.created_at DESC LIMIT 10`,
      [id]
    );

    res.json({
      customer: customer.rows[0],
      orders: orders.rows,
      campaigns: campaigns.rows
    });
  } catch (err) {
    console.error('GET /customers/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/stats/overview — dashboard stats
router.get('/stats/overview', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)                                              AS total_customers,
        COUNT(*) FILTER (WHERE churn_risk > 0.6)             AS high_churn,
        COUNT(*) FILTER (WHERE purchase_propensity > 0.6)    AS hot_leads,
        COUNT(*) FILTER (WHERE last_order_at > NOW() - INTERVAL '30 days') AS active_30d,
        ROUND(AVG(churn_risk)::numeric, 2)                   AS avg_churn_risk,
        ROUND(AVG(purchase_propensity)::numeric, 2)          AS avg_propensity,
        ROUND(SUM(total_spent)::numeric, 2)                  AS total_revenue,
        channel_affinity,
        COUNT(*) as channel_count
      FROM customers
      GROUP BY GROUPING SETS ((), (channel_affinity))
    `);

    const overview = result.rows.find(r => !r.channel_affinity);
    const byChannel = result.rows.filter(r => r.channel_affinity);

    res.json({ overview, byChannel });
  } catch (err) {
    console.error('GET /customers/stats/overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers — add a customer
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, city } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });

    const result = await pool.query(
      `INSERT INTO customers (name, email, phone, city)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, email, phone, city]
    );
    res.status(201).json({ customer: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers/:id/recalculate — recalculate scores with AI (queued)
router.post('/:id/recalculate', async (req, res) => {
  try {
    const { id } = req.params;
    const customerCheck = await pool.query('SELECT id FROM customers WHERE id = $1', [id]);
    if (!customerCheck.rows.length) return res.status(404).json({ error: 'Customer not found' });

    const { addJob } = require('../services/eventQueue');
    const jobId = addJob('SCORE_RECALCULATION', { customerId: id });
    res.json({ ok: true, jobId, message: 'Recalculation task added to the background queue.' });
  } catch (err) {
    console.error('POST /customers/:id/recalculate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers/segment-nl — segments customers using natural language AI query
router.post('/segment-nl', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  try {
    const { segmentCustomers } = require('../services/aiService');
    const result = await segmentCustomers(prompt);
    
    let matchedCustomers = [];
    if (result.selectedIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT * FROM customers WHERE id = ANY($1::uuid[])`,
        [result.selectedIds]
      );
      matchedCustomers = rows;
    }
    
    res.json({
      segmentName: result.segmentName,
      reasoning: result.reasoning,
      estimatedImpact: result.estimatedImpact,
      customerCount: matchedCustomers.length,
      customers: matchedCustomers,
      selectedIds: result.selectedIds
    });
  } catch (err) {
    console.error('POST /customers/segment-nl error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers/import — resets DB and imports new brand datasets (queued)
router.post('/import', async (req, res) => {
  const { customers, orders } = req.body;
  if (!customers || !orders) {
    return res.status(400).json({ error: 'customers and orders arrays are required' });
  }
  
  try {
    const { addJob } = require('../services/eventQueue');
    const jobId = addJob('CUSTOMER_IMPORT', { customers, orders });
    res.json({ ok: true, jobId, message: 'Database reset and data ingestion job queued successfully.' });
  } catch (err) {
    console.error('[Import Error] Failed to queue job:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;