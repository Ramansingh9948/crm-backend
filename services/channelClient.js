// services/channelClient.js — Sends comms to the channel service
const axios = require('axios');

const CHANNEL_URL = process.env.CHANNEL_SERVICE_URL || 'http://localhost:5000';

async function sendToChannel(communications) {
  // Fire all sends in parallel — channel service handles queuing
  const results = await Promise.allSettled(
    communications.map(comm =>
      axios.post(`${CHANNEL_URL}/send`, {
        commId:    comm.id,
        recipient: comm.recipient,   // { name, email, phone }
        channel:   comm.channel,
        message:   comm.message,
        campaignId: comm.campaign_id
      }, { timeout: 5000 })
    )
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed    = results.filter(r => r.status === 'rejected').length;

  console.log(`Channel dispatch: ${succeeded} sent, ${failed} failed`);
  return { succeeded, failed };
}

module.exports = { sendToChannel };