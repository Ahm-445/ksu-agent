import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../src/config.js";

type Listener = (
  message: unknown,
  sender: { origin?: string },
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

type SendMessage = (
  tabId: number,
  message: unknown,
  callback: (reply?: unknown) => void,
) => void;

const state: {
  listener?: Listener;
  stored: unknown;
  storageThrows: boolean;
  tabs: Array<{ id?: number }>;
  tabsQueryThrows: boolean;
  sent: Array<{ tabId: number; message: unknown }>;
  sendMessage?: SendMessage;
} = {
  stored: [],
  storageThrows: false,
  tabs: [],
  tabsQueryThrows: false,
  sent: [],
};

const runtime: { lastError?: { message: string } } = {};

vi.stubGlobal("chrome", {
  runtime: {
    onMessageExternal: {
      addListener: (listener: Listener) => {
        state.listener = listener;
      },
    },
    get lastError() {
      return runtime.lastError;
    },
  },
  storage: {
    local: {
      get: async () => {
        if (state.storageThrows) {
          throw new Error("storage unavailable");
        }

        return { categoriesAllowed: state.stored };
      },
    },
  },
  tabs: {
    query: async () => {
      if (state.tabsQueryThrows) {
        throw new Error("tabs unavailable");
      }

      return state.tabs;
    },
    sendMessage: (tabId: number, message: unknown, callback: (reply?: unknown) => void) => {
      state.sent.push({ tabId, message });
      state.sendMessage?.(tabId, message, callback);
    },
  },
});

const { respondToMessage, runToolInBrowser } = await import("../src/background.js");

const GPA = {
  cumulative_gpa: "4.31",
  scale: "5",
  earned_hours: 95,
  registered_hours: 98,
  as_of_term: "الفصل الأول 1447/1448",
};

describe("respondToMessage", () => {
  beforeEach(() => {
    state.stored = [];
    state.storageThrows = false;
  });

  it("reports no consent when nothing is stored", async () => {
    const response = await respondToMessage(
      { kind: "run_tool", request_id: "r-1", tool: "get_gpa", args: {} },
      "http://localhost:3000",
    );

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-1",
      ok: false,
      error: "no_consent",
    });
  });

  it("keeps only stored values that are category names", async () => {
    state.stored = ["grades", 42, null, "lms"];

    const response = await respondToMessage({ kind: "ping" }, "http://localhost:3000");

    expect(response).toEqual({
      kind: "pong",
      version: VERSION,
      categories_allowed: ["grades", "lms"],
    });
  });

  it("still answers a ping when storage fails", async () => {
    state.storageThrows = true;

    const response = await respondToMessage({ kind: "ping" }, "http://localhost:3000");

    expect(response).toEqual({
      kind: "pong",
      version: VERSION,
      categories_allowed: [],
    });
  });

  it("answers nothing for a foreign origin", async () => {
    const response = await respondToMessage({ kind: "ping" }, "https://evil.example");

    expect(response).toBeNull();
  });
});

describe("the external message listener", () => {
  it("is registered", () => {
    expect(typeof state.listener).toBe("function");
  });

  it("keeps the channel open and sends the response", async () => {
    const sendResponse = vi.fn();

    const keepOpen = state.listener?.({ kind: "ping" }, { origin: "http://localhost:3000" }, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        kind: "pong",
        version: VERSION,
        categories_allowed: [],
      });
    });

    expect(keepOpen).toBe(true);
  });

  it("sends nothing back to a foreign origin", async () => {
    const sendResponse = vi.fn();

    state.listener?.({ kind: "ping" }, { origin: "https://evil.example" }, sendResponse);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe("runToolInBrowser", () => {
  beforeEach(() => {
    state.tabs = [{ id: 7 }];
    state.tabsQueryThrows = false;
    state.sent = [];
    state.sendMessage = (_tabId, _message, callback) => callback({ ok: true, data: GPA });
  });

  it("asks the Edugate tab for the GPA and returns its data", async () => {
    await expect(runToolInBrowser("get_gpa")).resolves.toEqual({ ok: true, data: GPA });

    expect(state.sent).toEqual([{ tabId: 7, message: { kind: "read", tool: "get_gpa" } }]);
  });

  it("reports not_logged_in when no Edugate tab is open", async () => {
    state.tabs = [];

    await expect(runToolInBrowser("get_gpa")).resolves.toEqual({
      ok: false,
      error: "not_logged_in",
    });
    expect(state.sent).toEqual([]);
  });

  it("reports not_logged_in when the tabs API is unavailable", async () => {
    state.tabsQueryThrows = true;

    await expect(runToolInBrowser("get_gpa")).resolves.toEqual({
      ok: false,
      error: "not_logged_in",
    });
  });

  it("passes a not_logged_in reply through", async () => {
    state.sendMessage = (_tabId, _message, callback) => callback({ ok: false, error: "not_logged_in" });

    await expect(runToolInBrowser("get_gpa")).resolves.toEqual({
      ok: false,
      error: "not_logged_in",
    });
  });

  it("reports page_unreadable when the page cannot be read", async () => {
    state.sendMessage = (_tabId, _message, callback) => callback({ ok: false, error: "page_unreadable" });

    await expect(runToolInBrowser("get_gpa")).resolves.toEqual({
      ok: false,
      error: "page_unreadable",
    });
  });

  it("reports not_logged_in when the tab has no content script", async () => {
    state.sendMessage = (_tabId, _message, callback) => {
      runtime.lastError = { message: "Could not establish connection." };
      callback();
      runtime.lastError = undefined;
    };

    await expect(runToolInBrowser("get_gpa")).resolves.toEqual({
      ok: false,
      error: "not_logged_in",
    });
  });

  it("keeps only the fields the contract lists", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({ ok: true, data: { ...GPA, password: "secret", student_name: "طالب" } });

    await expect(runToolInBrowser("get_gpa")).resolves.toEqual({ ok: true, data: GPA });
  });

  it("reports page_unreadable when a contract field is mistyped", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({ ok: true, data: { ...GPA, earned_hours: "95" } });

    await expect(runToolInBrowser("get_gpa")).resolves.toEqual({
      ok: false,
      error: "page_unreadable",
    });
  });

  it("reports page_unreadable when a contract field is missing", async () => {
    const { as_of_term: _dropped, ...withoutTerm } = GPA;
    state.sendMessage = (_tabId, _message, callback) =>
      callback({ ok: true, data: withoutTerm });

    await expect(runToolInBrowser("get_gpa")).resolves.toEqual({
      ok: false,
      error: "page_unreadable",
    });
  });

  it("reports timeout when the tab does not answer within 20 seconds", async () => {
    vi.useFakeTimers();
    state.sendMessage = () => {};

    try {
      const running = runToolInBrowser("get_gpa");

      await vi.advanceTimersByTimeAsync(20_000);

      await expect(running).resolves.toEqual({ ok: false, error: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers page_unreadable for a tool without a reader", async () => {
    await expect(runToolInBrowser("get_grades")).resolves.toEqual({
      ok: false,
      error: "page_unreadable",
    });
    expect(state.sent).toEqual([]);
  });
});
