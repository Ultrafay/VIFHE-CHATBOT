// /api/chat.js — Assistants v2 (threads + runs) with automatic tool handling
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await readBody(req);
    // front-end sends "prevId"; accept both and normalize
    const { message, threadId: _threadIdFromClient, prevId: _prevIdFromClient } = body || {};
    if (!message) return res.status(400).json({ error: 'Missing message' });

    // --- ENV ---
    const key = (process.env.OPENAI_API_KEY || '').trim();
    const project = (process.env.OPENAI_PROJECT_ID || '').trim(); // required if your key starts with sk-proj-
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
      'OpenAI-Beta': 'assistants=v2',
      ...(project ? { 'OpenAI-Project': project } : {}),
      ...(org ? { 'OpenAI-Organization': org } : {}),
    };

    // --- 1) Ensure a thread ---
    let threadId = (_threadIdFromClient || _prevIdFromClient || '').trim();
    if (!threadId) {
      const t = await fetch('https://api.openai.com/v1/threads', { method: 'POST', headers, body: JSON.stringify({}) });
      const tText = await t.text();
      if (!t.ok) return res.status(t.status).json({ error: tText });
      threadId = JSON.parse(tText).id;
    }

    // --- 2) Add the user's message ---
    const m = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST', headers, body: JSON.stringify({ role: 'user', content: message })
    });
    if (!m.ok) return res.status(m.status).json({ error: await m.text() });

    // --- 3) Run the assistant on the thread ---
    const run = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST', headers, body: JSON.stringify({ assistant_id: assistantId })
    });
    const runText = await run.text();
    if (!run.ok) return res.status(run.status).json({ error: runText });
    let runData = JSON.parse(runText);

    // --- 4) Poll loop: handle tool calls until completed ---
    const started = Date.now();
    while (true) {
      // exit after ~20s to be serverless-friendly
      if (Date.now() - started > 20000) {
        return res.status(502).json({ error: 'Run timed out (serverless limit)', threadId });
      }

      // get latest run status
      const rr = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runData.id}`, { headers });
      if (!rr.ok) return res.status(rr.status).json({ error: await rr.text(), threadId });
      runData = await rr.json();

      if (runData.status === 'completed') break;

      if (runData.status === 'requires_action' && runData.required_action?.type === 'submit_tool_outputs') {
        const toolCalls = runData.required_action.submit_tool_outputs.tool_calls || [];

        // Build tool outputs by dispatching to your data layer
        const tool_outputs = await Promise.all(toolCalls.map(async (tc) => {
          const name = tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}

          // ---- DISPATCH: wire these to your vector store (strictly KB grounded) ----
          if (name === 'get_fees') {
            const { subject, country } = args; // country: "Pakistan" | "Other"
            const result = await vsFindFees(subject, country);
            return { tool_call_id: tc.id, output: JSON.stringify(result) };
          }
          if (name === 'get_payment_link') {
            const { subject, attempt, language } = args; // attempt: "December 2025" | "March 2026" | "On-demand"
            const result = await vsFindPaymentLink(subject, attempt, language);
            return { tool_call_id: tc.id, output: JSON.stringify(result) };
          }
          if (name === 'get_demo_link') {
            const { subject, language } = args;
            const result = await vsFindDemoLink(subject, language);
            return { tool_call_id: tc.id, output: JSON.stringify(result) };
          }
          if (name === 'get_teacher_info') {
            const { subject, language } = args;
            const result = await vsFindTeacherInfo(subject, language);
            return { tool_call_id: tc.id, output: JSON.stringify(result) };
          }
          if (name === 'get_other_links') {
            const { subject, link_type, language } = args; // link_type: "WhatsApp Group" | "Subject Details"
            const result = await vsFindOtherLinks(subject, link_type, language);
            return { tool_call_id: tc.id, output: JSON.stringify(result) };
          }

          // Unknown tool fallback
          return { tool_call_id: tc.id, output: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }) };
        }));

        // Submit back to OpenAI — THIS is the automation you want
        const submit = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runData.id}/submit_tool_outputs`, {
          method: 'POST', headers, body: JSON.stringify({ tool_outputs })
        });
        if (!submit.ok) return res.status(submit.status).json({ error: await submit.text(), threadId });

        // loop again; the run will continue
        await sleep(700);
        continue;
      }

      if (['failed', 'expired', 'cancelling', 'cancelled'].includes(runData.status)) {
        return res.status(502).json({ error: `Run status: ${runData.status}`, threadId });
      }

      await sleep(700);
    }

    // --- 5) Fetch the latest assistant message ---
    const list = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages?limit=10&order=desc`, { headers });
    const listJson = await list.json();
    const lastAssistant = listJson.data.find(x => x.role === 'assistant');
    const reply = (lastAssistant?.content || [])
      .map(c => c?.text?.value)
      .filter(Boolean)
      .join('\n') || '(no reply)';

    // Return responseId so your front-end keeps conversation context (it currently uses prevId/responseId)
    return res.status(200).json({ reply, threadId, responseId: threadId });
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

// ======================= VECTOR-STORE STUBS =======================
// TODO: Replace these with real lookups that ONLY return content present in your KB/vector store.

async function vsFindFees(subject, country /* "Pakistan" | "Other" */) {
  // Must include BOTH attempts, currency depends on country (no conversion)
  // Return exactly what's in your KB; below is just a shape example.
  return {
    success: true,
    currency: country === 'Pakistan' ? 'PKR' : 'USD',
    dec2025: [
      // "- Tuition: PKR 00,000"
      // "- Revision Camp: PKR 00,000"
    ],
    mar2026: [
      // "- Tuition: PKR 00,000"
    ]
  };
}

async function vsFindPaymentLink(subject, attempt /* "December 2025" | "March 2026" | "On-demand" */, language /* "English" | "Urdu/Hindi" */) {
  // Return exact link + coupon from KB (no guessing)
  return {
    success: true,
    link: "https://...exact-payment-link-from-kb...",
    coupon: "VIFHE-COUPON-KB",
    note: "Please make sure to apply the coupon code before payment in order to avail the discount."
  };
}

async function vsFindDemoLink(subject, language) {
  return { success: true, link: "https://...demo-link-from-kb..." };
}

async function vsFindTeacherInfo(subject, language) {
  return {
    success: true,
    teacher: "Exact Name From KB",
    profile: "https://...profile-link-from-kb...",
    notes: ["Point 1 from KB", "Point 2 from KB"]
  };
}

async function vsFindOtherLinks(subject, link_type /* "WhatsApp Group" | "Subject Details" */, language) {
  return {
    success: true,
    link_type,
    link: "https://...exact-link-from-kb..."
  };
}
