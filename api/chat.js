// api/chat.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await readBody(req);
    const { message, prevId } = body || {};
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
      ...(project ? { 'OpenAI-Project': project } : {}),
      ...(org ? { 'OpenAI-Organization': org } : {}),
    };

    // Call your Assistant via the Responses API
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        assistant_id: assistantId,
        input: [{ role: 'user', content: message }],           // messages go here
        ...(prevId ? { previous_response_id: prevId } : {}),   // keep conversation memory
      }),
    });

    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: text });

    const data = JSON.parse(text);

    // Robust text extraction from Responses API
    const reply =
      data?.output_text ??
      (Array.isArray(data?.output)
        ? data.output.flatMap(o => o?.content || []).map(c => c?.text).filter(Boolean).join('\n')
        : '(no reply)');

    return res.status(200).json({ reply, responseId: data?.id || null });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}

async function readBody(req) {
  if (req.body) return req.body;
  if (typeof req.json === 'function') { try { return await req.json(); } catch { return {}; } }
  return {};
}
