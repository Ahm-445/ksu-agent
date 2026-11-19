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

- Completed: `table#myForm:takenPlanTable`; remaining: `table#myForm:remainPlanTable`.
- Headings: `رمز المقرر`, `اسم المقرر`, `الساعات`, `نوع المجموعة`, `المستوى`.
- Courses are grouped by requirement group, each group headed with its hours in
  brackets, e.g. `… (3)`.

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

- The LMS builds its pages in the browser after load, so a reader must **wait for the
  content to appear** before reading.
- Course list: course cards, a term filter, and the `To Do` / `Overdue` / `Due Today` /
  `Due Soon` sections.
- Due dates: items grouped under day headings such as `Saturday - November 21, 2026`;
  each item shows a `Due:` label, title and course.
- Grades: one card per course under `Current Courses and Organizations`.

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
