// api/chat.js  — Assistants v2 (threads + runs)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await readBody(req);
    const { message, threadId } = body || {};
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const key = (process.env.OPENAI_API_KEY || '').trim();
    const project = (process.env.OPENAI_PROJECT_ID || '').trim(); // required for sk-proj- keys
    const org = (process.env.OPENAI_ORG_ID || '').trim();         // optional
    const assistantId = (process.env.ASSISTANT_ID || 'asst_6bTM0AFh7GHRjpZzOzWfzJx1').trim();

    if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY is missing' });
    if (!assistantId) return res.status(500).json({ error: 'ASSISTANT_ID is missing' });
    if (key.startsWith('sk-proj-') && !project) {
      return res.status(500).json({ error: 'OPENAI_PROJECT_ID is required when using a sk-proj key' });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'OpenAI-Beta': 'assistants=v2',                 // 👈 required for Assistants v2
      ...(project ? { 'OpenAI-Project': project } : {}),
      ...(org ? { 'OpenAI-Organization': org } : {}),
    };

    // 1) Ensure a thread exists
    let tId = (threadId || '').trim();
    if (!tId) {
      const t = await fetch('https://api.openai.com/v1/threads', { method: 'POST', headers, body: JSON.stringify({}) });
      const tText = await t.text();
      if (!t.ok) return res.status(t.status).json({ error: tText });
      tId = JSON.parse(tText).id;
    }

    // 2) Add the user's message
    const m = await fetch(`https://api.openai.com/v1/threads/${tId}/messages`, {
      method: 'POST', headers, body: JSON.stringify({ role: 'user', content: message })
    });
    if (!m.ok) return res.status(m.status).json({ error: await m.text() });

    // 3) Run your assistant on the thread
    const run = await fetch(`https://api.openai.com/v1/threads/${tId}/runs`, {
      method: 'POST', headers, body: JSON.stringify({ assistant_id: assistantId })
    });
    const runText = await run.text();
    if (!run.ok) return res.status(run.status).json({ error: runText });
    const runData = JSON.parse(runText);

    // 4) Poll until the run completes (simple serverless-friendly loop)
    let status = runData.status;
    const runId = runData.id;
    const started = Date.now();
    while (!['completed', 'failed', 'cancelled', 'expired'].includes(status) && Date.now() - started < 20000) {
      await sleep(800);
      const rr = await fetch(`https://api.openai.com/v1/threads/${tId}/runs/${runId}`, { headers });
      const rj = await rr.json();
      status = rj.status;
      if (status === 'requires_action') break; // tool calls not handled in this minimal example
    }

    if (status !== 'completed') {
      return res.status(502).json({ error: `Run status: ${status}`, threadId: tId });
    }

    // 5) Fetch the latest assistant message
    const list = await fetch(`https://api.openai.com/v1/threads/${tId}/messages?limit=10&order=desc`, { headers });
    const listJson = await list.json();
    const lastAssistant = listJson.data.find(x => x.role === 'assistant');
    const reply = (lastAssistant?.content || [])
      .map(c => c?.text?.value)
      .filter(Boolean)
      .join('\n') || '(no reply)';

    return res.status(200).json({ reply, threadId: tId });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}

async function readBody(req) {
  if (req.body) return req.body;
  if (typeof req.json === 'function') { try { return await req.json(); } catch { return {}; } }
  return {};
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
