const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const db = require("./db");

const questionShape = z.object({
  text: z.string().describe("Question text. Write math in LaTeX between $...$, e.g. $v = u + at$."),
  options: z.array(z.string()).min(2).max(6).describe("Answer choices, usually 4, without A/B/C/D prefixes. LaTeX allowed."),
  correct_index: z.number().int().min(0).describe("0-based index of the correct option."),
  explanation: z.string().optional().describe("Short worked solution shown to students after they submit."),
});

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

function buildServer(tutor, base) {
  const own = async (batchId) => {
    const b = await db.getBatch(batchId);
    return b && b.tutor_id === tutor.id ? b : null;
  };
  const ownTest = async (testId) => {
    const t = await db.getTest(testId);
    return t && t.tutor_id === tutor.id ? t : null;
  };
  const batchLinks = (b) => ({ batch_link: `${base}/batch/${b.id}`, join_link: `${base}/join/${b.join_code}`, report_link: `${base}/batch/${b.id}/report` });

  const server = new McpServer({ name: "quizdrop", version: "2.0.0" }, {
    instructions:
      "QuizDrop turns a coaching tutor's offline material (printed question papers, notes, photos of worksheets) into online " +
      "JEE/NEET-style tests. You (Claude) read the material and write the questions, options, answer keys and solutions. " +
      "QuizDrop stores them inside the tutor's batch and chapter, lets the tutor review and publish, times and marks students " +
      "(+4/−1 by default), and produces reports. Tests you create are drafts until the tutor publishes them, unless the tutor " +
      "asks you to publish. Call list_batches first to find the right batch. Always share the review_link after creating a test.",
  });

  server.registerTool("list_batches", {
    title: "List batches",
    description: "List the tutor's batches with their chapters and tests.",
    inputSchema: {},
  }, async () => {
    const batches = await db.tutorBatches(tutor.id);
    const out = [];
    for (const b of batches) {
      const chapters = await db.chaptersWithTests(b.id);
      out.push({
        batch_id: b.id, name: b.name, exam: b.exam, students: b.students, ...batchLinks(b),
        chapters: chapters.map((c) => ({ chapter: c.name, subject: c.subject,
          tests: c.tests.map((t) => ({ test_id: t.id, title: t.title, questions: t.qcount, published: t.published, attempts: t.attempts })) })),
      });
    }
    return ok(out);
  });

  server.registerTool("create_batch", {
    title: "Create a batch",
    description: "Create a new batch (cohort) of students, e.g. 'NEET 2027 – Morning batch'.",
    inputSchema: { name: z.string(), exam: z.string().optional().describe("JEE, NEET, or another exam name") },
  }, async ({ name, exam }) => {
    const b = await db.createBatch(tutor.id, name, exam);
    return ok({ batch_id: b.id, name: b.name, exam: b.exam, ...batchLinks(b) });
  });

  server.registerTool("create_test", {
    title: "Create a test",
    description:
      "Create a timed multiple-choice test inside a batch and chapter. The chapter is created if it doesn't exist. " +
      "Write every question, option, correct answer and solution yourself from the tutor's material.",
    inputSchema: {
      batch_id: z.number().int(),
      chapter: z.string().describe("Chapter name, e.g. 'Kinematics'"),
      subject: z.string().optional().describe("Physics, Chemistry, Maths, Biology…"),
      title: z.string(),
      duration_min: z.number().int().min(1).max(300).optional().describe("Default 30"),
      marks_correct: z.number().int().optional().describe("Default 4"),
      marks_wrong: z.number().int().optional().describe("Marks deducted per wrong answer. Default 1"),
      instructions: z.string().optional(),
      publish: z.boolean().optional().describe("Default false: the tutor reviews and publishes in QuizDrop."),
      questions: z.array(questionShape).min(1).max(200),
    },
  }, async (a) => {
    const b = await own(a.batch_id);
    if (!b) return fail(`Batch ${a.batch_id} is not in this tutor's account. Call list_batches.`);
    const ch = await db.findOrCreateChapter(b.id, a.chapter, a.subject);
    const t = await db.createTest(ch.id, { ...a, published: !!a.publish });
    return ok({ test_id: t.id, title: t.title, batch: b.name, chapter: ch.name, questions: t.questions.length,
      published: t.published, review_link: `${base}/test/${t.id}/edit`, ...batchLinks(b) });
  });

  server.registerTool("get_test", {
    title: "Get a test",
    description: "Read a test's current questions, including edits the tutor made in QuizDrop.",
    inputSchema: { test_id: z.number().int() },
  }, async ({ test_id }) => {
    const t = await ownTest(test_id);
    if (!t) return fail(`Test ${test_id} is not in this tutor's account.`);
    return ok({ test_id: t.id, title: t.title, batch: t.batch_name, chapter: t.chapter_name, duration_min: t.duration_min,
      marking: `+${t.marks_correct} / -${t.marks_wrong}`, published: t.published, questions: t.questions });
  });

  server.registerTool("update_test", {
    title: "Update a test",
    description: "Edit a test: replace all questions, append questions, change timing or marking, or publish/unpublish.",
    inputSchema: {
      test_id: z.number().int(), title: z.string().optional(), duration_min: z.number().int().optional(),
      instructions: z.string().optional(), publish: z.boolean().optional(),
      questions: z.array(questionShape).optional(), add_questions: z.array(questionShape).optional(),
    },
  }, async ({ test_id, publish, ...rest }) => {
    if (!(await ownTest(test_id))) return fail(`Test ${test_id} is not in this tutor's account.`);
    const t = await db.updateTest(test_id, { ...rest, published: publish });
    return ok({ test_id: t.id, questions: t.questions.length, published: t.published, review_link: `${base}/test/${t.id}/edit` });
  });

  server.registerTool("enroll_students", {
    title: "Enroll students",
    description: "Add students to a batch by email. Students who don't have an account yet join automatically when they sign up with that email.",
    inputSchema: { batch_id: z.number().int(), emails: z.array(z.string()).min(1).max(500) },
  }, async ({ batch_id, emails }) => {
    const b = await own(batch_id);
    if (!b) return fail(`Batch ${batch_id} is not in this tutor's account.`);
    return ok({ ...(await db.enrollEmails(b.id, emails)), ...batchLinks(b) });
  });

  server.registerTool("get_batch_report", {
    title: "Batch report",
    description: "Group report for a batch: each test's average and top marks and average time, plus a leaderboard of total marks and time.",
    inputSchema: { batch_id: z.number().int() },
  }, async ({ batch_id }) => {
    const b = await own(batch_id);
    if (!b) return fail(`Batch ${batch_id} is not in this tutor's account.`);
    return ok({ batch: b.name, ...(await db.groupReport(b.id)), report_link: `${base}/batch/${b.id}/report` });
  });

  server.registerTool("get_student_report", {
    title: "Student report",
    description: "Individual report for one student in a batch: marks, correct/wrong/skipped and time per test, compared with the batch average.",
    inputSchema: { batch_id: z.number().int(), student_email: z.string() },
  }, async ({ batch_id, student_email }) => {
    const b = await own(batch_id);
    if (!b) return fail(`Batch ${batch_id} is not in this tutor's account.`);
    const s = (await db.batchStudents(b.id)).find((x) => x.email === student_email.toLowerCase().trim());
    if (!s) return fail(`${student_email} is not enrolled in ${b.name}.`);
    return ok({ student: s.name, batch: b.name, ...(await db.studentReport(b.id, s.id)), report_link: `${base}/batch/${b.id}/student/${s.id}` });
  });

  return server;
}

async function handle(req, res, base) {
  const tutor = await db.tutorByToken(req.params.token);
  if (!tutor) return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown QuizDrop connector key." }, id: null });
  const server = buildServer(tutor, base);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

module.exports = { handle };
