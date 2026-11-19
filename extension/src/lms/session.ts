// The LMS JSON API, read in the student's own session.
//
// The LMS (Blackboard Ultra) builds its pages in the browser, so the HTML of a page is an
// empty shell; the page itself calls this JSON API, and the readers work from the same
// answers. Every request is a same-origin GET to lms.ksu.edu.sa, one at a time, and the whole
// tool stops at a deadline so the background's 20 second timeout is never the first to fire.
//
// The session is shared by the content script on lms.ksu.edu.sa and by the console check
// script, so both send exactly the same requests.

import selectors from "../selectors.json" with { type: "json" };
import {
  coursesData,
  readCourses,
  text,
  isRecord,
  type LmsCourse,
} from "../readers/lms/ultra.js";

export type LmsReply =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: "not_logged_in" | "page_unreadable" };

type Failure = { error: "not_logged_in" | "page_unreadable" };

type Fetched =
  | { kind: "json"; value: unknown }
  | ({ kind: "failed" } & Failure);

// The background gives a tool 20 seconds. This stops a little earlier, so a slow page still
// answers with an error code instead of being cut off with no reply.
const BUDGET_MS = 19_000;

// The membership list is followed through paging.nextPage, and never past these pages.
const MEMBERSHIP_PAGES = 5;

function failed(error: Failure["error"]): Failure {
  return { error };
}

function url(path: string): string {
  return new URL(path, selectors.lms.origin).href;
}

/** One same-origin GET for JSON, with the login check on the answer. */
async function getJson(path: string, deadline: number): Promise<Fetched> {
  const left = deadline - Date.now();

  if (left <= 0) {
    return { kind: "failed", ...failed("page_unreadable") };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), left);

  let response: Response;

  try {
    response = await fetch(url(path), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    return { kind: "failed", ...failed("page_unreadable") };
  } finally {
    clearTimeout(timer);
  }

  // Signed out, or a session the LMS refuses.
  if (response.status === 401 || response.status === 403) {
    return { kind: "failed", ...failed("not_logged_in") };
  }

  if (!response.ok) {
    return { kind: "failed", ...failed("page_unreadable") };
  }

  // An expired session is answered with the login page, which is still a 200.
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().includes("text/html")) {
    return { kind: "failed", ...failed("not_logged_in") };
  }

  const body = await response.text();

  try {
    return { kind: "json", value: JSON.parse(body) };
  } catch {
    return { kind: "failed", ...failed("page_unreadable") };
  }
}

/** The `results` array of a list answer, or null when the shape is not the documented one. */
function resultsOf(value: unknown): unknown[] | null {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return null;
  }

  return value.results;
}

/**
 * The next page of a list answer as a path on the LMS, or null at the end. A page link on any
 * other origin is not followed: the extension never requests another host.
 */
function nextPageOf(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.paging)) {
    return null;
  }

  const next = text(value.paging.nextPage);

  if (next === null) {
    return null;
  }

  try {
    const target = new URL(next, selectors.lms.origin);

    return target.origin === selectors.lms.origin
      ? `${target.pathname}${target.search}`
      : null;
  } catch {
    return null;
  }
}

/**
 * The signed-in student's id. It is kept in memory for the URLs and never leaves the
 * extension: no other field of the answer is read.
 */
async function signedInId(deadline: number): Promise<string | Failure> {
  const answer = await getJson(selectors.lms.me, deadline);

  if (answer.kind === "failed") {
    return answer;
  }

  const id = isRecord(answer.value) ? text(answer.value.id) : null;

  return id === null ? failed("page_unreadable") : id;
}

/** The student's memberships, through paging.nextPage and never past MEMBERSHIP_PAGES. */
async function memberships(
  userId: string,
  deadline: number,
): Promise<unknown[] | Failure> {
  const memberships: unknown[] = [];
  let path: string | null = `${selectors.lms.memberships.replace(
    "{id}",
    encodeURIComponent(userId),
  )}?expand=course&includeCount=true&limit=100`;

  for (let page = 0; page < MEMBERSHIP_PAGES && path !== null; page += 1) {
    const answer = await getJson(path, deadline);

    if (answer.kind === "failed") {
      return answer;
    }

    const results = resultsOf(answer.value);

    if (results === null) {
      return failed("page_unreadable");
    }

    memberships.push(...results);
    path = nextPageOf(answer.value);
  }

  return memberships;
}

/** The courses of the current term, or why they could not be read. */
async function currentCourses(deadline: number): Promise<LmsCourse[] | Failure> {
  const userId = await signedInId(deadline);

  if (typeof userId !== "string") {
    return userId;
  }

  const items = await memberships(userId, deadline);

  if (!Array.isArray(items)) {
    return items;
  }

  const courses = readCourses(items, new Date());

  return courses === null ? failed("page_unreadable") : courses;
}

/** Runs one LMS tool and answers with the fields the contract lists for it. */
export async function readLmsTool(tool: string): Promise<LmsReply> {
  const deadline = Date.now() + BUDGET_MS;

  if (tool === "get_courses") {
    const courses = await currentCourses(deadline);

    if (!Array.isArray(courses)) {
      return { ok: false, error: courses.error };
    }

    return { ok: true, data: { courses: coursesData(courses).courses } };
  }

  return { ok: false, error: "page_unreadable" };
}
