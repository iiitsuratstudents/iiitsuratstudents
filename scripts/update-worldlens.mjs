import fs from 'node:fs/promises';

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'ollama';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const OUT = new URL('../data/worldlens.json', import.meta.url);

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

const RSS_FEEDS = {
  geopolitics: [
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'The Guardian World', url: 'https://www.theguardian.com/world/rss' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' }
  ],
  science: [
    { name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
    { name: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/top/science.xml' },
    { name: 'The Guardian Science', url: 'https://www.theguardian.com/science/rss' },
    { name: 'Nature', url: 'https://www.nature.com/nature.rss' }
  ],
  economy: [
    { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
    { name: 'The Guardian Business', url: 'https://www.theguardian.com/business/rss' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' }
  ]
};

const result = {
  generatedAt: new Date().toISOString(),
  provider: LLM_PROVIDER === 'ollama' ? `Local Ollama / ${OLLAMA_MODEL}` : `Gemini / ${GEMINI_MODEL}`,
  retrieval: 'Direct publisher RSS feeds',
  topics: {}
};

for (const [topic, cfg] of Object.entries(lenses)) {
  console.log(`Building ${cfg.label} brief...`);
  const sources = await fetchPublisherFeeds(topic);
  if (!sources.length) throw new Error(`No sources returned for ${topic}`);
  const brief = await summarize(topic, cfg.label, sources);
  result.topics[topic] = {
    ...brief,
    kicker: brief.kicker || `${cfg.label} · global brief`,
    mode: LLM_PROVIDER === 'ollama' ? 'GitHub Action · local Qwen' : 'GitHub Action · Gemini',
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


async function fetchPublisherFeeds(topic) {
  const feeds = RSS_FEEDS[topic] || [];
  const settled = await Promise.allSettled(feeds.map(feed => fetchOneFeed(feed)));

  const all = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const feed = feeds[i];
    if (result.status === 'fulfilled') {
      console.log(`${feed.name}: ${result.value.length} items`);
      all.push(...result.value);
    } else {
      console.warn(`${feed.name} unavailable: ${result.reason?.message || result.reason}`);
    }
  }

  const seen = new Set();
  const sourceCounts = new Map();
  const cutoff = Date.now() - 72 * 60 * 60 * 1000;

  const deduped = all
    .filter(item => {
      if (!item.title || !item.url) return false;
      const key = normalize(item.title);
      if (!key || seen.has(key)) return false;
      const count = sourceCounts.get(item.domain) || 0;
      if (count >= 6) return false;
      seen.add(key);
      sourceCounts.set(item.domain, count + 1);
      return true;
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const recent = deduped.filter(x => !x.timestamp || x.timestamp >= cutoff);
  const selected = (recent.length >= 10 ? recent : deduped).slice(0, 20);

  if (selected.length < 6) {
    throw new Error(`Only ${selected.length} usable publisher-feed items were available for ${topic}.`);
  }
  return selected;
}

async function fetchOneFeed(feed) {
  const xml = await fetchTextWithRetry(feed.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SETU-IIIT-Surat/1.0; +https://iiitsuratstudents.github.io/iiitsuratstudents/)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
  }, 3);

  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
  if (!items.length) throw new Error('Feed contained no RSS <item> entries.');

  return items.slice(0, 20).map(item => {
    const title = decodeXml(stripCdata(xmlValue(item, 'title')));
    const link = decodeXml(stripCdata(xmlValue(item, 'link') || xmlValue(item, 'guid')));
    const pubDate = decodeXml(stripCdata(
      xmlValue(item, 'pubDate') ||
      xmlValue(item, 'dc:date') ||
      xmlValue(item, 'date')
    ));
    const t = Date.parse(pubDate);

    return {
      title: clean(title, 300),
      url: link,
      domain: feed.name,
      seenDate: pubDate,
      timestamp: Number.isFinite(t) ? t : 0,
      language: 'English',
      sourceCountry: ''
    };
  }).filter(x => x.title && /^https?:\/\//i.test(x.url));
}

async function fetchTextWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
      return await r.text();
    } catch (err) {
      lastError = err;
      console.warn(`Feed fetch attempt ${i}/${attempts} for ${url} failed: ${err.message}`);
      if (i < attempts) await sleep(1200 * i);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('Feed request failed after retries');
}

function xmlValue(item, tag) {
  const m = item.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m?.[1] || '';
}
function stripCdata(s='') { return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim(); }
function decodeXml(s='') {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
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
      "body": "70-110 word explanation",
      "whyItMatters": "one concise sentence",
      "sourceIndexes": [0, 2]
    }
  ]
}

SOURCE METADATA:
${sourceText}`;

  if (LLM_PROVIDER === 'gemini') {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
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

  const r = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user + '\n\n/no_think' }
      ],
      stream: false,
      format: 'json',
      think: false,
      options: {
        temperature: 0.2,
        num_ctx: 16384,
        num_predict: 1800
      }
    })
  });

  if (!r.ok) throw new Error(`Local Ollama failed (${r.status}): ${await r.text()}`);
  const data = await r.json();
  const text = data?.message?.content?.trim() || data?.response?.trim();
  if (!text) throw new Error('Local Ollama returned no text.');
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
