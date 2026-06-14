// routes/ai.js
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { getSuggestions } = require('../services/aiService');
const geminiService = require('../services/geminiService');

// GET /api/ai/status — check Gemini API status
router.get('/status', (req, res) => {
  res.json({
    geminiEnabled: geminiService.isGeminiEnabled(),
    mode: geminiService.isGeminiEnabled() ? 'Google Gemini' : 'Local Fallback Engine'
  });
});

// POST /api/ai/configure-key — configure the Gemini API Key dynamically
router.post('/configure-key', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: 'API Key is required' });
  }

  try {
    const envPath = path.join(__dirname, '../.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8');
    }

    if (content.includes('GEMINI_API_KEY=')) {
      content = content.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${apiKey}`);
    } else {
      content += `\nGEMINI_API_KEY=${apiKey}\n`;
    }

    fs.writeFileSync(envPath, content, 'utf8');
    
    // Update environment and re-initialize
    process.env.GEMINI_API_KEY = apiKey;
    geminiService.initGenAI(apiKey);

    res.json({
      success: true,
      geminiEnabled: geminiService.isGeminiEnabled(),
      mode: geminiService.isGeminiEnabled() ? 'Google Gemini' : 'Local Fallback Engine'
    });
  } catch (err) {
    console.error('Configure key error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/suggestions — get proactive suggestions
router.get('/suggestions', async (req, res) => {
  try {
    const suggestions = await getSuggestions();
    res.json({ suggestions });
  } catch (err) {
    console.error('GET /api/ai/suggestions error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

