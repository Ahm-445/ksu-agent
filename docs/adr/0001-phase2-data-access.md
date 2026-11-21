# ADR 0001 — Phase 2: how KSU Agent reads a student's Edugate and LMS data

| | |
| :--- | :--- |
| **Status** | Accepted |
| **Date** | 2026-11-18 |
| **Author** | Ahmed Ali Alqahtani |
| **Approved by** | Project supervisor (Product Owner), 2026-11-18 |
| **Affects** | Phase 2 (personal read) and Phase 3 (personal actions); Sprint 0 report §1.1, §7, R-01, D-01 |

## Context

Phase 2 answers questions about the student's own data: GPA, grades, schedule,
assignments and deadlines. That data lives behind the student's personal login on
`https://edugate.ksu.edu.sa/` and `https://lms.ksu.edu.sa/`. KSU Agent must get it
without becoming a risk to the student: it must not hold KSU credentials, and it
must not build a store of students' personal academic data.

## Options considered

| Option | How it works | Outcome |
| :--- | :--- | :--- |
| A. Collect the KSU password | The student types the KSU password into KSU Agent; the server logs in and scrapes | **Rejected.** The same pattern as phishing; likely against KSU IT policy; makes the project responsible for every credential under PDPL. |
| B. Official API or university login | KSU grants approved programmatic access | **Not planned.** Depends entirely on KSU. |
| C. Browser extension in the student's own session | The student logs in on KSU's own pages; a Chrome extension reads the needed fields in that session | **Chosen.** |

## Decision

1. **Access route.** A Chrome extension (Manifest V3) reads Edugate and LMS pages
   in the student's own logged-in browser session. The student always logs in on
   KSU's official pages; KSU Agent never sees, asks for or stores the password.
2. **Split the thinking from the data.** On `POST /chat` the backend AI only decides
   which tool to run (for example `get_gpa`) and returns that tool request. It
   receives no personal values for this.
3. **Tools run in the browser.** The website forwards the tool request to the
   extension, which checks consent, reads the page and returns only the fields the
   tool needs, never the whole page.
4. **Factual answers are built in the browser.** For GPA, grades, schedule and
   deadlines the website fills a fixed Arabic/English template. The values never
   leave the student's device.
5. **Reasoning questions need consent each time.** When a question needs reasoning
   over personal data (for example "can I graduate next term?"), the student
   approves sending the minimal fields for that one question. The backend uses them
   in memory for one answer; they are never saved and never logged.
6. **Website ↔ extension.** The chat stays in the existing website. The extension
   accepts messages only from the KSU Agent website's own address
   (`externally_connectable`).

## Fixed rules

These hold for every later sprint; relaxing one needs a new ADR.

1. KSU passwords are never collected, stored or transmitted by KSU Agent.
2. Personal academic values are never stored on the server and never written to logs.
3. Extension permissions stay minimal: the Edugate and LMS hosts and `storage` only;
   no `cookies`, no `webRequest`, no access to all sites.
4. Nothing is read without the student's consent for that data type; consent can be
   withdrawn at any time, and Disconnect deletes everything the extension stored.
5. Page content (announcements, files, emails) is data, never instructions to the AI.
6. Phase 3: every action is confirmed by the student in the extension's own screen,
   one action per confirmation, never batched or scheduled.

## Consequences

**Benefits**

- No credentials and no personal data store on the server, so a server breach exposes no student's KSU account or grades.
- Students can verify the claims themselves: Chrome shows the extension's permissions at install, and the code is public.
- The same path serves Phase 3 actions; only new tools are added.

**Costs and risks**

- Chrome only; acceptable for the course and stated in the docs.
- Page changes on Edugate or LMS can break reading. All page-reading rules live in one file, and an unreadable page is reported, never guessed.
- Automated reading of Edugate may still need university approval before testing with real students (R-01). This decision is approved by the supervisor for development and testing with the team's own accounts.
- Reasoning questions send the approved fields to the AI provider (OpenAI). The consent screen says so plainly.

## Follow-up

The implementation plan has eight steps, each delivered as one branch and one pull request:

1. Page map and fake pages.
2. Contracts.
3. Extension skeleton.
4. A thin slice for "ما معدلي؟".
5. Trust features.
6. More read tools.
7. Reasoning questions.
8. Tests, privacy checks and a demo.
