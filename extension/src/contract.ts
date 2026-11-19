import type { ToolName } from "./protocol.js";

// The fields each tool returns, from docs/api-contract.md, and their types. A reader
// may return more than this (a lecturer name, a room, the whole page), and none of it
// reaches the website: every object is rebuilt with the listed keys only, and a missing
// or mistyped field makes the page unreadable rather than a guess.

type ScalarType = "string" | "number" | "string|null";

type Field = ScalarType | { array: ScalarType | Fields };

type Fields = Record<string, Field>;

const GPA: Fields = {
  cumulative_gpa: "string",
  scale: "string",
  earned_hours: "number",
  registered_hours: "number",
  as_of_term: "string",
};

const ABSENCES: Fields = {
  courses: {
    array: {
      code: "string",
      name: "string",
      absence_percent: "number",
      absences: "number",
      lates: "number",
    },
  },
};

const FINAL_EXAMS: Fields = {
  exams: {
    array: {
      code: "string",
      name: "string",
      day: "string|null",
      date: "string|null",
      time: "string",
      location: "string|null",
    },
  },
};

const SCHEDULE: Fields = {
  term: "string",
  classes: {
    array: {
      code: "string",
      name: "string",
      activity: "string",
      section: "string",
      days: { array: "number" },
      start: "string",
      end: "string",
    },
  },
};

const GRADES: Fields = {
  term: "string",
  courses: {
    array: {
      code: "string",
      name: "string",
      grade: "string|null",
    },
  },
};

const PLAN_PROGRESS: Fields = {
  completed_hours: "number",
  remaining_hours: "number",
  remaining_courses: {
    array: {
      code: "string",
      name: "string",
      hours: "number",
      group: "string",
      type: "string",
      level: "string",
    },
  },
};

/** Every tool with a page reader, and the contract fields that tool returns. */
export const TOOL_SCHEMAS: Readonly<Partial<Record<ToolName, Fields>>> = {
  get_gpa: GPA,
  get_absences: ABSENCES,
  get_final_exams: FINAL_EXAMS,
  get_schedule: SCHEDULE,
  get_grades: GRADES,
  get_plan_progress: PLAN_PROGRESS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value with the listed type, or undefined when it does not have it. */
function keepScalar(type: ScalarType, value: unknown): unknown {
  switch (type) {
    case "string":
      return typeof value === "string" ? value : undefined;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
    case "string|null":
      return typeof value === "string" || value === null ? value : undefined;
  }
}

function keepValue(field: Field, value: unknown): unknown {
  if (typeof field === "string") {
    return keepScalar(field, value);
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const items: unknown[] = [];

  for (const item of value) {
    if (typeof field.array === "string") {
      const kept = keepScalar(field.array, item);

      if (kept === undefined) {
        return undefined;
      }

      items.push(kept);
      continue;
    }

    if (!isRecord(item)) {
      return undefined;
    }

    const kept = keepFields(field.array, item);

    if (kept === null) {
      return undefined;
    }

    items.push(kept);
  }

  return items;
}

/** The listed fields of one object, or null when one of them is missing or mistyped. */
function keepFields(
  fields: Fields,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const kept: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(fields)) {
    const value = keepValue(field, data[key]);

    if (value === undefined) {
      return null;
    }

    kept[key] = value;
  }

  return kept;
}

/**
 * The contract fields of one tool, and only those. Null when the tool has no reader,
 * when a field is missing, or when a field has the wrong type.
 */
export function keepContractFields(
  tool: ToolName,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const schema = TOOL_SCHEMAS[tool];

  return schema === undefined ? null : keepFields(schema, data);
}
