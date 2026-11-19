const EXTENSION_ID = (process.env.NEXT_PUBLIC_EXTENSION_ID ?? "").trim();
const PING_TIMEOUT_MS = 1500;

export const CATEGORIES = [
  "grades",
  "schedule",
  "attendance",
  "plan",
  "lms",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** The consent category each tool needs, from the API contract's tool catalogue. */
export const TOOL_CATEGORIES: Record<string, Category> = {
  get_gpa: "grades",
  get_grades: "grades",
  get_lms_grades: "grades",
  get_schedule: "schedule",
  get_final_exams: "schedule",
  get_absences: "attendance",
  get_plan_progress: "plan",
  get_courses: "lms",
  get_assignments: "lms",
};

export function categoryOfTool(tool: string): Category | null {
  return Object.hasOwn(TOOL_CATEGORIES, tool) ? TOOL_CATEGORIES[tool] : null;
}

export type ExtensionStatus =
  | { installed: false }
  | { installed: true; version: string; categoriesAllowed: Category[] };

type SendMessage = (
  extensionId: string,
  message: unknown,
  callback: (response?: unknown) => void,
) => void;
type Runtime = {
  sendMessage: SendMessage;
  lastError?: { message?: string };
};

function readRuntime(): Runtime | null {
  if (typeof window === "undefined") {
    return null;
  }

  const chrome = (
    window as Window & { chrome?: { runtime?: Partial<Runtime> } }
  ).chrome;
  const runtime = chrome?.runtime;

  if (!runtime || typeof runtime.sendMessage !== "function") {
    return null;
  }

  return runtime as Runtime;
}

function isPong(value: unknown): value is {
  version: string;
  categories_allowed: string[];
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (record.kind !== "pong") {
    return false;
  }

  if (typeof record.version !== "string" || !record.version) {
    return false;
  }

  const categories = record.categories_allowed;

  if (
    !Array.isArray(categories) ||
    !categories.every((entry) => typeof entry === "string")
  ) {
    return false;
  }

  return true;
}

function ping(runtime: Runtime, extensionId: string): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      resolve(undefined);
    }, PING_TIMEOUT_MS);

    const finish = (value: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    try {
      runtime.sendMessage(extensionId, { kind: "ping" }, (response?: unknown) => {
        if (runtime.lastError) {
          finish(undefined);
          return;
        }

        finish(response);
      });
    } catch {
      finish(undefined);
    }
  });
}

export async function detectExtension(): Promise<ExtensionStatus> {
  try {
    const runtime = readRuntime();

    if (!runtime || !EXTENSION_ID) {
      return { installed: false };
    }

    const response = await ping(runtime, EXTENSION_ID);

    if (!isPong(response)) {
      return { installed: false };
    }
    return {
      installed: true,
      version: response.version,
      categoriesAllowed: response.categories_allowed.filter(isCategory),
    };
  } catch {
    return { installed: false };
  }
}

const TOOL_TIMEOUT_MS = 25_000;

export type GpaData = {
  cumulative_gpa: string;
  scale: string;
  earned_hours: number;
  registered_hours: number;
  as_of_term: string;
};

export type AbsenceCourse = {
  code: string;
  name: string;
  absence_percent: number;
  absences: number;
  lates: number;
};

export type AbsencesData = { courses: AbsenceCourse[] };

export type FinalExam = {
  code: string;
  name: string;
  day: string | null;
  date: string | null;
  time: string;
  location: string | null;
};

export type FinalExamsData = { exams: FinalExam[] };

export type ScheduleClass = {
  code: string;
  name: string;
  activity: string;
  section: string;
  days: number[];
  start: string;
  end: string;
};

export type ScheduleData = { term: string; classes: ScheduleClass[] };

export type GradeCourse = { code: string; name: string; grade: string | null };

export type GradesData = { term: string; courses: GradeCourse[] };

/** The fields of one tool result, from the API contract's tool catalogue. */
export type ToolData =
  | GpaData
  | AbsencesData
  | FinalExamsData
  | ScheduleData
  | GradesData;

export type ToolErrorKind =
  | "not_installed"
  | "no_consent"
  | "not_logged_in"
  | "page_unreadable"
  | "timeout";

export type ToolResult =
  | { ok: true; data: ToolData; readAt: string }
  | { ok: false; error: ToolErrorKind };

const TOOL_ERRORS: readonly ToolErrorKind[] = [
  "no_consent",
  "not_logged_in",
  "page_unreadable",
  "timeout",
];

function createRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp based id.
  }

  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGpaData(value: unknown): value is GpaData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.cumulative_gpa === "string" &&
    typeof value.scale === "string" &&
    typeof value.earned_hours === "number" &&
    typeof value.registered_hours === "number" &&
    typeof value.as_of_term === "string"
  );
}

function isAbsenceCourse(value: unknown): value is AbsenceCourse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.code === "string" &&
    typeof value.name === "string" &&
    typeof value.absence_percent === "number" &&
    typeof value.absences === "number" &&
    typeof value.lates === "number"
  );
}

function isAbsencesData(value: unknown): value is AbsencesData {
  return isRecord(value) && Array.isArray(value.courses) && value.courses.every(isAbsenceCourse);
}

function isFinalExam(value: unknown): value is FinalExam {
  if (!isRecord(value)) {
    return false;
  }

  const optionalText = (field: unknown) =>
    typeof field === "string" || field === null;

  return (
    typeof value.code === "string" &&
    typeof value.name === "string" &&
    optionalText(value.day) &&
    optionalText(value.date) &&
    typeof value.time === "string" &&
    optionalText(value.location)
  );
}

function isFinalExamsData(value: unknown): value is FinalExamsData {
  return isRecord(value) && Array.isArray(value.exams) && value.exams.every(isFinalExam);
}

function isScheduleClass(value: unknown): value is ScheduleClass {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.code === "string" &&
    typeof value.name === "string" &&
    typeof value.activity === "string" &&
    typeof value.section === "string" &&
    Array.isArray(value.days) &&
    value.days.every((day) => typeof day === "number") &&
    typeof value.start === "string" &&
    typeof value.end === "string"
  );
}

function isScheduleData(value: unknown): value is ScheduleData {
  return (
    isRecord(value) &&
    typeof value.term === "string" &&
    Array.isArray(value.classes) &&
    value.classes.every(isScheduleClass)
  );
}

function isGradeCourse(value: unknown): value is GradeCourse {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.name === "string" &&
    (typeof value.grade === "string" || value.grade === null)
  );
}

function isGradesData(value: unknown): value is GradesData {
  return (
    isRecord(value) &&
    typeof value.term === "string" &&
    Array.isArray(value.courses) &&
    value.courses.every(isGradeCourse)
  );
}

/** The guard for the fields each tool returns; a tool without one is unreadable. */
const TOOL_DATA: Readonly<Record<string, (value: unknown) => boolean>> = {
  get_gpa: isGpaData,
  get_absences: isAbsencesData,
  get_final_exams: isFinalExamsData,
  get_schedule: isScheduleData,
  get_grades: isGradesData,
};

function parseToolResult(value: unknown, tool: string): ToolResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const response = value;

  if (response.kind !== "tool_result") {
    return null;
  }

  if (response.ok === true) {
    const guard = TOOL_DATA[tool];

    if (
      typeof response.read_at !== "string" ||
      guard === undefined ||
      !guard(response.data)
    ) {
      return null;
    }

    return { ok: true, data: response.data as ToolData, readAt: response.read_at };
  }

  if (response.ok === false) {
    const error = response.error;

    // Anything the contract does not name is reported as an unreadable page.
    return {
      ok: false,
      error: TOOL_ERRORS.includes(error as ToolErrorKind)
        ? (error as ToolErrorKind)
        : "page_unreadable",
    };
  }

  return null;
}

type Ask =
  | { kind: "reply"; value: unknown }
  | { kind: "silent" }
  | { kind: "failed" };

function askExtension(
  runtime: Runtime,
  extensionId: string,
  message: unknown,
): Promise<Ask> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      resolve({ kind: "silent" });
    }, TOOL_TIMEOUT_MS);

    const finish = (outcome: Ask) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    try {
      runtime.sendMessage(extensionId, message, (response?: unknown) => {
        // lastError means no extension answered: it is not installed, or this page
        // is not one it listens to.
        if (runtime.lastError) {
          finish({ kind: "failed" });
          return;
        }

        finish({ kind: "reply", value: response });
      });
    } catch {
      finish({ kind: "failed" });
    }
  });
}

/**
 * Runs one tool in the student's browser. The values come back from the extension and
 * stay here: they are never sent to the KSU Agent server.
 */
export async function runTool(tool: string): Promise<ToolResult> {
  const runtime = readRuntime();

  if (!runtime || !EXTENSION_ID) {
    return { ok: false, error: "not_installed" };
  }

  const answer = await askExtension(runtime, EXTENSION_ID, {
    kind: "run_tool",
    request_id: createRequestId(),
    tool,
    args: {},
  });

  if (answer.kind === "failed") {
    return { ok: false, error: "not_installed" };
  }

  if (answer.kind === "silent") {
    return { ok: false, error: "timeout" };
  }

  return (
    parseToolResult(answer.value, tool) ?? { ok: false, error: "page_unreadable" }
  );
}
