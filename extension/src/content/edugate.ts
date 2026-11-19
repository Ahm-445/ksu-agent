// The content script of the Edugate pages, bundled by esbuild into one classic script.
//
// It reads the pages a tool needs in the student's own session and answers with the
// fields that tool needs. It never sends the page, never sends anything else, and writes
// nothing to storage.
//
// Every page is fetched with a same-origin GET. Five Edugate pages answer a GET with a
// small "forward" stub instead of the page: a form that posts itself back to the same
// address, and a script that clicks its link on load. For those the script replays that
// one click as a POST to the same URL — the form's own hidden fields and the link — and
// reads the page that comes back. At most one hop, and no other request is ever sent.

import selectors from "../selectors.json" with { type: "json" };
import { readAbsences, type AbsenceData } from "../readers/edugate/absences.js";
import {
  readFinalExams,
  type FinalExamData,
} from "../readers/edugate/finalExams.js";
import { isEdugateLoginPage, readGpa, type GpaData } from "../readers/edugate/gpa.js";
import { readGrades, type GradesData } from "../readers/edugate/grades.js";
import {
  readPlanProgress,
  type PlanProgressData,
} from "../readers/edugate/plan.js";
import { readSchedule, type ScheduleData } from "../readers/edugate/schedule.js";

const EDUGATE = "https://edugate.ksu.edu.sa";

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

// The stub's <body onload> runs a function of its own, and only that function's body is looked
// at for the click. The function name and the click pattern live in selectors.json.
const LOAD_FUNCTION = selectors.forward.loadFunction;
const LOAD_CALL = new RegExp(`(?:^|[^\\w$.])${LOAD_FUNCTION}\\s*\\(\\s*\\)`);
const LOAD_DECLARATION = new RegExp(`function\\s+${LOAD_FUNCTION}\\s*\\([^)]*\\)\\s*\\{`);
const CLICK = new RegExp(selectors.forward.clickPattern);

// A real page carries tables with these id prefixes; its menu tables are "menuForm:" and never
// match. A page with a data table is a real page, whatever scripts it also carries.
const DATA_TABLE_PREFIXES = ["myForm:", "j_id"];

// The pages each tool reads, from docs/phase2-page-map.md. The study plan is split
// over two pages: the completed courses and the remaining ones.
const TOOL_PAGES: Readonly<Record<string, readonly string[]>> = {
  get_gpa: [
    `${EDUGATE}/ksu/ui/student/student_transcript/index/studentTranscriptAllIndex.faces`,
  ],
  get_absences: [
    `${EDUGATE}/ksu/ui/student/student_absences/index/courseAbsencesIndex.faces`,
  ],
  get_final_exams: [
    `${EDUGATE}/ksu/ui/student/final_exams/index/forwardFinalExams.faces`,
  ],
  get_schedule: [
    `${EDUGATE}/ksu/ui/student/student_schedule/index/forwardStudentSchedule.faces`,
  ],
  get_grades: [
    `${EDUGATE}/ksu/ui/student/courses_results/index/forwardCoursesResults.faces`,
  ],
  get_plan_progress: [
    `${EDUGATE}/ksu/ui/student/student_plan/index/forwardTakenPlanIndex.faces`,
    `${EDUGATE}/ksu/ui/student/student_plan/index/forwardRemainPlanIndex.faces`,
  ],
};

type ReadData =
  | GpaData
  | AbsenceData
  | FinalExamData
  | GradesData
  | ScheduleData
  | PlanProgressData;

type ReadReply =
  | { ok: true; data: ReadData }
  | { ok: false; error: "not_logged_in" | "page_unreadable" };

type Fetched =
  | { kind: "page"; doc: Document }
  | { kind: "not_logged_in" }
  | { kind: "page_unreadable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePage(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** The body of `function <LOAD_FUNCTION>() { … }` in this source, or null when it is not there. */
function loadFunctionBody(source: string): string | null {
  const start = LOAD_DECLARATION.exec(source);

  if (start === null) {
    return null;
  }

  const from = start.index + start[0].length;
  let depth = 1;

  for (let i = from; i < source.length; i += 1) {
    const char = source.charAt(i);

    if (char === '"' || char === "'" || char === "`") {
      i = closingQuote(source, i);
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(from, i);
      }
    }
  }

  return null;
}

/** The index of the quote that closes the string opened at `open`. */
function closingQuote(source: string, open: number): number {
  const quote = source.charAt(open);

  for (let i = open + 1; i < source.length; i += 1) {
    const char = source.charAt(i);

    if (char === "\\") {
      i += 1;
    } else if (char === quote) {
      return i;
    }
  }

  return source.length;
}

/** True when the body's onload runs the stub's own function. */
function bodyLoadsFunction(doc: Document): boolean {
  return LOAD_CALL.test(doc.body?.getAttribute("onload") ?? "");
}

/** True when the page carries a data table, which a forward stub never does. */
function hasDataTable(doc: Document): boolean {
  for (const table of doc.querySelectorAll("table")) {
    const id = table.getAttribute("id") ?? "";

    if (DATA_TABLE_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      return true;
    }
  }

  return false;
}

/**
 * The id of the link a forward stub clicks, or null when the page is not a forward stub. A page
 * is a stub only when all three hold: its body's onload runs LOAD_FUNCTION, that function's own
 * body clicks the link, and the page carries no data table. Anything else — a real page with a
 * command script, a stub without the onload — is a normal page, and nothing is posted.
 */
function forwardLinkId(doc: Document): string | null {
  if (!bodyLoadsFunction(doc) || hasDataTable(doc)) {
    return null;
  }

  for (const script of doc.querySelectorAll("script")) {
    const body = loadFunctionBody(script.textContent ?? "");
    const id = body === null ? undefined : CLICK.exec(body)?.groups?.linkId;

    if (id !== undefined && id !== "") {
      return id;
    }
  }

  return null;
}

/** The form a forward stub posts back: the post form holding the link it clicks. */
function forwardForm(doc: Document, linkId: string): Element | null {
  const link = doc.getElementById(linkId);

  if (link === null || link.tagName.toLowerCase() !== "a") {
    return null;
  }

  const form = link.closest("form");

  if (form === null) {
    return null;
  }

  return (form.getAttribute("method") ?? "").toLowerCase() === "post" ? form : null;
}

/**
 * The address the stub's form posts to, resolved against the page that was requested —
 * or null when it is not that same Edugate page, in which case no request is made.
 */
function forwardTarget(form: Element, requestedUrl: string): URL | null {
  const action = (form.getAttribute("action") ?? "").trim();

  if (action === "") {
    return null;
  }

  let target: URL;
  let requested: URL;

  try {
    requested = new URL(requestedUrl);
    target = new URL(action, requested);
  } catch {
    return null;
  }

  return target.origin === EDUGATE && target.pathname === requested.pathname
    ? target
    : null;
}

/** The stub's form as a form body: its hidden fields, then the link it clicks. */
function formBody(form: Element, linkId: string): string {
  const body = new URLSearchParams();

  for (const input of form.querySelectorAll("input")) {
    const name = input.getAttribute("name");

    if ((input.getAttribute("type") ?? "").toLowerCase() !== "hidden") {
      continue;
    }

    if (name === null || name === "") {
      continue;
    }

    body.append(name, input.getAttribute("value") ?? "");
  }

  body.append(linkId, linkId);

  return body.toString();
}

/** One same-origin GET, with the login check on what came back. */
async function requestPage(url: string): Promise<Fetched> {
  let response: Response;

  try {
    response = await fetch(url, { credentials: "same-origin" });
  } catch {
    return { kind: "not_logged_in" };
  }

  if (!response.ok) {
    return { kind: "page_unreadable" };
  }

  const doc = parsePage(await response.text());

  // An expired session is redirected to the login form, which is still a 200.
  return isEdugateLoginPage(doc) ? { kind: "not_logged_in" } : { kind: "page", doc };
}

/** The one POST that replays a forward stub's own click. Never a second hop. */
async function postForward(target: URL, body: string): Promise<Fetched> {
  let response: Response;

  try {
    response = await fetch(target.href, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": FORM_CONTENT_TYPE },
      body,
    });
  } catch {
    return { kind: "not_logged_in" };
  }

  if (!response.ok) {
    return { kind: "page_unreadable" };
  }

  const doc = parsePage(await response.text());

  if (isEdugateLoginPage(doc)) {
    return { kind: "not_logged_in" };
  }

  // Still a stub: the page is not reachable by this route, so no second request.
  return forwardLinkId(doc) === null ? { kind: "page", doc } : { kind: "page_unreadable" };
}

/** One page of a tool: a GET, and the replay of a forward stub when the page is one. */
async function readPage(url: string): Promise<Fetched> {
  const first = await requestPage(url);

  if (first.kind !== "page") {
    return first;
  }

  const linkId = forwardLinkId(first.doc);

  if (linkId === null) {
    return first;
  }

  const form = forwardForm(first.doc, linkId);
  const target = form === null ? null : forwardTarget(form, url);

  // Not the same Edugate page: unreadable, and nothing is sent.
  if (form === null || target === null) {
    return { kind: "page_unreadable" };
  }

  return postForward(target, formBody(form, linkId));
}

function readFor(tool: string, pages: readonly Document[]): ReadData | null {
  const page = pages[0];

  if (page === undefined) {
    return null;
  }

  switch (tool) {
    case "get_gpa":
      return readGpa(page);
    case "get_absences":
      return readAbsences(page);
    case "get_final_exams":
      return readFinalExams(page);
    case "get_schedule":
      return readSchedule(page);
    case "get_grades":
      return readGrades(page);
    case "get_plan_progress": {
      const remaining = pages[1];

      return remaining === undefined ? null : readPlanProgress(page, remaining);
    }
    default:
      return null;
  }
}

async function readTool(tool: string): Promise<ReadReply> {
  const urls = TOOL_PAGES[tool];

  if (urls === undefined) {
    return { ok: false, error: "page_unreadable" };
  }

  const pages: Document[] = [];

  for (const url of urls) {
    const page = await readPage(url);

    if (page.kind === "not_logged_in") {
      return { ok: false, error: "not_logged_in" };
    }

    if (page.kind === "page_unreadable") {
      return { ok: false, error: "page_unreadable" };
    }

    pages.push(page.doc);
  }

  const data = readFor(tool, pages);

  return data === null
    ? { ok: false, error: "page_unreadable" }
    : { ok: true, data };
}

// One read at a time. Edugate's form state belongs to the session, so two tools reading
// at once must not interleave their requests: each read waits for the one before it.
let reads: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = reads.then(task, task);

  reads = run.catch(() => undefined);

  return run;
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (reply: unknown) => void) => {
    // Only this extension may ask; a page or another extension gets no answer.
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (!isRecord(message) || message.kind !== "read") {
      return false;
    }

    const tool = typeof message.tool === "string" ? message.tool : "";

    void oneAtATime(() => readTool(tool)).then(sendResponse);

    return true;
  },
);
