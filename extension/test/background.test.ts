import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../src/config.js";
import type { ActivityEntry } from "../src/storage.js";

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
  activity: unknown[];
  tabs: Array<{ id?: number }>;
  tabsQueryThrows: boolean;
  queries: Array<{ url: string }>;
  sent: Array<{ tabId: number; message: unknown }>;
  sendMessage?: SendMessage;
  badge: string[];
} = {
  stored: [],
  storageThrows: false,
  activity: [],
  tabs: [],
  tabsQueryThrows: false,
  queries: [],
  sent: [],
  badge: [],
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
      get: async (keys: string[]) => {
        if (state.storageThrows) {
          throw new Error("storage unavailable");
        }

        const stored: Record<string, unknown> = {};

        if (keys.includes("categoriesAllowed")) {
          stored.categoriesAllowed = state.stored;
        }

        if (keys.includes("activity")) {
          stored.activity = state.activity;
        }

        return stored;
      },
      set: async (items: Record<string, unknown>) => {
        if ("categoriesAllowed" in items) {
          state.stored = items.categoriesAllowed;
        }

        if ("activity" in items) {
          state.activity = items.activity as unknown[];
        }
      },
      remove: async (keys: string[]) => {
        if (keys.includes("categoriesAllowed")) {
          state.stored = [];
        }

        if (keys.includes("activity")) {
          state.activity = [];
        }
      },
    },
  },
  action: {
    setBadgeText: async ({ text }: { text: string }) => {
      state.badge.push(text);
    },
  },
  tabs: {
    query: async (query: { url: string }) => {
      state.queries.push(query);

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
    state.activity = [];
    state.badge = [];
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
    state.queries = [];
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

  it("asks the LMS tab for the course list", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          courses: [
            { code: "SWE 999", name: "Software Engineering Project", sections: ["99999"] },
          ],
        },
      });

    await expect(runToolInBrowser("get_courses")).resolves.toEqual({
      ok: true,
      data: {
        courses: [
          { code: "SWE 999", name: "Software Engineering Project", sections: ["99999"] },
        ],
      },
    });

    expect(state.queries).toEqual([{ url: "https://lms.ksu.edu.sa/*" }]);
    expect(state.sent).toEqual([
      { tabId: 7, message: { kind: "read", tool: "get_courses" } },
    ]);
  });

  it("reports not_logged_in when no LMS tab is open", async () => {
    state.tabs = [];

    await expect(runToolInBrowser("get_courses")).resolves.toEqual({
      ok: false,
      error: "not_logged_in",
    });
    expect(state.sent).toEqual([]);
  });

  it("keeps only the course contract fields and the membership ids out", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          courses: [
            {
              code: "SWE 999",
              name: "Software Engineering Project",
              sections: ["99999"],
              ids: ["_999_1"],
              email: "fake.student@student.ksu.edu.sa",
            },
          ],
        },
      });

    await expect(runToolInBrowser("get_courses")).resolves.toEqual({
      ok: true,
      data: {
        courses: [
          { code: "SWE 999", name: "Software Engineering Project", sections: ["99999"] },
        ],
      },
    });
  });

  it("reports page_unreadable when a course has no section list", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({ ok: true, data: { courses: [{ code: "SWE 999", name: "Project" }] } });

    await expect(runToolInBrowser("get_courses")).resolves.toEqual({
      ok: false,
      error: "page_unreadable",
    });
  });

  it("keeps only the absences contract fields of each course", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          courses: [
            {
              code: "SWE 444",
              name: "هندسة البرمجيات",
              absence_percent: 11.86,
              absences: 3,
              lates: 1,
              lecturer: "اسم المحاضر",
              room: "A/1",
            },
          ],
        },
      });

    await expect(runToolInBrowser("get_absences")).resolves.toEqual({
      ok: true,
      data: {
        courses: [
          {
            code: "SWE 444",
            name: "هندسة البرمجيات",
            absence_percent: 11.86,
            absences: 3,
            lates: 1,
          },
        ],
      },
    });
  });

  it("keeps the final exam contract fields and their null cases", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          exams: [
            {
              code: "SWE 444",
              name: "هندسة البرمجيات",
              day: null,
              date: null,
              time: "08:00",
              location: null,
              lecturer: "اسم المحاضر",
            },
          ],
        },
      });

    await expect(runToolInBrowser("get_final_exams")).resolves.toEqual({
      ok: true,
      data: {
        exams: [
          {
            code: "SWE 444",
            name: "هندسة البرمجيات",
            day: null,
            date: null,
            time: "08:00",
            location: null,
          },
        ],
      },
    });
  });

  it("reports page_unreadable when a nullable final exam field is missing", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          exams: [{ code: "SWE 444", name: "هندسة البرمجيات", time: "08:00", location: null }],
        },
      });

    await expect(runToolInBrowser("get_final_exams")).resolves.toEqual({
      ok: false,
      error: "page_unreadable",
    });
  });

  it("keeps the schedule contract fields and drops a lecturer name", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          term: "الفصل الأول 1448/1449",
          classes: [
            {
              code: "SWE 444",
              name: "هندسة البرمجيات",
              activity: "محاضرة",
              section: "12345",
              days: [1, 3],
              start: "08:00",
              end: "08:50",
              lecturer: "اسم المحاضر",
              room: "A/1",
            },
          ],
        },
      });

    const result = await runToolInBrowser("get_schedule");

    expect(result).toEqual({
      ok: true,
      data: {
        term: "الفصل الأول 1448/1449",
        classes: [
          {
            code: "SWE 444",
            name: "هندسة البرمجيات",
            activity: "محاضرة",
            section: "12345",
            days: [1, 3],
            start: "08:00",
            end: "08:50",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("اسم المحاضر");
  });

  it("reports page_unreadable when a day is not a number", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          term: "الفصل الأول 1448/1449",
          classes: [
            {
              code: "SWE 444",
              name: "هندسة البرمجيات",
              activity: "محاضرة",
              section: "12345",
              days: ["1", 3],
              start: "08:00",
              end: "08:50",
            },
          ],
        },
      });

    await expect(runToolInBrowser("get_schedule")).resolves.toEqual({
      ok: false,
      error: "page_unreadable",
    });
  });

  it("keeps a null grade and drops a lecturer name from the grades result", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          term: "الفصل الأول 1448/1449",
          courses: [
            { code: "SWE 444", name: "هندسة البرمجيات", grade: null, lecturer: "اسم المحاضر" },
          ],
        },
      });

    const result = await runToolInBrowser("get_grades");

    expect(result).toEqual({
      ok: true,
      data: {
        term: "الفصل الأول 1448/1449",
        courses: [{ code: "SWE 444", name: "هندسة البرمجيات", grade: null }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("اسم المحاضر");
  });

  it("reports page_unreadable when a grade is a number", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          term: "الفصل الأول 1448/1449",
          courses: [{ code: "SWE 444", name: "هندسة البرمجيات", grade: 95 }],
        },
      });

    await expect(runToolInBrowser("get_grades")).resolves.toEqual({
      ok: false,
      error: "page_unreadable",
    });
  });

  it("keeps the plan progress contract fields and drops an extra key", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          completed_hours: 107,
          remaining_hours: 45,
          remaining_courses: [
            {
              code: "SWE 444",
              name: "هندسة البرمجيات",
              hours: 3,
              group: "متطلبات الجامعة",
              type: "إجباري",
              level: "الأول",
              lecturer: "اسم المحاضر",
            },
          ],
          student_name: "طالب",
        },
      });

    const result = await runToolInBrowser("get_plan_progress");

    expect(result).toEqual({
      ok: true,
      data: {
        completed_hours: 107,
        remaining_hours: 45,
        remaining_courses: [
          {
            code: "SWE 444",
            name: "هندسة البرمجيات",
            hours: 3,
            group: "متطلبات الجامعة",
            type: "إجباري",
            level: "الأول",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("اسم المحاضر");
  });

  it("checks every item of an array against the contract", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({
        ok: true,
        data: {
          courses: [
            { code: "SWE 444", name: "أ", absence_percent: 1, absences: 1, lates: 0 },
            { code: "SWE 445", name: "ب", absence_percent: "2", absences: 1, lates: 0 },
          ],
        },
      });

    await expect(runToolInBrowser("get_absences")).resolves.toEqual({
      ok: false,
      error: "page_unreadable",
    });
  });
});

describe("activity history", () => {
  const RUN = {
    kind: "run_tool",
    request_id: "r-1",
    tool: "get_gpa",
    args: {},
  };

  beforeEach(() => {
    state.stored = ["grades"];
    state.activity = [];
    state.badge = [];
    state.tabs = [{ id: 7 }];
    state.sendMessage = (_tabId, _message, callback) =>
      callback({ ok: true, data: GPA });
  });

  it("records one read entry when the read succeeds", async () => {
    await respondToMessage(RUN, "http://localhost:3000");

    expect(state.activity).toHaveLength(1);
    expect(state.activity[0]).toEqual({
      at: expect.any(String),
      kind: "read",
      category: "grades",
      tool: "get_gpa",
      outcome: "ok",
    });
  });

  it("records the error code when the read fails", async () => {
    state.sendMessage = (_tabId, _message, callback) =>
      callback({ ok: false, error: "page_unreadable" });

    await respondToMessage(RUN, "http://localhost:3000");

    expect(state.activity).toEqual([
      {
        at: expect.any(String),
        kind: "read",
        category: "grades",
        tool: "get_gpa",
        outcome: "page_unreadable",
      },
    ]);
  });

  it("records a blocked entry when the category is not allowed", async () => {
    state.stored = [];

    await respondToMessage(RUN, "http://localhost:3000");

    expect(state.activity).toEqual([
      {
        at: expect.any(String),
        kind: "blocked",
        category: "grades",
        tool: "get_gpa",
        allowed: false,
      },
    ]);
  });

  it("keeps no value the tool read in the entry", async () => {
    await respondToMessage(RUN, "http://localhost:3000");

    const [entry] = state.activity as ActivityEntry[];

    expect(Object.keys(entry).sort()).toEqual([
      "at",
      "category",
      "kind",
      "outcome",
      "tool",
    ]);
    expect(JSON.stringify(entry)).not.toContain("4.31");
  });

  it("records nothing for a ping or a foreign origin", async () => {
    await respondToMessage({ kind: "ping" }, "http://localhost:3000");
    await respondToMessage(RUN, "https://evil.example");

    expect(state.activity).toEqual([]);
  });
});

describe("the reading badge", () => {
  const RUN = {
    kind: "run_tool",
    request_id: "r-1",
    tool: "get_gpa",
    args: {},
  };

  beforeEach(() => {
    state.stored = ["grades"];
    state.activity = [];
    state.badge = [];
    state.tabs = [{ id: 7 }];
  });

  it("shows while a tool reads and clears after it succeeds", async () => {
    const during: string[][] = [];

    const response = await respondToMessage(
      RUN,
      "http://localhost:3000",
      async () => {
        during.push([...state.badge]);
        return { ok: true, data: GPA };
      },
    );

    expect(response).toMatchObject({ ok: true });
    expect(during).toEqual([["…"]]);
    expect(state.badge).toEqual(["…", ""]);
  });

  it("clears after an error", async () => {
    await respondToMessage(RUN, "http://localhost:3000", async () => ({
      ok: false,
      error: "page_unreadable",
    }));

    expect(state.badge).toEqual(["…", ""]);
  });

  it("clears after a timeout", async () => {
    vi.useFakeTimers();
    state.sendMessage = () => {};

    try {
      const running = respondToMessage(RUN, "http://localhost:3000");

      await vi.advanceTimersByTimeAsync(20_000);

      await expect(running).resolves.toMatchObject({
        ok: false,
        error: "timeout",
      });
      expect(state.badge).toEqual(["…", ""]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows nothing when there is no consent", async () => {
    state.stored = [];

    await respondToMessage(RUN, "http://localhost:3000");

    expect(state.badge).toEqual([]);
  });
});
