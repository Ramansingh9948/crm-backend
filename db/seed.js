// db/seed.js — Seeds default DTC Fashion Brand data
const pool = require('./pool');

const CUSTOMERS = [
  { id: "f1111111-1111-4111-a111-111111111111", name: "Priya Sharma", email: "priya.sharma@yahoo.com", phone: "+919876543210", city: "Gurgaon", channel_affinity: "whatsapp", churn_risk: 0.75, purchase_propensity: 0.20, total_spent: 4200.00, total_orders: 2, avg_order_value: 2100.00, last_order_at: "2026-05-15T12:00:00Z" },
  { id: "f2222222-2222-4222-a222-222222222222", name: "Arjun Mehta", email: "arjun.mehta@gmail.com", phone: "+919810123456", city: "Delhi", channel_affinity: "whatsapp", churn_risk: 0.15, purchase_propensity: 0.85, total_spent: 8500.00, total_orders: 4, avg_order_value: 2125.00, last_order_at: "2026-06-10T15:30:00Z" },
  { id: "f3333333-3333-4333-a333-333333333333", name: "Amit Verma", email: "amit.verma@outlook.com", phone: "+919910098765", city: "Noida", channel_affinity: "email", churn_risk: 0.22, purchase_propensity: 0.90, total_spent: 12500.00, total_orders: 5, avg_order_value: 2500.00, last_order_at: "2026-06-12T10:15:00Z" },
  { id: "f4444444-4444-4444-a444-444444444444", name: "Sneha Reddy", email: "sneha.reddy@gmail.com", phone: "+919811223344", city: "Noida", channel_affinity: "rcs", churn_risk: 0.08, purchase_propensity: 0.95, total_spent: 15400.00, total_orders: 6, avg_order_value: 2566.67, last_order_at: "2026-06-13T09:00:00Z" },
  { id: "f5555555-5555-4555-a555-555555555555", name: "Kabir Singh", email: "kabir.singh@gmail.com", phone: "+919955443322", city: "Delhi", channel_affinity: "whatsapp", churn_risk: 0.82, purchase_propensity: 0.12, total_spent: 2900.00, total_orders: 1, avg_order_value: 2900.00, last_order_at: "2026-04-20T17:45:00Z" },
  { id: "f6666666-6666-4666-a666-666666666666", name: "Ananya Goel", email: "ananya.goel@gmail.com", phone: "+919818822334", city: "Gurgaon", channel_affinity: "email", churn_risk: 0.35, purchase_propensity: 0.62, total_spent: 6200.00, total_orders: 3, avg_order_value: 2066.67, last_order_at: "2026-06-02T14:20:00Z" },
  { id: "f7777777-7777-4777-a777-777777777777", name: "Vikram Malhotra", email: "vikram.m@outlook.com", phone: "+919560987654", city: "Delhi", channel_affinity: "sms", churn_risk: 0.88, purchase_propensity: 0.18, total_spent: 1950.00, total_orders: 1, avg_order_value: 1950.00, last_order_at: "2026-03-25T11:00:00Z" },
  { id: "f8888888-8888-4888-a888-888888888888", name: "Divya Nair", email: "divya.nair@gmail.com", phone: "+919871122334", city: "Noida", channel_affinity: "whatsapp", churn_risk: 0.05, purchase_propensity: 0.88, total_spent: 18200.00, total_orders: 7, avg_order_value: 2600.00, last_order_at: "2026-06-13T11:30:00Z" }
];

const ORDERS = [
  { customer_id: "f1111111-1111-4111-a111-111111111111", amount: 2200.00, items: "Designer Kurta", ordered_at: "2026-04-10T12:00:00Z" },
  { customer_id: "f1111111-1111-4111-a111-111111111111", amount: 2000.00, items: "Silk Dupatta", ordered_at: "2026-05-15T12:00:00Z" },
  
  { customer_id: "f2222222-2222-4222-a222-222222222222", amount: 2500.00, items: "Slim Fit Denim", ordered_at: "2026-03-01T15:30:00Z" },
  { customer_id: "f2222222-2222-4222-a222-222222222222", amount: 1800.00, items: "Casual Shirt", ordered_at: "2026-04-15T15:30:00Z" },
  { customer_id: "f2222222-2222-4222-a222-222222222222", amount: 2100.00, items: "Chino Trousers", ordered_at: "2026-05-20T15:30:00Z" },
  { customer_id: "f2222222-2222-4222-a222-222222222222", amount: 2100.00, items: "Designer Kurta", ordered_at: "2026-06-10T15:30:00Z" },

  { customer_id: "f3333333-3333-4333-a333-333333333333", amount: 2500.00, items: "Cotton Kurta", ordered_at: "2026-06-12T10:15:00Z" },
  { customer_id: "f3333333-3333-4333-a333-333333333333", amount: 3000.00, items: "Silk Saree", ordered_at: "2026-05-10T10:15:00Z" },
  { customer_id: "f3333333-3333-4333-a333-333333333333", amount: 2500.00, items: "Designer Kurta", ordered_at: "2026-04-05T10:15:00Z" },

  { customer_id: "f4444444-4444-4444-a444-444444444444", amount: 4500.00, items: "Leather Jacket", ordered_at: "2026-06-13T09:00:00Z" },
  { customer_id: "f4444444-4444-4444-a444-444444444444", amount: 2200.00, items: "Slim Fit Denim", ordered_at: "2026-05-25T09:00:00Z" },

  { customer_id: "f5555555-5555-4555-a555-555555555555", amount: 2900.00, items: "Silk Saree", ordered_at: "2026-04-20T17:45:00Z" },

  { customer_id: "f6666666-6666-4666-a666-666666666666", amount: 2100.00, items: "Casual Shirt", ordered_at: "2026-06-02T14:20:00Z" },
  { customer_id: "f6666666-6666-4666-a666-666666666666", amount: 2000.00, items: "Slim Fit Denim", ordered_at: "2026-05-01T14:20:00Z" },

  { customer_id: "f7777777-7777-4777-a777-777777777777", amount: 1950.00, items: "Cotton Kurta", ordered_at: "2026-03-25T11:00:00Z" },

  { customer_id: "f8888888-8888-4888-a888-888888888888", amount: 2500.00, items: "Designer Kurta", ordered_at: "2026-06-13T11:30:00Z" },
  { customer_id: "f8888888-8888-4888-a888-888888888888", amount: 3500.00, items: "Silk Saree", ordered_at: "2026-05-30T11:30:00Z" },
  { customer_id: "f8888888-8888-4888-a888-888888888888", amount: 2200.00, items: "Slim Fit Denim", ordered_at: "2026-04-10T11:30:00Z" }
];

async function seed() {
  console.log('[Seed] Starting default database seeding...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Clear old tables
    await client.query('DELETE FROM communications');
    await client.query('DELETE FROM orders');
    await client.query('DELETE FROM campaigns');
    await client.query('DELETE FROM customers');

    // Insert customers
    for (const c of CUSTOMERS) {
      await client.query(
        `INSERT INTO customers (id, name, email, phone, city, channel_affinity, churn_risk, purchase_propensity, total_spent, total_orders, avg_order_value, last_order_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          c.id, c.name, c.email, c.phone, c.city, c.channel_affinity,
          c.churn_risk, c.purchase_propensity, c.total_spent, c.total_orders,
          c.avg_order_value, new Date(c.last_order_at)
        ]
      );
    }

    // Insert orders
    for (const o of ORDERS) {
      await client.query(
        `INSERT INTO orders (customer_id, amount, items, ordered_at)
         VALUES ($1, $2, $3, $4)`,
        [o.customer_id, o.amount, o.items, new Date(o.ordered_at)]
      );
    }

    await client.query('COMMIT');
    console.log(`[Seed] Database successfully initialized with ${CUSTOMERS.length} fashion customers.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Seed Error] Failed database seeding:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

seed();
