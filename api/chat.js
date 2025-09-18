// api/chat.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await readBody(req);
    const { message } = body || {};
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    };

    // 👇 Add project header if available
    if (process.env.OPENAI_PROJECT_ID) {
      headers['OpenAI-Project'] = process.env.OPENAI_PROJECT_ID;
    }

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: message }],
        temperature: 0.7,
      }),
    });

    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: text });

    const data = JSON.parse(text);
    const reply = data?.choices?.[0]?.message?.content ?? '(no reply)';
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}

// Helper: safely parse body
async function readBody(req) {
  if (req.body) return req.body;
  if (typeof req.json === 'function') {
    try { return await req.json(); } catch { return {}; }
  }
  return {};
}
