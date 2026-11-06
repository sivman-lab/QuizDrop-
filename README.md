# QuizDrop

Online JEE/NEET practice tests for coaching batches, created from Claude.

Most coaching practice still happens on printed question papers, while JEE and NEET are computer-based.
A tutor gives Claude a photo of a worksheet or their chapter notes. Claude writes the questions and sends them
to QuizDrop over MCP as a draft. The tutor reviews and publishes, and students in the batch take a timed test
with +4/−1 marking. Tutor and students see the same reports: marks and time taken.

**No AI inside.** No OpenAI, Anthropic or other AI keys anywhere. Timing, marking and reports are plain code.

## For reviewers

- **App:** `https://YOUR-APP.onrender.com`
- **Tutor login:** `tutor@quizdrop.app` / `demo1234`
- **Student login:** `student@quizdrop.app` / `demo1234`
- **MCP URL:** `https://YOUR-APP.onrender.com/mcp/demo-tutor-key`
- **Student join link for the demo batch:** `https://YOUR-APP.onrender.com/join/jee27a`

### Connect to Claude (1 minute)
1. In claude.ai open **Settings → Connectors → Add custom connector**.
2. Name: `QuizDrop`. URL: the MCP URL above. Click **Add** (no sign-in needed).
3. In a new chat, open **+ → Connectors** and make sure QuizDrop is on.
4. Upload a photo of a question paper and say: *"Turn this into a 15-minute test in the Laws of Motion chapter of my JEE batch."*
5. Log in as the tutor. The test is in the batch as a **Draft**. Edit any question, then click **Publish to batch**.
6. Log in as the student (another browser or a private window), open the batch, and take the test.
7. Both of you can open the **Batch report** and the individual report. Or ask Claude: *"How is JEE Batch A doing?"*

Free Claude plans allow one custom connector. The free host sleeps when idle, so open the app URL once first.

### Tools Claude gets
| Tool | What it does |
|---|---|
| `list_batches` | Batches with their chapters and tests |
| `create_batch` | New cohort, e.g. "NEET 2027 – Morning" |
| `create_test` | Saves Claude's questions into a batch and chapter (chapter created if new), as a draft by default |
| `get_test` / `update_test` | Read the tutor's edits, change questions, timing or marking, publish |
| `enroll_students` | Add students by email; new emails join automatically when they sign up |
| `get_batch_report` | Group report: average and top marks and time per test, plus leaderboard |
| `get_student_report` | Individual report: marks, correct/wrong/skipped and time per test |

## Deploy (Render, free)
1. Push this folder to a GitHub repo.
2. On render.com: **New → Blueprint**, pick the repo. `render.yaml` creates the web service and a Postgres database.
3. The demo tutor, student, batch and a sample test are created on first start.

Any Node 18+ host with Postgres works. Set `DATABASE_URL` and `SESSION_SECRET`.
Optional: `PUBLIC_URL`, `DEMO_MCP_TOKEN`. If the database refuses SSL, set `PGSSL=disable`.

## Run locally
```
npm install
DATABASE_URL=postgres://user:pass@localhost/quizdrop npm start
```
