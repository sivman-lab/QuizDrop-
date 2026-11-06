const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const db = require("./db");
const mcp = require("./mcp");
const v = require("./views");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.SESSION_SECRET || "change-me-in-production"));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/vendor/katex", express.static(path.join(__dirname, "..", "node_modules", "katex", "dist"), { maxAge: "7d" }));

const base = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeNext = (n) => (typeof n === "string" && /^\/[a-z0-9/_-]*$/i.test(n) ? n : null);
const home = (u) => (u.role === "tutor" ? "/tutor" : "/student");

// ---------- session ----------
app.use(wrap(async (req, res, next) => {
  const id = req.signedCookies.uid;
  if (id) req.user = await db.userById(id);
  next();
}));
const setLogin = (res, u) => res.cookie("uid", String(u.id), {
  signed: true, httpOnly: true, sameSite: "lax", maxAge: 30 * 864e5, secure: process.env.NODE_ENV === "production" });
const auth = (role) => (req, res, next) => {
  if (!req.user) return res.redirect("/");
  if (role && req.user.role !== role) return res.status(403).send(v.message(req.user, "Not available", `This page is for ${role}s.`, [home(req.user), "Go to your home page"]));
  next();
};
const notFound = (req, res, what = "That page") =>
  res.status(404).send(v.message(req.user, "Not found", `${what} doesn't exist or isn't in your account.`, req.user ? [home(req.user), "Go to your home page"] : ["/", "Go to QuizDrop"]));

// Access to a batch: its tutor, or an enrolled student
async function batchAccess(req, res) {
  const batch = await db.getBatch(parseInt(req.params.id, 10));
  if (!batch) return notFound(req, res, "That batch"), null;
  if (req.user.role === "tutor" ? batch.tutor_id === req.user.id : await db.isEnrolled(batch.id, req.user.id)) return batch;
  notFound(req, res, "That batch"); return null;
}
async function ownTest(req, res) {
  const t = await db.getTest(parseInt(req.params.id, 10));
  if (!t || t.tutor_id !== req.user.id) return notFound(req, res, "That test"), null;
  return t;
}
async function studentTest(req, res) {
  const t = await db.getTest(parseInt(req.params.id, 10));
  if (!t || !t.published || !(await db.isEnrolled(t.batch_id, req.user.id))) return notFound(req, res, "That test"), null;
  return t;
}

// ---------- MCP ----------
app.post("/mcp/:token", wrap((req, res) => mcp.handle(req, res, base(req))));
app.all("/mcp/:token", (req, res) => res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));

// ---------- auth ----------
app.get("/", (req, res) => (req.user ? res.redirect(home(req.user)) : res.send(v.landing())));
app.post("/login", wrap(async (req, res) => {
  const u = await db.checkLogin(req.body.email || "", req.body.password || "");
  const next = safeNext(req.body.next);
  if (!u) {
    const msg = "That email and password don't match. Check them and try again.";
    if (next && next.startsWith("/join/")) { const b = await db.batchByCode(next.split("/")[2]); if (b) return res.status(401).send(v.joinPage(await db.getBatch(b.id), null, msg)); }
    return res.status(401).send(v.landing(msg));
  }
  setLogin(res, u); res.redirect(next || home(u));
}));
app.post("/signup", wrap(async (req, res) => {
  const { role, name = "", email = "", password = "" } = req.body;
  const next = safeNext(req.body.next);
  const bad = (msg) => res.status(400).send(v.landing(msg));
  if (!["tutor", "student"].includes(role)) return bad("Choose whether you're a student or a tutor.");
  if (!name.trim() || password.length < 6) return bad("Enter your name and a password of at least 6 characters.");
  try {
    const u = await db.createUser(role, name.trim(), email, password);
    setLogin(res, u); res.redirect(next && role === "student" ? next : home(u));
  } catch (e) {
    if (e.code === "23505") return bad("An account with that email already exists. Log in instead.");
    throw e;
  }
}));
app.post("/logout", (req, res) => { res.clearCookie("uid"); res.redirect("/"); });

// ---------- joining a batch ----------
app.get("/join", (req, res) => res.redirect(`/join/${encodeURIComponent(String(req.query.code || "").trim().toLowerCase())}`));
app.get("/join/:code", wrap(async (req, res) => {
  const b = await db.batchByCode(req.params.code);
  if (!b) return res.status(404).send(v.message(req.user, "Batch not found", "Check the link or code with your tutor.", req.user ? [home(req.user), "Go back"] : ["/", "Go to QuizDrop"]));
  const batch = await db.getBatch(b.id);
  if (req.user && req.user.role === "student") { await db.enroll(batch.id, req.user.id); return res.redirect(`/batch/${batch.id}`); }
  res.send(v.joinPage(batch, req.user));
}));

// ---------- tutor ----------
app.get("/tutor", auth("tutor"), wrap(async (req, res) => res.send(v.tutorHome(req.user, await db.tutorBatches(req.user.id), base(req)))));
app.post("/batches", auth("tutor"), wrap(async (req, res) => {
  if (!String(req.body.name || "").trim()) return res.redirect("/tutor");
  const b = await db.createBatch(req.user.id, req.body.name.trim(), req.body.exam);
  res.redirect(`/batch/${b.id}`);
}));
app.post("/batch/:id/chapters", auth("tutor"), wrap(async (req, res) => {
  const b = await batchAccess(req, res); if (!b) return;
  if (String(req.body.name || "").trim()) await db.findOrCreateChapter(b.id, req.body.name, String(req.body.subject || "").trim());
  res.redirect(`/batch/${b.id}`);
}));
app.post("/chapter/:cid/delete", auth("tutor"), wrap(async (req, res) => {
  const c = await db.getChapter(parseInt(req.params.cid, 10));
  const b = c && (await db.getBatch(c.batch_id));
  if (!b || b.tutor_id !== req.user.id) return notFound(req, res, "That chapter");
  await db.deleteChapter(c.id); res.redirect(`/batch/${b.id}`);
}));
app.post("/batch/:id/enroll", auth("tutor"), wrap(async (req, res) => {
  const b = await batchAccess(req, res); if (!b) return;
  const r = await db.enrollEmails(b.id, String(req.body.emails || "").split(/[\s,;]+/));
  const parts = [];
  if (r.enrolled.length) parts.push(`${r.enrolled.length} added`);
  if (r.invited.length) parts.push(`${r.invited.length} invited (they join when they sign up with that email)`);
  if (r.skipped.length) parts.push(`${r.skipped.length} skipped: ${r.skipped.join(", ")}`);
  res.redirect(`/batch/${b.id}?flash=${encodeURIComponent(parts.join(" · ") || "No emails found.")}`);
}));
app.post("/batch/:id/students/:sid/remove", auth("tutor"), wrap(async (req, res) => {
  const b = await batchAccess(req, res); if (!b) return;
  await db.removeStudent(b.id, parseInt(req.params.sid, 10)); res.redirect(`/batch/${b.id}`);
}));
app.post("/batch/:id/invites/remove", auth("tutor"), wrap(async (req, res) => {
  const b = await batchAccess(req, res); if (!b) return;
  await db.removeInvite(b.id, req.body.email); res.redirect(`/batch/${b.id}`);
}));
app.get("/test/:id/edit", auth("tutor"), wrap(async (req, res) => {
  const t = await ownTest(req, res); if (!t) return;
  res.send(v.editor(req.user, t, req.query.saved));
}));
app.post("/api/test/:id", auth("tutor"), wrap(async (req, res) => {
  const t = await ownTest(req, res); if (!t) return;
  const b = req.body || {};
  if (!String(b.title || "").trim()) return res.status(400).send("Add a title.");
  const clamp = (n, lo, hi, d) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);
  const updated = await db.updateTest(t.id, {
    title: b.title.trim(), instructions: b.instructions, questions: b.questions || [],
    duration_min: clamp(b.duration_min, 1, 300, t.duration_min), marks_correct: clamp(b.marks_correct, 1, 10, t.marks_correct),
    marks_wrong: clamp(b.marks_wrong, 0, 10, t.marks_wrong), published: !!b.published,
  });
  if (updated.published && !updated.questions.length) { await db.updateTest(t.id, { published: false }); return res.status(400).send("Add at least one complete question before publishing."); }
  res.json({ ok: true });
}));
app.post("/test/:id/delete", auth("tutor"), wrap(async (req, res) => {
  const t = await ownTest(req, res); if (!t) return;
  await db.deleteTest(t.id); res.redirect(`/batch/${t.batch_id}`);
}));

// ---------- student ----------
app.get("/student", auth("student"), wrap(async (req, res) => res.send(v.studentHome(req.user, await db.studentBatches(req.user.id), req.query.flash))));
app.get("/test/:id", auth("student"), wrap(async (req, res) => {
  const t = await studentTest(req, res); if (!t) return;
  const a = await db.startAttempt(t.id, req.user.id);
  if (a.submitted_at) return res.redirect(`/test/${t.id}/result`);
  // Time already ran out on an unfinished attempt: submit what we have (nothing)
  if (Date.now() > new Date(a.started_at).getTime() + t.duration_min * 60000) { await db.submitAttempt(t, req.user.id, {}); return res.redirect(`/test/${t.id}/result`); }
  res.send(v.take(req.user, t, a));
}));
app.post("/test/:id", auth("student"), wrap(async (req, res) => {
  const t = await studentTest(req, res); if (!t) return;
  const answers = {};
  for (const qn of t.questions) answers[qn.id] = req.body[`a_${qn.id}`];
  await db.submitAttempt(t, req.user.id, answers);
  res.redirect(`/test/${t.id}/result`);
}));
app.get("/test/:id/result", auth(), wrap(async (req, res) => {
  const t = await db.getTest(parseInt(req.params.id, 10));
  if (!t) return notFound(req, res, "That test");
  let sid = req.user.id;
  if (req.user.role === "tutor") { if (t.tutor_id !== req.user.id) return notFound(req, res, "That test"); sid = parseInt(req.query.student, 10); }
  else if (!(await db.isEnrolled(t.batch_id, sid))) return notFound(req, res, "That test");
  const a = sid && (await db.getAttempt(t.id, sid));
  if (!a || !a.submitted_at) return notFound(req, res, "That result");
  res.send(v.result(req.user, t, a, req.user.role === "tutor"));
}));

// ---------- batch page and reports (both roles) ----------
app.get("/batch/:id", auth(), wrap(async (req, res) => {
  const b = await batchAccess(req, res); if (!b) return;
  if (req.user.role === "tutor") {
    return res.send(v.tutorBatch(req.user, b, await db.chaptersWithTests(b.id), await db.batchStudents(b.id), await db.batchInvites(b.id), base(req), req.query.flash));
  }
  res.send(v.studentBatch(req.user, b, await db.chaptersWithTests(b.id, { publishedOnly: true, studentId: req.user.id })));
}));
app.get("/batch/:id/report", auth(), wrap(async (req, res) => {
  const b = await batchAccess(req, res); if (!b) return;
  res.send(v.groupReport(req.user, b, await db.groupReport(b.id)));
}));
app.get("/batch/:id/student/:sid", auth(), wrap(async (req, res) => {
  const b = await batchAccess(req, res); if (!b) return;
  const sid = parseInt(req.params.sid, 10);
  if (req.user.role === "student" && sid !== req.user.id) return notFound(req, res, "That report");
  const s = (await db.batchStudents(b.id)).find((x) => x.id === sid);
  if (!s) return notFound(req, res, "That student");
  res.send(v.studentReport(req.user, b, s, await db.studentReport(b.id, sid)));
}));

app.get("/health", (req, res) => res.json({ ok: true }));
app.use((err, req, res, next) => { console.error(err); res.status(500).send("Something went wrong on our side. Try again in a moment."); });

const port = process.env.PORT || 3000;
db.init().then(() => app.listen(port, () => console.log(`QuizDrop on :${port}`)));
