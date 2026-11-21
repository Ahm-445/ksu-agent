import type { ToolData, ToolErrorKind, ToolResult } from "@/lib/extension";
import type { Dictionary } from "@/lib/i18n";

// The reasoning step's card, built here and kept in memory (ADR 0001, rule 5): one card for
// the question, the exact values it would send, and a single approval for this one question.

export type ConsentTool = {
  tool: string;
  /** What this tool reads, in the student's words, never its name. */
  description: string;
  /** The field names the value carries, so the card can list them. */
  fields: string[];
  /** How many records the value holds: courses, exams, classes, items, or one. */
  items: number;
  /** Exactly what is sent for this tool, and nothing else. */
  payload: ToolData;
};

export type ConsentRequest = {
  question: string;
  /** The token `/chat` issued for this question, sent back with the values, once. */
  routeToken: string;
  tools: ConsentTool[];
  /** The body's `data`: one entry per tool, in the order the tools were read. */
  data: Record<string, ToolData>;
};

/** What the card itself decides: everything in the request but the token. */
export type ConsentContents = Omit<ConsentRequest, "routeToken">;

// The array field each tool's value lists, so the card can count the items without
// knowing the shape of every tool.
const ITEM_FIELDS: Record<string, string> = {
  get_absences: "courses",
  get_final_exams: "exams",
  get_schedule: "classes",
  get_grades: "courses",
  get_plan_progress: "remaining_courses",
  get_courses: "courses",
  get_assignments: "items",
  get_lms_grades: "courses",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** How many records a tool's value holds: the listed array's length, else one. */
export function itemCount(tool: string, payload: unknown): number {
  const field = ITEM_FIELDS[tool];

  if (!field || !isRecord(payload)) {
    return 1;
  }

  const list = payload[field];

  return Array.isArray(list) ? list.length : 1;
}

/** The description of a tool in the student's language, or its name when it has none. */
function describe(t: Dictionary, tool: string): string {
  const descriptions = t.chat.consent.tools as Record<string, string | undefined>;

  return descriptions[tool] ?? tool;
}

/** The card's contents: one entry per tool read, and the body that would be sent. */
export function buildConsent(
  question: string,
  results: { tool: string; data: ToolData }[],
  t: Dictionary,
): ConsentContents {
  return {
    question,
    tools: results.map(({ tool, data }) => ({
      tool,
      description: describe(t, tool),
      fields: isRecord(data) ? Object.keys(data) : [],
      items: itemCount(tool, data),
      payload: data,
    })),
    data: Object.fromEntries(
      results.map(({ tool, data }) => [tool, data]),
    ) as Record<string, ToolData>,
  };
}

export type ConsentOutcome =
  | { ok: true; request: ConsentRequest }
  | { ok: false; tool: string; error: ToolErrorKind };

/**
    read.push({ tool, data: result.data });
 * cannot be read stops the flow: there is nothing to approve, and the caller says which
 * site to open.
 */
export async function readForConsent(
  question: string,
  reply: { tools: string[]; routeToken: string },
  t: Dictionary,
  run: (tool: string) => Promise<ToolResult>,
): Promise<ConsentOutcome> {
  const read: { tool: string; data: ToolData }[] = [];

  for (const tool of reply.tools) {
    const result = await run(tool);

    if (!result.ok) {
      return { ok: false, tool, error: result.error };
    }

    read.push({ tool, data: result.data });
  }

  return {
    ok: true,
    request: {
      ...buildConsent(question, read, t),
      routeToken: reply.routeToken,
    },
  };
}
