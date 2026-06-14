// services/geminiService.js
// Dedicated service for Google Gemini API connections and helper functions
const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function initGenAI(key) {
  const isMock = !key || key === 'mock';
  if (!isMock) {
    genAI = new GoogleGenerativeAI(key);
    console.log('[Gemini Service] Initialized/Updated dynamically with API Key');
  } else {
    genAI = null;
    console.log('[Gemini Service] Operating in Mock Mode (no GEMINI_API_KEY or set to "mock")');
  }
}

// Initial initialization
initGenAI(process.env.GEMINI_API_KEY);

const MODEL_NAME = 'gemini-1.5-flash';

// Helper to check if Gemini is active
function isGeminiEnabled() {
  return genAI !== null;
}

// Low-level helper to generate text
async function generateText(systemPrompt, userPrompt, isJson = false) {
  if (!genAI) {
    throw new Error('Gemini API is not configured. Running in mock fallback mode.');
  }

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: isJson ? { responseMimeType: 'application/json' } : undefined
    });

    const fullPrompt = `${systemPrompt}\n\nUser Input:\n${userPrompt}`;
    const result = await model.generateContent(fullPrompt);
    const responseText = result.response.text();
    
    if (isJson) {
      // Clean up markdown block if model output includes it despite the configuration
      return responseText.replace(/```json|```/g, '').trim();
    }
    return responseText.trim();
  } catch (err) {
    console.error('[Gemini Service Error] generateText failed:', err.message);
    throw err;
  }
}

// 1. Natural Language Segmentation to SQL Translator
async function translateSegmentToSQL(nlPrompt) {
  const systemPrompt = `You are a professional database analyst. Translate the marketer's natural language segmentation request into a PostgreSQL SELECT query that extracts customer IDs.

DATABASE SCHEMA:
- Table: customers
  * id UUID PRIMARY KEY
  * name VARCHAR(255)
  * email VARCHAR(255)
  * phone VARCHAR(50)
  * city VARCHAR(100)
  * channel_affinity VARCHAR(50) -- email, whatsapp, sms, rcs
  * churn_risk NUMERIC(3, 2) -- 0.0 to 1.0
  * purchase_propensity NUMERIC(3, 2) -- 0.0 to 1.0
  * total_spent NUMERIC(10, 2)
  * total_orders INTEGER
  * avg_order_value NUMERIC(10, 2)
  * last_order_at TIMESTAMP WITH TIME ZONE

- Table: orders
  * id UUID PRIMARY KEY
  * customer_id UUID REFERENCES customers(id)
  * campaign_id UUID
  * amount NUMERIC(10, 2)
  * items VARCHAR(255) -- contains bought products (e.g. "Kurtas", "Lipstick", "Coffee")
  * ordered_at TIMESTAMP WITH TIME ZONE

RULES:
- Return ONLY the executable SQL query string. Do not include markdown formatting, markdown backticks, explanations, or trailing semicolons.
- Only SELECT the customers.id column: "SELECT c.id FROM customers c ..."
- The query must be read-only and safe. Do not perform any modifications (inserts, updates, deletes).
- Use correct column names and joins where appropriate.
- Handing Indian Rupees (₹) spent: spent over ₹500 is total_spent > 500.
- "Haven't bought in 2 weeks" means: last_order_at < NOW() - INTERVAL '14 days' or last_order_at IS NULL.
- Do not use any emojis in SQL or return value.`;

  return await generateText(systemPrompt, nlPrompt, false);
}

// 2. AI Campaign Planner Chat
async function planCampaignChat(userMessage, customerAggregates) {
  const systemPrompt = `You are an expert retail marketing campaign planner assistant. Help the marketer plan campaigns.
Analyze the request and provide a response in valid JSON.

CUSTOMER BASE METRICS:
${JSON.stringify(customerAggregates, null, 2)}

RESPONSE JSON FORMAT:
{
  "responseText": "Your helpful, professional text reply describing the strategy (3-4 sentences, no emojis). Use natural, clear language.",
  "recommendedSegment": "Description of the customer segment criteria (e.g. High spenders who haven't ordered in 30 days)",
  "suggestedChannel": "one of: whatsapp, email, sms, rcs",
  "suggestedTiming": "Specific launch time recommendation (e.g. Friday at 5 PM)",
  "messageTemplate": "Message template with {name} placeholder referencing their typical purchases or category."
}

RULES:
- Do not use any emojis in the response fields.
- Make the recommendations realistic based on retail data and the user request.
- Return ONLY the JSON object.`;

  const responseJson = await generateText(systemPrompt, userMessage, true);
  return JSON.parse(responseJson);
}

// 3. Personalized Message Composer (Send-time)
async function composePersonalizedMessage(goal, customer, pastOrders) {
  const systemPrompt = `You are an AI copywriter specializing in DTC and retail brand customer engagement. 
Write a highly personalized, natural-sounding marketing message for the customer based on their past purchase history and the campaign goal.

CAMPAIGN GOAL: "${goal}"
CUSTOMER:
- Name: ${customer.name}
- Channel Preference: ${customer.channel_affinity}
- Purchase Propensity: ${customer.purchase_propensity}

PAST PURCHASE ORDERS:
${JSON.stringify(pastOrders, null, 2)}

RULES:
- Write in a clean, human, warm, and highly engaging tone.
- Do NOT use any emojis.
- Reference actual item names or categories from their past orders (e.g. "Looks like you loved our Kurtas" or "Since you enjoy our Cappuccinos").
- Make it short and punchy: under 160 characters for SMS, under 280 characters for WhatsApp/RCS, and a 2-3 sentence paragraph for Email.
- Include a clear call to action and simulated link (e.g. bit.ly/brand-deals).
- Return ONLY the plain text message copy. No quotes, no prefix, no header.`;

  const userPrompt = `Create copy for customer ${customer.name}`;
  return await generateText(systemPrompt, userPrompt, false);
}

// 4. Performance Debrief Analytics Generator
async function generatePerformanceDebrief(campaignDetails, channelBreakdowns) {
  const systemPrompt = `You are a retail marketing analytics expert. Generate a smart, professional, natural language debrief summary analyzing the performance of this completed marketing campaign.

CAMPAIGN DETAILS:
- Name: ${campaignDetails.name}
- Goal: ${campaignDetails.goal}
- Reached/Targeted: ${campaignDetails.total_targeted}
- Sent: ${campaignDetails.total_sent}
- Delivered: ${campaignDetails.total_delivered}
- Opened: ${campaignDetails.total_opened}
- Clicked: ${campaignDetails.total_clicked}
- Converted (Placed Orders): ${campaignDetails.total_conversions}
- Revenue Generated: ₹${campaignDetails.total_revenue}

CHANNEL BREAKDOWN:
${JSON.stringify(channelBreakdowns, null, 2)}

RULES:
- Write a 3-4 sentence paragraph summary.
- Sound like a smart human analyst, not a robot. Explain what went well, what underperformed, and give one concrete recommendation for next time.
- Mention specific statistics: reached, open rate, conversions, revenue.
- Do NOT use any emojis.
- Return ONLY the plain text debrief.`;

  const userPrompt = `Analyze campaign: ${campaignDetails.name}`;
  return await generateText(systemPrompt, userPrompt, false);
}

module.exports = {
  isGeminiEnabled,
  initGenAI,
  translateSegmentToSQL,
  planCampaignChat,
  composePersonalizedMessage,
  generatePerformanceDebrief
};
