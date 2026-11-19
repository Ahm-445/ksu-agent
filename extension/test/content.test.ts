// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (reply: unknown) => void,
) => boolean | undefined;

const state: {
  listener?: Listener;
  fetchFails: boolean;
  fetched: string[];
  html: string;
} = {
  fetchFails: false,
  fetched: [],
  html: "<html></html>",
};

vi.stubGlobal("chrome", {
  runtime: {
    id: "extension-id",
    onMessage: {
      addListener: (listener: Listener) => {
        state.listener = listener;
      },
    },
  },
});

vi.stubGlobal("fetch", async (url: string) => {
  state.fetched.push(url);

  if (state.fetchFails) {
    throw new Error("network down");
  }

  return { ok: true, text: async () => state.html };
});

await import("../src/content/edugate.js");
describe("the Edugate content script", () => {
  beforeEach(() => {
    state.fetchFails = false;
    state.fetched = [];
    state.html = "<html></html>";
  });

  it("answers nothing to a message from a page or another extension", () => {
    const sendResponse = vi.fn();

    const keepOpen = state.listener?.(
      { kind: "read", tool: "get_gpa" },
      { id: "another-extension" },
      sendResponse,
    );

    expect(keepOpen).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("ignores a message that is not a read request", () => {
    const sendResponse = vi.fn();

    const keepOpen = state.listener?.({ kind: "ping" }, { id: "extension-id" }, sendResponse);

    expect(keepOpen).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("reports not_logged_in when the transcript cannot be fetched", async () => {
    state.fetchFails = true;
    const sendResponse = vi.fn();

    const keepOpen = state.listener?.(
      { kind: "read", tool: "get_gpa" },
      { id: "extension-id" },
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });

    expect(keepOpen).toBe(true);
    expect(state.fetched).toEqual([
      "https://edugate.ksu.edu.sa/ksu/ui/student/student_transcript/index/studentTranscriptAllIndex.faces",
    ]);
  });

  it("reports page_unreadable for a tool that has no reader", async () => {
    const sendResponse = vi.fn();

    state.listener?.({ kind: "read", tool: "get_courses" }, { id: "extension-id" }, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([]);
  });

  it("fetches the absences page for get_absences", async () => {
    const sendResponse = vi.fn();

    state.listener?.(
      { kind: "read", tool: "get_absences" },
      { id: "extension-id" },
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([
      "https://edugate.ksu.edu.sa/ksu/ui/student/student_absences/index/courseAbsencesIndex.faces",
    ]);
  });

  it("fetches the final exams page for get_final_exams", async () => {
    const sendResponse = vi.fn();

    state.listener?.(
      { kind: "read", tool: "get_final_exams" },
      { id: "extension-id" },
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([
      "https://edugate.ksu.edu.sa/ksu/ui/student/final_exams/index/forwardFinalExams.faces",
    ]);
  });

  it("fetches the schedule page for get_schedule", async () => {
    const sendResponse = vi.fn();

    state.listener?.(
      { kind: "read", tool: "get_schedule" },
      { id: "extension-id" },
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([
      "https://edugate.ksu.edu.sa/ksu/ui/student/student_schedule/index/forwardStudentSchedule.faces",
    ]);
  });

  it("reports not_logged_in when a fetched page is the login form", async () => {
    const sendResponse = vi.fn();

    state.html = '<html><body><form id="loginForm"></form></body></html>';

    state.listener?.(
      { kind: "read", tool: "get_absences" },
      { id: "extension-id" },
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });
  });
});
