import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../src/config.js";

type Listener = (
  message: unknown,
  sender: { origin?: string },
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

const state: {
  listener?: Listener;
  stored: unknown;
  storageThrows: boolean;
} = { stored: [], storageThrows: false };

vi.stubGlobal("chrome", {
  runtime: {
    onMessageExternal: {
      addListener: (listener: Listener) => {
        state.listener = listener;
      },
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
});

const { respondToMessage } = await import("../src/background.js");

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
