// api/chat.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await readBody(req);
    const { message } = body || {};
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const key = (process.env.OPENAI_API_KEY || '').trim();
    const project = (process.env.OPENAI_PROJECT_ID || '').trim();
    const org = (process.env.OPENAI_ORG_ID || '').trim(); // optional but helps some accounts

    if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY is missing' });
    if (key.startsWith('sk-proj-') && !project) {
      return res.status(500).json({ error: 'OPENAI_PROJECT_ID is required when using a sk-proj key' });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      // required for sk-proj- keys:
      ...(project ? { 'OpenAI-Project': project } : {}),
      // optional but can help resolve context in some orgs:
      ...(org ? { 'OpenAI-Organization': org } : {}),
    };

    // (A) quick auth check hit first (cheap): if this fails, key/headers are wrong
    const authCheck = await fetch('https://api.openai.com/v1/models', { headers });
    if (!authCheck.ok) {
      const e = await authCheck.text();
      return res.status(authCheck.status).json({ error: `Auth check failed: ${e}` });
    }

    // (B) do the actual chat call
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

async function readBody(req) {
  if (req.body) return req.body;
  if (typeof req.json === 'function') {
    try { return await req.json(); } catch { return {}; }
  }
  return {};
}



// // api/chat.js
// export default async function handler(req, res) {
//   if (req.method !== 'POST') {
//     return res.status(405).json({ error: 'Method not allowed' });
//   }

//   try {
//     const body = await readBody(req);
//     const { message } = body || {};
//     if (!message) return res.status(400).json({ error: 'Missing message' });

//     // Headers: must include Project ID when using sk-proj- keys
//     const headers = {
//       'Content-Type': 'application/json',
//       'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
//       'OpenAI-Project': process.env.OPENAI_PROJECT_ID,   // 👈 required
//     };

//     const r = await fetch('https://api.openai.com/v1/chat/completions', {
//       method: 'POST',
//       headers,
//       body: JSON.stringify({
//         model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
//         messages: [{ role: 'user', content: message }],
//         temperature: 0.7,
//       }),
//     });

//     const text = await r.text();
//     if (!r.ok) return res.status(r.status).json({ error: text });

//     const data = JSON.parse(text);
//     const reply = data?.choices?.[0]?.message?.content ?? '(no reply)';
//     return res.status(200).json({ reply });
//   } catch (e) {
//     return res.status(500).json({ error: e?.message || 'Server error' });
//   }
// }

// async function readBody(req) {
//   if (req.body) return req.body;
//   if (typeof req.json === 'function') {
//     try { return await req.json(); } catch { return {}; }
//   }
//   return {};
// }
