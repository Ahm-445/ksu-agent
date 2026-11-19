import type { Dictionary, Lang } from "@/lib/i18n";
import {
  categoryOfTool,
  type AbsencesData,
  type AssignmentsData,
  type CoursesData,
  type FinalExamsData,
  type GradesData,
  type GpaData,
  type LmsGradeItem,
  type LmsGradesData,
  type PlanProgressData,
  type RemainingCourse,
  type ScheduleData,
  type Source,
  type ToolData,
  type ToolErrorKind,
} from "@/lib/extension";
import { sourceOfTool } from "@/lib/extension";

// Factual answers about the student's own data are built here, in the browser, from
// fixed templates (ADR 0001). The values are filled in and never leave the device.

const GPA_TEMPLATES: Record<Lang, string> = {
  ar: "معدلك التراكمي {gpa} من {scale}، والساعات المكتسبة {earned} ساعة (حسب Edugate، {term}).",
  en: "Your cumulative GPA is {gpa} out of {scale}, with {earned} earned hours (from Edugate, {term}).",
};

const ABSENCES_TEMPLATES: Record<Lang, { intro: string; course: string; none: string }> = {
  ar: {
    intro: "الغياب حسب Edugate:",
    course: "{name} ({code}): نسبة الغياب {percent}% — {absences} غياب و{lates} تأخير",
    none: "لا توجد غيابات مسجلة في Edugate.",
  },
  en: {
    intro: "Your attendance from Edugate:",
    course: "{name} ({code}): {percent}% absence — {absences} absences and {lates} late arrivals",
    none: "No absences are recorded in Edugate.",
  },
};

const FINAL_EXAMS_TEMPLATES: Record<
  Lang,
  { intro: string; exam: string; none: string; noDay: string; noDate: string; noPlace: string }
> = {
  ar: {
    intro: "اختباراتك النهائية حسب Edugate:",
    exam: "{name} ({code}): {day} {date}، {time}، {location}",
    none: "لا توجد اختبارات نهائية مسجلة في Edugate.",
    noDay: "اليوم غير محدد بعد",
    noDate: "التاريخ غير محدد بعد",
    noPlace: "المكان غير محدد بعد",
  },
  en: {
    intro: "Your final exams from Edugate:",
    exam: "{name} ({code}): {day} {date}, {time}, {location}",
    none: "No final exams are recorded in Edugate.",
    noDay: "day not announced yet",
    noDate: "date not announced yet",
    noPlace: "location not announced yet",
  },
};

const GRADES_TEMPLATES: Record<
  Lang,
  { intro: string; course: string; none: string; notRecorded: string; unrecorded: string }
> = {
  ar: {
    intro: "درجاتك في {term} حسب Edugate:",
    course: "{name} ({code}): {grade}",
    none: "لا توجد مقررات مسجلة في {term}.",
    notRecorded: "لم تُرصد بعد",
    unrecorded: "درجات {term} لم تُرصد بعد في Edugate.",
  },
  en: {
    intro: "Your grades for {term} from Edugate:",
    course: "{name} ({code}): {grade}",
    none: "No courses are recorded for {term}.",
    notRecorded: "not recorded yet",
    unrecorded: "Grades for {term} are not recorded yet in Edugate.",
  },
};

const PLAN_TEMPLATES: Record<
  Lang,
  { summary: string; mandatory: string; elective: string; join: string }
> = {
  ar: {
    summary: "حسب Edugate، أكملت {completed} ساعة، وبقي لك {remaining} ساعة على التخرج.",
    mandatory: "المقررات الإجبارية المتبقية: {courses}.",
    elective: "{group}: {count} مقررات اختيارية متاحة.",
    join: "، ",
  },
  en: {
    summary:
      "From Edugate, you have completed {completed} hours and have {remaining} hours left to graduate.",
    mandatory: "Remaining mandatory courses: {courses}.",
    elective: "{group}: {count} elective options available.",
    join: ", ",
  },
};

// The type column's word for a course the student must take, from the plan page.
const MANDATORY_TYPES = ["إجباري", "اجباري"];

// A tool the website does not know still reads Edugate, the source of most tools.
const DEFAULT_SOURCE: Source = "edugate";

function isMandatory(course: RemainingCourse): boolean {
  return MANDATORY_TYPES.includes(course.type);
}

const SCHEDULE_TEMPLATES: Record<
  Lang,
  { intro: string; entry: string; none: string; days: string[] }
> = {
  ar: {
    intro: "جدولك الدراسي {term} حسب Edugate:",
    entry: "{name} ({code}) — {days}، {start}-{end} (شعبة {section})",
    none: "لا توجد محاضرات مسجلة في جدولك لهذا الفصل.",
    days: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  },
  en: {
    intro: "Your {term} schedule from Edugate:",
    entry: "{name} ({code}) — {days}, {start}-{end} (section {section})",
    none: "No classes are recorded in your schedule for this term.",
    days: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ],
  },
};

const COURSES_TEMPLATES: Record<
  Lang,
  { intro: string; course: string; courseWithSections: string; noCode: string; none: string }
> = {
  ar: {
    intro: "مقرراتك في LMS هذا الفصل:",
    course: "{name} ({code})",
    courseWithSections: "{name} ({code}) — شعبة {sections}",
    noCode: "بدون رمز",
    none: "لا توجد مقررات لك في LMS هذا الفصل.",
  },
  en: {
    intro: "Your LMS courses this term:",
    course: "{name} ({code})",
    courseWithSections: "{name} ({code}) — section {sections}",
    noCode: "no code",
    none: "No LMS courses are listed for this term.",
  },
};

const ASSIGNMENTS_TEMPLATES: Record<
  Lang,
  { intro: string; item: string; none: string }
> = {
  ar: {
    intro: "واجباتك القادمة حسب LMS:",
    item: "{title} — {course}، التسليم {due}",
    none: "لا توجد واجبات قادمة في LMS.",
  },
  en: {
    intro: "Your upcoming LMS assignments:",
    item: "{title} — {course}, due {due}",
    none: "No upcoming LMS assignments.",
  },
};

const LMS_GRADES_TEMPLATES: Record<
  Lang,
  {
    intro: string;
    course: string;
    item: string;
    score: string;
    scoreOnly: string;
    pending: string;
    missing: string;
    none: string;
    join: string;
  }
> = {
  ar: {
    intro: "درجاتك في البلاك بورد:",
    course: "{course}: {items}",
    item: "{title} {grade}",
    score: "{score} من {possible}",
    scoreOnly: "{score}",
    pending: "قيد التصحيح",
    missing: "لم تُرصد بعد",
    none: "لا توجد درجات لك في البلاك بورد هذا الفصل.",
    join: "، ",
  },
  en: {
    intro: "Your grades on the LMS:",
    course: "{course}: {items}",
    item: "{title} {grade}",
    score: "{score} out of {possible}",
    scoreOnly: "{score}",
    pending: "being graded",
    missing: "not recorded yet",
    none: "No grades are listed on the LMS this term.",
    join: ", ",
  },
};

/** A due date as `2026-11-21 23:59`, from the contract's `2026-11-21T23:59:00+03:00`. */
function dueDate(dueAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(dueAt);

  return match ? `${match[1]} ${match[2]}` : dueAt;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? values[key] : placeholder,
  );
}

function sentence(intro: string, items: string[], lang: Lang): string {
  return `${intro} ${items.join(lang === "ar" ? "؛ " : "; ")}.`;
}

/** The GPA answer in the student's language, from the values read on their device. */
export function gpaAnswer(data: GpaData, lang: Lang): string {
  return fill(GPA_TEMPLATES[lang], {
    gpa: data.cumulative_gpa,
    scale: data.scale,
    earned: String(data.earned_hours),
    term: data.as_of_term,
  });
}

/** The absences answer, one line per course, or the empty case. */
export function absencesAnswer(data: AbsencesData, lang: Lang): string {
  const templates = ABSENCES_TEMPLATES[lang];

  if (data.courses.length === 0) {
    return templates.none;
  }

  return sentence(
    templates.intro,
    data.courses.map((course) =>
      fill(templates.course, {
        name: course.name,
        code: course.code,
        percent: String(course.absence_percent),
        absences: String(course.absences),
        lates: String(course.lates),
      }),
    ),
    lang,
  );
}

/** The final exam schedule answer, with the not-announced-yet cases spelled out. */
export function finalExamsAnswer(data: FinalExamsData, lang: Lang): string {
  const templates = FINAL_EXAMS_TEMPLATES[lang];

  if (data.exams.length === 0) {
    return templates.none;
  }

  return sentence(
    templates.intro,
    data.exams.map((exam) =>
      fill(templates.exam, {
        name: exam.name,
        code: exam.code,
        day: exam.day ?? templates.noDay,
        date: exam.date ?? templates.noDate,
        time: exam.time,
        location: exam.location ?? templates.noPlace,
      }),
    ),
    lang,
  );
}

/** The grades answer: one line per course, and the all-unrecorded case. */
export function gradesAnswer(data: GradesData, lang: Lang): string {
  const templates = GRADES_TEMPLATES[lang];

  if (data.courses.length === 0) {
    return fill(templates.none, { term: data.term });
  }

  if (data.courses.every((course) => course.grade === null)) {
    return fill(templates.unrecorded, { term: data.term });
  }

  return sentence(
    fill(templates.intro, { term: data.term }),
    data.courses.map((course) =>
      fill(templates.course, {
        name: course.name,
        code: course.code,
        grade: course.grade ?? templates.notRecorded,
      }),
    ),
    lang,
  );
}

/**
 * The plan progress answer: the hours left, the mandatory courses by name, and one
 * count per group for the elective options. The remaining page lists every option of
 * an elective group, so the options themselves are never listed.
 */
export function planProgressAnswer(data: PlanProgressData, lang: Lang): string {
  const templates = PLAN_TEMPLATES[lang];
  const parts = [
    fill(templates.summary, {
      completed: String(data.completed_hours),
      remaining: String(data.remaining_hours),
    }),
  ];

  const mandatory = data.remaining_courses.filter(isMandatory);

  if (mandatory.length > 0) {
    parts.push(
      fill(templates.mandatory, {
        courses: mandatory.map((course) => course.name).join(templates.join),
      }),
    );
  }

  const electiveCounts = new Map<string, number>();

  for (const course of data.remaining_courses) {
    if (!isMandatory(course)) {
      electiveCounts.set(course.group, (electiveCounts.get(course.group) ?? 0) + 1);
    }
  }

  for (const [group, count] of electiveCounts) {
    parts.push(fill(templates.elective, { group, count: String(count) }));
  }

  return parts.join(" ");
}

/** The schedule answer, one line per class slot, or the empty case. */
export function scheduleAnswer(data: ScheduleData, lang: Lang): string {
  const templates = SCHEDULE_TEMPLATES[lang];

  if (data.classes.length === 0) {
    return templates.none;
  }

  const intro = fill(templates.intro, { term: data.term });

  return sentence(
    intro,
    data.classes.map((entry) =>
      fill(templates.entry, {
        name: entry.name,
        code: entry.code,
        days: entry.days
          .map((day) => templates.days[day - 1] ?? String(day))
          .join(lang === "ar" ? "، " : ", "),
        start: entry.start,
        end: entry.end,
        section: entry.section,
      }),
    ),
    lang,
  );
}

/** The LMS course list, one line per course, or the empty case. */
export function coursesAnswer(data: CoursesData, lang: Lang): string {
  const templates = COURSES_TEMPLATES[lang];

  if (data.courses.length === 0) {
    return templates.none;
  }

  return sentence(
    templates.intro,
    data.courses.map((course) =>
      course.sections.length === 0
        ? fill(templates.course, {
            name: course.name,
            code: course.code ?? templates.noCode,
          })
        : fill(templates.courseWithSections, {
            name: course.name,
            code: course.code ?? templates.noCode,
            sections: course.sections.join(lang === "ar" ? "، " : ", "),
          }),
    ),
    lang,
  );
}

/** The upcoming assignments, soonest first, or the empty case. */
export function assignmentsAnswer(data: AssignmentsData, lang: Lang): string {
  const templates = ASSIGNMENTS_TEMPLATES[lang];

  if (data.items.length === 0) {
    return templates.none;
  }

  return sentence(
    templates.intro,
    data.items.map((item) =>
      fill(templates.item, {
        title: item.title,
        course: item.course,
        due: dueDate(item.due_at),
      }),
    ),
    lang,
  );
}

/** One grade item as the student reads it: the score, the status, or not recorded yet. */
function lmsGradeText(
  item: LmsGradeItem,
  templates: (typeof LMS_GRADES_TEMPLATES)[Lang],
): string {
  if (item.status === "needs_grading") {
    return templates.pending;
  }

  if (item.score === null) {
    return templates.missing;
  }

  const score = String(item.score);

  return item.possible === null
    ? fill(templates.scoreOnly, { score })
    : fill(templates.score, { score, possible: String(item.possible) });
}

/**
 * The LMS grades, one line per course and one entry per graded column: the LMS has no
 * course total, so the items are what the student's grade is made of.
 */
export function lmsGradesAnswer(data: LmsGradesData, lang: Lang): string {
  const templates = LMS_GRADES_TEMPLATES[lang];

  if (data.courses.length === 0) {
    return templates.none;
  }

  const courses = data.courses.map((course) =>
    fill(templates.course, {
      course: course.code === null ? course.name : `${course.code} ${course.name}`,
      items: course.items
        .map((item) =>
          fill(templates.item, {
            title: item.title,
            grade: lmsGradeText(item, templates),
          }),
        )
        .join(templates.join),
    }),
  );

  return `${templates.intro} ${courses.join(lang === "ar" ? "؛ " : "; ")}.`;
}

/**
 * The answer for one tool result, in the student's language. Null when the tool has no
 * template here, so the caller can report an unreadable page instead.
 */
export function personalAnswer(
  tool: string,
  data: ToolData,
  lang: Lang,
): string | null {
  switch (tool) {
    case "get_gpa":
      return gpaAnswer(data as GpaData, lang);
    case "get_absences":
      return absencesAnswer(data as AbsencesData, lang);
    case "get_final_exams":
      return finalExamsAnswer(data as FinalExamsData, lang);
    case "get_schedule":
      return scheduleAnswer(data as ScheduleData, lang);
    case "get_grades":
      return gradesAnswer(data as GradesData, lang);
    case "get_plan_progress":
      return planProgressAnswer(data as PlanProgressData, lang);
    case "get_courses":
      return coursesAnswer(data as CoursesData, lang);
    case "get_assignments":
      return assignmentsAnswer(data as AssignmentsData, lang);
    case "get_lms_grades":
      return lmsGradesAnswer(data as LmsGradesData, lang);
    default:
      return null;
  }
}

export type ToolErrorKey =
  | "extensionMissingFor"
  | "consentMissing"
  | "notSignedInFor"
  | "readFailedFor";

/** The message key for a failed tool run: what the student can do about it. */
export function toolErrorKey(error: ToolErrorKind): ToolErrorKey {
  switch (error) {
    case "not_installed":
      return "extensionMissingFor";
    case "no_consent":
      return "consentMissing";
    case "not_logged_in":
      return "notSignedInFor";
    default:
      return "readFailedFor";
  }
}

/**
 * The message for a failed tool run. When the student has not allowed the category
 * the tool needs, the message names that category; otherwise it names the site the tool
 * reads, so a question about the LMS never sends the student to Edugate.
 */
export function toolErrorText(
  t: Dictionary,
  error: ToolErrorKind,
  tool: string,
): string {
  if (error === "no_consent") {
    const category = categoryOfTool(tool);

    return category
      ? t.chat.errors.consentMissingFor.replace(
          "{category}",
          t.chat.categories[category],
        )
      : t.chat.errors.consentMissing;
  }

  return t.chat.errors[toolErrorKey(error)].replace(
    "{source}",
    t.chat.toolSources[sourceOfTool(tool) ?? DEFAULT_SOURCE],
  );
}
