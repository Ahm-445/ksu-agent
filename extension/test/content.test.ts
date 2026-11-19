import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (reply: unknown) => void,
) => boolean | undefined;

const state: { listener?: Listener; fetchFails: boolean; fetched: string[] } = {
  fetchFails: false,
  fetched: [],
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

  return { ok: true, text: async () => "<html></html>" };
});

await import("../src/content/edugate.js");

describe("the Edugate content script", () => {
  beforeEach(() => {
    state.fetchFails = false;
    state.fetched = [];
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

    state.listener?.({ kind: "read", tool: "get_grades" }, { id: "extension-id" }, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([]);
  });
});
