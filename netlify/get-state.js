// netlify/functions/get-state.js
// Returns the current dashboard state from Netlify Blobs

const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  try {
    const store = getStore('dashboard-state');
    const raw = await store.get('state');
    if (!raw) return { statusCode: 200, body: JSON.stringify({ state: null }) };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: JSON.parse(raw) })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
