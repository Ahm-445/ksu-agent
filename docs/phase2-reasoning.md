# Phase 2 reasoning step — values compared, with consent

Step 7 of the Phase 2 plan ([ADR 0001](adr/0001-phase2-data-access.md)). A factual
question is one page and is answered in the browser. A *reasoning* question compares
values — "can I graduate next term?" — so it needs one to three pages and the student's
approval to send them. This is the flow, the questions the router recognises, and the
card's wording. The API shapes are in [the contract](api-contract.md#post-chatwith-data--reasoning-questions-only).

## The flow, end to end

1. The student asks a question in the chat.
2. `POST /chat` routes it by rule, not by the model (`backend/app/tools.py`). A reasoning
   question answers `{ "type": "reason", "tools": [...] }`: one to three tool names, no
   values, no args. The reasoning patterns are checked **before** the factual ones, so
   "كم أحتاج أجيب عشان يصير معدلي 4.5؟" is a target and not the GPA.
3. The website runs every tool in the reply through the extension, in the order the reply
   named them, in the student's own session. A page that cannot be read stops the flow:
   the chat shows the existing "open Edugate / the LMS" message for that tool and no card
   is shown, because there is nothing to approve.
4. The website shows **one** card for the question, not one per tool: what each tool
   reads, the field names it would send, how many items, and the exact JSON behind a
   toggle. The values live in the component only — never `localStorage`, never
   `sessionStorage`, never the URL, never the message list.
5. The student decides for **this one question**:
   - **Approve** — `POST /chat/with-data` with `data` holding one entry per tool the reply
     named. The backend validates every value against the contract's fields, adds it to the
     prompt in a user block between `<student_data>` tags, and answers from the same
     pipeline, citing the regulation. The card is gone before the request starts, so it
     cannot be approved twice.
   - **Cancel** — nothing is sent. The chat answers from the templates that already exist
     for each tool (`frontend/src/lib/personalAnswers.ts`), and the answer carries
     «لم يُرسل شيء إلى الخادم».
6. There is no standing approval and no batching: the next reasoning question gets a new
   card.

What the backend may write down for a reasoning answer: the tool names, the byte size of
the data and the latency. Never the question, never a value, never the text of an error.

## Questions the router recognises

`detect_reasoning_tools` in `backend/app/tools.py`, matched on normalised text (marks
removed, `أ إ آ ٱ` → `ا`, `ى` → `ي`, Arabic-Indic digits → Western, lower-cased).

| Question (AR) | Question (EN) | Tools, in order |
| :--- | :--- | :--- |
| هل أقدر أتخرج الفصل القادم؟ · متى أتخرج؟ | Can I graduate next term? · When will I graduate? | `get_plan_progress`, `get_gpa` |
| هل أنا قريب من الحرمان؟ · كم غياب باقي لي قبل الحرمان في 434 | Am I close to being barred? · How many absences do I have left before being barred in 434? | `get_absences` |
| كم أحتاج أجيب عشان يصير معدلي 4.5؟ · هل أنا تحت الإنذار؟ | What do I need to raise my GPA to 4.5? · Am I on academic warning? | `get_gpa` |
| هل عندي تعارض في الاختبارات النهائية؟ | Do I have any final exam conflicts? | `get_final_exams` |
| كيف أوزع وقتي هالأسبوع؟ | plan my week | `get_assignments`, `get_schedule` |

These stay ordinary answers, because they ask about the rule and not about the student:
«ما شروط الحرمان؟», «ما شروط التخرج؟», «كيف يُحسب المعدل التراكمي؟», «كم المعدل المطلوب
عشان أتخرج؟», «متى الاختبار النهائي؟».

Two questions about what is due stay **factual**, so they read one page and are answered in
the browser with no consent step: «متى الواجب القادم في مادة 444» and «هل عندي اختبار بكرة»
(`get_assignments`).

## The card's wording

One card, titled with a question, not a warning. Field names are shown exactly as they are
sent, in Latin letters; the descriptions are in the student's language.

| Element | العربية | English |
| :--- | :--- | :--- |
| Title | هل أرسل هذه البيانات لهذا السؤال؟ | Send this data for this question? |
| Intro | هذا السؤال يحتاج مقارنة قيمك، وهي تُقرأ في متصفحك. إن وافقت، تُرسل مرة واحدة لخادم KSU Agent لهذا السؤال فقط، ولا تُحفظ ولا تُسجَّل. | This question needs your values compared, and they are read in your browser. If you approve, they are sent once to the KSU Agent server for this question only, and are never stored or logged. |
| Fields | الحقول: {fields} | Fields: {fields} |
| Items | عدد العناصر: {count} | Items: {count} |
| Show JSON | اعرض البيانات التي ستُرسل | Show the data that will be sent |
| Hide JSON | أخفِ البيانات | Hide the data |
| Approve | أوافق، أرسل لهذا السؤال | Approve, send for this question |
| Cancel | لا ترسل | Don't send |
| After cancel | لم يُرسل شيء إلى الخادم. | Nothing was sent to the server. |

Per-tool descriptions on the card:

| Tool | العربية | English |
| :--- | :--- | :--- |
| `get_gpa` | معدلك التراكمي والساعات المكتسبة من Edugate | Your cumulative GPA and earned hours from Edugate |
| `get_grades` | درجات المواد لهذا الفصل من Edugate | Your course grades for this term from Edugate |
| `get_schedule` | جدولك الدراسي من Edugate | Your class schedule from Edugate |
| `get_final_exams` | مواعيد اختباراتك النهائية من Edugate | Your final exam dates from Edugate |
| `get_absences` | نسب الغياب لكل مقرر من Edugate | Your absence percentages per course from Edugate |
| `get_plan_progress` | الساعات المكتملة والمقررات المتبقية من Edugate | Your completed hours and remaining courses from Edugate |
| `get_courses` | قائمة مقرراتك من البلاك بورد | Your course list from the LMS |
| `get_assignments` | واجباتك القادمة ومواعيد تسليمها من البلاك بورد | Your upcoming assignments and their due dates from the LMS |
| `get_lms_grades` | درجاتك في البلاك بورد | Your grades on the LMS |

## Where it lives

| Part | File |
| :--- | :--- |
| Which tools a question needs | `backend/app/tools.py` (`detect_reasoning_tools`, `detect_personal_request`) |
| `POST /chat` `reason` reply | `backend/app/main.py` (`ReasonResponse`) |
| The data's shape, per tool | `backend/app/with_data.py` (models built from `TOOL_SCHEMAS`, `extra="forbid"`) |
| The prompt's data rules | `backend/scripts/answer.py` (`STUDENT_DATA_RULES`, `STUDENT_DATA_TEMPLATE`) |
| The reason reply in the client | `frontend/src/lib/api/chat.ts` (`parseChatResponse`, `sendWithData`) |
| The card's contents | `frontend/src/lib/consent.ts` (`buildConsent`, `readForConsent`) |
| The card | `frontend/src/components/chat/ConsentCard.tsx` |
| The flow | `frontend/src/components/chat/ChatScreen.tsx` (`approveConsent`, `cancelConsent`) |
| The cancel answer | `frontend/src/lib/personalAnswers.ts` (`consentAnswers`) |
