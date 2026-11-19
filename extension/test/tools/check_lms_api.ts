// Checks the LMS readers against the student's own LMS session, so a change in the API shows up
// before release. It prints no value: only the tool name, whether the read worked, the item count
// and true/false checks.
//
// The LMS builds its pages in the browser and reads its own JSON API, so this check runs in the
// browser console rather than in node:
//   npm run build:lms-check
// then open https://lms.ksu.edu.sa signed in, open the console and paste dist/lms-check.js.
//
// It sends the same requests the content script sends, in the same session, and is not part of
// npm test.

import { readLmsTool } from "../../src/lms/session.js";

// Every due date is in Riyadh time, which is +03:00 all year.
const RIYADH = /\+03:00$/;

// A course code is `SWE 999`; null is allowed for a course outside the pattern.
const CODE = /^[A-Z]{2,5} [0-9]{3}$/;

// An e-mail address must never reach the website.
const PERSONAL = /@/;

type Data = Record<string, unknown>;

function isRecord(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The objects of one array field, or null when the field is not an array of objects. */
function objects(data: Data, key: string): Data[] | null {
  const value = data[key];

  return Array.isArray(value) && value.every(isRecord) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function courses(data: Data): Record<string, boolean> {
  const list = objects(data, "courses") ?? [];
  const sections = list.flatMap((course) =>
    Array.isArray(course.sections) ? course.sections : [],
  );

  return {
    codes_or_null: list.every(
      (course) => course.code === null || CODE.test(text(course.code) ?? ""),
    ),
    sections_are_text: sections.every((section) => text(section) !== null),
    sections_unique: list.every(
      (course) =>
        Array.isArray(course.sections) &&
        new Set(course.sections).size === course.sections.length,
    ),
  };
}

function items(data: Data): Record<string, boolean> {
  const list = objects(data, "items") ?? [];
  const due = list.map((item) => text(item.due_at) ?? "");

  return {
    courses_named: list.every((item) => text(item.course) !== null),
    due_at_riyadh: due.every((at) => RIYADH.test(at)),
    soonest_first: due.every((at, index) => index === 0 || due[index - 1]! <= at),
  };
}

function grades(data: Data): Record<string, boolean> {
  const list = objects(data, "courses") ?? [];
  const items = list.flatMap((course) => (Array.isArray(course.items) ? course.items : []));

  return {
    courses_named: list.every(
      (course) => text(course.name) !== null && (course.code === null || text(course.code) !== null),
    ),
    courses_have_items: list.every(
      (course) => Array.isArray(course.items) && course.items.length > 0,
    ),
    scores_or_null: items.every(
      (item) =>
        isRecord(item) && (item.score === null || typeof item.score === "number"),
    ),
    possible_or_null: items.every(
      (item) =>
        isRecord(item) && (item.possible === null || typeof item.possible === "number"),
    ),
    statuses_known: items.every(
      (item) =>
        isRecord(item) &&
        ["graded", "needs_grading", "none"].includes(String(item.status)),
    ),
  };
}

/**
 * Reads one tool, prints its line, and answers whether it passed: the read worked, the answer
 * holds no personal data, and every check is true.
 */
async function run(
  tool: string,
  check: (data: Data) => Record<string, boolean>,
  count: (data: Data) => number,
): Promise<boolean> {
  const reply = await readLmsTool(tool);

  if (!reply.ok) {
    console.log(`${tool}: ${reply.error}`);
    return false;
  }

  const data = reply.data;
  const results: Record<string, boolean> = {
    ...check(data),
    no_personal_data: !PERSONAL.test(JSON.stringify(data)),
  };
  const passed = Object.values(results).every(Boolean);
  const line = Object.entries(results)
    .map(([name, ok]) => `${name}=${ok}`)
    .join(" ");

  console.log(`${tool}: ok, items ${count(data)}, ${line}`);

  return passed;
}

async function main(): Promise<void> {
  console.log(
    "LMS API check: paste on lms.ksu.edu.sa while signed in. It prints no value of yours.",
  );

  const results = [
    await run("get_courses", courses, (data) => (objects(data, "courses") ?? []).length),
    await run("get_assignments", items, (data) => (objects(data, "items") ?? []).length),
    await run("get_lms_grades", grades, (data) =>
      (objects(data, "courses") ?? []).reduce(
        (sum, course) => sum + (Array.isArray(course.items) ? course.items.length : 0),
        0,
      ),
    ),
  ];

  console.log(
    results.every(Boolean)
      ? "check passed"
      : "check failed: see the lines above",
  );
}

void main();
