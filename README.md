# SETU — IIIT Surat Student Hub

A modular, static-first student welfare + learning + campus-life portal designed for GitHub Pages, with an optional Cloudflare Worker backend for AI, news summaries and persistence.

## What is included

- **SpeakUp** — issue reporting with anonymous-mode UX and local ticket history.
- **Sahaara** — minimal-data confidential conversation request flow.
- **WorldLens** — separate daily briefs for geopolitics, academic/scientific news and the economy.
- **LearnLab** — Socratic Coach, Depth Dial, Paper Decoder, Debate Lens, Concept Mapper and Viva Simulator.
- **Focus Sprint** — local Pomodoro-style timer.
- **Daily Spark** — a short reasoning challenge with local streaks.
- **Campus** — opportunities, peer learning, events, lost & found, skill exchange, projects, idea wall and student-built micro-tools.
- **Command palette** — press `/` or `Cmd/Ctrl + K`.
- **Dark mode**, responsive mobile navigation and zero-framework frontend.

The site works immediately in **demo mode**. No API key is exposed in the browser.

---

## Architecture

```text
GitHub Pages (index.html + CSS + ES modules)
        |
        | HTTPS fetch
        v
Cloudflare Worker
   |       |        |
   |       |        +-- D1: issue/counselling records + brief cache
   |       +----------- GDELT DOC API: current global news metadata
   +------------------- Workers AI OR Gemini API: summarization + learning tools
```

GitHub Pages is static hosting, so do **not** put a Gemini/OpenAI key in `js/config.js`. Anyone can inspect browser JavaScript. Keep keys or AI bindings in the Worker.

## GitHub-only WorldLens (recommended for this Pages deployment)

The live daily news brief does **not** need a separate backend. A scheduled GitHub Action in `.github/workflows/update-worldlens.yml`:

1. Retrieves current article metadata from GDELT.
2. Calls Gemini using the repository secret `GEMINI_API_KEY`.
3. Writes `data/worldlens.json`.
4. Commits that generated file back to `main`.
5. The GitHub Pages frontend reads the latest JSON directly from `raw.githubusercontent.com`.

The workflow runs every four hours and can also be run manually from **Actions → Update WorldLens → Run workflow**.

To activate it, create a Gemini API key in Google AI Studio, then add it in **Repository Settings → Secrets and variables → Actions → New repository secret** with the exact name:

```
GEMINI_API_KEY
```

Do not put the key in `js/config.js`, HTML, JavaScript, a repository variable, or any committed file.

## 1. Run the frontend locally

Because the app uses JavaScript modules, serve the directory instead of double-clicking `index.html`:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## 2. Publish the frontend on GitHub Pages

1. Create a repository, for example `setu`.
2. Copy the contents of this folder to the repository root.
3. Commit and push.
4. In **Settings → Pages**, deploy from the main branch/root (or use a Pages GitHub Action).
5. The static app will run in demo mode until the backend URL is added.

## 3. Deploy the free backend with Cloudflare

The backend can use **Cloudflare Workers AI** so you do not need a client-side LLM key. An optional Gemini provider is also implemented.

Install Wrangler:

```bash
npm install -g wrangler
wrangler login
```

Inside `worker/`:

```bash
cp wrangler.toml.example wrangler.toml
```

Create a D1 database:

```bash
wrangler d1 create setu
```

Paste the resulting `database_id` into `wrangler.toml`, uncomment the `[[d1_databases]]` block, and enable the AI binding:

```toml
[[d1_databases]]
binding = "DB"
database_name = "setu"
database_id = "YOUR_DATABASE_ID"

[ai]
binding = "AI"
```

Apply the schema:

```bash
wrangler d1 execute setu --remote --file=./schema.sql
```

Set the exact GitHub Pages origin in `ALLOWED_ORIGIN`, for example:

```toml
ALLOWED_ORIGIN = "https://yourname.github.io"
```

Deploy:

```bash
wrangler deploy
```

Copy the Worker URL and set it in `js/config.js`:

```js
export const API_BASE = "https://setu-api.your-subdomain.workers.dev";
```

Commit that one public Worker URL to GitHub. It is safe; it is not a secret.

## 4. Optional: use Gemini instead of Workers AI

In `worker/wrangler.toml`:

```toml
AI_PROVIDER = "gemini"
AI_MODEL = "gemini-2.5-flash-lite"
```

Store the key as a Worker secret:

```bash
wrangler secret put GEMINI_API_KEY
```

Never commit the key.

## 5. WorldLens pipeline

For each lens, the Worker:

1. Retrieves fresh article metadata through the **GDELT DOC API**.
2. Deduplicates article titles/domains.
3. Sends only the retrieved source metadata to the LLM.
4. Requires a compact JSON brief with three stories.
5. Maps each summary back to source URLs.
6. Caches the brief in D1 for three hours to reduce AI usage.

This is preferable to asking an LLM to “tell me today’s news” from memory.

## Production hardening before official institute rollout

The UI is production-shaped, but the backend is deliberately an MVP. Before storing real student data, add:

- **Institute authentication / SSO** for non-anonymous workflows.
- **Cloudflare Turnstile + rate limiting** to stop spam.
- Separate staff-only admin dashboard with role-based access.
- Ticket assignment, status updates, audit log and escalation policy.
- Data-retention policy; collect the minimum necessary personal data.
- Encryption / secrets review and periodic access review.
- Explicit consent and privacy notice for counselling-related flows.
- A human moderation workflow for public campus content.
- Accessibility review (keyboard, screen-reader, contrast, WCAG testing).
- Named emergency/security contacts maintained by the institute.

For counselling, the safest product pattern is to store **a request for contact**, not a detailed mental-health history, unless the institute has approved systems and policies for that data.

## Good next modules

- Institute handbook / policy RAG assistant using approved documents and citations.
- Personalized academic planner with prerequisites and calendar export.
- Club/event calendar with `.ics` export.
- Student research/project matching by interests (opt-in only).
- “Ask an alumnus” question queue.
- Equipment/lab availability board.
- Mess/menu feedback analytics without individual profiling.
- Shuttle/transport reminders.
- Scholarship/research-call watchlist.
- Student-built module gallery with a lightweight review process.

## File map

```text
index.html
styles.css
js/
  app.js        # interaction and UI state
  api.js        # backend adapter + demo fallbacks
  config.js     # public backend URL only
  data.js       # static modules/demo content
worker/
  worker.js     # API, GDELT retrieval, AI, D1 writes/cache
  schema.sql
  wrangler.toml.example
README.md
```
