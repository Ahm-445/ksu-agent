// The content script of the Edugate pages, bundled by esbuild into one classic script.
//
// It reads the pages a tool needs in the student's own session and answers with the
// fields that tool needs. It never sends the page, never sends anything else, and writes
// nothing to storage. Every page is fetched with a same-origin GET: no form is posted.

import { readAbsences, type AbsenceData } from "../readers/edugate/absences.js";
import {
  readFinalExams,
  type FinalExamData,
} from "../readers/edugate/finalExams.js";
import { isEdugateLoginPage, readGpa, type GpaData } from "../readers/edugate/gpa.js";
import { readGrades, type GradesData } from "../readers/edugate/grades.js";
import { readSchedule, type ScheduleData } from "../readers/edugate/schedule.js";

const EDUGATE = "https://edugate.ksu.edu.sa";

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
};

type ReadData =
  | GpaData
  | AbsenceData
  | FinalExamData
  | ScheduleData
  | GradesData;

type ReadReply =
  | { ok: true; data: ReadData }
  | { ok: false; error: "not_logged_in" | "page_unreadable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchPage(url: string): Promise<Document | "not_logged_in" | null> {
  let page: Response;

  try {
    page = await fetch(url, { credentials: "same-origin" });
  } catch {
    return "not_logged_in";
  }

  if (!page.ok) {
    return null;
  }

  const doc = new DOMParser().parseFromString(await page.text(), "text/html");

  // An expired session is redirected to the login form, which is still a 200.
  return isEdugateLoginPage(doc) ? "not_logged_in" : doc;
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
    const page = await fetchPage(url);

    if (page === "not_logged_in") {
      return { ok: false, error: "not_logged_in" };
    }

    if (page === null) {
      return { ok: false, error: "page_unreadable" };
    }

    pages.push(page);
  }

  const data = readFor(tool, pages);

  return data === null
    ? { ok: false, error: "page_unreadable" }
    : { ok: true, data };
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

    void readTool(tool).then(sendResponse);

    return true;
  },
);
