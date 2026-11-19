# Phase 2 page map — Edugate and LMS

Step 1 of the Phase 2 plan ([ADR 0001](adr/0001-phase2-data-access.md)). Lists every
page the extension reads, what each tool needs from it, and where that sits on the
page. Test copies of these pages are in `extension/test/fixtures/`: the structure is
real, **every value is fake**.

## Pages and tools

| Tool | Page | Address (path) | Fixture |
| :--- | :--- | :--- | :--- |
| `get_gpa` | Academic record (السجل الأكاديمي) | `edugate…/ksu/ui/student/student_transcript/index/studentTranscriptAllIndex.faces` | `edugate/academic-record.html` |
| `get_grades` | Course results (نتائج المقررات) | `…/student/courses_results/index/forwardCoursesResults.faces` | `edugate/course-results.html` |
| `get_schedule` | Class schedule (الجدول الدراسي) | `…/student/student_schedule/index/forwardStudentSchedule.faces` | `edugate/schedule.html` |
| `get_absences` | Absences (الغياب) | `…/student/student_absences/index/courseAbsencesIndex.faces` | `edugate/absences.html` |
| `get_plan_progress` | Study plan, completed, remaining | `…/student/student_plan/index/forwardAllPlanIndex.faces`, `…/forwardTakenPlanIndex.faces`, `…/forwardRemainPlanIndex.faces` | `edugate/study-plan.html`, `edugate/plan-completed.html`, `edugate/plan-remaining.html` |
| `get_final_exams` | Final exam schedule | `…/student/final_exams/index/forwardFinalExams.faces` | `edugate/final-exams.html` |
| `get_courses` | LMS course list | `lms.ksu.edu.sa/ultra/course` | `lms/courses.html` |
| `get_assignments` | LMS calendar, **Due dates** tab | `lms.ksu.edu.sa/ultra/calendar` | `lms/due-dates.html` |
| `get_lms_grades` | LMS grades | `lms.ksu.edu.sa/ultra/grades` | `lms/grades.html` |

Edugate's host is `https://edugate.ksu.edu.sa`. `edugate/home.html` (the student
home page) is kept as a fixture for detecting "logged in or not"; no tool reads data
from it yet.

## Forward pages

Five of the Edugate pages above do not answer a GET with the page itself. The GET returns
a small stub (about 850 bytes), and the page only arrives when that stub posts its own
form back:

- **Tools that use them:** `get_final_exams`, `get_schedule`, `get_grades`, and both
  pages of `get_plan_progress` (taken and remaining plan).
- **Tools that do not:** `get_gpa` and `get_absences` answer the real page on GET, so no
  form is posted for them.

The stub has this shape:

```html
<body onload="loadService()">
  <form id="myForm" method="post" action="<same path>.faces" enctype="application/x-www-form-urlencoded">
    <input type="hidden" name="myForm" value="myForm" />
    <a id="myForm:serLinkFinalExams" href="#"
       onclick="mojarra.jsfcljs(document.getElementById('myForm'),{…},'');return false"></a>
    <input type="hidden" name="javax.faces.ViewState" value="…" />
  </form>
  <script>function loadService(){document.getElementById("myForm:serLinkFinalExams").onclick();}</script>
</body>
```

The link id differs on every page — `myForm:serLinkFinalExams`,
`myForm:takenPlanActionListener`, `myForm:remainPlanActionListener` — so it is **read
from the stub's own script**, never assumed from a prefix.

A page counts as a stub **only when all three of these hold**, so read-only holds by
construction and not by luck:

1. Its `<body onload>` calls `loadService()`; the name is `forward.loadFunction` in
   `extension/src/selectors.json`.
2. The link id comes from the body of `function loadService() { … }` and from nowhere else:
   that function's body is extracted first, then `forward.clickPattern` (also in
   `selectors.json`, accepting either quote) is applied to that body alone. A click anywhere
   else is ignored — the study plan page (`forwardAllPlanIndex`) really does carry
   `function callCommand() { … document.getElementById("myForm:checkCourseContentCmd").onclick(); }`,
   and that is a user command, not a forward.
3. It carries no table whose id starts with `myForm:` or `j_id`: a real data page is never a
   stub. The menu tables are `menuForm:menuTable…`, so they never count.

Anything else is a normal page, and nothing is posted.

The replay rule (content script, `readPage`):

1. Before posting, the form's action — resolved against the page that was just requested —
   must be `https://edugate.ksu.edu.sa` and the **same pathname**. Any other origin or path
   is `page_unreadable`, and nothing is sent.
2. The form is posted **once**: `application/x-www-form-urlencoded`, made of every hidden
   field of that form plus `<linkId>=<linkId>`, with `credentials: "same-origin"` and no other
   header.
3. **At most one hop.** A POST that comes back as a stub — tested by the same three
   conditions — is `page_unreadable`. The login check runs on the stub and on the page behind
   it, so an expired session is `not_logged_in` either way.
4. The view state and the other form values are never stored, logged or returned; they only
   travel back to the same Edugate URL they came from.
5. Reads are serialised — one page read at a time — so two tools cannot interleave, and the
   two study plan pages are read one after the other.

Hand-written fixtures: `edugate/forward-stub.html` (final exams) and
`edugate/forward-stub-plan.html` (study plan, relative action). They are not saved pages:
the saved fixtures have their scripts and hidden form fields scrubbed out.

## Where the data sits

### Academic record (`get_gpa`)

- Main table: `table#myForm:allTranscriptTable`; one block per term.
- Each term has a **course table** (headings: `رمز المقرر`, `اسم المقرر`, `الساعات`,
  `النقاط`, `التقدير`) and a **summary table** (headings: `الساعات المسجلة`,
  `الساعات المكتسبة`, `نجاح`, `النقاط`, `المعدل`).
- The summary table has two rows labelled **`فصلي`** (term) and **`تراكمي`**
  (cumulative). The cumulative GPA is the `المعدل` column of the `تراكمي` row in the
  **latest** term block.
- Tables use `class="responsiveDataTable"`, headings `th.HEADING`, rows `tr.ROW1` / `tr.ROW2`.
- Terms are labelled like `الفصل الأول 1448/1449` (Hijri years).

### Course results (`get_grades`)

- Table `myForm:courseTable`. Headings: `رمز المقرر`, `اسم المقرر`, `التقدير`.
- The term selector `myForm:selectSemester` lists every term as an `<option>`, and the
  page shows the **selected** one. It opens on the current term, where every `التقدير`
  cell is still empty; `ت` marks a grade that is not recorded. The selector is not
  submitted in this step, so only the shown term is read.

### Class schedule (`get_schedule`)

- Table `myForm:studScheduleTable`. Headings: `رمز المقرر`, `اسم المقرر`, `نوع المقرر`,
  `النشاط`, `الشعبة`, `الساعات`, `اليوم الوقت`, `نوع الشعبة`, `التفاصيل`. The `اليوم الوقت`
  heading carries many `&nbsp;` between the two words, so headings are compared after
  whitespace normalisation.
- `اليوم الوقت` holds a nested table (`…:dataTb2` and the like) with **one or more slots**;
  each slot has its own day codes and its own time range. A real row can read
  `4` `01:00 م - 01:50 م` and `2` `01:00 م - 02:50 م`, which is two classes entries.
- Day codes are numbers 1–5 on Edugate (1 = Sunday … 5 = Thursday); the contract allows
  1–7. Times are 12-hour with ص/م and are returned as 24-hour `HH:MM`.
- Activity rows (تمارين) leave `الساعات` and `نوع الشعبة` empty, and a slot may have no day
  and no time yet; that slot is skipped.
- The `التفاصيل` cell holds the lecturer (`المحاضر :`) and the room — **never read**.
- The term is the one the page's `myForm:selectSemester` shows.

### Absences (`get_absences`)

- The page carries **two tables**. `…:warningTable` has only three headings
  (`رمز المقرر`, `اسم المقرر` and an unlabelled percentage) and is **not** the source.
- The source is the summary table (`…:absenceSummationTable` on the real page), whose
  headings include `رمز المقرر`, `اسم المقرر`, `الشعبة`, `النشاط`, `المقر`, `مجموع الغياب`,
  `مجموع التأخير` and `نسبة الغياب`. A reader finds it by those headings, not by
  the id.
- `نسبة الغياب` is a percentage shown **without** the % sign on the real page
  (`11.86`); both forms are accepted and returned as a number.

### Study plan (`get_plan_progress`)

- Two pages: the completed courses (`…/student_plan/index/forwardTakenPlanIndex.faces`)
  and the remaining ones (`…/student_plan/index/forwardRemainPlanIndex.faces`). The
  reader fetches both in the same session.
- Each page is split per requirement group. `table#myForm:takenPlanTable` and
  `table#myForm:remainPlanTable` are the outer tables; each group inside them is its own
  `…:N:table` with a header table `…:N:headerArray` above it. `N` is the group's index in
  the order the page lists the groups, and it differs between the two pages, so groups are
  matched across the pages **by title**, never by `N`.
- The header holds the group title and `عدد الساعات (N)`: N is the hours that group
  requires, and it is the same on both pages (e.g. `متطلبات الجامعة - عدد الساعات (4)`).
- Group table headings: `رمز المقرر`, `اسم المقرر`, `الساعات`, `نوع المجموعة`, `المستوى`.
- The remaining page lists **every option** of each elective group (a six-hour group can
  list about twenty courses), so its rows are never summed. Per group the hours still
  needed are max(the hours of its `إجباري` rows on the remaining page, N − the completed
  hours of that group); `remaining_hours` is the sum over the groups. A student can exceed
  N with electives while a mandatory course is still missing.

### Final exams (`get_final_exams`)

- Headings: `رمز المقرر`, `اسم المقرر`, `الشعبة`, the location heading
  (`مكان الاختبار` with الوحدة/المبنى/الطابق/الجناح/القاعة inside it), `يوم الاختبار`,
  `وقت الاختبار`, `تاريخ الاختبار`.
- The location cell holds a nested `…:roomTable` whose inner row has the five parts;
  on a real record every part is `---` until a room is assigned.
- Some rows have no day and no date yet, only a time: both are `null` then. The date is
  the Hijri date as shown (`6-07-1448`) and is not converted.
- `وقت الاختبار` is 24-hour `HH:MM` on the real page.

### LMS (Blackboard Ultra)

Blackboard Ultra builds its pages in the browser from its own JSON API, so the rendered
HTML is a shell and a saved page holds nothing to read. The readers therefore call that
API **same-origin, in the student's own session**, instead of parsing HTML. Every request
is absolute on `https://lms.ksu.edu.sa` (`selectors.lms.origin`), the content script runs
in the top frame only, and nothing is read from a cookie or a token: the session cookie is
the browser's.

| Call | Endpoint | Gives |
| :--- | :--- | :--- |
| signed-in user | `/learn/api/v1/users/me` | `id` only, kept in memory |
| course list | `/learn/api/v1/users/{id}/memberships?expand=course&includeCount=true&limit=100` | `results[]`, each with `role`, `courseId` and `course` |
| due dates | `/learn/api/v1/calendars/dueDateCalendarItems` | `results[]`, each with `calendarId`, `title`, `start` |
| gradebook columns | `/learn/api/v1/courses/{id}/gradebook/columns` | `results[]`, each with `id`, `grading.type`, `visibility`, `gradesReleased` |
| gradebook grades | `/learn/api/v1/courses/{id}/gradebook/grades?userId={id}` | `results[]`, each with `userId`, `columnId`, `displayGrade.text` |

- Paging follows `paging.nextPage` up to five pages; a page past that is not read.
- A 401 or 403, or a login page instead of JSON, is `not_logged_in`. JSON of another shape
  is `page_unreadable`; no value is guessed.
- The membership list is filtered to the current term (`currentTerm`), and the sections of
  one subject are merged into one course: Ultra lists a lecture and each lab or tutorial as
  separate memberships (`SWE 999_1_1`, `SWE 999_2_1`). `code` comes from the course id by
  `courseCodePattern` and is `null` when the id does not match.
- Due dates are matched to those courses by the `calendarId` prefix (`_999_1_`), so an item
  of a merged section carries the merged course name. `start` is a UTC timestamp and is
  returned in Riyadh time (`+03:00`), soonest first.
- The gradebook's overall grade is the column with `grading.type` `Calculated`,
  `visibility` `Visible` and `gradesReleased` true. Grades are read one course at a time,
  with `?userId=` so only the student's own rows come back; the class average row has
  `userId` null and is skipped, and feedback is never read. A course whose overall column
  is missing, hidden or not released has `grade` `null`.
- The reader keeps `id` from `/users/me` in memory for the memberships and grades calls and
  returns nothing of it.

The saved HTML pages `extension/test/fixtures/lms/*.html` are kept for reference only: no
reader uses them, because a saved Ultra page carries none of its content. The JSON fixtures
in `extension/test/fixtures/lms-api/` are written by hand to the shapes above, with fake ids
(`_999_…`) and fake values, and are what the reader tests read.

Because the LMS answers only in a real session, `npm run build:lms-check` bundles a console
script (`dist/lms-check.js`) that runs the three LMS tools on the page and prints the tool
name, whether the read worked, the item count and true/false checks — never a title, a grade
or an id.

## Rules for readers

1. **Find columns by heading text**, not by position or by generated ids such as
   `j_id_id953` (they change between page loads). Stable ids like
   `myForm:allTranscriptTable` may be used as a first try.
2. Course codes look like `SWE 444` or Arabic `444 عال`; keep both forms.
3. Arabic and Western digits may both appear; normalise digits before parsing numbers.
4. If a heading or table is missing, return `page_unreadable` — never guess a value.
5. All selectors and heading texts go into `extension/src/selectors.json` (Step 3+),
   never scattered through the code.

## Fixtures: how they were made and how to update them

- Saved from the developer's own account with Chrome ("Webpage, HTML only") into a
  private folder **outside the repository**.
- `extension/test/tools/scrub_fixture.py` keeps the structure and the fixed labels and
  replaces every other text and attribute value with fake data of the same shape (fake
  course numbers start with 9, fake IDs with 9, years stay `14xx`/`20xx`). It removes
  scripts, styles, images, iframes, hidden form fields (including session state) and
  the "saved from" address.
- `extension/test/tools/verify_fixture.py` compares the original with the fixture and
  fails if any real value survives. It prints counts only, never the values. Pass your
  own name and student ID through the environment so they are checked but never
  written into the repository:

  ```bash
  python3 extension/test/tools/scrub_fixture.py <private/page.html> <fixture.html> <label>
  KSU_PRIVATE_TERMS="<name>,<student id>" python3 extension/test/tools/verify_fixture.py <private/page.html> <fixture.html>
  ```

- Not used and never committed: the Edugate and KSU single-sign-on login pages (they
  carry session fields), and the LMS Tools, Content and Messages pages.
