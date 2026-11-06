const { Pool } = require("pg");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && process.env.PGSSL !== "disable";
const pool = new Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : false });
const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0];
const token = (n = 18) => crypto.randomBytes(n).toString("base64url");
const code = () => crypto.randomBytes(4).toString("hex");

async function init() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('tutor','student')),
      name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      mcp_token TEXT UNIQUE, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS batches (
      id SERIAL PRIMARY KEY, tutor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, exam TEXT NOT NULL DEFAULT 'JEE', join_code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS enrollments (
      batch_id INT REFERENCES batches(id) ON DELETE CASCADE, student_id INT REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (batch_id, student_id));
    CREATE TABLE IF NOT EXISTS invites (
      batch_id INT REFERENCES batches(id) ON DELETE CASCADE, email TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (batch_id, email));
    CREATE TABLE IF NOT EXISTS chapters (
      id SERIAL PRIMARY KEY, batch_id INT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      subject TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS tests (
      id SERIAL PRIMARY KEY, chapter_id INT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      title TEXT NOT NULL, instructions TEXT DEFAULT '', duration_min INT NOT NULL DEFAULT 30,
      marks_correct INT NOT NULL DEFAULT 4, marks_wrong INT NOT NULL DEFAULT 1,
      questions JSONB NOT NULL DEFAULT '[]', published BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS attempts (
      id SERIAL PRIMARY KEY, test_id INT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ DEFAULT now(), submitted_at TIMESTAMPTZ,
      answers JSONB, correct INT, wrong INT, skipped INT, marks INT, max_marks INT, time_sec INT,
      UNIQUE (test_id, student_id));
  `);
  await seedDemo();
}

// ---------- users ----------
async function createUser(role, name, email, password) {
  const u = await one(
    "INSERT INTO users (role,name,email,password_hash,mcp_token) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [role, name, email.toLowerCase().trim(), bcrypt.hashSync(password, 10), role === "tutor" ? token() : null]);
  if (role === "student") {
    // Turn any email invites into enrolments
    await q(`INSERT INTO enrollments (batch_id, student_id) SELECT batch_id, $1 FROM invites WHERE email=$2 ON CONFLICT DO NOTHING`, [u.id, u.email]);
    await q("DELETE FROM invites WHERE email=$1", [u.email]);
  }
  return u;
}
async function checkLogin(email, password) {
  const u = await one("SELECT * FROM users WHERE email=$1", [String(email).toLowerCase().trim()]);
  return u && bcrypt.compareSync(password, u.password_hash) ? u : null;
}
const userById = (id) => one("SELECT * FROM users WHERE id=$1", [id]);
const tutorByToken = (t) => one("SELECT * FROM users WHERE mcp_token=$1 AND role='tutor'", [t]);

// ---------- batches ----------
const createBatch = (tutorId, name, exam) =>
  one("INSERT INTO batches (tutor_id,name,exam,join_code) VALUES ($1,$2,$3,$4) RETURNING *", [tutorId, name, exam || "JEE", code()]);
const batchByCode = (c) => one("SELECT * FROM batches WHERE join_code=$1", [c]);
const getBatch = (id) => one("SELECT b.*, u.name AS tutor_name FROM batches b JOIN users u ON u.id=b.tutor_id WHERE b.id=$1", [id]);
async function tutorBatches(tutorId) {
  return (await q(`SELECT b.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.batch_id=b.id)::int AS students,
      (SELECT COUNT(*) FROM chapters c WHERE c.batch_id=b.id)::int AS chapters,
      (SELECT COUNT(*) FROM tests t JOIN chapters c ON c.id=t.chapter_id WHERE c.batch_id=b.id)::int AS tests
    FROM batches b WHERE b.tutor_id=$1 ORDER BY b.created_at DESC`, [tutorId])).rows;
}
async function studentBatches(studentId) {
  return (await q(`SELECT b.*, u.name AS tutor_name,
      (SELECT COUNT(*) FROM tests t JOIN chapters c ON c.id=t.chapter_id WHERE c.batch_id=b.id AND t.published)::int AS tests,
      (SELECT COUNT(*) FROM attempts a JOIN tests t ON t.id=a.test_id JOIN chapters c ON c.id=t.chapter_id
         WHERE c.batch_id=b.id AND a.student_id=$1 AND a.submitted_at IS NOT NULL)::int AS done
    FROM enrollments e JOIN batches b ON b.id=e.batch_id JOIN users u ON u.id=b.tutor_id
    WHERE e.student_id=$1 ORDER BY e.joined_at DESC`, [studentId])).rows;
}
const isEnrolled = async (batchId, studentId) => !!(await one("SELECT 1 FROM enrollments WHERE batch_id=$1 AND student_id=$2", [batchId, studentId]));
const enroll = (batchId, studentId) => q("INSERT INTO enrollments (batch_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [batchId, studentId]);

async function enrollEmails(batchId, emails) {
  const out = { enrolled: [], invited: [], skipped: [] };
  for (const raw of emails) {
    const email = String(raw).toLowerCase().trim();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { out.skipped.push(email); continue; }
    const u = await one("SELECT * FROM users WHERE email=$1", [email]);
    if (u && u.role === "student") { await enroll(batchId, u.id); out.enrolled.push(email); }
    else if (!u) { await q("INSERT INTO invites (batch_id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING", [batchId, email]); out.invited.push(email); }
    else out.skipped.push(email);
  }
  return out;
}
const batchStudents = async (batchId) => (await q(
  `SELECT u.id,u.name,u.email,e.joined_at FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.batch_id=$1 ORDER BY u.name`, [batchId])).rows;
const batchInvites = async (batchId) => (await q("SELECT email FROM invites WHERE batch_id=$1 ORDER BY created_at", [batchId])).rows;
const removeStudent = (batchId, sid) => q("DELETE FROM enrollments WHERE batch_id=$1 AND student_id=$2", [batchId, sid]);
const removeInvite = (batchId, email) => q("DELETE FROM invites WHERE batch_id=$1 AND email=$2", [batchId, email]);

// ---------- chapters & tests ----------
async function findOrCreateChapter(batchId, name, subject) {
  const ex = await one("SELECT * FROM chapters WHERE batch_id=$1 AND lower(name)=lower($2)", [batchId, name.trim()]);
  if (ex) return ex;
  return one("INSERT INTO chapters (batch_id,name,subject) VALUES ($1,$2,$3) RETURNING *", [batchId, name.trim(), subject || ""]);
}
const getChapter = (id) => one("SELECT * FROM chapters WHERE id=$1", [id]);
async function chaptersWithTests(batchId, { publishedOnly, studentId } = {}) {
  const chapters = (await q("SELECT * FROM chapters WHERE batch_id=$1 ORDER BY subject, created_at", [batchId])).rows;
  const tests = (await q(`SELECT t.id,t.chapter_id,t.title,t.duration_min,t.published,t.marks_correct,t.marks_wrong,
      jsonb_array_length(t.questions)::int AS qcount,
      ${studentId ? `a.id AS attempt_id, a.submitted_at, a.marks, a.max_marks, a.time_sec` : "NULL AS attempt_id"},
      (SELECT COUNT(*) FROM attempts x WHERE x.test_id=t.id AND x.submitted_at IS NOT NULL)::int AS attempts
    FROM tests t JOIN chapters c ON c.id=t.chapter_id
    ${studentId ? "LEFT JOIN attempts a ON a.test_id=t.id AND a.student_id=$2" : ""}
    WHERE c.batch_id=$1 ${publishedOnly ? "AND t.published" : ""} ORDER BY t.created_at`, studentId ? [batchId, studentId] : [batchId])).rows;
  return chapters.map((c) => ({ ...c, tests: tests.filter((t) => t.chapter_id === c.id) }))
    .filter((c) => !publishedOnly || c.tests.length);
}
const deleteChapter = (id) => q("DELETE FROM chapters WHERE id=$1", [id]);

function cleanQuestions(list) {
  return (list || []).map((x) => {
    const options = (x.options || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 6);
    let c = parseInt(x.correct_index, 10);
    if (!(c >= 0 && c < options.length)) c = 0;
    return { id: x.id || token(6), text: String(x.text || "").trim(), options, correct_index: c, explanation: String(x.explanation || "").trim() };
  }).filter((x) => x.text && x.options.length >= 2);
}
async function createTest(chapterId, d) {
  return one(`INSERT INTO tests (chapter_id,title,instructions,duration_min,marks_correct,marks_wrong,questions,published)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [chapterId, d.title, d.instructions || "", d.duration_min || 30, d.marks_correct ?? 4, d.marks_wrong ?? 1,
     JSON.stringify(cleanQuestions(d.questions)), !!d.published]);
}
// Test with its chapter and batch, for permission checks
const getTest = (id) => one(`SELECT t.*, c.name AS chapter_name, c.subject, c.batch_id, b.tutor_id, b.name AS batch_name, b.exam
  FROM tests t JOIN chapters c ON c.id=t.chapter_id JOIN batches b ON b.id=c.batch_id WHERE t.id=$1`, [id]);
async function updateTest(id, p) {
  const t = await getTest(id); if (!t) return null;
  let questions = t.questions;
  if (p.questions) questions = cleanQuestions(p.questions);
  if (p.add_questions) questions = questions.concat(cleanQuestions(p.add_questions));
  await q(`UPDATE tests SET title=$1,instructions=$2,duration_min=$3,marks_correct=$4,marks_wrong=$5,questions=$6,published=$7,updated_at=now() WHERE id=$8`,
    [p.title ?? t.title, p.instructions ?? t.instructions, p.duration_min ?? t.duration_min, p.marks_correct ?? t.marks_correct,
     p.marks_wrong ?? t.marks_wrong, JSON.stringify(questions), typeof p.published === "boolean" ? p.published : t.published, id]);
  return getTest(id);
}
const deleteTest = (id) => q("DELETE FROM tests WHERE id=$1", [id]);

// ---------- attempts ----------
const getAttempt = (testId, sid) => one("SELECT * FROM attempts WHERE test_id=$1 AND student_id=$2", [testId, sid]);
async function startAttempt(testId, sid) {
  await q("INSERT INTO attempts (test_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [testId, sid]);
  return getAttempt(testId, sid);
}
async function submitAttempt(test, sid, answers) {
  const a = await getAttempt(test.id, sid);
  if (!a || a.submitted_at) return a;
  let correct = 0, wrong = 0, skipped = 0;
  const detail = test.questions.map((qn) => {
    const raw = answers[qn.id];
    const chosen = raw === undefined || raw === null || raw === "" ? null : parseInt(raw, 10);
    if (chosen === null) skipped++; else if (chosen === qn.correct_index) correct++; else wrong++;
    return { question_id: qn.id, chosen };
  });
  const elapsed = Math.round((Date.now() - new Date(a.started_at).getTime()) / 1000);
  const time = Math.max(1, Math.min(elapsed, test.duration_min * 60));
  const marks = correct * test.marks_correct - wrong * test.marks_wrong;
  return one(`UPDATE attempts SET submitted_at=now(),answers=$1,correct=$2,wrong=$3,skipped=$4,marks=$5,max_marks=$6,time_sec=$7
    WHERE id=$8 RETURNING *`, [JSON.stringify(detail), correct, wrong, skipped, marks, test.questions.length * test.marks_correct, time, a.id]);
}

// ---------- reports (plain SQL, no AI) ----------
async function groupReport(batchId) {
  const tests = (await q(`SELECT t.id,t.title,c.name AS chapter,c.subject,(jsonb_array_length(t.questions)*t.marks_correct)::int AS max_marks,
      COUNT(a.id)::int AS attempts, ROUND(AVG(a.marks),1)::float AS avg_marks, MAX(a.marks) AS top_marks,
      ROUND(AVG(a.time_sec))::int AS avg_time
    FROM tests t JOIN chapters c ON c.id=t.chapter_id LEFT JOIN attempts a ON a.test_id=t.id AND a.submitted_at IS NOT NULL
    WHERE c.batch_id=$1 AND t.published GROUP BY t.id,c.name,c.subject ORDER BY c.subject,t.created_at`, [batchId])).rows;
  const students = (await q(`SELECT u.id,u.name, COUNT(a.id)::int AS tests_taken, COALESCE(SUM(a.marks),0)::int AS total_marks,
      COALESCE(SUM(a.max_marks),0)::int AS total_max, COALESCE(SUM(a.time_sec),0)::int AS total_time
    FROM enrollments e JOIN users u ON u.id=e.student_id
    LEFT JOIN attempts a ON a.student_id=u.id AND a.submitted_at IS NOT NULL
      AND a.test_id IN (SELECT t.id FROM tests t JOIN chapters c ON c.id=t.chapter_id WHERE c.batch_id=$1)
    WHERE e.batch_id=$1 GROUP BY u.id ORDER BY total_marks DESC, total_time ASC, u.name`, [batchId])).rows;
  return { tests, students };
}
async function studentReport(batchId, sid) {
  const rows = (await q(`SELECT t.id,t.title,c.name AS chapter,c.subject,(jsonb_array_length(t.questions)*t.marks_correct)::int AS max_marks,
      t.duration_min, a.marks,a.correct,a.wrong,a.skipped,a.time_sec,a.submitted_at,
      (SELECT ROUND(AVG(x.marks),1)::float FROM attempts x WHERE x.test_id=t.id AND x.submitted_at IS NOT NULL) AS batch_avg
    FROM tests t JOIN chapters c ON c.id=t.chapter_id
    LEFT JOIN attempts a ON a.test_id=t.id AND a.student_id=$2 AND a.submitted_at IS NOT NULL
    WHERE c.batch_id=$1 AND t.published ORDER BY c.subject,t.created_at`, [batchId, sid])).rows;
  const done = rows.filter((r) => r.submitted_at);
  return {
    tests: rows,
    totals: {
      tests_taken: done.length, tests_available: rows.length,
      marks: done.reduce((s, r) => s + r.marks, 0), max_marks: done.reduce((s, r) => s + r.max_marks, 0),
      time_sec: done.reduce((s, r) => s + r.time_sec, 0),
    },
  };
}

// ---------- demo data for reviewers ----------
async function seedDemo() {
  if (await one("SELECT 1 FROM users WHERE email='tutor@quizdrop.app'")) return;
  await one(`INSERT INTO users (role,name,email,password_hash,mcp_token) VALUES ('tutor','Demo Tutor','tutor@quizdrop.app',$1,$2) RETURNING *`,
    [bcrypt.hashSync("demo1234", 10), process.env.DEMO_MCP_TOKEN || "demo-tutor-key"]);
  const tutor = await one("SELECT * FROM users WHERE email='tutor@quizdrop.app'");
  const batch = await one("INSERT INTO batches (tutor_id,name,exam,join_code) VALUES ($1,'JEE 2027 – Batch A','JEE','jee27a') RETURNING *", [tutor.id]);
  const ch = await findOrCreateChapter(batch.id, "Kinematics", "Physics");
  await findOrCreateChapter(batch.id, "Chemical Bonding", "Chemistry");
  const test = await createTest(ch.id, {
    title: "Kinematics – Practice Test 1", duration_min: 15, published: true,
    instructions: "+4 for a correct answer, −1 for a wrong one, 0 if skipped.",
    questions: [
      { text: "A body starts from rest with acceleration $2\\,\\text{m/s}^2$. Distance covered in 5 s is", options: ["10 m", "25 m", "50 m", "20 m"], correct_index: 1, explanation: "$s = \\tfrac12 a t^2 = \\tfrac12 \\cdot 2 \\cdot 25 = 25$ m." },
      { text: "The slope of a velocity–time graph gives", options: ["Displacement", "Acceleration", "Speed", "Distance"], correct_index: 1, explanation: "$a = dv/dt$, the slope of the v–t graph." },
      { text: "A ball is thrown up at $20\\,\\text{m/s}$. Maximum height ($g = 10\\,\\text{m/s}^2$) is", options: ["10 m", "20 m", "40 m", "30 m"], correct_index: 1, explanation: "$h = u^2/2g = 400/20 = 20$ m." },
      { text: "Area under an acceleration–time graph gives", options: ["Change in velocity", "Displacement", "Jerk", "Force"], correct_index: 0, explanation: "$\\int a\\,dt = \\Delta v$." },
    ],
  });
  const student = await createUser("student", "Demo Student", "student@quizdrop.app", "demo1234");
  await enroll(batch.id, student.id);
  const sample = [["Aarav Sharma", [1, 1, 1, 0], 512], ["Diya Iyer", [1, 1, 2, 0], 640], ["Kabir Rao", [0, 1, null, 1], 803]];
  for (const [name, picks, secs] of sample) {
    const u = await createUser("student", name, name.split(" ")[0].toLowerCase() + "@example.com", token());
    await enroll(batch.id, u.id);
    await q("INSERT INTO attempts (test_id,student_id,started_at) VALUES ($1,$2, now() - make_interval(secs => $3))", [test.id, u.id, secs]);
    const ans = {}; test.questions.forEach((qn, i) => { if (picks[i] !== null) ans[qn.id] = picks[i]; });
    await submitAttempt(test, u.id, ans);
  }
  console.log("Seeded demo: tutor@quizdrop.app / student@quizdrop.app, password demo1234");
}

module.exports = {
  init, createUser, checkLogin, userById, tutorByToken,
  createBatch, batchByCode, getBatch, tutorBatches, studentBatches, isEnrolled, enroll, enrollEmails,
  batchStudents, batchInvites, removeStudent, removeInvite,
  findOrCreateChapter, getChapter, chaptersWithTests, deleteChapter, createTest, getTest, updateTest, deleteTest,
  getAttempt, startAttempt, submitAttempt, groupReport, studentReport,
};
