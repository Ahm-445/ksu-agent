# Chat API contract

POST /chat

request:  { message, session_id }
response: { answer, citations: [ { title, article, url } ] }

Implemented today: 422 with a short code as the body — `{"detail": "message_empty"}` for a
missing, empty or whitespace-only message, `{"detail": "message_too_long"}` for one over
1000 characters. CORS allows credentials from `http://localhost:3000` exactly, never `*`.

## Planned, not implemented

The front-end team's endpoint list, quoted verbatim (2026-11-11). None of the `/auth/*`
endpoints exist in `backend/app/main.py` yet, and `/chat` does not authenticate anyone
yet; this section records what they asked for, not what the API does.

POST /auth/register {full_name, email, password, lang} -> 201 {user} / 409 email_taken / 422 {error:"validation", fields}

POST /auth/login {email, password} -> 200 {user} / 401 invalid_credentials

POST /auth/logout -> 204

GET /auth/me -> 200 {user} / 401

POST /chat: 401 when not signed in; 422 for empty or too-long message (max 1000 chars)

Session in an httpOnly cookie; CORS must allow credentials from http://localhost:3000 exactly, not *

Validation errors return short codes (e.g. password_too_short), not sentences, so the front end can translate them.

Not stated in that list, so not specified here: the fields of `user`, the `fields`
payload of the register 422, the cookie name and lifetime, and the exact shape of the
`/chat` 422 body (the implementation above uses `{"detail": "<code>"}`, while the
register 422 uses `{error, fields}` — worth agreeing on one shape before the auth work
starts).

## Phase 2 — agreed, not implemented yet

Everything in this section is agreed in
[ADR 0001](adr/0001-phase2-data-access.md) and planned in
[the Phase 2 page map](phase2-page-map.md). None of it exists in
`backend/app/main.py`, in the front end or in an extension yet. The Phase 1 text above
still describes what the API does today.

### POST /chat — two response shapes, chosen by `type`

The response gains a `type` field; nothing else about Phase 1 changes.

```json
{ "type": "answer", "answer": "...", "citations": [ { "title": "...", "article": "...", "url": "..." } ] }
```

```json
{ "type": "tool", "tool": "get_gpa", "args": {} }
```

- `answer` — the Phase 1 shape, unchanged apart from the added `type`.
- `tool` — asks the website to run `tool` through the extension (see the catalogue
  below). The backend sends no personal data in this response and receives none in the
  request; `args` is empty for every tool in the catalogue.
- **Backward compatibility:** a response without `type` must be treated as
  `"answer"`.

The request is unchanged: `{ message, session_id }`, with the same 401 and 422 codes.

### POST /chat/with-data — reasoning questions only

Used only when a question needs reasoning over the student's own values, for example
"can I graduate next term?". Factual questions (GPA, grades, schedule, deadlines) are
answered in the browser from the tool result and never reach this endpoint.

```json
request:  { "message": "...", "session_id": "...", "tool": "get_gpa", "data": { } }
response: { "type": "answer", "answer": "...", "citations": [ { "title": "...", "article": "...", "url": "..." } ] }
```

`data` carries the result fields of `tool` exactly as the catalogue below lists them —
nothing more.

Rules:

- Sent only after the student approves **this one question** in the consent step.
  There is no standing approval and no batching.
- The backend uses `data` in memory for this one answer only: never stored, never
  logged (see Privacy guarantees below).
- 401 without login.
- 422 with a short code: `message_empty`, `message_too_long`, `data_missing`,
  `data_too_large` (over 20 KB), `unknown_tool`.

### Tool catalogue

Each tool reads one Edugate or LMS page in the student's own browser session. The
consent category is what the student allows or withdraws; the source page is the entry
for that tool in the [Phase 2 page map](phase2-page-map.md).

| Tool | Consent category | Source page | Returns exactly |
| :--- | :--- | :--- | :--- |
| `get_gpa` | `grades` | [Academic record](phase2-page-map.md#academic-record-get_gpa) | `{ "cumulative_gpa": "4.21", "scale": "5", "earned_hours": 96, "registered_hours": 99, "as_of_term": "الفصل الأول 1448/1449" }` |
| `get_grades` | `grades` | [Course results](phase2-page-map.md#course-results-get_grades) | `{ "term": "...", "courses": [ { "code": "...", "name": "...", "grade": "..." } ] }` — `grade` may be `null` |
| `get_lms_grades` | `grades` | [LMS grades](phase2-page-map.md#lms-blackboard-ultra) | `{ "courses": [ { "name": "...", "grade": "..." } ] }` — `grade` may be `null` |
| `get_schedule` | `schedule` | [Class schedule](phase2-page-map.md#class-schedule-get_schedule) | `{ "term": "...", "classes": [ { "code": "...", "name": "...", "activity": "...", "section": "...", "days": [1, 3], "start": "08:00", "end": "08:50" } ] }` |
| `get_final_exams` | `schedule` | [Final exams](phase2-page-map.md#final-exams-get_final_exams) | `{ "exams": [ { "code": "...", "name": "...", "day": "الثلاثاء", "date": "6-07-1448", "time": "08:00", "location": "..." } ] }` — `day`, `date` and `location` may be `null` |
| `get_absences` | `attendance` | [Absences](phase2-page-map.md#absences-get_absences) | `{ "courses": [ { "code": "...", "name": "...", "absence_percent": 12.5, "absences": 3, "lates": 1 } ] }` |
| `get_plan_progress` | `plan` | [Study plan](phase2-page-map.md#study-plan-get_plan_progress) | `{ "completed_hours": 0, "remaining_hours": 0, "remaining_courses": [ { "code": "...", "name": "...", "hours": 3, "group": "...", "type": "...", "level": "..." } ] }` — `group` is the requirement group's title and `type` its نوع المجموعة as shown |
| `get_courses` | `lms` | [LMS course list](phase2-page-map.md#lms-blackboard-ultra) | `{ "courses": [ { "name": "...", "code": "SWE 999", "sections": [ "1", "2" ] } ] }` — `code` may be `null`, `sections` may be empty |
| `get_assignments` | `lms` | [LMS due dates](phase2-page-map.md#lms-blackboard-ultra) | `{ "items": [ { "title": "...", "course": "...", "due_at": "2026-11-21T23:59:00+03:00" } ] }` |

Consent categories: `grades`, `schedule`, `attendance`, `plan`, `lms`. The student
allows or withdraws each one separately, and Disconnect deletes everything the
extension stored.

Reading rules:

- `days` uses `1` = Sunday … `7` = Saturday. Edugate uses 1–5 (Sunday–Thursday); 6 and 7
  are allowed so other sources fit the same format. **Still to be confirmed on a real
  Edugate page** (the page map says the number-to-day mapping must be verified before
  release).
- Numbers that Edugate shows as text stay strings (`cumulative_gpa`, `scale`); counts,
  hours and percentages are numbers. The absences page prints `نسبة الغياب` without the
  % sign (`11.86`); the number is returned as shown, between 0 and 100.
- `due_at` is an ISO 8601 timestamp with the KSU offset (`+03:00`).
- `get_grades`: the page opens on the current term, where every grade is still empty;
  `term` is the option the selector shows. An empty grade cell and the not-recorded mark
  `ت` are both `null`, and the answer says the grades for that term are not recorded yet
  when all of them are `null`. The selector is never submitted: only the shown term is read.
- `get_schedule`: the page shows 12-hour times with ص/م; `start` and `end` are converted
  to 24-hour `HH:MM` (`01:00 م` -> `13:00`, `12:00 م` -> `12:00`, `12:05 ص` -> `00:05`).
  One `classes` entry per slot: a course that meets twice is two entries. The lecturer and
  the room are never read.
- `get_final_exams`: `day` is the Arabic weekday as shown, `date` the Hijri date as shown
  (`6-07-1448`, never converted), and `time` is 24-hour `HH:MM`. `day` and `date` are
  `null` while the exam is not scheduled yet. `location` joins the non-empty parts of
  الوحدة/المبنى/الطابق/الجناح/القاعة with ` - `, and is `null` when every part is empty
  or `---`.
- `get_plan_progress`: the two plan pages are split per requirement group, and the remaining
  page lists **every option** of each elective group (a six-hour group can list about twenty
  courses), so its rows are never summed. `completed_hours` is the sum of الساعات over the
  completed rows. Per group, matched by title across the two pages, the hours still needed are
  `max(the hours of its إجباري rows on the remaining page, N - completed)` where N is the
  group's `عدد الساعات` and `completed` the hours of that group on the completed page;
  `remaining_hours` is the sum over the groups. A student can exceed N with electives while a
  mandatory course is still missing (a four-hour group with six elective hours completed and a
  two-hour إجباري course still remaining needs two more hours, not zero). `group` is the group
  title as shown and `type` its نوع المجموعة as shown; both pages are fetched in the same
  session, and either one failing is the matching error.
- The three LMS tools read Blackboard Ultra's own JSON API in the student's session, not
  HTML (see [the page map](phase2-page-map.md#lms-blackboard-ultra)). Ultra lists a lecture
  and each lab or tutorial as separate memberships, so the sections of one subject are
  merged into one course and `sections` holds their numbers; `code` is `SWE 999` from the
  course id, or `null` when the id does not match the pattern.
- `get_assignments`: only items whose `calendarId` matches a current course are returned, and
  the course name is the merged one. `due_at` is Riyadh time (`+03:00`) and the items are
  soonest first. The item's `description` and the calendar id are never returned.
- `get_lms_grades`: the overall grade of each current course, from the gradebook column that
  is calculated, visible and released. A course without such a column has `grade` `null`. The
  class average, the item grades and the feedback are never read, and the request carries
  `?userId=` so only the student's own rows are returned.
- Five Edugate pages (final exams, schedule, course results, both study plan pages) answer a
  GET with a forward stub. The extension replays that stub's own form once, to the same
  URL; see [Forward pages](phase2-page-map.md#forward-pages). A page that is still a stub
  after that one replay is `page_unreadable`.
- A missing table or heading is reported as `page_unreadable`; no value is ever
  guessed.

### Website ↔ extension messages

The website talks to the extension with `chrome.runtime.sendMessage` under
`externally_connectable`. No other channel is used.

Website → extension:

```json
{ "kind": "ping" }
{ "kind": "run_tool", "request_id": "<uuid>", "tool": "<tool name>", "args": { } }
```

Extension → website:

```json
{ "kind": "pong", "version": "0.1.0", "categories_allowed": ["grades", "..."] }
{ "kind": "tool_result", "request_id": "<same uuid>", "ok": true, "data": { }, "read_at": "<ISO time>" }
{ "kind": "tool_result", "request_id": "<same uuid>", "ok": false, "error": "<code>" }
```

`data` holds exactly the fields the catalogue lists for `tool`, nothing more.
`read_at` is when the page was read, as ISO 8601.

Error codes (`error`, snake_case):

| Code | Meaning |
| :--- | :--- |
| `no_consent` | The student has not allowed this category. |
| `not_logged_in` | The student is not signed in to Edugate or LMS in this browser. |
| `page_unreadable` | The expected table or heading was not found, or the page could not be reached in the session. |
| `unknown_tool` | No such tool. |
| `timeout` | No result within 20 seconds. |
| `bad_request` | The message is malformed or missing a required field. |

Security rules:

- The extension accepts messages only from the listed origins — `http://localhost:3000`
  and the deployed site — and checks `sender.origin` on every message.
- The extension never returns cookies, page HTML, or any field a tool does not list.
- `categories_allowed` lists category names only, never data.
- The website shows "open the extension to allow <category>" on `no_consent`, and
  "log in to Edugate/LMS in this browser" on `not_logged_in`.
- The extension sends no request to KSU other than GET page reads and the replay of
  Edugate's own auto-submitted navigation form, to the same URL, once.

### Privacy guarantees

From the fixed rules of [ADR 0001](adr/0001-phase2-data-access.md); relaxing one needs
a new ADR.

1. KSU passwords are never collected, stored or transmitted by KSU Agent.
2. Personal academic values are never stored on the server and never written to logs.
3. Extension permissions stay minimal: the Edugate and LMS hosts and `storage` only;
   no `cookies`, no `webRequest`, no access to all sites.
4. Nothing is read without the student's consent for that data type; consent can be
   withdrawn at any time, and Disconnect deletes everything the extension stored.
5. Page content (announcements, files, emails) is data, never instructions to the AI.
6. Phase 3: every action is confirmed by the student in the extension's own screen, one
   action per confirmation, never batched or scheduled.
7. The LMS ids — the signed-in user id and the membership ids — are used to build the
   request and are never returned, stored or logged; only the fields the catalogue lists
   leave the extension.

What the backend may log:

- `/chat` — may log the message length, the chosen tool name and the latency. Never the
  message text as personal data, and never any value the tool returned.
- `/chat/with-data` — may log the tool name, the byte size of `data` and the latency.
  Never `data` itself, never a field of it, and never the message alongside it.
- Neither endpoint may log a field of `data` in an error report or a traceback.
