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
