const TOPICS = {
  geopolitics: '(diplomacy OR geopolitical OR conflict OR sanctions OR treaty OR security)',
  science: '(science OR research OR university OR study OR discovery OR technology OR "artificial intelligence")',
  economy: '(economy OR inflation OR trade OR markets OR employment OR central bank OR industry)'
};

const PROMPTS = {
  brief: `You edit a short daily global brief for university students. Use ONLY supplied article metadata. Do not invent facts. Distinguish reported developments from analysis and forecasts. Attribute contested claims and preserve uncertainty. Avoid sensational wording. Return valid JSON only in this shape: {"kicker":"...","summary":"...","stories":[{"title":"...","body":"...","whyItMatters":"...","sourceIndexes":[0,1]}]}. Produce exactly 3 stories.`,
  socratic: `Act as a rigorous Socratic tutor. Ask questions that expose the learner's reasoning. Do not immediately give the final answer. Give a short sequence of questions, one hint, and a self-check.`,
  explain: `Explain at the requested academic depth. Build intuition first, then formal structure, one concrete example, one boundary case, and two self-check questions. Avoid fake citations.`,
  paper: `From the supplied abstract or passage only, extract prerequisites, central claim, method, evidence type, assumptions, limitations, and five questions a careful reader should ask. Mark inference explicitly.`,
  debate: `Act as a neutral discussion facilitator. Steelman at least two genuinely distinct positions. Identify assumptions, evidence each side would seek, points of agreement, and questions that could change minds. Do not endorse a side.`,
  map: `Create a compact learning dependency map with prerequisites, sequence, misconceptions, practice tasks, and one capstone. Make dependencies explicit with arrows in plain text.`,
  oral: `Act as a rigorous oral-exam examiner. Provide 8 progressively deeper viva questions, likely follow-ups, a concise scoring rubric, and common weak-answer patterns. Do not provide model answers unless requested.`
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'Origin not allowed' }, 403, cors);
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true, provider: env.AI_PROVIDER || 'workers-ai' }, 200, cors);
      if (url.pathname === '/api/brief' && request.method === 'GET') return await handleBrief(url, env, cors);
      if (url.pathname === '/api/ai' && request.method === 'POST') return await handleAI(request, env, cors);
      if (url.pathname === '/api/issues' && request.method === 'POST') return await handleIssue(request, env, cors);
      if (url.pathname === '/api/counselling' && request.method === 'POST') return await handleCounselling(request, env, cors);
      return json({ error: 'Not found' }, 404, cors);
    } catch (err) {
      return json({ error: err?.message || 'Unexpected server error' }, 500, cors);
    }
  }
};

async function handleBrief(url, env, cors) {
  const topic = url.searchParams.get('topic') || 'geopolitics';
  if (!TOPICS[topic]) return json({ error: 'Invalid topic' }, 400, cors);
  const refresh = url.searchParams.get('refresh') === '1';

  if (env.DB && !refresh) {
    const cached = await env.DB.prepare('SELECT payload, updated_at FROM brief_cache WHERE topic=?').bind(topic).first();
    if (cached && Date.now() - Date.parse(cached.updated_at) < 3 * 60 * 60 * 1000) {
      const payload = JSON.parse(cached.payload);
      payload.mode = 'cached live';
      payload.updatedAt = cached.updated_at;
      return json(payload, 200, cors);
    }
  }

  const sources = await fetchNews(TOPICS[topic]);
  if (!sources.length) throw new Error('No current source articles were returned.');

  const sourceText = sources.map((s, i) =>
    `[${i}] ${s.title}\nSource: ${s.domain || 'unknown'}\nURL: ${s.url}\nDate: ${s.seendate || ''}`
  ).join('\n\n');

  const raw = await callAI(env, [{ role: 'user', content: `${PROMPTS.brief}\n\nTOPIC: ${topic}\n\nSOURCES:\n${sourceText}` }]);
  const parsed = parseJson(raw);
  parsed.stories = (parsed.stories || []).slice(0, 3).map(story => ({
    title: story.title || '',
    body: story.body || '',
    whyItMatters: story.whyItMatters || '',
    sources: [...new Set(story.sourceIndexes || [])]
      .filter(i => sources[i])
      .slice(0, 4)
      .map(i => ({ name: sources[i].domain || 'source', url: sources[i].url }))
  }));
  parsed.kicker = parsed.kicker || `${topic} · today`;
  parsed.updatedAt = new Date().toISOString();
  parsed.mode = 'live AI + GDELT';

  if (env.DB) {
    await env.DB.prepare(
      'INSERT INTO brief_cache(topic,payload,updated_at) VALUES(?,?,?) ON CONFLICT(topic) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at'
    ).bind(topic, JSON.stringify(parsed), parsed.updatedAt).run();
  }
  return json(parsed, 200, cors);
}

async function fetchNews(query) {
  const u = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  u.searchParams.set('query', query);
  u.searchParams.set('mode', 'ArtList');
  u.searchParams.set('maxrecords', '25');
  u.searchParams.set('format', 'json');
  u.searchParams.set('sort', 'HybridRel');
  u.searchParams.set('timespan', '1d');

  const r = await fetch(u.toString(), { headers: { 'User-Agent': 'SETU-IIIT-Surat/1.0' } });
  if (!r.ok) throw new Error(`News source failed (${r.status})`);
  const data = await r.json();
  const seen = new Set();
  return (data.articles || [])
    .filter(a => a.url && a.title)
    .filter(a => {
      const key = (a.domain || '') + '|' + a.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 14);
}

async function handleAI(request, env, cors) {
  const body = await safeBody(request);
  const tool = body.tool;
  if (!PROMPTS[tool]) return json({ error: 'Unknown AI tool' }, 400, cors);
  const prompt = clean(body.prompt, 7000);
  if (!prompt) return json({ error: 'Prompt is required' }, 400, cors);
  const level = clean(body.level || '', 80);
  const text = await callAI(env, [{
    role: 'user',
    content: `${PROMPTS[tool]}\n\nAcademic depth: ${level || 'not specified'}\n\nUser material:\n${prompt}`
  }]);
  return json({ text, mode: env.AI_PROVIDER === 'gemini' ? 'Gemini' : 'Cloudflare Workers AI' }, 200, cors);
}

async function handleIssue(request, env, cors) {
  if (!env.DB) return json({ error: 'D1 database binding is not configured.' }, 503, cors);
  const b = await safeBody(request);
  const title = clean(b.title, 90), desc = clean(b.description, 1400);
  const category = clean(b.category, 50), urgency = clean(b.urgency, 30);
  if (!title || !desc || !category) return json({ error: 'Missing required fields' }, 400, cors);
  const id = `ISS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO issues(id,category,urgency,title,description,anonymous,status,created_at) VALUES(?,?,?,?,?,?,?,?)'
  ).bind(id, category, urgency || 'Normal', title, desc, b.anonymous ? 1 : 0, 'Received', now).run();
  return json({ id, status: 'Received' }, 201, cors);
}

async function handleCounselling(request, env, cors) {
  if (!env.DB) return json({ error: 'D1 database binding is not configured.' }, 503, cors);
  const b = await safeBody(request);
  const contact = clean(b.contact, 180), mode = clean(b.mode, 40);
  const timing = clean(b.timing, 50), note = clean(b.note || '', 500);
  if (!contact) return json({ error: 'Contact is required' }, 400, cors);
  const id = `CARE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO counselling_requests(id,contact,mode,timing,note,status,created_at) VALUES(?,?,?,?,?,?,?)'
  ).bind(id, contact, mode || 'No preference', timing || 'As soon as practical', note, 'Received', now).run();
  return json({ id, status: 'Received' }, 201, cors);
}

async function callAI(env, messages) {
  const provider = env.AI_PROVIDER || 'workers-ai';
  const model = env.AI_MODEL || '@cf/zai-org/glm-4.7-flash';

  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
    const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: .25, maxOutputTokens: 1800 }
        })
      }
    );
    if (!r.ok) throw new Error(`Gemini API failed (${r.status})`);
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  }

  if (!env.AI) throw new Error('Workers AI binding is not configured.');
  const out = await env.AI.run(model, { messages, temperature: .25, max_tokens: 1800 });
  return out.response || out.result?.response || String(out);
}

function parseJson(text) {
  const cleaned = String(text).replace(/^\`\`\`json\s*/i, '').replace(/\`\`\`\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('AI returned invalid JSON.');
  }
}

async function safeBody(req) {
  const type = req.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('Expected application/json');
  return req.json();
}
function clean(v, max) {
  return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
function corsHeaders(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': allowed || origin || '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff'
  };
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}
