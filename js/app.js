import { getBrief, runAI, submitIssue, requestCounselling, isLive } from './api.js';
import { signals, campusModules, aiTools, pollSeed } from './data.js';

const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const state = { route: 'home', topic: 'geopolitics', timer: 25 * 60, timerTotal: 25 * 60, timerId: null, aiTool: null };

function formatToday() {
  const d = new Date();
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning, IIIT Surat.' : h < 17 ? 'Good afternoon, IIIT Surat.' : 'Good evening, IIIT Surat.';
}
$('#todayLabel').textContent = formatToday();
$('#pageTitle').textContent = greeting();

function navigate(route) {
  state.route = route;
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === route));
  $$('.nav-item,[data-route].mobile-nav button').forEach(n => n.classList.toggle('active', n.dataset.route === route));
  $$('.mobile-nav button').forEach(n => n.classList.toggle('active', n.dataset.route === route));
  history.replaceState(null, '', `#${route}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (route === 'world') loadWorldBrief(state.topic);
  if (route === 'welfare') renderTickets();
}
$$('[data-route]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.route); }));

const initial = location.hash.replace('#', '');
if (['home','world','learn','welfare','campus'].includes(initial)) navigate(initial);

const savedTheme = localStorage.getItem('setu-theme');
if (savedTheme === 'dark') document.body.classList.add('dark');
$('#themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('setu-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

$('#signalGrid').innerHTML = signals.map(s => `<article class="signal-item"><span class="tag">${s.tag}</span><h4>${s.title}</h4><p>${s.body}</p></article>`).join('');
$('#campusGrid').innerHTML = campusModules.map((m,i) => `<article class="campus-card"><span class="campus-icon">${m.icon}</span><h3>${m.title}</h3><p>${m.body}</p><button class="text-btn campus-module-action" data-index="${i}">${m.action} →</button></article>`).join('');
$$('.campus-module-action').forEach(b => b.addEventListener('click', () => showToast('This module is ready to connect to a dedicated data source.')));

async function loadHomeBrief(topic = 'geopolitics') {
  $('#homeBrief').innerHTML = `<div class="skeleton" style="width:45%"></div><div class="skeleton"></div><div class="skeleton" style="width:80%"></div>`;
  try {
    const data = await getBrief(topic);
    const first = data.stories?.[0];
    $('#homeBrief').innerHTML = `<h4>${escapeHtml(first?.title || data.summary)}</h4><p>${escapeHtml(first?.body || data.summary)}</p>`;
  } catch (err) { $('#homeBrief').innerHTML = `<p>${escapeHtml(err.message)}</p>`; }
}
loadHomeBrief();
$$('[data-preview-topic]').forEach(btn => btn.addEventListener('click', () => {
  $$('[data-preview-topic]').forEach(x => x.classList.remove('active')); btn.classList.add('active'); loadHomeBrief(btn.dataset.previewTopic);
}));

const challengeKey = `setu-challenge-${new Date().toISOString().slice(0,10)}`;
if (localStorage.getItem(challengeKey)) $('#challengeFeedback').textContent = 'Completed today. P(TH)=1/4 and P(end before toss 4)=7/8, so the conditional probability is 2/7.';
$$('#challengeChoices button').forEach(btn => btn.addEventListener('click', () => {
  if (localStorage.getItem(challengeKey)) return;
  const ok = btn.dataset.answer === 'b'; btn.classList.add(ok ? 'correct' : 'wrong');
  if (ok) {
    $('#challengeFeedback').textContent = 'Correct. P(TH)=1/4 and P(end before toss 4)=1/2+1/4+1/8=7/8, so P(TH | end before toss 4)=(1/4)/(7/8)=2/7.';
  } else {
    $('#challengeChoices button[data-answer="b"]').classList.add('correct');
    $('#challengeFeedback').textContent = 'The terminal paths are not equally likely. P(TH)=1/4 and the conditioning event has probability 7/8, so the answer is 2/7.';
  }
  localStorage.setItem(challengeKey, '1'); updateStreak();
}));
function updateStreak(){ const count = Number(localStorage.getItem('setu-streak')||0) + (localStorage.getItem(challengeKey)==='1' && !sessionStorage.getItem('streak-counted') ? 1 : 0); localStorage.setItem('setu-streak',count); sessionStorage.setItem('streak-counted','1'); $('#streakBadge').textContent=`${count} day streak`; }
$('#streakBadge').textContent = `${Number(localStorage.getItem('setu-streak')||0)} day streak`;

function updateTimer(){ const m=Math.floor(state.timer/60),s=state.timer%60; $('#timerDisplay').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; $('#timerProgress').style.width=`${100*(1-state.timer/state.timerTotal)}%`; }
$('#timerStart').addEventListener('click', () => {
  if(state.timerId){ clearInterval(state.timerId); state.timerId=null; $('#timerStart').textContent='Resume'; return; }
  $('#timerStart').textContent='Pause'; state.timerId=setInterval(()=>{ state.timer--; updateTimer(); if(state.timer<=0){clearInterval(state.timerId);state.timerId=null;$('#timerStart').textContent='Again';showToast('Focus sprint complete. Look away from the screen for a minute.');state.timer=state.timerTotal;} },1000);
});
$('#timerReset').addEventListener('click',()=>{clearInterval(state.timerId);state.timerId=null;state.timer=state.timerTotal;$('#timerStart').textContent='Start';updateTimer();});

async function loadWorldBrief(topic, force=false){
  state.topic=topic; $('#worldBrief').innerHTML=`<div class="skeleton" style="width:28%"></div><div class="skeleton" style="height:28px"></div><div class="skeleton"></div><div class="skeleton" style="width:85%"></div>`;
  try{
    const data=await getBrief(topic,force); renderBrief(data); $('#briefMode').textContent=data.mode || (isLive()?'live AI':'demo preview'); $('#briefUpdated').textContent = new Date(data.updatedAt || Date.now()).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
  }catch(err){ $('#worldBrief').innerHTML=`<p>${escapeHtml(err.message)}</p>`; }
}
function renderBrief(data){
  $('#worldBrief').innerHTML=`<span class="brief-kicker">${escapeHtml(data.kicker||'Today')}</span><div class="brief-summary">${escapeHtml(data.summary||'')}</div><div class="brief-stories">${(data.stories||[]).map(s=>`<article class="brief-story"><h4>${escapeHtml(s.title||'')}</h4><p>${escapeHtml(s.body||'')}</p>${s.whyItMatters?`<p><strong>Why it matters:</strong> ${escapeHtml(s.whyItMatters)}</p>`:''}<div class="source-row">${(s.sources||[]).slice(0,4).map(src=>`<a class="source-chip" target="_blank" rel="noopener noreferrer" href="${safeUrl(src.url)}">${escapeHtml(src.name||'source')} ↗</a>`).join('')}</div></article>`).join('')}</div>`;
}
$$('.world-tab').forEach(t=>t.addEventListener('click',()=>{$$('.world-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');loadWorldBrief(t.dataset.topic);}));
$('#refreshBrief').addEventListener('click',()=>loadWorldBrief(state.topic,true));

const modalMap={issue:$('#issueModal'),counselling:$('#counsellingModal'),ai:$('#aiModal')};
function openModal(name){ const m=modalMap[name]; if(!m)return; $('#modalBackdrop').classList.add('open'); m.classList.add('open'); m.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
function closeModals(){ $('#modalBackdrop').classList.remove('open'); $$('.modal').forEach(m=>{m.classList.remove('open');m.setAttribute('aria-hidden','true')}); document.body.style.overflow=''; }
$$('[data-open]').forEach(b=>b.addEventListener('click',()=>{ const target=b.dataset.open; if(target==='support') openModal('counselling'); else { if(b.dataset.category) $('#issueCategory').value=b.dataset.category; openModal(target); }}));
$$('[data-close]').forEach(b=>b.addEventListener('click',closeModals)); $('#modalBackdrop').addEventListener('click',closeModals);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModals();closeCommand();}});

$('#issueForm').addEventListener('submit', async e=>{
  e.preventDefault(); const form=e.currentTarget; const fd=new FormData(form); const payload={category:fd.get('category'),urgency:fd.get('urgency'),title:fd.get('title'),description:fd.get('description'),anonymous:fd.get('anonymous')==='on'};
  const submit=$('button[type="submit"]',form); submit.disabled=true; submit.textContent='Submitting…';
  try{ const res=await submitIssue(payload); saveLocalTicket({...payload,id:res.id,status:res.status||'Received',createdAt:new Date().toISOString(),demo:res.demo}); form.hidden=true; $('#issueSuccess').hidden=false; $('#issueSuccess').innerHTML=`<strong>Received.</strong>Your reference is <b>${escapeHtml(res.id)}</b>. ${res.demo?'This is demo mode, so the ticket exists only in this browser.':'Keep the reference for tracking.'}`; }
  catch(err){showToast(err.message)} finally{submit.disabled=false;submit.textContent='Submit issue'}
});
$('#counsellingForm').addEventListener('submit', async e=>{
  e.preventDefault(); const form=e.currentTarget; const fd=new FormData(form); const payload={contact:fd.get('contact'),mode:fd.get('mode'),timing:fd.get('timing'),note:fd.get('note')||''}; const submit=$('button[type="submit"]',form);submit.disabled=true;submit.textContent='Sending…';
  try{const res=await requestCounselling(payload);form.hidden=true;$('#counsellingSuccess').hidden=false;$('#counsellingSuccess').innerHTML=`<strong>Request recorded.</strong>Reference: <b>${escapeHtml(res.id)}</b>. ${res.demo?'In demo mode this is not sent to a real counsellor.':'An authorized contact can now follow up through the configured workflow.'}`;}catch(err){showToast(err.message)}finally{submit.disabled=false;submit.textContent='Request contact'}
});
function saveLocalTicket(t){const list=JSON.parse(localStorage.getItem('setu-tickets')||'[]');list.unshift(t);localStorage.setItem('setu-tickets',JSON.stringify(list.slice(0,20)));}
function renderTickets(){const list=JSON.parse(localStorage.getItem('setu-tickets')||'[]');$('#ticketHistory').innerHTML=list.length?list.map(t=>`<article class="ticket-item"><span class="ticket-id">${escapeHtml(t.id)}</span><div><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(t.category)} · ${new Date(t.createdAt).toLocaleDateString('en-IN')}</small></div><span class="ticket-status">${escapeHtml(t.status)}</span></article>`).join(''):`<div class="empty-state">No issue tickets have been created in this browser.</div>`;}

$$('[data-ai-tool]').forEach(b=>b.addEventListener('click',()=>openAITool(b.dataset.aiTool)));
function openAITool(tool){state.aiTool=tool;const cfg=aiTools[tool];if(!cfg)return;$('#aiTitle').textContent=cfg.title;$('#aiDescription').textContent=cfg.description;$('#aiPromptLabel').childNodes[0].nodeValue=cfg.label+' ';$('#aiLevelWrap').style.display=cfg.level?'grid':'none';$('#aiPrompt').value='';$('#aiResult').hidden=true;openModal('ai');}
$('#aiForm').addEventListener('submit',async e=>{e.preventDefault();const prompt=$('#aiPrompt').value.trim();if(!prompt)return;const btn=$('button[type="submit"]',e.currentTarget);btn.disabled=true;btn.innerHTML='<span class="loading-dots">Thinking</span>';$('#aiResult').hidden=false;$('#aiResult').textContent='Building a useful response…';try{const res=await runAI(state.aiTool,prompt,$('#aiLevel').value);$('#aiResult').textContent=res.text||'No response returned.';}catch(err){$('#aiResult').textContent=err.message}finally{btn.disabled=false;btn.textContent='Run tool'}});
$('#skillBuild').addEventListener('click',async()=>{const p=$('#skillInput').value.trim();if(!p)return;$('#skillOutput').textContent='Building sprint…';try{const r=await runAI('map',`Create a seven-day micro-learning sprint for: ${p}. Each day must take 30-45 minutes and produce one observable output.`,'advanced');$('#skillOutput').textContent=r.text}catch(e){$('#skillOutput').textContent=e.message}});
$('#moduleIdea').addEventListener('click',async()=>{$('#moduleIdeaOutput').textContent='Generating…';try{const r=await runAI('map','Invent one small, privacy-respecting digital micro-tool that IIIT Surat students could build in a weekend to remove a real campus friction. Give problem, MVP, data needed, and success measure.','advanced');$('#moduleIdeaOutput').textContent=r.text}catch(e){$('#moduleIdeaOutput').textContent=e.message}});

function renderPoll(){let poll=JSON.parse(localStorage.getItem('setu-poll')||'null')||pollSeed;const total=poll.reduce((a,b)=>a+b.votes,0);const voted=localStorage.getItem('setu-poll-voted');$('#pollOptions').innerHTML=poll.map(p=>`<button class="poll-option" data-poll="${p.id}" ${voted?'disabled':''}><i class="fill" style="width:${voted?Math.round(100*p.votes/total):0}%"></i><span>${p.label}${voted?` · ${Math.round(100*p.votes/total)}%`:''}</span></button>`).join('');$$('[data-poll]').forEach(b=>b.addEventListener('click',()=>{if(localStorage.getItem('setu-poll-voted'))return;poll=poll.map(p=>p.id===b.dataset.poll?{...p,votes:p.votes+1}:p);localStorage.setItem('setu-poll',JSON.stringify(poll));localStorage.setItem('setu-poll-voted',b.dataset.poll);renderPoll();}));}
renderPoll();
$('#campusSuggest').addEventListener('click',()=>showToast('Next module: student suggestions with moderation + status tracking.'));

const commands=[
  {name:'Home',desc:'Dashboard',run:()=>navigate('home')},{name:'WorldLens',desc:'Daily global brief',run:()=>navigate('world')},{name:'LearnLab',desc:'AI learning tools',run:()=>navigate('learn')},{name:'Raise an issue',desc:'SpeakUp',run:()=>openModal('issue')},{name:'Request counselling',desc:'Sahaara',run:()=>openModal('counselling')},
  ...Object.entries(aiTools).map(([key,v])=>({name:v.title,desc:'LearnLab tool',run:()=>openAITool(key)}))
];
function openCommand(){closeModals();$('#commandPalette').classList.add('open');$('#commandPalette').setAttribute('aria-hidden','false');$('#commandInput').value='';renderCommands('');setTimeout(()=>$('#commandInput').focus(),30)}
function closeCommand(){$('#commandPalette').classList.remove('open');$('#commandPalette').setAttribute('aria-hidden','true')}
function renderCommands(q){const f=commands.filter(c=>(c.name+' '+c.desc).toLowerCase().includes(q.toLowerCase()));$('#commandResults').innerHTML=f.map((c,i)=>`<button class="command-result" data-command="${i}"><span>${c.name}</span><small>${c.desc}</small></button>`).join('');$$('[data-command]').forEach((b,i)=>b.addEventListener('click',()=>{closeCommand();f[i].run()}));}
$('#searchOpen').addEventListener('click',openCommand);$('#commandButton').addEventListener('click',openCommand);$('#commandInput').addEventListener('input',e=>renderCommands(e.target.value));$('#commandPalette').addEventListener('click',e=>{if(e.target===$('#commandPalette'))closeCommand()});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();openCommand()} if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommand()}});

function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(showToast.id);showToast.id=setTimeout(()=>t.classList.remove('show'),2600)}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function safeUrl(url=''){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?u.href:'#'}catch{return '#'}}
