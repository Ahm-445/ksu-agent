// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (reply: unknown) => void,
) => boolean | undefined;

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  credentials: string | null;
};

const EDUGATE = "https://edugate.ksu.edu.sa";

const GPA_URL = `${EDUGATE}/ksu/ui/student/student_transcript/index/studentTranscriptAllIndex.faces`;
const ABSENCES_URL = `${EDUGATE}/ksu/ui/student/student_absences/index/courseAbsencesIndex.faces`;
const FINAL_EXAMS_URL = `${EDUGATE}/ksu/ui/student/final_exams/index/forwardFinalExams.faces`;
const SCHEDULE_URL = `${EDUGATE}/ksu/ui/student/student_schedule/index/forwardStudentSchedule.faces`;
const GRADES_URL = `${EDUGATE}/ksu/ui/student/courses_results/index/forwardCoursesResults.faces`;
const TAKEN_PLAN_URL = `${EDUGATE}/ksu/ui/student/student_plan/index/forwardTakenPlanIndex.faces`;
const REMAIN_PLAN_URL = `${EDUGATE}/ksu/ui/student/student_plan/index/forwardRemainPlanIndex.faces`;

const LOGIN_PAGE = '<html><body><form id="loginForm"></form></body></html>';

const state: {
  listener?: Listener;
  fetchFails: boolean;
  fetched: string[];
  calls: Call[];
  html: string;
  htmlByUrl: Record<string, string>;
  htmlByRequest: Record<string, string>;
  log: string[];
  inFlight: number;
  maxInFlight: number;
} = {
  fetchFails: false,
  fetched: [],
  calls: [],
  html: "<html></html>",
  htmlByUrl: {},
  htmlByRequest: {},
  log: [],
  inFlight: 0,
  maxInFlight: 0,
};

// jsdom gives no file URL for this module, so the fixtures folder is taken from the run.
const FIXTURES = join(process.cwd(), "test", "fixtures", "edugate");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

/** The forward stub a GET returns, and the same stub with another link id (the plan). */
const FORWARD_STUB = fixture("forward-stub.html");
const FORWARD_STUB_PLAN = fixture("forward-stub-plan.html");

// The remaining plan page answers with the same stub shape: only its action and link differ.
const FORWARD_STUB_REMAIN = FORWARD_STUB_PLAN.replaceAll(
  "forwardTakenPlanIndex.faces",
  "forwardRemainPlanIndex.faces",
).replaceAll("myForm:takenPlanActionListener", "myForm:remainPlanActionListener");

/** What a fetch of this call answers with: the method-specific page, then the URL's, then the default. */
function replyFor(call: Call): string {
  return (
    state.htmlByRequest[`${call.method} ${call.url}`] ??
    state.htmlByUrl[call.url] ??
    state.html
  );
}

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
  const call: Call = {
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    headers: { ...(init?.headers as Record<string, string> | undefined) },
    body: typeof init?.body === "string" ? init.body : null,
    credentials: init?.credentials ?? null,
  };

  state.fetched.push(url);
  state.calls.push(call);
  state.log.push(`${call.method} ${call.url} start`);

  state.inFlight += 1;
  state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);

  await new Promise((resolve) => setTimeout(resolve, 1));

  state.inFlight -= 1;
  state.log.push(`${call.method} ${call.url} end`);

  if (state.fetchFails) {
    throw new Error("network down");
  }

  return { ok: true, text: async () => replyFor(call) };
});

await import("../src/content/edugate.js");

/** Asks for one tool's data, the way the background does. */
function read(tool: string): ReturnType<typeof vi.fn> {
  const sendResponse = vi.fn();

  state.listener?.({ kind: "read", tool }, { id: "extension-id" }, sendResponse);

  return sendResponse;
}

/** The form fields a POST carried, decoded. */
function bodyOf(call: Call): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(call.body ?? ""));
}

describe("the Edugate content script", () => {
  beforeEach(() => {
    state.fetchFails = false;
    state.fetched = [];
    state.calls = [];
    state.html = "<html></html>";
    state.htmlByUrl = {};
    state.htmlByRequest = {};
    state.log = [];
    state.inFlight = 0;
    state.maxInFlight = 0;
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
    const sendResponse = read("get_gpa");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });

    expect(state.fetched).toEqual([GPA_URL]);
  });

  it("reports page_unreadable for a tool that has no reader", async () => {
    const sendResponse = read("get_courses");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([]);
  });

  it("fetches the absences page for get_absences", async () => {
    const sendResponse = read("get_absences");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([ABSENCES_URL]);
  });

  it("fetches the final exams page for get_final_exams", async () => {
    const sendResponse = read("get_final_exams");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([FINAL_EXAMS_URL]);
  });

  it("fetches the schedule page for get_schedule", async () => {
    const sendResponse = read("get_schedule");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([SCHEDULE_URL]);
  });

  it("fetches the course results page for get_grades", async () => {
    const sendResponse = read("get_grades");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([GRADES_URL]);
  });

  it("reports not_logged_in when a fetched page is the login form", async () => {
    const sendResponse = vi.fn();

    state.html = LOGIN_PAGE;

    state.listener?.(
      { kind: "read", tool: "get_absences" },
      { id: "extension-id" },
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });
  });

  it("fetches the completed page and then the remaining page for get_plan_progress", async () => {
    const sendResponse = read("get_plan_progress");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.fetched).toEqual([TAKEN_PLAN_URL, REMAIN_PLAN_URL]);
  });

  it("reports not_logged_in when the remaining plan page is the login form", async () => {
    state.htmlByUrl = { [REMAIN_PLAN_URL]: LOGIN_PAGE };

    const sendResponse = read("get_plan_progress");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });

    expect(state.fetched).toHaveLength(2);
  });

  it("sends no POST for a page that is not a forward page", async () => {
    state.htmlByUrl = { [ABSENCES_URL]: fixture("absences.html") };

    const sendResponse = read("get_absences");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true }),
      );
    });

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ url: ABSENCES_URL, method: "GET" });
  });

  it("follows the final exams forward stub with one POST and reads the page behind it", async () => {
    state.htmlByRequest = {
      [`GET ${FINAL_EXAMS_URL}`]: FORWARD_STUB,
      [`POST ${FINAL_EXAMS_URL}`]: fixture("final-exams.html"),
    };

    const sendResponse = read("get_final_exams");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true }),
      );
    });

    expect(state.calls.map((call) => call.method)).toEqual(["GET", "POST"]);

    const post = state.calls[1] as Call;

    expect(post.url).toBe(FINAL_EXAMS_URL);
    expect(post.credentials).toBe("same-origin");
    expect(post.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(bodyOf(post)).toEqual({
      myForm: "myForm",
      "javax.faces.ViewState": "FAKE-VIEWSTATE",
      "myForm:serLinkFinalExams": "myForm:serLinkFinalExams",
    });
  });

  it("takes the link id from the stub's own script, not from a prefix", async () => {
    state.htmlByRequest = {
      [`GET ${TAKEN_PLAN_URL}`]: FORWARD_STUB_PLAN,
      [`POST ${TAKEN_PLAN_URL}`]: fixture("plan-completed.html"),
      [`GET ${REMAIN_PLAN_URL}`]: FORWARD_STUB_REMAIN,
      [`POST ${REMAIN_PLAN_URL}`]: fixture("plan-remaining.html"),
    };

    const sendResponse = read("get_plan_progress");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true }),
      );
    });

    // GET, POST, GET, POST — the two pages are read one after the other.
    expect(state.log).toEqual([
      `GET ${TAKEN_PLAN_URL} start`,
      `GET ${TAKEN_PLAN_URL} end`,
      `POST ${TAKEN_PLAN_URL} start`,
      `POST ${TAKEN_PLAN_URL} end`,
      `GET ${REMAIN_PLAN_URL} start`,
      `GET ${REMAIN_PLAN_URL} end`,
      `POST ${REMAIN_PLAN_URL} start`,
      `POST ${REMAIN_PLAN_URL} end`,
    ]);
    expect(state.maxInFlight).toBe(1);
    expect(bodyOf(state.calls[1] as Call)).toMatchObject({
      "myForm:takenPlanActionListener": "myForm:takenPlanActionListener",
    });
    expect(bodyOf(state.calls[3] as Call)).toMatchObject({
      "myForm:remainPlanActionListener": "myForm:remainPlanActionListener",
    });
  });

  it("does not treat a page with a command script as a forward page", async () => {
    const page = fixture("absences.html").replace(
      "</body>",
      '<script>function callCommand(){document.getElementById("myForm:checkCourseContentCmd").onclick();}</script></body>',
    );

    state.htmlByUrl = { [ABSENCES_URL]: page };

    const sendResponse = read("get_absences");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    expect(state.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("does not follow a stub whose body has no onload", async () => {
    state.htmlByRequest = {
      [`GET ${FINAL_EXAMS_URL}`]: FORWARD_STUB.replace(' onload="loadService()"', ""),
    };

    const sendResponse = read("get_final_exams");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("clicks the link loadService names, not one from another script", async () => {
    const page = FORWARD_STUB.replace(
      '<body onload="loadService()">',
      '<body onload="loadService()"><script>function callCommand(){document.getElementById("myForm:checkCourseContentCmd").onclick();}</script>',
    );

    state.htmlByRequest = {
      [`GET ${FINAL_EXAMS_URL}`]: page,
      [`POST ${FINAL_EXAMS_URL}`]: fixture("final-exams.html"),
    };

    const sendResponse = read("get_final_exams");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    expect(state.calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(bodyOf(state.calls[1] as Call)).toEqual({
      myForm: "myForm",
      "javax.faces.ViewState": "FAKE-VIEWSTATE",
      "myForm:serLinkFinalExams": "myForm:serLinkFinalExams",
    });
  });

  it("does not follow a page that carries a data table", async () => {
    const page = FORWARD_STUB.replace(
      "</form>",
      '</form><table id="myForm:courseTable"><thead><tr><th class="HEADING">رمز المقرر</th></tr></thead></table>',
    );

    state.htmlByRequest = { [`GET ${FINAL_EXAMS_URL}`]: page };

    const sendResponse = read("get_final_exams");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("does not post when the stub's form action is on another origin", async () => {
    state.htmlByRequest = {
      [`GET ${FINAL_EXAMS_URL}`]: FORWARD_STUB.replace(
        "https://edugate.ksu.edu.sa",
        "https://evil.example",
      ),
    };

    const sendResponse = read("get_final_exams");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("does not post when the stub's form action is another path", async () => {
    state.htmlByRequest = {
      [`GET ${FINAL_EXAMS_URL}`]: FORWARD_STUB.replace(
        "forwardFinalExams.faces",
        "forwardStudentSchedule.faces",
      ),
    };

    const sendResponse = read("get_final_exams");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("reports page_unreadable when the POST returns the stub again", async () => {
    state.htmlByRequest = {
      [`GET ${FINAL_EXAMS_URL}`]: FORWARD_STUB,
      [`POST ${FINAL_EXAMS_URL}`]: FORWARD_STUB,
    };

    const sendResponse = read("get_final_exams");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "page_unreadable" });
    });

    expect(state.calls.map((call) => call.method)).toEqual(["GET", "POST"]);
  });

  it("reports not_logged_in when the POST returns the login form", async () => {
    state.htmlByRequest = {
      [`GET ${FINAL_EXAMS_URL}`]: FORWARD_STUB,
      [`POST ${FINAL_EXAMS_URL}`]: LOGIN_PAGE,
    };

    const sendResponse = read("get_final_exams");

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "not_logged_in" });
    });

    expect(state.calls.map((call) => call.method)).toEqual(["GET", "POST"]);
  });

  it("does not interleave two reads that start at the same time", async () => {
    state.htmlByUrl = {
      [GPA_URL]: fixture("academic-record.html"),
      [ABSENCES_URL]: fixture("absences.html"),
    };

    const gpa = read("get_gpa");
    const absences = read("get_absences");

    await vi.waitFor(() => {
      expect(gpa).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      expect(absences).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    expect(state.maxInFlight).toBe(1);
    expect(state.log).toEqual([
      `GET ${GPA_URL} start`,
      `GET ${GPA_URL} end`,
      `GET ${ABSENCES_URL} start`,
      `GET ${ABSENCES_URL} end`,
    ]);
  });
});
