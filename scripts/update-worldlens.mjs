import fs from 'node:fs/promises';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const OUT = new URL('../data/worldlens.json', import.meta.url);

if (!API_KEY) {
  console.error('GEMINI_API_KEY is missing. Add it in Settings → Secrets and variables → Actions.');
  process.exit(2);
}

const lenses = {
  geopolitics: {
    label: 'Geopolitics',
    query: '(diplomacy OR geopolitical OR sanctions OR treaty OR conflict OR ceasefire OR election OR security)'
  },
  science: {
    label: 'Academic & scientific',
    query: '(science OR research OR university OR journal OR study OR discovery OR breakthrough OR "artificial intelligence")'
  },
  economy: {
    label: 'Economic',
    query: '(economy OR inflation OR trade OR markets OR employment OR "central bank" OR industry OR growth)'
  }
};

const result = {
  generatedAt: new Date().toISOString(),
  provider: `Gemini / ${MODEL}`,
  retrieval: 'GDELT DOC 2.0',
  topics: {}
};

for (const [topic, cfg] of Object.entries(lenses)) {
  console.log(`Building ${cfg.label} brief...`);
  const sources = await fetchGdelt(cfg.query);
  if (!sources.length) throw new Error(`No sources returned for ${topic}`);
  const brief = await summarize(topic, cfg.label, sources);
  result.topics[topic] = {
    ...brief,
    kicker: brief.kicker || `${cfg.label} · global brief`,
    mode: 'GitHub Action · Gemini',
    updatedAt: result.generatedAt,
    stories: (brief.stories || []).slice(0, 3).map(story => ({
      title: clean(story.title, 180),
      body: clean(story.body, 900),
      whyItMatters: clean(story.whyItMatters, 500),
      sources: [...new Set(Array.isArray(story.sourceIndexes) ? story.sourceIndexes : [])]
        .filter(i => Number.isInteger(i) && sources[i])
        .slice(0, 4)
        .map(i => ({ name: sources[i].domain || 'source', url: sources[i].url }))
    }))
  };
}

await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(`Updated ${OUT.pathname}`);

async function fetchGdelt(query) {
  const u = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  u.searchParams.set('query', query);
  u.searchParams.set('mode', 'ArtList');
  u.searchParams.set('maxrecords', '40');
  u.searchParams.set('format', 'json');
  u.searchParams.set('sort', 'HybridRel');
  u.searchParams.set('timespan', '24h');

  try {
    const data = await fetchJsonWithRetry(u.toString(), {
      headers: { 'User-Agent': 'SETU-IIIT-Surat/1.0 (+https://iiitsuratstudents.github.io/iiitsuratstudents/)' }
    }, 4);

    const seenTitles = new Set();
    const domainCount = new Map();
    const items = (data.articles || [])
      .filter(a => a?.url && a?.title)
      .filter(a => {
        const title = normalize(a.title);
        if (!title || seenTitles.has(title)) return false;
        const domain = (a.domain || safeDomain(a.url) || 'unknown').toLowerCase();
        const count = domainCount.get(domain) || 0;
        if (count >= 2) return false;
        seenTitles.add(title);
        domainCount.set(domain, count + 1);
        return true;
      })
      .slice(0, 18)
      .map(a => ({
        title: clean(a.title, 300),
        url: a.url,
        domain: a.domain || safeDomain(a.url),
        seenDate: a.seendate || '',
        language: a.language || '',
        sourceCountry: a.sourcecountry || ''
      }));

    if (items.length >= 6) return items;
    console.warn(`GDELT returned only ${items.length} usable items; using RSS fallback.`);
  } catch (err) {
    console.warn(`GDELT unavailable after retries: ${err.message}. Using RSS fallback.`);
  }

  return fetchGoogleNewsFallback(query);
}

async function fetchJsonWithRetry(url, options = {}, attempts = 4) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return await r.json();
    } catch (err) {
      lastError = err;
      console.warn(`Fetch attempt ${i}/${attempts} failed: ${err.message}`);
      if (i < attempts) await sleep(1500 * i);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Request failed after retries');
}

async function fetchGoogleNewsFallback(query) {
  const rssQuery = query
    .replace(/[()"]/g, ' ')
    .replace(/\s+OR\s+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const u = new URL('https://news.google.com/rss/search');
  u.searchParams.set('q', `${rssQuery} when:1d`);
  u.searchParams.set('hl', 'en-US');
  u.searchParams.set('gl', 'US');
  u.searchParams.set('ceid', 'US:en');

  const xml = await fetchTextWithRetry(u.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 SETU-IIIT-Surat/1.0' }
  }, 3);

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
  const out = [];
  const seen = new Set();
  const sourceCounts = new Map();

  for (const item of items) {
    const titleRaw = xmlValue(item, 'title');
    const linkRaw = xmlValue(item, 'link');
    const pubDate = xmlValue(item, 'pubDate');
    const sourceMatch = item.match(/<source(?:\s+url="([^"]*)")?>([\s\S]*?)<\/source>/i);
    const sourceName = decodeXml(stripCdata(sourceMatch?.[2] || 'Google News'));
    const sourceUrl = decodeXml(sourceMatch?.[1] || '');
    const title = decodeXml(stripCdata(titleRaw));
    const url = decodeXml(stripCdata(linkRaw));

    if (!title || !url) continue;
    const key = normalize(title);
    if (!key || seen.has(key)) continue;
    const domain = safeDomain(sourceUrl) || sourceName || 'Google News';
    const count = sourceCounts.get(domain) || 0;
    if (count >= 2) continue;

    seen.add(key);
    sourceCounts.set(domain, count + 1);
    out.push({
      title: clean(title, 300),
      url,
      domain: clean(domain, 120),
      seenDate: pubDate,
      language: 'English',
      sourceCountry: ''
    });
    if (out.length >= 18) break;
  }

  if (out.length < 3) throw new Error(`RSS fallback returned only ${out.length} usable items.`);
  console.log(`Using Google News RSS fallback with ${out.length} source items.`);
  return out;
}

async function fetchTextWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return await r.text();
    } catch (err) {
      lastError = err;
      console.warn(`RSS fetch attempt ${i}/${attempts} failed: ${err.message}`);
      if (i < attempts) await sleep(1200 * i);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('RSS request failed after retries');
}

function xmlValue(item, tag) {
  const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m?.[1] || '';
}
function stripCdata(s='') { return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''); }
function decodeXml(s='') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function summarize(topic, label, sources) {
  const sourceText = sources.map((s, i) =>
    `[${i}] ${s.title}\nOutlet/domain: ${s.domain}\nSource country: ${s.sourceCountry || 'unknown'}\nSeen: ${s.seenDate || 'unknown'}\nURL: ${s.url}`
  ).join('\n\n');

  const system = `You edit WorldLens, a short daily global brief for university students.
Be neutral, precise, non-sensational, and globally minded.
Use ONLY the supplied source metadata; never invent an event, quote, number, date, motive, or causal claim.
For politics and geopolitics, distinguish observed facts from claims, interpretations, forecasts, and allegations, and attribute contested claims.
Do not recommend political choices or tell readers what position to take.
Prefer developments supported by multiple distinct outlets. Avoid making three stories about one country unless the source set genuinely warrants it.
If the source metadata is too thin to support a detail, omit the detail.
Each story should explain: what happened, essential context, and why it could matter to an informed student.
Return JSON only. No markdown.`;

  const user = `Lens: ${label} (${topic})
Current UTC time: ${new Date().toISOString()}

Create exactly three distinct stories from the source list below.

Required JSON schema:
{
  "kicker": "short label",
  "summary": "2-3 sentence overview of today's lens",
  "stories": [
    {
      "title": "short factual headline",
      "body": "80-130 word explanation",
      "whyItMatters": "one concise sentence",
      "sourceIndexes": [0, 2]
    }
  ]
}

SOURCE METADATA:
${sourceText}`;

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2200,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  if (!r.ok) throw new Error(`Gemini failed (${r.status}): ${await r.text()}`);
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')?.trim();
  if (!text) throw new Error('Gemini returned no text.');
  return parseJson(text);
}

function parseJson(text) {
  const s = text.replace(/^\x60\x60\x60json\s*/i, '').replace(/\x60\x60\x60\s*$/i, '').trim();
  try { return JSON.parse(s); }
  catch {
    const match = s.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini returned invalid JSON.');
    return JSON.parse(match[0]);
  }
}
function normalize(s='') { return s.toLowerCase().replace(/\s+/g,' ').replace(/[^a-z0-9 ]/g,'').trim(); }
function safeDomain(url='') { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } }
function clean(v='', max=1000) { return String(v ?? '').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
