// api/wati.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await readJson(req);

    // Adjust these field paths to match your exact WATI payload
    const waId = body?.waId || body?.data?.waId;
    const text = body?.text || body?.data?.text?.body || body?.message || '';
    const ticketId = body?.ticketId || body?.data?.ticketId;

    if (!waId || !text) {
      // Ack quickly so WATI doesn't retry; log what you got
      console.log('WATI webhook: missing waId/text', { body });
      return res.status(200).json({ ok: true, skipped: true });
    }

    // --- ENV ---
    const key = (process.env.OPENAI_API_KEY || '').trim();
    const project = (process.env.OPENAI_PROJECT_ID || '').trim();
    const org = (process.env.OPENAI_ORG_ID || '').trim();
    const assistantId = (process.env.ASSISTANT_ID || '').trim();

    if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY missing' });
    if (!assistantId) return res.status(500).json({ error: 'ASSISTANT_ID missing' });

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'OpenAI-Beta': 'assistants=v2',
      ...(project ? { 'OpenAI-Project': project } : {}),
      ...(org ? { 'OpenAI-Organization': org } : {}),
    };

    // --- Create a fresh thread per inbound message (simple, reviewable) ---
    const t = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST', headers,
      body: JSON.stringify({ metadata: { waId, ticketId, source: 'wati' } })
    });
    if (!t.ok) return res.status(t.status).json({ error: await t.text() });
    const thread = await t.json();

    // Add the user’s WhatsApp message
    const m = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({
        role: 'user',
        content: text,
        metadata: { waId, ticketId }
      })
    });
    if (!m.ok) return res.status(m.status).json({ error: await m.text() });

    // Run your assistant
    const run = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: 'POST', headers,
      body: JSON.stringify({ assistant_id: assistantId, metadata: { waId, ticketId, mode: 'mirror_only' } })
    });
    if (!run.ok) return res.status(run.status).json({ error: await run.text(), threadId: thread.id });

    // Mirror-only: DO NOT send any message back to WATI here.
    // (When you’re ready to go live, call WATI send API after fetching the assistant’s reply.)

    return res.status(200).json({ ok: true, threadId: thread.id });
  } catch (e) {
    console.error('wati webhook error', e);
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}

async function readJson(req) {
  if (req.body) return req.body; // Vercel often gives parsed JSON here
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { return {}; }
}
