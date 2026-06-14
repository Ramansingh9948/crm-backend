// services/eventQueue.js
// Asynchronous background queue service for ingestion and database tasks
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { recalculateCustomerScores } = require('./aiService');

const jobs = [];
let isProcessing = false;

function getJobs() {
  // Return recent jobs to avoid swelling memory infinitely
  return jobs.slice(-50);
}

function addJob(type, payload) {
  const job = {
    id: uuidv4(),
    type,
    status: 'pending',
    progress: 0,
    payload,
    createdAt: new Date(),
    completedAt: null,
    error: null
  };
  jobs.push(job);
  console.log(`[Event Queue] Enqueued job: ${job.id} | Type: ${type}`);
  
  // Process asynchronously
  processNextJob();
  return job.id;
}

async function processNextJob() {
  if (isProcessing) return;
  const nextJob = jobs.find(j => j.status === 'pending');
  if (!nextJob) return;

  isProcessing = true;
  nextJob.status = 'processing';
  console.log(`[Event Queue] Processing job: ${nextJob.id} | Type: ${nextJob.type}`);

  try {
    if (nextJob.type === 'CUSTOMER_IMPORT') {
      await simulateProgressAndRun(nextJob, async () => {
        const { customers, orders } = nextJob.payload;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('DELETE FROM communications');
          await client.query('DELETE FROM orders');
          await client.query('DELETE FROM campaigns');
          await client.query('DELETE FROM customers');
          
          for (const c of customers) {
            await client.query(
              `INSERT INTO customers (id, name, email, phone, city, channel_affinity, churn_risk, purchase_propensity, total_spent, total_orders, avg_order_value, last_order_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [
                c.id, c.name, c.email, c.phone || null, c.city || null, c.channel_affinity || 'whatsapp',
                c.churn_risk || 0.5, c.purchase_propensity || 0.5, c.total_spent || 0.00, c.total_orders || 0,
                c.avg_order_value || 0.00, c.last_order_at ? new Date(c.last_order_at) : null
              ]
            );
          }
          
          for (const o of orders) {
            await client.query(
              `INSERT INTO orders (id, customer_id, campaign_id, amount, items, ordered_at)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                o.id, o.customer_id, o.campaign_id || null, o.amount, o.items || null,
                o.ordered_at ? new Date(o.ordered_at) : new Date()
              ]
            );
          }
          
          await client.query('COMMIT');
          console.log(`[Event Queue] Ingested ${customers.length} customers and ${orders.length} orders successfully.`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      });
    } else if (nextJob.type === 'SCORE_RECALCULATION') {
      await simulateProgressAndRun(nextJob, async () => {
        const { customerId } = nextJob.payload;
        const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [customerId]);
        if (customerResult.rows.length) {
          const customer = customerResult.rows[0];
          const ordersResult = await pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY ordered_at DESC LIMIT 50', [customerId]);
          const campaignsResult = await pool.query(
            `SELECT c.id, c.name, cm.channel, cm.message, cm.status as comm_status, cm.created_at
             FROM communications cm
             JOIN campaigns c ON cm.campaign_id = c.id
             WHERE cm.customer_id = $1
             ORDER BY cm.created_at DESC LIMIT 20`,
            [customerId]
          );
          const scores = await recalculateCustomerScores(customer, ordersResult.rows, campaignsResult.rows);
          await pool.query(
            `UPDATE customers
             SET churn_risk = $1, purchase_propensity = $2, channel_affinity = $3
             WHERE id = $4`,
            [scores.churnRisk, scores.purchasePropensity, scores.channelAffinity, customerId]
          );
        }
      });
    } else {
      await simulateProgressAndRun(nextJob, async () => {});
    }

    nextJob.status = 'completed';
    nextJob.progress = 100;
    nextJob.completedAt = new Date();
    console.log(`[Event Queue] Completed job: ${nextJob.id}`);
  } catch (err) {
    nextJob.status = 'failed';
    nextJob.error = err.message;
    nextJob.completedAt = new Date();
    console.error(`[Event Queue Error] Job ${nextJob.id} failed: ${err.message}`);
  } finally {
    isProcessing = false;
    setTimeout(processNextJob, 50);
  }
}

function simulateProgressAndRun(job, dbAction) {
  return new Promise((resolve, reject) => {
    let currentProgress = 0;
    const interval = setInterval(async () => {
      currentProgress += 25;
      job.progress = Math.min(currentProgress, 95);
      if (currentProgress >= 100) {
        clearInterval(interval);
        try {
          await dbAction();
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    }, 100);
  });
}

module.exports = {
  getJobs,
  addJob
};
