const axios = require('axios');

const BOLNA_BASE_URL = 'https://api.bolna.ai';

/**
 * Makes an outbound feedback call to a seller via Bolna AI.
 * @param {string} phoneNumber - Seller phone in E.164 format (e.g. +919876543210)
 * @returns {Promise<{callId: string}>} The Bolna call ID for tracking
 */
async function makeCall(phoneNumber) {
  const apiKey = process.env.BOLNA_API_KEY;
  const agentId = process.env.BOLNA_AGENT_ID;

  if (!apiKey || !agentId) {
    throw new Error('Missing BOLNA_API_KEY or BOLNA_AGENT_ID in environment');
  }

  try {
    const response = await axios.post(
      `${BOLNA_BASE_URL}/call`,
      {
        agent_id: agentId,
        recipient_phone_number: phoneNumber,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const callId = response.data.call_id || response.data.id;
    console.log(`[Bolna] Call initiated — callId: ${callId}, phone: ${phoneNumber}`);
    return { callId };
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    console.error(`[Bolna] Call failed — status: ${status}`, data || error.message);
    throw new Error(`Bolna API call failed: ${status} — ${JSON.stringify(data) || error.message}`);
  }
}

module.exports = { makeCall };
