// Reads the saved Edugate pages and checks what each reader returns, so a page change on
// Edugate shows up before release. It prints no value: only the tool name, whether the page
// was readable, the item count and true/false checks.
//
// Run it on pages saved from a real account with:
//   KSU_PAGES_DIR=<folder> npm run check:real
// <folder> holds the pages under edugate/, either under the name the browser saves them as
// (PAGE_FILES.real) or under the fixture name (PAGE_FILES.fixture), so it runs on a folder
// laid out like extension/test/fixtures too. Without KSU_PAGES_DIR it prints a skip message
// and exits 0. It is not part of npm test.
//
// Every tool is read and then filtered by the background's contract filter, so the checks see
// exactly what the website would receive.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

import { keepContractFields, TOOL_SCHEMAS } from "../../src/contract.js";
import type { ToolName } from "../../src/protocol.js";
import { readAbsences } from "../../src/readers/edugate/absences.js";
import { readFinalExams } from "../../src/readers/edugate/finalExams.js";
import { readGpa } from "../../src/readers/edugate/gpa.js";
import { readGrades } from "../../src/readers/edugate/grades.js";
import { readPlanProgress } from "../../src/readers/edugate/plan.js";
import { readSchedule } from "../../src/readers/edugate/schedule.js";

/** The pages this check needs, under <folder>/edugate/, and the two names they arrive under. */
const PAGE_FILES = {
  academicRecord: { real: "Academic_record.html", fixture: "academic-record.html" },
  absences: { real: "Absent.html", fixture: "absences.html" },
  finalExams: { real: "finalSchudle.html", fixture: "final-exams.html" },
  schedule: { real: "schedule.html", fixture: "schedule.html" },
  grades: { real: "gades.html", fixture: "course-results.html" },
  planCompleted: { real: "Completed_courses.html", fixture: "plan-completed.html" },
  planRemaining: { real: "Remaining_courses.html", fixture: "plan-remaining.html" },
} as const;

type PageName = keyof typeof PAGE_FILES;

// A field of the contract: a scalar type, or an array of one type or of fields.
type Schema = Record<string, string | { array: string | Schema }>;

// 24-hour HH:MM, which is what the readers return for every time.
const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

// A lecturer name or an e-mail address must never reach the website.
const PRIVATE_TEXT = /المحاضر|@t/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaOf(tool: string): Schema | undefined {
  return (TOOL_SCHEMAS as Record<string, Schema | undefined>)[tool];
}

/** True when every key the reader returned is one the contract lists. */
function keysAreInContract(schema: Schema, data: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(data)) {
    const field = schema[key];

    if (field === undefined) {
      return false;
    }

    if (typeof field === "string") {
      continue;
    }

    if (!Array.isArray(value)) {
      return false;
    }

    if (typeof field.array === "string") {
      continue;
    }

    for (const item of value) {
      if (!isRecord(item) || !keysAreInContract(field.array, item)) {
        return false;
      }
    }
  }

  return true;
}

function hasNoPrivateText(data: Record<string, unknown>): boolean {
  return !PRIVATE_TEXT.test(JSON.stringify(data));
}

function pageFrom(folder: string, name: PageName): Document | null {
  const files = PAGE_FILES[name];

  for (const file of [files.real, files.fixture]) {
    const path = join(folder, "edugate", file);

    if (existsSync(path)) {
      return new JSDOM(readFileSync(path, "utf8")).window.document as unknown as Document;
    }
  }

  return null;
}

/**
 * Runs one tool on the loaded pages, filters its result by the contract, and prints one line
 * with the tool name, ok or unreadable, the item count and each check as true or false.
 */
function runTool<T extends Record<string, unknown>>(
  tool: string,
  read: () => T | null,
  count: (data: T) => number,
  checks: (data: T) => Record<string, boolean>,
): boolean {
  const data = read();

  if (data === null) {
    console.log(`${tool}: unreadable`);
    return false;
  }

  const filtered = keepContractFields(tool as ToolName, data);
  const schema = schemaOf(tool);

  const results: Record<string, boolean> = {
    contract_keys: schema !== undefined && keysAreInContract(schema, data),
    ...checks(data),
    no_private_text: filtered !== null && hasNoPrivateText(filtered),
  };

  const line = Object.entries(results)
    .map(([name, ok]) => `${name}=${ok}`)
    .join(" ");

  console.log(
    `${tool}: ${filtered === null ? "unreadable" : "ok"}, items ${count(data)}, ${line}`,
  );

  return filtered !== null && Object.values(results).every(Boolean);
}

function main(): number {
  const folder = process.env.KSU_PAGES_DIR?.trim();

  if (folder === undefined || folder === "") {
    console.log("check:real skipped: set KSU_PAGES_DIR to the folder of saved pages.");
    return 0;
  }

  const pages = {} as Record<PageName, Document | null>;
  let missingPage = false;

  for (const name of Object.keys(PAGE_FILES) as PageName[]) {
    pages[name] = pageFrom(folder, name);

    if (pages[name] === null) {
      console.log(`page ${name}: missing`);
      missingPage = true;
    }
  }

  /** The reader on one page, or null when the page is missing. */
  const onPage =
    <T>(name: PageName, reader: (page: Document) => T | null) =>
    (): T | null => {
      const page = pages[name];

      return page === null ? null : reader(page);
    };

  const plan = (): ReturnType<typeof readPlanProgress> => {
    const completed = pages.planCompleted;
    const remaining = pages.planRemaining;

    return completed === null || remaining === null
      ? null
      : readPlanProgress(completed, remaining);
  };

  const results = [
    runTool("get_gpa", onPage("academicRecord", readGpa), () => 1, () => ({})),
    runTool(
      "get_absences",
      onPage("absences", readAbsences),
      (data) => data.courses.length,
      (data) => ({
        percents_0_100: data.courses.every(
          (course) => course.absence_percent >= 0 && course.absence_percent <= 100,
        ),
      }),
    ),
    runTool(
      "get_final_exams",
      onPage("finalExams", readFinalExams),
      (data) => data.exams.length,
      (data) => ({
        times_hhmm: data.exams.every((exam) => HHMM.test(exam.time)),
        day_null_with_date: data.exams.every(
          (exam) => (exam.day === null) === (exam.date === null),
        ),
      }),
    ),
    runTool(
      "get_schedule",
      onPage("schedule", readSchedule),
      (data) => data.classes.length,
      (data) => ({
        times_hhmm: data.classes.every(
          (entry) => HHMM.test(entry.start) && HHMM.test(entry.end),
        ),
        days_1_5: data.classes.every((entry) =>
          entry.days.every((day) => day >= 1 && day <= 5),
        ),
      }),
    ),
    runTool(
      "get_grades",
      onPage("grades", readGrades),
      (data) => data.courses.length,
      () => ({}),
    ),
    runTool(
      "get_plan_progress",
      plan,
      (data) => data.remaining_courses.length,
      (data) => ({
        remaining_within_rows:
          data.remaining_hours <=
          data.remaining_courses.reduce((total, course) => total + course.hours, 0),
      }),
    ),
  ];

  return missingPage || results.some((ok) => !ok) ? 1 : 0;
}

process.exitCode = main();
