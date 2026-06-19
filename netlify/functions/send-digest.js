// netlify/functions/send-digest.js
// Sends daily assignment digest email via Resend

const { getStore } = require('@netlify/blobs');

exports.handler = async () => {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'Your Life Helper <updates@raelleonline.online>';
  const TO_EMAILS = ['raellevelenawhite@gmail.com', 'luhheed@gmail.com'];

  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'RESEND_API_KEY not set' }) };
  }

  // Load state
  const store = getStore({
  name: 'dashboard-state',
  siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN
});
  let state;
  try {
    const raw = await store.get('state');
    state = raw ? JSON.parse(raw) : null;
  } catch { state = null; }

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  const raeAssignments = state?.assignments?.rae?.filter(a => !a.done) || [];
  const boogieAssignments = state?.assignments?.boogie?.filter(a => !a.done) || [];

  const allTasks = [...(state?.houseTasks||[]), ...(state?.fatherTasks||[]), ...(state?.raeTasks||[])];
  const doneTasks = allTasks.filter(t => t.done).length;
  const pct = allTasks.length ? Math.round((doneTasks / allTasks.length) * 100) : 0;

  const raeList = raeAssignments.length
    ? raeAssignments.map(a => `  - ${a.text}`).join('\n')
    : '  No assignments today.';

  const boogieList = boogieAssignments.length
    ? boogieAssignments.map(a => `  - ${a.text}`).join('\n')
    : '  No assignments today.';

  const emailText = `Your Life Helper — Daily Digest
${today}

Road to Charlotte: ${pct}% complete (${doneTasks} of ${allTasks.length} tasks done)

---

RAE'S ASSIGNMENTS TODAY:
${raeList}

BOOGIE'S ASSIGNMENTS TODAY:
${boogieList}

---

SAVINGS: $${(state?.savings || 0).toFixed(2)} saved toward $500 goal

---

Reply to this email to update the dashboard.
Reply from luhheed@gmail.com or raellevelenawhite@gmail.com.

Commands (one per line):
  DONE: task name
  UNDO: task name
  PAID: bill name $amount
  SAVINGS: $amount
  NOTE: any message

Or just write naturally — "I finished painting the walls" or "Paid Verizon $300"
`;

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  body { font-family: 'Century Gothic', 'Trebuchet MS', sans-serif; background: #f2e8d9; color: #2e1f0e; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 0 auto; background: #fdfaf6; border: 2px solid #c9913d; border-radius: 12px; overflow: hidden; }
  .hdr { background: #3d2e1e; padding: 24px 28px; border-bottom: 3px solid #c9913d; }
  .hdr h1 { color: #e8b96a; font-size: 22px; margin: 0; letter-spacing: 2px; text-transform: uppercase; }
  .hdr p { color: #c9b99a; font-size: 12px; margin: 6px 0 0; }
  .body { padding: 24px 28px; }
  .progress { background: #f5e6c8; border: 1px solid #c9b99a; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; }
  .progress-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #c9913d; font-weight: 700; }
  .progress-val { font-size: 24px; font-weight: 800; color: #c9913d; }
  .section-title { font-size: 13px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #8a5c35; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 1.5px solid #e8d9c0; }
  .task-item { padding: 8px 0; border-bottom: 1px solid #f2e8d9; font-size: 14px; color: #2e1f0e; }
  .task-item:last-child { border-bottom: none; }
  .cmd-box { background: #f2e8d9; border-radius: 8px; padding: 14px 16px; margin-top: 20px; font-size: 12px; color: #9a8470; line-height: 1.8; }
  .cmd-box strong { color: #8a5c35; }
  .ftr { padding: 16px 28px; background: #3d2e1e; text-align: center; font-size: 11px; color: #c9b99a; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>Your Life Helper</h1>
    <p>Daily Digest &mdash; ${today}</p>
  </div>
  <div class="body">
    <div class="progress">
      <div class="progress-label">Road to Charlotte</div>
      <div class="progress-val">${pct}% complete</div>
      <div style="font-size:12px;color:#9a8470;margin-top:4px">${doneTasks} of ${allTasks.length} total tasks done</div>
    </div>

    <div class="section-title">Rae's Assignments</div>
    ${raeAssignments.length ? raeAssignments.map(a => `<div class="task-item">${a.text}</div>`).join('') : '<div style="font-size:13px;color:#9a8470">No assignments today.</div>'}

    <div class="section-title">Boogie's Assignments</div>
    ${boogieAssignments.length ? boogieAssignments.map(a => `<div class="task-item">${a.text}</div>`).join('') : '<div style="font-size:13px;color:#9a8470">No assignments today.</div>'}

    <div class="section-title">Savings</div>
    <div style="font-size:22px;font-weight:800;color:#c9913d">$${(state?.savings||0).toFixed(2)}</div>
    <div style="font-size:12px;color:#9a8470">Goal: $500 emergency fund</div>

    <div class="cmd-box">
      <strong>Reply to update the dashboard</strong><br/>
      Reply to this email (from luhheed@gmail.com or raellevelenawhite@gmail.com) with one command per line:<br/><br/>
      <strong>DONE:</strong> Paint the walls &nbsp;|&nbsp; <strong>UNDO:</strong> Fix gutter<br/>
      <strong>PAID:</strong> Verizon $300 &nbsp;|&nbsp; <strong>SAVINGS:</strong> $500<br/>
      <strong>NOTE:</strong> Will handle car note next Friday<br/><br/>
      Or write naturally: "I finished painting the walls" or "Paid Verizon $300"
    </div>
  </div>
  <div class="ftr">Your Life Helper &mdash; The Road to Charlotte</div>
</div>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: TO_EMAILS,
        subject: `Daily Update: The Road to Charlotte — ${today}`,
        text: emailText,
        html: emailHtml
      })
    });

    const data = await res.json();
    if (!res.ok) return { statusCode: res.status, body: JSON.stringify({ ok: false, error: JSON.stringify(data) }) };
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: data.id }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
