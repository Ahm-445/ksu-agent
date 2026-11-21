export const CATEGORIES = [
  "grades",
  "schedule",
  "attendance",
  "plan",
  "lms",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const TOOL_CATEGORIES = {
  get_gpa: "grades",
  get_grades: "grades",
  get_lms_grades: "grades",
  get_schedule: "schedule",
  get_final_exams: "schedule",
  get_absences: "attendance",
  get_plan_progress: "plan",
  get_courses: "lms",
  get_assignments: "lms",
} as const satisfies Record<string, Category>;

export type ToolName = keyof typeof TOOL_CATEGORIES;

export const TOOL_NAMES = Object.keys(TOOL_CATEGORIES) as ToolName[];

export type ToolErrorCode =
  | "no_consent"
  | "not_logged_in"
  | "page_unreadable"
  | "unknown_tool"
  | "timeout"
  | "bad_request";

export type PingMessage = { kind: "ping" };

export type RunToolMessage = {
  kind: "run_tool";
  request_id: string;
  tool: ToolName;
  args: Record<string, unknown>;
};

export type WebsiteMessage = PingMessage | RunToolMessage;

export type PongResponse = {
  kind: "pong";
  version: string;
  categories_allowed: Category[];
};

export type ToolResultResponse =
  | {
      kind: "tool_result";
      request_id: string;
      ok: true;
      data: Record<string, unknown>;
      read_at: string;
    }
  | {
      kind: "tool_result";
      request_id?: string;
      ok: false;
      error: ToolErrorCode;
    };

export type ExtensionResponse = PongResponse | ToolResultResponse;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && Object.hasOwn(TOOL_CATEGORIES, value);
}

export type RunToolFields = {
  request_id: string;
  tool: string;
  args: Record<string, unknown>;
};

export function readRunTool(value: Record<string, unknown>): RunToolFields | null {
  const { request_id: requestId, tool, args } = value;

  if (typeof requestId !== "string" || requestId.length === 0) {
    return null;
  }

  if (typeof tool !== "string" || tool.length === 0) {
    return null;
  }

  if (args !== undefined && !isRecord(args)) {
    return null;
  }

  return { request_id: requestId, tool, args: args ?? {} };
}

export function isPongResponse(value: unknown): value is PongResponse {
  if (!isRecord(value)) {
    return false;
  }

  const { kind, version, categories_allowed: categories } = value;

  return (
    kind === "pong" &&
    typeof version === "string" &&
    Array.isArray(categories) &&
    categories.every(isCategory)
  );
}

export function isToolResultResponse(value: unknown): value is ToolResultResponse {
  if (!isRecord(value) || value.kind !== "tool_result") {
    return false;
  }

  if (typeof value.request_id !== "string") {
    return false;
  }

  if (value.ok === true) {
    return isRecord(value.data) && typeof value.read_at === "string";
  }

  if (value.ok === false) {
    return typeof value.error === "string" && value.error.length > 0;
  }

  return false;
}
