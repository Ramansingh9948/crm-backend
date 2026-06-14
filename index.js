// index.js — CRM Backend entry point
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const eventQueue = require('./services/eventQueue');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/customers',       require('./routes/customers'));
app.use('/api/campaigns',       require('./routes/campaigns'));
app.use('/api/communications',  require('./routes/communications'));
app.use('/api/ai',              require('./routes/ai'));
app.use('/api/mcp',             require('./routes/mcp'));

// Background Queue status check
app.get('/api/queue/status', (_, res) => {
  res.json({ jobs: eventQueue.getJobs() });
});

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'crm-backend' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`CRM Backend running on port ${PORT}`));