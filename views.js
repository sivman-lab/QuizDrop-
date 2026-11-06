const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const L = (i) => String.fromCharCode(65 + i);
const fmtTime = (s) => (s == null ? "—" : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`);
const marks = (m, max) => (m == null ? "—" : `${m} / ${max}`);
const subjects = (chs) => [...new Set(chs.map((c) => c.subject || "General"))];

function layout(title, body, user, { math, bare } = {}) {
  const home = user ? (user.role === "tutor" ? "/tutor" : "/student") : "/";
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · QuizDrop</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
${math ? `<link rel="stylesheet" href="/vendor/katex/katex.min.css">
<script defer src="/vendor/katex/katex.min.js"></script>
<script defer src="/vendor/katex/contrib/auto-render.min.js" onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false})"></script>` : ""}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='13' fill='none' stroke='%23C8364D' stroke-width='3'/><circle cx='16' cy='16' r='7' fill='%23C8364D'/></svg>">
</head><body>
${bare ? "" : `<header class="top"><a class="brand" href="${home}"><span class="dot" aria-hidden="true"></span>QuizDrop</a>
${user ? `<nav><span class="who">${esc(user.name)} <span class="role">${user.role === "tutor" ? "Tutor" : "Student"}</span></span><form method="post" action="/logout"><button class="link">Log out</button></form></nav>` : ""}</header>`}
<main>${body}</main>
<script>
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>{navigator.clipboard.writeText(b.dataset.copy);const t=b.textContent;b.textContent='Copied';setTimeout(()=>b.textContent=t,1400)}));
</script>
</body></html>`;
}

function authForms(error, next) {
  const n = next ? `<input type="hidden" name="next" value="${esc(next)}">` : "";
  return `<section class="auth">
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
  <form method="post" action="/login" class="card">
    <h2>Log in</h2>${n}
    <label>Email<input name="email" type="email" required autocomplete="email"></label>
    <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
    <button>Log in</button>
    <p class="hint">Reviewing? Tutor: <b>tutor@quizdrop.app</b> · Student: <b>student@quizdrop.app</b> · Password: <b>demo1234</b></p>
  </form>
  <form method="post" action="/signup" class="card">
    <h2>Create an account</h2>${n}
    <div class="roles" role="radiogroup" aria-label="I am a">
      <label class="role-pick"><input type="radio" name="role" value="student" ${next ? "checked" : ""} required><span>I'm a student</span></label>
      <label class="role-pick"><input type="radio" name="role" value="tutor" ${next ? "" : ""}><span>I'm a tutor</span></label>
    </div>
    <label>Full name<input name="name" required maxlength="60"></label>
    <label>Email<input name="email" type="email" required></label>
    <label>Password<input name="password" type="password" required minlength="6"></label>
    <button>Create account</button>
  </form>
</section>`;
}

function landing(error) {
  return layout("Online tests for JEE and NEET coaching", `
<section class="hero">
  <div class="hero-copy">
    <h1>Your printed question bank, online in one message.</h1>
    <p class="lede">JEE and NEET are moving to computer-based tests, but most coaching practice still happens on paper. Give Claude a photo of a question paper or your chapter notes. QuizDrop turns it into a timed online test for your batch, with +4/−1 marking and reports.</p>
    <ol class="steps">
      <li><b>In Claude:</b> “Turn this Kinematics worksheet into a 20-minute test for JEE Batch A.”</li>
      <li><b>In QuizDrop:</b> check the questions, then publish. Your batch sees it under the chapter.</li>
      <li><b>Students:</b> take it on their phone, timed, exactly like the real CBT.</li>
      <li><b>Everyone:</b> the same report for tutor and student: marks and time taken.</li>
    </ol>
  </div>
  <div class="sheet" aria-hidden="true">
    <div class="sheet-head"><span>JEE 2027 – Batch A</span><span>Kinematics · 15:00</span></div>
    ${[["Distance covered in 5 s from rest at 2 m/s²", 1], ["Slope of a v–t graph gives", 1], ["Max height for 20 m/s upward throw", 1]]
      .map(([t, c], i) => `<div class="sheet-row"><span class="n">${i + 1}</span><span class="t">${esc(t)}</span><span class="bubbles">${[0, 1, 2, 3].map((k) => `<i class="${k === c ? "on" : ""}">${L(k)}</i>`).join("")}</span></div>`).join("")}
  </div>
</section>
${authForms(error)}`);
}

function joinPage(batch, user, error) {
  const body = `<section class="join card">
    <h1>Join ${esc(batch.name)}</h1>
    <p>${esc(batch.tutor_name)} invited you to their ${esc(batch.exam)} batch on QuizDrop. Log in or create a student account to join.</p>
    ${user && user.role === "tutor" ? `<p class="error">You're logged in as a tutor. Log out and use a student account to join.</p>` : ""}
  </section>${user ? "" : authForms(error, `/join/${batch.join_code}`)}`;
  return layout(`Join ${batch.name}`, body, user);
}

// ---------------- tutor ----------------
function tutorHome(user, batches, base) {
  const mcpUrl = `${base}/mcp/${user.mcp_token}`;
  return layout("Your batches", `
<section class="connect card">
  <h2>Connect Claude</h2>
  <p>In Claude, open <b>Settings → Connectors → Add custom connector</b>, name it QuizDrop and paste this URL. Then send Claude a photo of a question paper and tell it which batch and chapter it's for.</p>
  <div class="copyline"><code>${esc(mcpUrl)}</code><button class="btn" data-copy="${esc(mcpUrl)}">Copy</button></div>
  <p class="hint">Keep this URL private. Anyone with it can add tests to your batches.</p>
</section>
<div class="section-head"><h1>Your batches</h1></div>
${batches.length ? `<ul class="tiles">${batches.map((b) => `
  <li><a class="tile" href="/batch/${b.id}">
    <span class="exam">${esc(b.exam)}</span>
    <b>${esc(b.name)}</b>
    <span class="meta">${b.students} students · ${b.chapters} chapters · ${b.tests} tests</span>
  </a></li>`).join("")}</ul>` : `<div class="empty card"><p><b>No batches yet.</b> Create one below, or ask Claude: “Create a batch called NEET 2027 – Morning.”</p></div>`}
<form method="post" action="/batches" class="card inline-form">
  <h2>New batch</h2>
  <div class="row">
    <label>Batch name<input name="name" required placeholder="JEE 2027 – Batch B"></label>
    <label>Exam<select name="exam"><option>JEE</option><option>NEET</option><option>Other</option></select></label>
    <button>Create batch</button>
  </div>
</form>`, user);
}

function tutorBatch(user, batch, chapters, students, invites, base, flash) {
  const join = `${base}/join/${batch.join_code}`;
  const chapterBlocks = subjects(chapters).map((sub) => `
    <h3 class="subject">${esc(sub)}</h3>
    ${chapters.filter((c) => (c.subject || "General") === sub).map((c) => `
    <div class="chapter card">
      <div class="chapter-head"><h4>${esc(c.name)}</h4><span class="meta">${c.tests.length} ${c.tests.length === 1 ? "test" : "tests"}</span>
        <form method="post" action="/chapter/${c.id}/delete" onsubmit="return confirm('Delete this chapter and its tests?')"><button class="link danger">Delete chapter</button></form></div>
      ${c.tests.length ? `<ul class="tests">${c.tests.map((t) => `
        <li><a href="/test/${t.id}/edit">${esc(t.title)}</a>
          <span class="meta">${t.qcount} Qs · ${t.duration_min} min · ${t.attempts} attempts</span>
          <span class="badge ${t.published ? "live" : "draft"}">${t.published ? "Published" : "Draft"}</span>
          <a class="btn ghost sm" href="/test/${t.id}/edit">${t.published ? "Edit" : "Review & publish"}</a></li>`).join("")}</ul>`
      : `<p class="hint">No tests yet. Ask Claude to add one to “${esc(c.name)}”.</p>`}
    </div>`).join("")}`).join("");

  return layout(batch.name, `
<a class="back" href="/tutor">All batches</a>
<div class="section-head">
  <div><span class="exam">${esc(batch.exam)}</span><h1>${esc(batch.name)}</h1></div>
  <div class="actions"><a class="btn" href="/batch/${batch.id}/report">Batch report</a></div>
</div>
${flash ? `<p class="toast" role="status">${esc(flash)}</p>` : ""}
<div class="split">
  <section>
    <h2>Chapters and tests</h2>
    ${chapters.length ? chapterBlocks : `<div class="empty card"><p><b>No chapters yet.</b> Ask Claude to create a test and name the chapter, or add one here.</p></div>`}
    <form method="post" action="/batch/${batch.id}/chapters" class="card inline-form">
      <div class="row">
        <label>Subject<input name="subject" placeholder="Physics" list="subj"></label>
        <label>Chapter<input name="name" required placeholder="Laws of Motion"></label>
        <button>Add chapter</button>
      </div>
      <datalist id="subj"><option>Physics</option><option>Chemistry</option><option>Maths</option><option>Biology</option></datalist>
    </form>
  </section>
  <aside>
    <h2>Students <span class="count">${students.length}</span></h2>
    <div class="card">
      <p class="small-label">Share this link to let students join</p>
      <div class="copyline"><code>${esc(join)}</code><button class="btn sm" data-copy="${esc(join)}">Copy</button></div>
      <form method="post" action="/batch/${batch.id}/enroll">
        <label>Or add by email<textarea name="emails" rows="3" placeholder="One email per line, or separated by commas"></textarea></label>
        <button>Add students</button>
      </form>
    </div>
    <ul class="people">
      ${students.map((s) => `<li><a href="/batch/${batch.id}/student/${s.id}">${esc(s.name)}</a><span class="meta">${esc(s.email)}</span>
        <form method="post" action="/batch/${batch.id}/students/${s.id}/remove" onsubmit="return confirm('Remove ${esc(s.name)} from this batch?')"><button class="link danger" aria-label="Remove ${esc(s.name)}">Remove</button></form></li>`).join("")}
      ${invites.map((i) => `<li class="pending"><span>${esc(i.email)}</span><span class="meta">Invited, joins when they sign up</span>
        <form method="post" action="/batch/${batch.id}/invites/remove"><input type="hidden" name="email" value="${esc(i.email)}"><button class="link danger">Cancel</button></form></li>`).join("")}
    </ul>
    ${students.length || invites.length ? "" : `<p class="hint">No students yet.</p>`}
  </aside>
</div>`, user);
}

function editor(user, t, saved) {
  return layout(`Edit ${t.title}`, `
<a class="back" href="/batch/${t.batch_id}">${esc(t.batch_name)}</a>
<div class="section-head">
  <div><span class="exam">${esc(t.subject || "General")} · ${esc(t.chapter_name)}</span><h1>${t.published ? "Edit test" : "Review test"}</h1></div>
  <span class="badge big ${t.published ? "live" : "draft"}">${t.published ? "Published: students can see it" : "Draft: students can't see it yet"}</span>
</div>
${saved ? `<p class="toast" role="status">${saved === "pub" ? "Published. Students in the batch can take it now." : "Changes saved."}</p>` : ""}
<form id="editor" class="card">
  <label>Title<input name="title" value="${esc(t.title)}" required></label>
  <div class="row">
    <label>Duration (minutes)<input name="duration_min" type="number" min="1" max="300" value="${t.duration_min}"></label>
    <label>Marks for correct<input name="marks_correct" type="number" min="1" max="10" value="${t.marks_correct}"></label>
    <label>Marks off for wrong<input name="marks_wrong" type="number" min="0" max="10" value="${t.marks_wrong}"></label>
  </div>
  <label>Instructions<textarea name="instructions" rows="2">${esc(t.instructions)}</textarea></label>
  <p class="hint">Math in $...$ (for example $v = u + at$) shows as formulas for students.</p>
</form>
<div id="questions"></div>
<div class="editor-foot">
  <button class="btn ghost" id="addQ" type="button">Add question</button>
  <form method="post" action="/test/${t.id}/delete" onsubmit="return confirm('Delete this test and its results?')"><button class="btn danger">Delete</button></form>
  <span class="spacer"></span>
  <button class="btn ghost" data-save="${t.published ? "unpublish" : "save"}" type="button">${t.published ? "Unpublish" : "Save draft"}</button>
  <button class="btn primary" data-save="publish" type="button">${t.published ? "Save changes" : "Publish to batch"}</button>
</div>
<template id="qtpl">
  <fieldset class="q card">
    <legend>Question <span class="qn"></span></legend>
    <textarea class="qtext" rows="2" placeholder="Question text"></textarea>
    <p class="hint">Fill the bubble next to the correct answer.</p>
    <div class="opts"></div>
    <button type="button" class="link addOpt">Add option</button>
    <label>Solution shown after submitting<textarea class="qexp" rows="2"></textarea></label>
    <button type="button" class="link danger delQ">Remove question</button>
  </fieldset>
</template>
<script>
const data = ${JSON.stringify(t.questions).replace(/</g, "\\u003c")};
const wrap = document.getElementById('questions'), tpl = document.getElementById('qtpl'); let uid = 0;
function optRow(name, text, checked){
  const r = document.createElement('div'); r.className='opt';
  r.innerHTML = '<label class="bubble"><input type="radio" name="'+name+'"><span></span></label><input class="otext" placeholder="Option"><button type="button" class="link delOpt" aria-label="Remove option">✕</button>';
  r.querySelector('.otext').value = text || ''; r.querySelector('input[type=radio]').checked = !!checked;
  r.querySelector('.delOpt').onclick = ()=>{ r.remove(); relabel(); }; return r;
}
function relabel(){ wrap.querySelectorAll('.q').forEach((q,i)=>{ q.querySelector('.qn').textContent=i+1; q.querySelectorAll('.bubble span').forEach((s,k)=>s.textContent=String.fromCharCode(65+k)); }); }
function addQ(q){
  const node = tpl.content.firstElementChild.cloneNode(true), name='c'+(uid++);
  node.dataset.id = q.id || ''; node.querySelector('.qtext').value = q.text || ''; node.querySelector('.qexp').value = q.explanation || '';
  const opts = node.querySelector('.opts');
  (q.options && q.options.length ? q.options : ['','','','']).forEach((o,i)=>opts.appendChild(optRow(name,o,i===(q.correct_index||0))));
  node.querySelector('.addOpt').onclick = ()=>{ opts.appendChild(optRow(name,'',false)); relabel(); };
  node.querySelector('.delQ').onclick = ()=>{ node.remove(); relabel(); };
  wrap.appendChild(node); relabel();
}
data.forEach(addQ);
document.getElementById('addQ').onclick = ()=>{ addQ({}); wrap.lastElementChild.querySelector('.qtext').focus(); };
document.querySelectorAll('[data-save]').forEach(btn=>btn.onclick = async ()=>{
  const f = document.getElementById('editor'), mode = btn.dataset.save;
  const questions = [...wrap.querySelectorAll('.q')].map(q=>{ const rows=[...q.querySelectorAll('.opt')];
    return { id: q.dataset.id || undefined, text: q.querySelector('.qtext').value, options: rows.map(r=>r.querySelector('.otext').value),
      correct_index: Math.max(0, rows.findIndex(r=>r.querySelector('input[type=radio]').checked)), explanation: q.querySelector('.qexp').value }; });
  const body = { title: f.title.value, instructions: f.instructions.value, duration_min: +f.duration_min.value,
    marks_correct: +f.marks_correct.value, marks_wrong: +f.marks_wrong.value, questions,
    published: mode === 'publish' ? true : mode === 'unpublish' ? false : ${t.published} };
  btn.disabled = true;
  const res = await fetch('/api/test/${t.id}', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  if (res.ok) location.href = '/test/${t.id}/edit?saved=' + (mode === 'publish' && !${t.published} ? 'pub' : '1');
  else { btn.disabled = false; alert('Could not save: ' + (await res.text())); }
});
</script>`, user);
}

// ---------------- student ----------------
function studentHome(user, batches, flash) {
  return layout("My batches", `
${flash ? `<p class="toast" role="status">${esc(flash)}</p>` : ""}
<div class="section-head"><h1>My batches</h1></div>
${batches.length ? `<ul class="tiles">${batches.map((b) => `
  <li><a class="tile" href="/batch/${b.id}">
    <span class="exam">${esc(b.exam)}</span><b>${esc(b.name)}</b>
    <span class="meta">${esc(b.tutor_name)} · ${b.done} of ${b.tests} tests done</span>
  </a></li>`).join("")}</ul>`
  : `<div class="empty card"><p><b>You're not in a batch yet.</b> Open the join link your tutor shared, or enter the batch code below.</p></div>`}
<form method="get" action="/join" class="card inline-form">
  <div class="row"><label>Batch code<input name="code" required placeholder="e.g. jee27a"></label><button>Join batch</button></div>
</form>`, user);
}

function studentBatch(user, batch, chapters) {
  const blocks = subjects(chapters).map((sub) => `
    <h3 class="subject">${esc(sub)}</h3>
    ${chapters.filter((c) => (c.subject || "General") === sub).map((c) => `
    <div class="chapter card">
      <div class="chapter-head"><h4>${esc(c.name)}</h4><span class="meta">${c.tests.length} ${c.tests.length === 1 ? "test" : "tests"}</span></div>
      <ul class="tests">${c.tests.map((t) => {
        const done = !!t.submitted_at, started = t.attempt_id && !done;
        return `<li><span class="ttl">${esc(t.title)}</span>
          <span class="meta">${t.qcount} Qs · ${t.duration_min} min · +${t.marks_correct}/−${t.marks_wrong}</span>
          ${done ? `<span class="score-chip">${t.marks} / ${t.max_marks} · ${fmtTime(t.time_sec)}</span><a class="btn ghost sm" href="/test/${t.id}/result">View answers</a>`
          : `<a class="btn ${started ? "" : "primary"} sm" href="/test/${t.id}">${started ? "Resume test" : "Start test"}</a>`}</li>`;
      }).join("")}</ul>
    </div>`).join("")}`).join("");
  return layout(batch.name, `
<a class="back" href="/student">My batches</a>
<div class="section-head">
  <div><span class="exam">${esc(batch.exam)} · ${esc(batch.tutor_name)}</span><h1>${esc(batch.name)}</h1></div>
  <div class="actions"><a class="btn ghost" href="/batch/${batch.id}/student/${user.id}">My report</a><a class="btn" href="/batch/${batch.id}/report">Batch report</a></div>
</div>
${chapters.length ? blocks : `<div class="empty card"><p><b>No tests yet.</b> Your tutor hasn't published any tests in this batch. Check back soon.</p></div>`}`, user);
}

function take(user, t, attempt) {
  const endsAt = new Date(attempt.started_at).getTime() + t.duration_min * 60000;
  const qs = t.questions.map((q, i) => `
    <fieldset class="sq" id="q${i + 1}">
      <legend><span class="n">${i + 1}</span><span>${esc(q.text)}</span></legend>
      ${q.options.map((o, k) => `<label class="sopt"><input type="radio" name="a_${esc(q.id)}" value="${k}"><span class="b">${L(k)}</span><span>${esc(o)}</span></label>`).join("")}
      <button type="button" class="link clear">Clear answer</button>
    </fieldset>`).join("");
  return layout(t.title, `
<form method="post" action="/test/${t.id}" class="student" id="paper">
  <div class="timerbar" role="timer" aria-live="off"><span>${esc(t.title)}</span><b id="clock">--:--</b></div>
  <p class="meta">${esc(t.batch_name)} · ${esc(t.chapter_name)} · ${t.questions.length} questions · +${t.marks_correct} correct, −${t.marks_wrong} wrong, 0 skipped</p>
  ${t.instructions ? `<p class="note">${esc(t.instructions)}</p>` : ""}
  ${qs}
  <button class="btn primary big" onclick="return confirm('Submit your answers? You can’t change them after this.')">Submit test</button>
</form>
<script>
const end = ${endsAt}, clock = document.getElementById('clock'), form = document.getElementById('paper');
const key = 'qd-${t.id}-${user.id}';
try { const saved = JSON.parse(localStorage.getItem(key) || '{}'); Object.entries(saved).forEach(([n,v])=>{ const el = form.querySelector('input[name="'+n+'"][value="'+v+'"]'); if (el) el.checked = true; }); } catch(e){}
form.addEventListener('change', ()=>{ try { const o={}; new FormData(form).forEach((v,k)=>o[k]=v); localStorage.setItem(key, JSON.stringify(o)); } catch(e){} });
form.querySelectorAll('.clear').forEach(b=>b.onclick=()=>{ b.closest('fieldset').querySelectorAll('input').forEach(i=>i.checked=false); form.dispatchEvent(new Event('change')); });
let sent = false;
function tick(){ const left = Math.max(0, Math.round((end - Date.now())/1000));
  clock.textContent = String(Math.floor(left/60)).padStart(2,'0') + ':' + String(left%60).padStart(2,'0');
  clock.classList.toggle('low', left <= 60);
  if (left === 0 && !sent) { sent = true; form.submit(); } }
form.addEventListener('submit', ()=>{ try{ localStorage.removeItem(key); }catch(e){} });
tick(); setInterval(tick, 1000);
</script>`, user, { math: true });
}

function result(user, t, a, viewerIsTutor) {
  const review = t.questions.map((q, i) => {
    const d = (a.answers || []).find((x) => x.question_id === q.id) || { chosen: null };
    const state = d.chosen === null ? "skip" : d.chosen === q.correct_index ? "right" : "wrong";
    return `<li class="rv ${state}">
      <p class="rv-q"><span class="n">${i + 1}</span><span>${esc(q.text)}</span></p>
      <p>${state === "right" ? `Correct: ${esc(q.options[q.correct_index])} <b>+${t.marks_correct}</b>`
        : state === "skip" ? `Skipped · Answer: <b>${esc(q.options[q.correct_index])}</b> <b>0</b>`
        : `${viewerIsTutor ? "Answered" : "Your answer"}: ${esc(q.options[d.chosen])} · Answer: <b>${esc(q.options[q.correct_index])}</b> <b>−${t.marks_wrong}</b>`}</p>
      ${q.explanation ? `<p class="exp">${esc(q.explanation)}</p>` : ""}</li>`;
  }).join("");
  return layout(`Result: ${t.title}`, `
<div class="student">
  <a class="back" href="/batch/${t.batch_id}">${esc(t.batch_name)}</a>
  <h1>${esc(t.title)}</h1>
  <div class="stats">
    <div><b>${a.marks}<small>/${a.max_marks}</small></b><span>Marks</span></div>
    <div><b>${fmtTime(a.time_sec)}</b><span>Time taken of ${t.duration_min} min</span></div>
  </div>
  <p class="tally"><span class="right">${a.correct} correct</span> <span class="wrong">${a.wrong} wrong</span> <span>${a.skipped} skipped</span></p>
  <ul class="review">${review}</ul>
</div>`, user, { math: true });
}

// ---------------- reports (same for tutor and student) ----------------
function groupReport(user, batch, rep) {
  const attempts = rep.tests.reduce((s, t) => s + t.attempts, 0);
  const canOpen = (id) => user.role === "tutor" || user.id === id;
  return layout(`Report: ${batch.name}`, `
<a class="back" href="/batch/${batch.id}">${esc(batch.name)}</a>
<div class="section-head"><div><span class="exam">Batch report</span><h1>${esc(batch.name)}</h1></div>
  ${user.role === "student" ? `<a class="btn" href="/batch/${batch.id}/student/${user.id}">My report</a>` : ""}</div>
<div class="stats three">
  <div><b>${rep.students.length}</b><span>students</span></div>
  <div><b>${rep.tests.length}</b><span>published tests</span></div>
  <div><b>${attempts}</b><span>tests taken</span></div>
</div>
<h2>Tests</h2>
${rep.tests.length ? `<div class="table-wrap"><table><thead><tr><th>Test</th><th>Chapter</th><th>Taken by</th><th>Avg marks</th><th>Top marks</th><th>Avg time</th></tr></thead><tbody>
${rep.tests.map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(t.chapter)}</td><td>${t.attempts} / ${rep.students.length}</td>
  <td>${t.avg_marks == null ? "—" : `${t.avg_marks} / ${t.max_marks}`}</td><td>${t.top_marks == null ? "—" : `${t.top_marks} / ${t.max_marks}`}</td><td>${fmtTime(t.avg_time)}</td></tr>`).join("")}
</tbody></table></div>` : `<p class="hint">No published tests yet.</p>`}
<h2>Leaderboard</h2>
<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Student</th><th>Tests taken</th><th>Total marks</th><th>Total time</th></tr></thead><tbody>
${rep.students.map((s, i) => `<tr class="${s.id === user.id ? "me" : ""}"><td>${s.tests_taken ? i + 1 : "—"}</td>
  <td>${canOpen(s.id) ? `<a href="/batch/${batch.id}/student/${s.id}">${esc(s.name)}</a>` : esc(s.name)}${s.id === user.id ? " (you)" : ""}</td>
  <td>${s.tests_taken}</td><td>${s.tests_taken ? marks(s.total_marks, s.total_max) : "—"}</td><td>${s.tests_taken ? fmtTime(s.total_time) : "—"}</td></tr>`).join("")}
</tbody></table></div>
<p class="hint">Ranked by total marks, then by less time taken.</p>`, user);
}

function studentReport(user, batch, student, rep) {
  const t = rep.totals;
  return layout(`Report: ${student.name}`, `
<a class="back" href="/batch/${batch.id}/report">Batch report</a>
<div class="section-head"><div><span class="exam">${esc(batch.name)}</span><h1>${esc(student.name)}</h1></div></div>
<div class="stats three">
  <div><b>${t.tests_taken}<small>/${t.tests_available}</small></b><span>tests taken</span></div>
  <div><b>${t.tests_taken ? `${t.marks}<small>/${t.max_marks}</small>` : "—"}</b><span>total marks</span></div>
  <div><b>${t.tests_taken ? fmtTime(t.time_sec) : "—"}</b><span>total time</span></div>
</div>
<h2>Test by test</h2>
<div class="table-wrap"><table><thead><tr><th>Test</th><th>Chapter</th><th>Marks</th><th>Batch avg</th><th>Correct / wrong / skipped</th><th>Time taken</th><th></th></tr></thead><tbody>
${rep.tests.map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.chapter)}</td>
  <td>${r.submitted_at ? `<b>${r.marks}</b> / ${r.max_marks}` : "Not taken"}</td><td>${r.batch_avg == null ? "—" : r.batch_avg}</td>
  <td>${r.submitted_at ? `${r.correct} / ${r.wrong} / ${r.skipped}` : "—"}</td><td>${r.submitted_at ? `${fmtTime(r.time_sec)} of ${r.duration_min}m` : "—"}</td>
  <td>${r.submitted_at ? `<a href="/test/${r.id}/result${user.role === "tutor" ? `?student=${student.id}` : ""}">Answers</a>` : ""}</td></tr>`).join("")}
</tbody></table></div>`, user);
}

function message(user, title, text, link) {
  return layout(title, `<div class="card narrow"><h1>${esc(title)}</h1><p>${esc(text)}</p>${link ? `<a class="btn" href="${link[0]}">${esc(link[1])}</a>` : ""}</div>`, user);
}

module.exports = { landing, joinPage, tutorHome, tutorBatch, editor, studentHome, studentBatch, take, result, groupReport, studentReport, message };
