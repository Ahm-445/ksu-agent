import type { Dictionary, Lang } from "@/lib/i18n";
import {
  categoryOfTool,
  type AbsencesData,
  type FinalExamsData,
  type GradesData,
  type GpaData,
  type ScheduleData,
  type ToolData,
  type ToolErrorKind,
} from "@/lib/extension";

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
    default:
      return null;
  }
}

export type ToolErrorKey =
  | "extensionMissing"
  | "consentMissing"
  | "notSignedIn"
  | "readFailed";

/** The message key for a failed tool run: what the student can do about it. */
export function toolErrorKey(error: ToolErrorKind): ToolErrorKey {
  switch (error) {
    case "not_installed":
      return "extensionMissing";
    case "no_consent":
      return "consentMissing";
    case "not_logged_in":
      return "notSignedIn";
    default:
      return "readFailed";
  }
}

/**
 * The message for a failed tool run. When the student has not allowed the category
 * the tool needs, the message names that category.
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

  return t.chat.errors[toolErrorKey(error)];
}
