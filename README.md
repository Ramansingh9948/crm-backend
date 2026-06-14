# XenCRM Backend Service (`crm-backend`)

The backend engine for XenCRM. It is built using Node.js, Express, and PostgreSQL. It exposes campaign management APIs, customer registries, transactional dispatch routes, an asynchronous task queue, and a Model Context Protocol (MCP) server.

## Features

1. **Async Event-Driven Queue**: Handles bulk data imports (`CUSTOMER_IMPORT`) and customer score recalculations (`SCORE_RECALCULATION`) in the background.
2. **Model Context Protocol (MCP)**: Exposes a compliant SSE/HTTP protocol to integrate directly with external AI systems (Cursor, Claude Desktop).
3. **Dynamic Gemini Configuration**: Allows dynamic Gemini key updating without service restart.
4. **Campaign & Webhook Receipt Loop**: Dispatches communications to the channel service and receives asynchronous delivery callback outcomes.

## Environment Variables

Create a `crm-backend/.env` file with:
```env
DATABASE_URL=postgresql://localhost:5432/xeno_crm
PORT=4000
CHANNEL_SERVICE_URL=http://localhost:5001
GEMINI_API_KEY=your_gemini_api_key
```

## Setup & Running

1. **Database Schema & Seeds**:
   ```bash
   createdb xeno_crm
   psql postgresql://localhost:5432/xeno_crm -f db/schema.sql
   npm run seed
   ```

2. **Run Server**:
   ```bash
   npm install
   npm start # Production mode
   # or
   npm run dev # Development mode
   ```

## API Endpoint Reference

### Customer Management
- `GET /api/customers` - List customers with filtering (churn risk, affinity, city) and sorting.
- `GET /api/customers/:id` - Fetch customer info, order history, and past communications.
- `POST /api/customers` - Add a customer record.
- `POST /api/customers/:id/recalculate` - Queue background AI churn/propensity recalculation.
- `POST /api/customers/segment-nl` - Segment customers using AI natural language query.
- `POST /api/customers/import` - Reset database and ingest brand dataset (queued).

### Campaign Management
- `GET /api/campaigns` - Fetch all campaigns list.
- `GET /api/campaigns/:id` - Fetch campaign info and detailed success metrics.
- `POST /api/campaigns/create` - Create draft campaign and pre-populate target communications.
- `POST /api/campaigns/:id/launch` - Mark campaign as running and dispatch messages to Channel Service.
- `POST /api/campaigns/:id/debrief` - Generate AI analytics debrief of campaign performance.

### Communications & Webhooks
- `GET /api/communications` - Fetch communication logs.
- `GET /api/communications/live` - Retrieve recent timeline delivery/reply events.
- `POST /api/communications/dispatch-adhoc` - Send a sandbox transactional test message.
- `POST /api/communications/receipt` - Webhook callback endpoint for delivery lifecycle (delivered, opened, clicked, converted, failed).
- `POST /api/communications/reply` - Simulate a text reply received from a customer.

### AI Configuration
- `POST /api/ai/configure-key` - Set or update Google Gemini API key dynamically in `.env`.
- `GET /api/ai/suggestions` - Get suggestion prompts for marketing campaigns.
- `GET /api/ai/status` - Check if Gemini API connection is active.

### MCP (Model Context Protocol) Endpoint
- `GET /api/mcp/sse` - Establish SSE connection for MCP clients.
- `POST /api/mcp/message` - Route JSON-RPC tools and commands.
