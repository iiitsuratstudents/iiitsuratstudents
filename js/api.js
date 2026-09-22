import { API_BASE } from './config.js';
import { demoBriefs } from './data.js';

export const isLive = () => Boolean(API_BASE);

async function request(path, options = {}) {
  if (!API_BASE) throw new Error('SETU is running in demo mode. Configure js/config.js to enable the backend.');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function getBrief(topic, force = false) {
  if (!API_BASE) return { ...demoBriefs[topic], mode: 'demo preview', updatedAt: new Date().toISOString() };
  return request(`/api/brief?topic=${encodeURIComponent(topic)}${force ? '&refresh=1' : ''}`);
}

export async function runAI(tool, prompt, level = '') {
  if (!API_BASE) {
    return { text: demoAI(tool, prompt, level), mode: 'demo preview' };
  }
  return request('/api/ai', { method: 'POST', body: JSON.stringify({ tool, prompt, level }) });
}

export async function submitIssue(payload) {
  if (!API_BASE) return { id: `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, status: 'Saved in this browser only', demo: true };
  return request('/api/issues', { method: 'POST', body: JSON.stringify(payload) });
}

export async function requestCounselling(payload) {
  if (!API_BASE) return { id: `CARE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, status: 'Demo request saved locally', demo: true };
  return request('/api/counselling', { method: 'POST', body: JSON.stringify(payload) });
}

function demoAI(tool, prompt, level) {
  const p = prompt.trim() || 'your topic';
  const snippets = {
    socratic: `Start here — do not solve it yet.\n\n1. What do you already know about “${p.slice(0,120)}”?\n2. Which quantity, assumption, or definition is doing the most work?\n3. Can you construct the smallest non-trivial example?\n\nNext move: write one sentence stating what would count as a valid solution.`,
    explain: `Depth: ${level || 'first-year'}\n\nIntuition\nThink of “${p.slice(0,120)}” by first asking what problem it solves and what changes when it is absent.\n\nStructure\n1. Define the objects.\n2. State the mechanism.\n3. Work through one concrete example.\n4. Identify a boundary case.\n\nProduction mode will replace this demo with a live LLM response.`,
    paper: `Paper Decoder — demo\n\nClaim: identify the single strongest claim made in the passage.\nMethod: ask what was actually measured or proved.\nEvidence: separate experiments, theorem statements and interpretation.\nPrerequisites: list concepts a student should know first.\nLimitations: look for scope, assumptions and missing comparisons.\nQuestion to ask the authors: “What observation would most strongly falsify or weaken this claim?”`,
    debate: `Debate Lens — demo\n\nPosition A: state the strongest version without caricature.\nPosition B: state a genuinely different strongest version.\nHidden assumptions: identify what each position must assume about evidence, incentives or values.\nCommon ground: locate claims that could be tested empirically.\nDiscussion question: What evidence would cause each side to update?`,
    map: `Concept Map — ${level || 'first-year'}\n\nFoundation → definitions and one canonical example\nMechanism → how the pieces interact\nTechnique → solve two representative problems\nFailure modes → counterexamples and misconceptions\nTransfer → connect the idea to another course or application\nCapstone → explain or build one small artifact without notes`,
    oral: `Viva opening — ${level || 'first-year'}\n\n1. Define the central object without using jargon.\n2. Give one example and one non-example.\n3. State the most important assumption.\n4. What breaks if that assumption is removed?\n5. Connect the topic to a neighbouring concept.\n\nSelf-check: precision, examples, causal reasoning, ability to handle counterexamples.`
  };
  return snippets[tool] || `Demo response for ${p}`;
}
