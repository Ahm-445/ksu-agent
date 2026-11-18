import { describe, expect, it } from "vitest";
import { ALLOWED_ORIGINS, VERSION } from "../src/config.js";
import { handleMessage } from "../src/handler.js";
import { TOOL_CATEGORIES, TOOL_NAMES } from "../src/protocol.js";

const ORIGIN = "http://localhost:3000";
const NO_CONSENT = { categoriesAllowed: [] as string[] };

describe("handleMessage origin check", () => {
  it("sends nothing back to an origin that is not allowed", () => {
    const response = handleMessage({ kind: "ping" }, "https://evil.example", NO_CONSENT);

    expect(response).toBeNull();
  });

  it("sends nothing back when the sender has no origin", () => {
    const response = handleMessage({ kind: "ping" }, undefined, NO_CONSENT);

    expect(response).toBeNull();
  });

  it("answers on every allowed origin", () => {
    for (const origin of ALLOWED_ORIGINS) {
      expect(handleMessage({ kind: "ping" }, origin, NO_CONSENT)).not.toBeNull();
    }
  });
});

describe("handleMessage ping", () => {
  it("answers a ping with pong, the version and the allowed categories", () => {
    expect(handleMessage({ kind: "ping" }, ORIGIN, NO_CONSENT)).toEqual({
      kind: "pong",
      version: VERSION,
      categories_allowed: [],
    });
  });

  it("lists the categories the student has allowed", () => {
    const response = handleMessage({ kind: "ping" }, ORIGIN, {
      categoriesAllowed: ["grades", "lms"],
    });

    expect(response).toEqual({
      kind: "pong",
      version: VERSION,
      categories_allowed: ["grades", "lms"],
    });
  });
});

describe("handleMessage run_tool", () => {
  it("rejects an unknown tool", () => {
    const response = handleMessage(
      { kind: "run_tool", request_id: "r-1", tool: "get_payroll", args: {} },
      ORIGIN,
      NO_CONSENT,
    );

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-1",
      ok: false,
      error: "unknown_tool",
    });
  });

  it.each(TOOL_NAMES)("asks for consent for %s", (tool) => {
    const response = handleMessage(
      { kind: "run_tool", request_id: "r-2", tool, args: {} },
      ORIGIN,
      NO_CONSENT,
    );

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-2",
      ok: false,
      error: "no_consent",
    });
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

  it("does not block a tool whose category is allowed", () => {
    const response = handleMessage(
      { kind: "run_tool", request_id: "r-3", tool: "get_gpa", args: {} },
      ORIGIN,
      { categoriesAllowed: ["grades"] },
    );

    expect(response).not.toEqual(
      expect.objectContaining({ error: "no_consent" }),
    );
  });
});

describe("handleMessage malformed messages", () => {
  it.each([
    ["null", null],
    ["a string", "ping"],
    ["a number", 42],
    ["an array", []],
  ])("rejects %s", (_label, message) => {
    const response = handleMessage(message, ORIGIN, NO_CONSENT);

    expect(response).toEqual({ kind: "tool_result", ok: false, error: "bad_request" });
  });

  it("rejects a message with no kind", () => {
    const response = handleMessage({ request_id: "r-4" }, ORIGIN, NO_CONSENT);

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-4",
      ok: false,
      error: "bad_request",
    });
  });

  it("rejects an unknown kind", () => {
    const response = handleMessage({ kind: "logout" }, ORIGIN, NO_CONSENT);

    expect(response).toEqual({ kind: "tool_result", ok: false, error: "bad_request" });
  });

  it("rejects run_tool without a request_id", () => {
    const response = handleMessage(
      { kind: "run_tool", tool: "get_gpa", args: {} },
      ORIGIN,
      NO_CONSENT,
    );

    expect(response).toEqual({ kind: "tool_result", ok: false, error: "bad_request" });
  });

  it("rejects run_tool without a tool", () => {
    const response = handleMessage(
      { kind: "run_tool", request_id: "r-5", args: {} },
      ORIGIN,
      NO_CONSENT,
    );

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-5",
      ok: false,
      error: "bad_request",
    });
  });

  it("rejects run_tool whose args are not an object", () => {
    const response = handleMessage(
      { kind: "run_tool", request_id: "r-6", tool: "get_gpa", args: 3 },
      ORIGIN,
      NO_CONSENT,
    );

    expect(response).toEqual({
      kind: "tool_result",
      request_id: "r-6",
      ok: false,
      error: "bad_request",
    });
  });
});
