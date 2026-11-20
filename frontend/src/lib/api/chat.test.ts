import { afterEach, describe, expect, it, vi } from "vitest";

import { parseChatResponse } from "@/lib/api/chat";

const GPA = {
  cumulative_gpa: "4.21",
  scale: "5",
  earned_hours: 96,
  registered_hours: 99,
  as_of_term: "الفصل الأول 1448/1449",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a reasoning reply", () => {
  it("names its tools and carries no data", () => {
    const result = parseChatResponse({
      type: "reason",
      tools: ["get_plan_progress", "get_gpa"],
    });

    expect(result).toEqual({
      ok: true,
      kind: "reason",
      tools: ["get_plan_progress", "get_gpa"],
    });
  });

  it("is not an answer when the tools are missing, empty or too many", () => {
    expect(parseChatResponse({ type: "reason" })).toBeNull();
    expect(parseChatResponse({ type: "reason", tools: [] })).toBeNull();
    expect(
      parseChatResponse({ type: "reason", tools: ["a", "b", "c", "d"] }),
    ).toBeNull();
    expect(parseChatResponse({ type: "reason", tools: [1] })).toBeNull();
    expect(parseChatResponse({ type: "reason", tools: [""] })).toBeNull();
  });

  it("does not change what an answer or a tool reply means", () => {
    expect(
      parseChatResponse({ type: "tool", tool: "get_gpa", args: {} }),
    ).toEqual({ ok: true, kind: "tool", tool: "get_gpa" });

    expect(
      parseChatResponse({ answer: "نص", citations: [] }),
    ).toEqual({ ok: true, kind: "answer", answer: "نص", citations: [] });
  });
});

describe("sending the approved values", () => {
  it("posts the data map to /chat/with-data", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAT_MODE", "api");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example/");
    vi.resetModules();

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ type: "answer", answer: "جواب", citations: [] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { sendWithData } = await import("@/lib/api/chat");
    const data = { get_gpa: GPA };

    const result = await sendWithData({
      message: "هل أقدر أتخرج؟",
      sessionId: "s-1",
      data,
    });

    expect(result).toEqual({
      ok: true,
      kind: "answer",
      answer: "جواب",
      citations: [],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.example/chat/with-data");
    expect(JSON.parse(String(init.body))).toEqual({
      message: "هل أقدر أتخرج؟",
      session_id: "s-1",
      data,
    });
  });

  it("reports a 422 as an invalid message, not as a server outage", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAT_MODE", "api");
    vi.resetModules();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 422 })),
    );

    const { sendWithData } = await import("@/lib/api/chat");

    expect(
      await sendWithData({ message: "س", sessionId: "s-1", data: { get_gpa: GPA } }),
    ).toEqual({ ok: false, error: "invalid" });
  });

  it("reports a missing session as unauthenticated", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAT_MODE", "api");
    vi.resetModules();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );

    const { sendWithData } = await import("@/lib/api/chat");

    expect(
      await sendWithData({ message: "س", sessionId: "s-1", data: { get_gpa: GPA } }),
    ).toEqual({ ok: false, error: "unauthenticated" });
  });
});
