// netlify/functions/email-inbound.js
// Receives webhook from Resend, fetches full email body, parses commands, updates state

const { getStore } = require('@netlify/blobs');

const ALLOWED_SENDERS = [
  'luhheed@gmail.com',
  'raellevelenawhite@gmail.com'
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) };
  }

  // Only handle received emails
  if (payload.type !== 'email.received') {
    return { statusCode: 200, body: JSON.stringify({ ok: true, message: 'Not an inbound email, skipped' }) };
  }

  const fromRaw = (payload.data?.from || '').toLowerCase();
  const isAllowed = ALLOWED_SENDERS.some(s => fromRaw.includes(s));
  if (!isAllowed) {
    return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Unauthorized sender' }) };
  }

  // Fetch full email body from Resend API
  const emailId = payload.data?.email_id;
  if (!emailId) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'No email_id in payload' }) };
  }

  let emailBody = '';
  try {
    const res = await fetch(`https://api.resend.com/inbound/${emailId}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
    });
    const fullEmail = await res.json();
    emailBody = fullEmail.text || fullEmail.html || '';
    // Strip HTML tags if html only
    emailBody = emailBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Failed to fetch email body: ' + err.message }) };
  }

  if (!emailBody) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, message: 'Empty email body' }) };
  }

  // Load current state
  const store = getStore({
  name: 'dashboard-state',
  siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN
});
  let state;
  try {
    const raw = await store.get('state');
    state = raw ? JSON.parse(raw) : getDefaultState();
  } catch {
    state = getDefaultState();
  }

  // Parse commands from email body
  const lines = emailBody.split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];
  let changed = false;

  for (const line of lines) {
    const upper = line.toUpperCase();

    // DONE: task name
    if (upper.startsWith('DONE:')) {
      const taskName = line.slice(5).trim().toLowerCase();
      const task = findTask(state, taskName);
      if (task) {
        task.done = true;
        results.push('Marked done: ' + task.text);
        changed = true;
      } else {
        results.push('Task not found: ' + taskName);
      }
    }

    // UNDO: task name
    else if (upper.startsWith('UNDO:')) {
      const taskName = line.slice(5).trim().toLowerCase();
      const task = findTask(state, taskName);
      if (task) {
        task.done = false;
        results.push('Marked incomplete: ' + task.text);
        changed = true;
      } else {
        results.push('Task not found: ' + taskName);
      }
    }

    // PAID: bill name $amount
    else if (upper.startsWith('PAID:')) {
      const parts = line.slice(5).trim();
      const amountMatch = parts.match(/\$?([\d.]+)\s*$/);
      if (amountMatch) {
        const amount = parseFloat(amountMatch[1]);
        const billName = parts.replace(amountMatch[0], '').trim().toLowerCase();
        const bill = state.bills.find(b => b.name.toLowerCase().includes(billName) || billName.includes(b.name.toLowerCase()));
        if (bill) {
          bill.paid = (bill.paid || 0) + amount;
          results.push('Payment logged: $' + amount.toFixed(2) + ' toward ' + bill.name);
          changed = true;
        } else {
          results.push('Bill not found: ' + billName);
        }
      } else {
        results.push('Could not parse amount in: ' + line);
      }
    }

    // SAVINGS: $amount
    else if (upper.startsWith('SAVINGS:')) {
      const amountMatch = line.match(/\$?([\d.]+)/);
      if (amountMatch) {
        state.savings = parseFloat(amountMatch[1]);
        results.push('Savings updated to $' + state.savings.toFixed(2));
        changed = true;
      }
    }

    // NOTE: message
    else if (upper.startsWith('NOTE:')) {
      const note = line.slice(5).trim();
      results.push('Note recorded: ' + note);
      changed = true;
    }

    // Natural language fallback — try to interpret
    else {
      const interpreted = interpretNatural(line, state);
      if (interpreted) {
        results.push(interpreted.message);
        changed = true;
      }
    }
  }

  if (!changed) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, message: 'No commands found in reply' }) };
  }

  // Log the update
  if (!state.emailLog) state.emailLog = [];
  state.emailLog.push({
    time: new Date().toISOString(),
    from: fromRaw,
    result: results.join(' | ')
  });
  state.lastUpdated = new Date().toISOString();

  // Save state
  try {
    await store.set('state', JSON.stringify(state));
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Failed to save state: ' + err.message }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, results })
  };
};

// ── HELPERS ──────────────────────────────────────────────────────────────

function findTask(state, query) {
  const allLists = ['houseTasks', 'fatherTasks', 'raeTasks'];
  for (const key of allLists) {
    const found = state[key].find(t => t.text.toLowerCase().includes(query) || query.includes(t.text.toLowerCase().substring(0, 8)));
    if (found) return found;
  }
  return null;
}

function interpretNatural(line, state) {
  const lower = line.toLowerCase();

  // "finished X" / "completed X" / "did X"
  const donePatterns = [/^finished (.+)/, /^completed (.+)/, /^did (.+)/, /^i finished (.+)/, /^i completed (.+)/, /^i did (.+)/];
  for (const pat of donePatterns) {
    const m = lower.match(pat);
    if (m) {
      const task = findTask(state, m[1].trim());
      if (task) { task.done = true; return { message: 'Marked done: ' + task.text }; }
    }
  }

  // "paid X" / "paid off X"
  const paidMatch = lower.match(/^paid (?:off )?(.+?)\s+\$?([\d.]+)$/);
  if (paidMatch) {
    const bill = state.bills.find(b => b.name.toLowerCase().includes(paidMatch[1].trim()));
    if (bill) {
      bill.paid = (bill.paid || 0) + parseFloat(paidMatch[2]);
      return { message: 'Payment logged: $' + parseFloat(paidMatch[2]).toFixed(2) + ' toward ' + bill.name };
    }
  }

  // "saved $X" / "put $X in savings"
  const savingsMatch = lower.match(/saved? \$?([\d.]+)/) || lower.match(/put \$?([\d.]+) in savings/);
  if (savingsMatch) {
    state.savings = parseFloat(savingsMatch[1]);
    return { message: 'Savings updated to $' + state.savings.toFixed(2) };
  }

  return null;
}

function getDefaultState() {
  return {
    savings: 0,
    bills: [
      { id:1, name:"Verizon", note:"Phones currently off", minimum:606.35, total:1089.77, badge:"urgent", paid:0 },
      { id:2, name:"Car Note", note:"Overdue since June 1", minimum:399.00, total:399.00, badge:"late", paid:0 },
      { id:3, name:"Progressive Auto Insurance", note:"Keep coverage active", minimum:190.00, total:190.00, badge:"soon", paid:0 },
      { id:4, name:"Rae's Credit Card", note:"Minimum to protect credit", minimum:100.00, total:2000.00, badge:"ongoing", paid:0 },
      { id:5, name:"Boogie's Credit Card", note:"Small balance, clearable soon", minimum:120.00, total:300.00, badge:"ongoing", paid:0 }
    ],
    houseTasks: [
      { id:"h1", text:"Paint the walls", done:false },
      { id:"h2", text:"Fix the kitchen floor", done:false },
      { id:"h3", text:"Fix front deck", done:false },
      { id:"h4", text:"Clear objects from vents", done:false },
      { id:"h5", text:"Address carpet situation", done:false },
      { id:"h6", text:"Fix gutter", done:false },
      { id:"h7", text:"Patch hole in roof", done:false }
    ],
    fatherTasks: [
      { id:"f1", text:"Gather vital documents", done:false },
      { id:"f2", text:"Access inheritance money", done:false },
      { id:"f3", text:"Find co-signer for apartment", done:false }
    ],
    raeTasks: [
      { id:"r1", text:"Fix financials together", who:"both", done:false },
      { id:"r2", text:"Complete data analytics certifications", who:"rae", done:false },
      { id:"r3", text:"Finish bachelor's degree", who:"rae", done:false },
      { id:"r4", text:"Get GED", who:"boogie", done:false },
      { id:"r5", text:"Launch liquor business", who:"boogie", done:false },
      { id:"r6", text:"Transfer Amazon position to Charlotte", who:"boogie", done:false }
    ],
    assignments: { rae:[], boogie:[] },
    emailLog: [],
    lastUpdated: null
  };
}
