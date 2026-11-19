// The content script of the Edugate pages, bundled by esbuild into one classic script.
//
// It reads the transcript page in the student's own session and answers with the fields
// a tool needs. It never sends the page, never sends anything else, and writes nothing
// to storage.

import { isEdugateLoginPage, readGpa, type GpaData } from "../readers/edugate/gpa.js";

const TRANSCRIPT_URL =
  "https://edugate.ksu.edu.sa/ksu/ui/student/student_transcript/index/studentTranscriptAllIndex.faces";

type ReadReply =
  | { ok: true; data: GpaData }
  | { ok: false; error: "not_logged_in" | "page_unreadable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readTranscript(): Promise<ReadReply> {
  let page: Response;

  try {
    page = await fetch(TRANSCRIPT_URL, { credentials: "same-origin" });
  } catch {
    return { ok: false, error: "not_logged_in" };
  }

  if (!page.ok) {
    return { ok: false, error: "page_unreadable" };
  }

  const doc = new DOMParser().parseFromString(await page.text(), "text/html");

  // An expired session is redirected to the login form, which is still a 200.
  if (isEdugateLoginPage(doc)) {
    return { ok: false, error: "not_logged_in" };
  }

  const data = readGpa(doc);

  return data === null
    ? { ok: false, error: "page_unreadable" }
    : { ok: true, data };
}

async function respondTo(tool: string): Promise<ReadReply> {
  return tool === "get_gpa"
    ? readTranscript()
    : { ok: false, error: "page_unreadable" };
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

    void respondTo(tool).then(sendResponse);

    return true;
  },
);
