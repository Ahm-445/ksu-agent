// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (reply: unknown) => void,
) => boolean | undefined;

type Call = { url: string; credentials?: string; accept?: string; signal?: unknown };

const LMS = "https://lms.ksu.edu.sa";
const ME_URL = `${LMS}/learn/api/v1/users/me`;
const MEMBERSHIPS_URL = `${LMS}/learn/api/v1/users/_999_0/memberships?expand=course&includeCount=true&limit=100`;
const MEMBERSHIPS_PAGE_2 = `${MEMBERSHIPS_URL}&offset=100`;
const DUE_DATES_PATH = `${LMS}/learn/api/v1/calendars/dueDateCalendarItems`;

function columnsUrl(courseId: string): string {
  return `${LMS}/learn/api/v1/courses/${courseId}/gradebook/columns?includeInvisible=false`;
}

function gradesUrl(courseId: string): string {
  return `${LMS}/learn/api/v1/courses/${courseId}/gradebook/grades?userId=_999_0&limit=100`;
}

/** The path of a fetched URL, without the query the reader builds at run time. */
function path(url: string): string {
  return url.split("?")[0] as string;
}

// jsdom gives no file URL for this module, so the fixtures folder is taken from the run.
const FIXTURES = join(process.cwd(), "test", "fixtures", "lms-api");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

type Reply = { status: number; type: string; body: string };

function json(value: unknown): Reply {
  return { status: 200, type: "application/json;charset=UTF-8", body: JSON.stringify(value) };
}

const LOGIN_PAGE: Reply = {
  status: 200,
  type: "text/html;charset=UTF-8",
  body: "<html><body><form id=\"login\"></form></body></html>",
};

const state: {
  listener?: Listener;
  replies: Record<string, Reply>;
  fetched: string[];
  calls: Call[];
  log: string[];
  inFlight: number;
  maxInFlight: number;
} = {
  replies: {},
  fetched: [],
  calls: [],
  log: [],
  inFlight: 0,
  maxInFlight: 0,
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

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;

  state.fetched.push(url);
  state.calls.push({
    url,
    credentials: init?.credentials,
    accept: headers.Accept,
    signal: init?.signal,
  });
  state.log.push(`${url} start`);

  state.inFlight += 1;
  state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);

  await new Promise((resolve) => setTimeout(resolve, 1));

  state.inFlight -= 1;
  state.log.push(`${url} end`);

  const reply = state.replies[url] ??
    state.replies[path(url)] ?? { status: 404, type: "application/json", body: "" };

  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? reply.type : null),
    },
    text: async () => reply.body,
  };
});

await import("../../src/content/lms.js");

/** Asks for one tool's data, the way the background does. */
function read(tool: string): ReturnType<typeof vi.fn> {
  const sendResponse = vi.fn();

  state.listener?.({ kind: "read", tool }, { id: "extension-id" }, sendResponse);

  return sendResponse;
}

function replyOf(sendResponse: ReturnType<typeof vi.fn>): unknown {
  return sendResponse.mock.calls[0]?.[0];
}

describe("the LMS content script", () => {
  beforeEach(() => {
    state.replies = {
      [ME_URL]: json(JSON.parse(fixture("me.json"))),
      [MEMBERSHIPS_URL]: json(JSON.parse(fixture("memberships.json"))),
      [DUE_DATES_PATH]: json(JSON.parse(fixture("due-dates.json"))),
    };
    state.fetched = [];
    state.calls = [];
    state.log = [];
    state.inFlight = 0;
    state.maxInFlight = 0;
  });

  it("answers nothing to a message from a page or another extension", () => {
    const sendResponse = vi.fn();

    const keepOpen = state.listener?.(
      { kind: "read", tool: "get_courses" },
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

  it("reads the course list in the student's own session", async () => {
    const sendResponse = read("get_courses");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    expect(state.fetched).toEqual([ME_URL, MEMBERSHIPS_URL]);
    expect(state.calls[0]?.credentials).toBe("same-origin");
    expect(state.calls[0]?.accept).toBe("application/json");
    expect(replyOf(sendResponse)).toEqual({
      ok: true,
      data: {
        courses: [
          {
            code: "SWE 999",
            name: "Software Engineering Project",
            sections: ["99999", "99998"],
          },
          { code: "ENG 999", name: "Technical Writing", sections: ["22222"] },
          { code: null, name: "Special Topic", sections: [] },
        ],
      },
    });
  });

  it("never sends the membership ids or the rest of the student's profile", async () => {
    const sendResponse = read("get_courses");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    const body = JSON.stringify(replyOf(sendResponse));

    expect(body).not.toContain("_999_1");
    expect(body).not.toContain("fake.student@");
    expect(body).not.toContain("Fake Student");
    expect(body).not.toContain("999999999");
  });

  it("reports not_logged_in when the session is refused", async () => {
    state.replies[ME_URL] = { status: 401, type: "application/json", body: "" };
    const sendResponse = read("get_courses");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });

    expect(state.fetched).toEqual([ME_URL]);
  });

  it("reports not_logged_in when the LMS answers with the login page", async () => {
    state.replies[ME_URL] = LOGIN_PAGE;
    const sendResponse = read("get_courses");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });
  });

  it("reports page_unreadable when the membership list fails", async () => {
    state.replies[MEMBERSHIPS_URL] = { status: 500, type: "application/json", body: "" };
    const sendResponse = read("get_courses");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });
  });

  it("reports page_unreadable when the course list is not the documented shape", async () => {
    state.replies[MEMBERSHIPS_URL] = json({ results: [{ course: null }] });
    const sendResponse = read("get_courses");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });
  });

  it("follows paging.nextPage, and no further than five pages", async () => {
    const page = JSON.parse(fixture("memberships.json"));

    page.paging.nextPage =
      "/learn/api/v1/users/_999_0/memberships?expand=course&includeCount=true&limit=100&offset=100";
    state.replies[MEMBERSHIPS_URL] = json(page);
    state.replies[MEMBERSHIPS_PAGE_2] = json(page);

    const sendResponse = read("get_courses");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    expect(state.fetched.filter((url) => url !== ME_URL)).toHaveLength(5);
  });

  it("never follows a nextPage on another host", async () => {
    const page = JSON.parse(fixture("memberships.json"));

    page.paging.nextPage = "https://evil.example/learn/api/v1/users/_999_0/memberships";
    state.replies[MEMBERSHIPS_URL] = json(page);

    const sendResponse = read("get_courses");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    expect(state.fetched).toEqual([ME_URL, MEMBERSHIPS_URL]);
    expect(replyOf(sendResponse)).toMatchObject({ ok: true });
  });

  it("reads the due dates of the current courses", async () => {
    const sendResponse = read("get_assignments");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    expect(state.fetched.map(path)).toEqual([
      ME_URL,
      MEMBERSHIPS_URL.split("?")[0],
      DUE_DATES_PATH,
    ]);
    expect(replyOf(sendResponse)).toEqual({
      ok: true,
      data: {
        items: [
          {
            title: "Essay draft",
            course: "Technical Writing",
            due_at: "2026-11-20T23:59:00+03:00",
          },
          {
            title: "Project proposal",
            course: "Software Engineering Project",
            due_at: "2026-11-21T23:59:00+03:00",
          },
          {
            title: "Past course quiz",
            course: "Calculus II",
            due_at: "2026-11-22T13:00:00+03:00",
          },
          {
            title: "Sprint review",
            course: "Software Engineering Project",
            due_at: "2026-11-23T09:30:00+03:00",
          },
          {
            title: "Section quiz",
            course: "Software Engineering Project",
            due_at: "2026-11-25T01:30:00+03:00",
          },
        ],
      },
    });
  });

  it("reports not_logged_in for the due dates when the session is refused", async () => {
    state.replies[DUE_DATES_PATH] = { status: 403, type: "application/json", body: "" };
    const sendResponse = read("get_assignments");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });
  });

  it("asks the calendar for the due dates from now on", async () => {
    const sendResponse = read("get_assignments");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    const query = new URL(state.fetched[2] as string).searchParams;

    expect(query.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(query.get("date_compare")).toBe("greaterOrEqual");
    expect(query.get("limit")).toBe("50");
    expect(query.get("offset")).toBe("0");
  });

  it("skips a due date the LMS has not filled in, and keeps the rest", async () => {
    const items = JSON.parse(fixture("due-dates.json"));

    delete items.results[0].endDate;
    state.replies[DUE_DATES_PATH] = json(items);

    const sendResponse = read("get_assignments");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    const reply = replyOf(sendResponse) as { data?: { items?: Array<{ title: string }> } };

    expect(reply.data?.items?.map((item) => item.title)).not.toContain("Project proposal");
    expect(reply.data?.items).toHaveLength(4);
  });

  it("reports page_unreadable when the due date list is not a list", async () => {
    state.replies[DUE_DATES_PATH] = json({ results: "none" });

    const sendResponse = read("get_assignments");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });
  });

  it("reads one grade per course of the current term", async () => {
    const books = JSON.parse(fixture("gradebook.json")) as Record<
      string,
      { columns: unknown; grades: unknown }
    >;

    for (const [courseId, book] of Object.entries(books)) {
      state.replies[columnsUrl(courseId)] = json(book.columns);
      state.replies[gradesUrl(courseId)] = json(book.grades);
    }

    const sendResponse = read("get_lms_grades");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    expect(replyOf(sendResponse)).toEqual({
      ok: true,
      data: {
        courses: [
          {
            code: "SWE 999",
            name: "Software Engineering Project",
            items: [
              { title: "Project proposal", score: 8.5, possible: 10, status: "graded" },
              { title: "Sprint quiz", score: null, possible: 5, status: "needs_grading" },
              { title: "Midterm total", score: 17, possible: 20, status: "none" },
              { title: "Lab task (lab)", score: 4, possible: 4, status: "graded" },
            ],
          },
          {
            code: null,
            name: "Special Topic",
            items: [{ title: "Discussion", score: null, possible: 10, status: "none" }],
          },
        ],
      },
    });
  });

  it("never sends a grade that is not released, nor feedback or the class average", async () => {
    const books = JSON.parse(fixture("gradebook.json")) as Record<
      string,
      { columns: unknown; grades: unknown }
    >;

    for (const [courseId, book] of Object.entries(books)) {
      state.replies[columnsUrl(courseId)] = json(book.columns);
      state.replies[gradesUrl(courseId)] = json(book.grades);
    }

    const sendResponse = read("get_lms_grades");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    const body = JSON.stringify(replyOf(sendResponse));

    expect(body).not.toContain("Well argued.");
    expect(body).not.toContain("Keep it up.");
    expect(body).not.toContain("7.25");
    expect(body).not.toContain("99.5");
    expect(body).not.toContain("5.5");
    expect(body).not.toContain("6.5");
    expect(body).not.toContain("9.5");
    expect(body).not.toContain("88");
  });

  it("leaves out a course with nothing to show", async () => {
    const books = JSON.parse(fixture("gradebook.json")) as Record<
      string,
      { columns: unknown; grades: unknown }
    >;

    for (const [courseId, book] of Object.entries(books)) {
      state.replies[columnsUrl(courseId)] = json(book.columns);
      state.replies[gradesUrl(courseId)] = json(book.grades);
    }

    const sendResponse = read("get_lms_grades");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    const reply = replyOf(sendResponse) as { data?: { courses?: Array<{ name: string }> } };

    expect(reply.data?.courses?.map((course) => course.name)).not.toContain(
      "Technical Writing",
    );
  });

  it("reports not_logged_in for the grades when the session is refused", async () => {
    state.replies[columnsUrl("_999_1")] = { status: 401, type: "application/json", body: "" };

    const sendResponse = read("get_lms_grades");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });
  });

  it("reports page_unreadable when a gradebook is not the documented shape", async () => {
    state.replies[columnsUrl("_999_1")] = json({ results: "none" });
    state.replies[gradesUrl("_999_1")] = json({ results: [] });

    const sendResponse = read("get_lms_grades");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });
  });

  it("reports page_unreadable for a tool it does not read", async () => {
    const sendResponse = read("get_gpa");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([]);
  });

  it("runs one read at a time", async () => {
    const first = read("get_courses");
    const second = read("get_courses");

    await vi.waitFor(() => {
      expect(first).toHaveBeenCalled();
      expect(second).toHaveBeenCalled();
    });

    expect(state.maxInFlight).toBe(1);
    expect(state.log).toEqual([
      `${ME_URL} start`,
      `${ME_URL} end`,
      `${MEMBERSHIPS_URL} start`,
      `${MEMBERSHIPS_URL} end`,
      `${ME_URL} start`,
      `${ME_URL} end`,
      `${MEMBERSHIPS_URL} start`,
      `${MEMBERSHIPS_URL} end`,
    ]);
  });
});
