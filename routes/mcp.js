// routes/mcp.js
// Model Context Protocol (MCP) HTTP/SSE Server Router
const router = require('express').Router();
const pool = require('../db/pool');
const { v4: uuidv4 } = require('uuid');

// Active client streams
const clients = new Map();

// GET /api/mcp/sse — SSE connection initialization
router.get('/sse', (req, res) => {
  const clientId = uuidv4();
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  clients.set(clientId, res);
  console.log(`[MCP Server] Client connected: ${clientId}`);
  
  // Register post URL message for client transport
  const initMsg = JSON.stringify({
    jsonrpc: '2.0',
    method: 'mcp/endpoint',
    params: {
      uri: `http://localhost:4000/api/mcp/message?clientId=${clientId}`
    }
  });
  
  res.write(`event: endpoint\ndata: ${initMsg}\n\n`);
  
  req.on('close', () => {
    clients.delete(clientId);
    console.log(`[MCP Server] Client disconnected: ${clientId}`);
  });
});

// POST /api/mcp/message — Receives client JSON-RPC commands
router.post('/message', async (req, res) => {
  const { clientId } = req.query;
  const message = req.body;
  
  console.log(`[MCP Server] Incoming message from client ${clientId}:`, JSON.stringify(message));
  
  if (!message || message.jsonrpc !== '2.0') {
    return res.status(400).json({ error: 'Invalid JSON-RPC request' });
  }

  const { id, method, params } = message;

  try {
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'xeno-crm-mcp',
            version: '1.0.0'
          }
        }
      });
    }

    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'add_customer',
              description: 'Create a new customer profile in XenCRM',
              inputSchema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Customer full name' },
                  email: { type: 'string', description: 'Unique email address' },
                  phone: { type: 'string', description: 'Phone number' },
                  city: { type: 'string', description: 'Residential city' }
                },
                required: ['name', 'email']
              }
            },
            {
              name: 'add_order',
              description: 'Record a purchase order for an existing customer',
              inputSchema: {
                type: 'object',
                properties: {
                  email: { type: 'string', description: 'Customer email address' },
                  amount: { type: 'number', description: 'Total purchase amount' },
                  items: { type: 'string', description: 'Purchased items list (comma separated)' }
                },
                required: ['email', 'amount']
              }
            },
            {
              name: 'list_campaigns',
              description: 'Get all created marketing campaigns in the database',
              inputSchema: {
                type: 'object',
                properties: {}
              }
            },
            {
              name: 'list_segments',
              description: 'Get customer segments overview statistics',
              inputSchema: {
                type: 'object',
                properties: {}
              }
            }
          ]
        }
      });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      let resultText = '';

      if (name === 'add_customer') {
        const { name: custName, email, phone, city } = args;
        const insertRes = await pool.query(
          `INSERT INTO customers (name, email, phone, city)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [custName, email, phone || null, city || null]
        );
        resultText = `Customer "${custName}" successfully created. ID: ${insertRes.rows[0].id}`;
      } 
      
      else if (name === 'add_order') {
        const { email, amount, items } = args;
        const custResult = await pool.query('SELECT id FROM customers WHERE email = $1', [email]);
        if (!custResult.rows.length) {
          resultText = `Error: Customer with email "${email}" not found. Please create the profile first.`;
        } else {
          const customerId = custResult.rows[0].id;
          const orderRes = await pool.query(
            `INSERT INTO orders (customer_id, amount, items)
             VALUES ($1, $2, $3) RETURNING *`,
            [customerId, amount, items || null]
          );
          
          // Queue background recalculation job
          const { addJob } = require('../services/eventQueue');
          addJob('SCORE_RECALCULATION', { customerId });

          resultText = `Order recorded successfully. ID: ${orderRes.rows[0].id} for customer ${email}. Asynchronous score recalculation triggered.`;
        }
      } 
      
      else if (name === 'list_campaigns') {
        const campaignRes = await pool.query('SELECT name, goal, status, total_targeted, launched_at FROM campaigns ORDER BY created_at DESC LIMIT 10');
        resultText = `Found ${campaignRes.rowCount} campaigns:\n` + campaignRes.rows.map(c => 
          `- Name: ${c.name} | Status: ${c.status} | Targeted: ${c.total_targeted} | Goal: ${c.goal}`
        ).join('\n');
      } 
      
      else if (name === 'list_segments') {
        const countRes = await pool.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE churn_risk > 0.6) as at_risk,
            COUNT(*) FILTER (WHERE purchase_propensity > 0.6) as high_intent
          FROM customers
        `);
        const stats = countRes.rows[0];
        resultText = `Segments Stats:\n- Total Customers: ${stats.total}\n- At Churn Risk (>0.6): ${stats.at_risk}\n- High Purchase Propensity (>0.6): ${stats.high_intent}`;
      } 
      
      else {
        resultText = `Error: Tool "${name}" is not implemented.`;
      }

      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: resultText
            }
          ]
        }
      });
    }

    // Default fallback
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {}
    });

  } catch (err) {
    console.error('[MCP Server Error] Tool call failed:', err.message);
    return res.json({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: err.message
      }
    });
  }
});

module.exports = router;
