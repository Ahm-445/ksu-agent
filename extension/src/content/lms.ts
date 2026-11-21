// The content script of the LMS (Blackboard Ultra), bundled by esbuild into one classic
// script and loaded in the top frame only.
//
// The LMS builds its pages in the browser, so there is no page HTML to read: the readers use
// the JSON API the page itself calls, in the student's own session (src/lms/session.ts).
// The script sends no cookies, no page and no field the contract does not list, and writes
// nothing to storage.

import { isRecord } from "../readers/lms/ultra.js";
import { readLmsTool } from "../lms/session.js";

// One read at a time: two tools reading at once must not interleave their requests.
let reads: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = reads.then(task, task);

  reads = run.catch(() => undefined);

  return run;
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: { id?: string }, sendResponse: (reply: unknown) => void) => {
    // Only this extension may ask; a page or another extension gets no answer.
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    if (!isRecord(message) || message.kind !== "read") {
      return false;
    }

    const tool = typeof message.tool === "string" ? message.tool : "";

    void oneAtATime(() => readLmsTool(tool)).then(sendResponse);

    return true;
  },
);
