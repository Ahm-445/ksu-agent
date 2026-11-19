import { describe, expect, it, vi } from "vitest";
import { ALLOWED_ORIGINS, VERSION } from "../src/config.js";
import { handleMessage, type ToolRunner } from "../src/handler.js";
import { TOOL_CATEGORIES, TOOL_NAMES } from "../src/protocol.js";

const ORIGIN = "http://localhost:3000";
const NO_CONSENT = { categoriesAllowed: [] as string[] };

const NEVER_RUN: ToolRunner = async () => {
  throw new Error("the tool runner must not be called");
};

const GPA = { cumulative_gpa: "4.31", scale: "5", earned_hours: 95, registered_hours: 98, as_of_term: "الفصل الأول 1447/1448" };

describe("handleMessage origin check", () => {
  it("sends nothing back to an origin that is not allowed", async () => {
    const response = await handleMessage({ kind: "ping" }, "https://evil.example", NO_CONSENT, NEVER_RUN);

    expect(response).toBeNull();
  });

  it("sends nothing back when the sender has no origin", async () => {
    const response = await handleMessage({ kind: "ping" }, undefined, NO_CONSENT, NEVER_RUN);

    expect(response).toBeNull();
  });

  it("answers on every allowed origin", async () => {
    for (const origin of ALLOWED_ORIGINS) {
      expect(await handleMessage({ kind: "ping" }, origin, NO_CONSENT, NEVER_RUN)).not.toBeNull();
    }
  });
});

describe("handleMessage ping", () => {
  it("answers a ping with pong, the version and the allowed categories", async () => {
    expect(await handleMessage({ kind: "ping" }, ORIGIN, NO_CONSENT, NEVER_RUN)).toEqual({
      kind: "pong",
      version: VERSION,
      categories_allowed: [],
    });
  });

  it("lists the categories the student has allowed", async () => {
    const response = await handleMessage({ kind: "ping" }, ORIGIN, {
      categoriesAllowed: ["grades", "lms"],
    }, NEVER_RUN);

    expect(response).toEqual({
      kind: "pong",
      version: VERSION,
      categories_allowed: ["grades", "lms"],
    });
  });
});

describe("handleMessage run_tool", () => {
  it("rejects an unknown tool", async () => {
    const response = await handleMessage(
      { kind: "run_tool", request_id: "r-1", tool: "get_payroll", args: {} },
      ORIGIN,
      NO_CONSENT,
      NEVER_RUN,
    );

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-1",
      ok: false,
      error: "unknown_tool",
    });
  });

  it.each(TOOL_NAMES)("asks for consent for %s", async (tool) => {
    const runTool = vi.fn<Parameters<ToolRunner>, ReturnType<ToolRunner>>();

    const response = await handleMessage(
      { kind: "run_tool", request_id: "r-2", tool, args: {} },
      ORIGIN,
      NO_CONSENT,
      runTool,
    );

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-2",
      ok: false,
      error: "no_consent",
    });
    expect(runTool).not.toHaveBeenCalled();
  });

  it("maps every tool to a contract category", () => {
    expect(Object.keys(TOOL_CATEGORIES)).toHaveLength(9);
    expect(TOOL_CATEGORIES.get_gpa).toBe("grades");
    expect(TOOL_CATEGORIES.get_grades).toBe("grades");
    expect(TOOL_CATEGORIES.get_lms_grades).toBe("grades");
    expect(TOOL_CATEGORIES.get_schedule).toBe("schedule");
    expect(TOOL_CATEGORIES.get_final_exams).toBe("schedule");
    expect(TOOL_CATEGORIES.get_absences).toBe("attendance");
    expect(TOOL_CATEGORIES.get_plan_progress).toBe("plan");
    expect(TOOL_CATEGORIES.get_courses).toBe("lms");
    expect(TOOL_CATEGORIES.get_assignments).toBe("lms");
  });

  it("runs a tool whose category the student allowed", async () => {
    const runTool = vi.fn(async () => ({ ok: true as const, data: GPA }));

    const response = await handleMessage(
      { kind: "run_tool", request_id: "r-3", tool: "get_gpa", args: {} },
      ORIGIN,
      { categoriesAllowed: ["grades"] },
      runTool,
    );

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith("get_gpa");
    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-3",
      ok: true,
      data: GPA,
      read_at: expect.any(String),
    });
  });

  it("stamps read_at with an ISO time", async () => {
    const response = await handleMessage(
      { kind: "run_tool", request_id: "r-4", tool: "get_gpa", args: {} },
      ORIGIN,
      { categoriesAllowed: ["grades"] },
      async () => ({ ok: true, data: GPA }),
    );

    if (response === null || response.kind !== "tool_result" || !response.ok) {
      throw new Error("expected a successful tool_result");
    }

    expect(response.read_at).toBe(new Date(response.read_at).toISOString());
  });

  it.each(["not_logged_in", "page_unreadable", "timeout"] as const)(
    "passes a %s failure through unchanged",
    async (error) => {
      const response = await handleMessage(
        { kind: "run_tool", request_id: "r-5", tool: "get_gpa", args: {} },
        ORIGIN,
        { categoriesAllowed: ["grades"] },
        async () => ({ ok: false, error }),
      );

      expect(response).toEqual({
        kind: "tool_result",
        request_id: "r-5",
        ok: false,
        error,
      });
    },
  );
});

describe("handleMessage malformed messages", () => {
  it.each([
    ["null", null],
    ["a string", "ping"],
    ["a number", 42],
    ["an array", []],
  ])("rejects %s", async (_label, message) => {
    const response = await handleMessage(message, ORIGIN, NO_CONSENT, NEVER_RUN);

    expect(response).toEqual({ kind: "tool_result", ok: false, error: "bad_request" });
  });

  it("rejects a message with no kind", async () => {
    const response = await handleMessage({ request_id: "r-6" }, ORIGIN, NO_CONSENT, NEVER_RUN);

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-6",
      ok: false,
      error: "bad_request",
    });
  });

  it("rejects an unknown kind", async () => {
    const response = await handleMessage({ kind: "logout" }, ORIGIN, NO_CONSENT, NEVER_RUN);

    expect(response).toEqual({ kind: "tool_result", ok: false, error: "bad_request" });
  });

  it("rejects run_tool without a request_id", async () => {
    const response = await handleMessage(
      { kind: "run_tool", tool: "get_gpa", args: {} },
      ORIGIN,
      NO_CONSENT,
      NEVER_RUN,
    );

    expect(response).toEqual({ kind: "tool_result", ok: false, error: "bad_request" });
  });

  it("rejects run_tool without a tool", async () => {
    const response = await handleMessage(
      { kind: "run_tool", request_id: "r-7", args: {} },
      ORIGIN,
      NO_CONSENT,
      NEVER_RUN,
    );

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-7",
      ok: false,
      error: "bad_request",
    });
  });

  it("rejects run_tool whose args are not an object", async () => {
    const response = await handleMessage(
      { kind: "run_tool", request_id: "r-8", tool: "get_gpa", args: 3 },
      ORIGIN,
      NO_CONSENT,
      NEVER_RUN,
    );

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-8",
      ok: false,
      error: "bad_request",
    });
  });
});
