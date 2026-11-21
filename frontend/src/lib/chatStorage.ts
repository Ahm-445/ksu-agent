import type { AnswerBasis, Citation } from "@/lib/api/chat";

export const CHAT_STORAGE_PREFIX = "ksu-agent-chat:";
export const MAX_STORED_MESSAGES = 50;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  note?: string;
  personal?: boolean;
  citations?: Citation[];
  /** What the answer rests on, so a stored answer still says so after a reload. */
  basis?: AnswerBasis;
  status: "ok" | "error";
  errorKind?: "invalid" | "server_unavailable";
};

export type StoredChat = {
  session_id: string;
  messages: ChatMessage[];
};

function storageKey(userId: string): string {
  return `${CHAT_STORAGE_PREFIX}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCitations(value: unknown): Citation[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const citations: Citation[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const { title, article, url } = entry;

    if (
      typeof title === "string" &&
      typeof url === "string" &&
      typeof article === "string"
    ) {
      citations.push({ title, article, url });
    }
  }

  return citations;
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, role, text, note, personal, status, errorKind, basis } = value;

  if (typeof id !== "string" || typeof text !== "string") {
    return null;
  }

  if (role !== "user" && role !== "assistant") {
    return null;
  }

  if (status !== "ok" && status !== "error") {
    return null;
  }

  const message: ChatMessage = { id, role, text, status };

  if (typeof note === "string" && note) {
    message.note = note;
  }

  if (personal === true) {
    message.personal = true;
  }

  if (errorKind === "invalid" || errorKind === "server_unavailable") {
    message.errorKind = errorKind;
  }

  if (basis === "regulation" || basis === "student_data") {
    message.basis = basis;
  }

  const citations = parseCitations(value.citations);

  if (citations && citations.length > 0) {
    message.citations = citations;
  }

  return message;
}

export function readChat(userId: string): StoredChat | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId));

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return null;
    }

    const sessionId = parsed.session_id;

    if (typeof sessionId !== "string" || !sessionId) {
      return null;
    }

    if (!Array.isArray(parsed.messages)) {
      return null;
    }

    const messages: ChatMessage[] = [];

    for (const entry of parsed.messages) {
      const message = parseMessage(entry);

      if (message) {
        messages.push(message);
      }
    }

    return { session_id: sessionId, messages: messages.slice(-MAX_STORED_MESSAGES) };
  } catch {
    return null;
  }
}

export function writeChat(userId: string, chat: StoredChat): void {
  try {
    // Written through the same reader that reads it back: a message keeps its own fields
    // and nothing else, so a caller that attaches a tool's payload cannot put a value in
    // web storage (ADR 0001, rule 4).
    const messages = chat.messages
      .map(parseMessage)
      .filter((message): message is ChatMessage => message !== null)
      .slice(-MAX_STORED_MESSAGES);

    window.sessionStorage.setItem(
      storageKey(userId),
      JSON.stringify({ session_id: chat.session_id, messages }),
    );
  } catch {
    // Storage unavailable or full: the conversation stays in memory.
  }
}

export function clearChatSessions(): void {
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);

      if (key && key.startsWith(CHAT_STORAGE_PREFIX)) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
