import type { ActivityEntry } from "./storage.js";
import type { Category, ToolErrorCode, ToolName } from "./protocol.js";

export type Bilingual = { ar: string; en: string };

export const CATEGORY_LABELS: Record<Category, Bilingual> = {
  grades: { ar: "الدرجات", en: "grades" },
  schedule: { ar: "الجدول الدراسي", en: "class schedule" },
  attendance: { ar: "الغياب والتأخير", en: "absence and lateness" },
  plan: { ar: "الخطة الدراسية", en: "study plan" },
  lms: { ar: "مقررات LMS", en: "LMS courses" },
};

export const CATEGORY_DESCRIPTIONS: Record<Category, Bilingual> = {
  grades: {
    ar: "المعدل والدرجات من Edugate وLMS",
    en: "GPA and grades from Edugate and LMS",
  },
  schedule: {
    ar: "الجدول الدراسي وجدول الاختبارات النهائية",
    en: "class schedule and final exams",
  },
  attendance: {
    ar: "نسب الغياب والتأخير",
    en: "absence and lateness rates",
  },
  plan: {
    ar: "الخطة الدراسية والمقررات المتبقية",
    en: "study plan and remaining courses",
  },
  lms: {
    ar: "المقررات والواجبات ومواعيد التسليم في LMS",
    en: "LMS courses, assignments and due dates",
  },
};

export const TOOL_LABELS: Record<ToolName, Bilingual> = {
  get_gpa: { ar: "قراءة المعدل", en: "Read GPA" },
  get_grades: { ar: "قراءة الدرجات", en: "Read grades" },
  get_lms_grades: { ar: "قراءة درجات LMS", en: "Read LMS grades" },
  get_schedule: { ar: "قراءة الجدول", en: "Read schedule" },
  get_final_exams: { ar: "قراءة جدول الاختبارات", en: "Read final exams" },
  get_absences: { ar: "قراءة الغياب", en: "Read absences" },
  get_plan_progress: { ar: "قراءة الخطة الدراسية", en: "Read plan progress" },
  get_courses: { ar: "قراءة مقررات LMS", en: "Read LMS courses" },
  get_assignments: { ar: "قراءة الواجبات", en: "Read assignments" },
};

const OUTCOME_LABELS: Record<"ok" | ToolErrorCode, Bilingual> = {
  ok: { ar: "نجحت", en: "ok" },
  no_consent: { ar: "لم يُسمح", en: "not allowed" },
  not_logged_in: { ar: "لم يُسجّل الدخول", en: "not logged in" },
  page_unreadable: { ar: "تعذرت قراءة الصفحة", en: "page unreadable" },
  unknown_tool: { ar: "أداة غير معروفة", en: "unknown tool" },
  timeout: { ar: "انتهت المدة", en: "timed out" },
  bad_request: { ar: "طلب غير صالح", en: "bad request" },
};

function timeOf(at: string): string {
  const date = new Date(at);

  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** One history entry as the two text lines the popup shows, Arabic and English. */
export function activityLines(entry: ActivityEntry): Bilingual {
  const time = timeOf(entry.at);
  const category = CATEGORY_LABELS[entry.category];

  if (entry.kind === "blocked") {
    return {
      ar: `رُفضت: لم يُسمح ب${category.ar} — ${time}`,
      en: `Blocked: ${category.en} not allowed — ${time}`,
    };
  }

  if (entry.kind === "consent") {
    return entry.allowed === true
      ? {
          ar: `السماح ب${category.ar} — ${time}`,
          en: `Allowed ${category.en} — ${time}`,
        }
      : {
          ar: `إلغاء السماح ب${category.ar} — ${time}`,
          en: `Withdrew ${category.en} — ${time}`,
        };
  }

  const tool = entry.tool ? TOOL_LABELS[entry.tool] : category;
  const outcome = entry.outcome
    ? OUTCOME_LABELS[entry.outcome]
    : OUTCOME_LABELS.bad_request;

  return {
    ar: `${tool.ar} — ${outcome.ar} — ${time}`,
    en: `${tool.en} — ${outcome.en} — ${time}`,
  };
}
