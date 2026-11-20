import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_STORAGE_PREFIX,
  MAX_STORED_MESSAGES,
  clearChatSessions,
  readChat,
  writeChat,
  type ChatMessage,
} from "@/lib/chatStorage";

const USER = "u-1";
const KEY = `${CHAT_STORAGE_PREFIX}${USER}`;

/** An answer the website built in the browser from the values a tool read. */
function answer(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m-1",
    role: "assistant",
    text: "معدلك التراكمي 4,31 من 5.",
    note: "من سجلك في Edugate.",
    personal: true,
    status: "ok",
    ...overrides,
  };
}

function stored(): Record<string, unknown> {
  return JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe("the stored conversation", () => {
  it("round-trips the session id and a personal answer", () => {
    writeChat(USER, { session_id: "s-1", messages: [answer()] });

    expect(readChat(USER)).toEqual({
      session_id: "s-1",
      messages: [answer()],
    });
  });

  it("writes only the fields a message is allowed to have", () => {
    // A caller that hands over the tool's own payload by mistake: the writer keeps the
    // message's own fields and nothing else, so no value reaches web storage.
    const withPayload = {
      ...answer(),
      data: { cumulative_gpa: "4.31", scale: "5" },
      read_at: "2026-11-20T09:00:00+03:00",
    } as unknown as ChatMessage;

    writeChat(USER, { session_id: "s-1", messages: [withPayload] });

    const raw = window.sessionStorage.getItem(KEY) ?? "";

    expect(raw).not.toContain("cumulative_gpa");
    expect(raw).not.toContain("read_at");

    const [message] = stored().messages as ChatMessage[];

    expect(Object.keys(message).sort()).toEqual([
      "id",
      "note",
      "personal",
      "role",
      "status",
      "text",
    ]);
  });

  it("keeps the last fifty messages and no more", () => {
    const messages = Array.from({ length: MAX_STORED_MESSAGES + 10 }, (_value, index) =>
      answer({ id: `m-${index}` }),
    );

    writeChat(USER, { session_id: "s-1", messages });

    const chat = readChat(USER);

    expect(chat?.messages).toHaveLength(MAX_STORED_MESSAGES);
    expect(chat?.messages[0].id).toBe("m-10");
    expect(chat?.messages.at(-1)?.id).toBe(`m-${MAX_STORED_MESSAGES + 9}`);
  });

  it("is null when nothing was stored for this student", () => {
    expect(readChat(USER)).toBeNull();
  });

  it("drops a message it cannot read and keeps the rest", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        session_id: "s-1",
        messages: [
          { id: "bad", role: "system", text: "x", status: "ok" },
          { id: "m-2", role: "user", text: "ما معدلي؟", status: "ok" },
        ],
      }),
    );

    expect(readChat(USER)).toEqual({
      session_id: "s-1",
      messages: [{ id: "m-2", role: "user", text: "ما معدلي؟", status: "ok" }],
    });
  });

  it("is null when the record is not the shape it writes", () => {
    window.sessionStorage.setItem(KEY, "{not json");
    expect(readChat(USER)).toBeNull();

    window.sessionStorage.setItem(KEY, JSON.stringify({ messages: [] }));
    expect(readChat(USER)).toBeNull();
  });

  it("keeps the conversation in memory when storage refuses the write", () => {
    const setItem = vi
      .spyOn(window.sessionStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() =>
      writeChat(USER, { session_id: "s-1", messages: [answer()] }),
    ).not.toThrow();

    setItem.mockRestore();
  });
});

describe("clearing", () => {
  it("removes every student's chat and leaves other storage alone", () => {
    writeChat("u-1", { session_id: "s-1", messages: [answer()] });
    writeChat("u-2", { session_id: "s-2", messages: [answer()] });
    window.sessionStorage.setItem("ksu-agent-lang", "ar");

    clearChatSessions();

    expect(window.sessionStorage.getItem(`${CHAT_STORAGE_PREFIX}u-1`)).toBeNull();
    expect(window.sessionStorage.getItem(`${CHAT_STORAGE_PREFIX}u-2`)).toBeNull();
    expect(window.sessionStorage.getItem("ksu-agent-lang")).toBe("ar");
  });
});
