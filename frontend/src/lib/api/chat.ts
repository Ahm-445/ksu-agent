export type Citation = {
  title: string;
  article: string;
  url: string;
};

export type ChatErrorKind =
  | "unauthenticated"
  | "invalid"
  | "server_unavailable"
  | "aborted";

/** What an answer rests on: the regulation, or the student's own numbers alone. */
export type AnswerBasis = "regulation" | "student_data";

export type SendMessageResult =
  | {
      ok: true;
      kind: "answer";
      answer: string;
      citations: Citation[];
      basis: AnswerBasis;
    }
  | { ok: true; kind: "tool"; tool: string }
  | {
      ok: true;
      kind: "reason";
      tools: string[];
      /** Binds this question to its route; sent back once with the approved values. */
      routeToken: string;
    }
  | { ok: false; error: ChatErrorKind };

export type SendMessageInput = {
  message: string;
  sessionId: string;
  signal?: AbortSignal;
};

export type SendWithDataInput = SendMessageInput & {
  /** One entry per tool the reply named, holding exactly the contract's fields. */
  data: Record<string, unknown>;
  /** The token the reasoning reply carried, unchanged and unread by the browser. */
  routeToken: string;
};

const MODE = process.env.NEXT_PUBLIC_CHAT_MODE === "api" ? "api" : "mock";
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCitations(value: unknown): Citation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const citations: Citation[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      return null;
    }

    const { title, article, url } = entry;

    if (typeof title !== "string" || typeof url !== "string") {
      return null;
    }

    // The backend sends the article number as an integer, or null for chunks
    // without one (the annex). Keep it as text for display and storage.
    let articleText: string;

    if (typeof article === "string") {
      articleText = article;
    } else if (typeof article === "number" && Number.isFinite(article)) {
      articleText = String(article);
    } else if (article === null || article === undefined) {
      articleText = "";
    } else {
      return null;
    }

    citations.push({
      title,
      article: articleText,
      url,
    });
  }

  return citations;
}

/**
 * The basis the backend names, and the regulation for anything else: a body without it
 * (an older server) is a regulation answer.
 */
function parseBasis(value: unknown): AnswerBasis {
  return value === "student_data" ? "student_data" : "regulation";
}

function parseAnswer(body: unknown): SendMessageResult | null {
  if (!isRecord(body)) {
    return null;
  }

  const { answer, citations, basis } = body;

  if (typeof answer !== "string" || !answer.trim()) {
    return null;
  }

  const parsedCitations = parseCitations(citations);

  if (!parsedCitations) {
    return null;
  }

  return {
    ok: true,
    kind: "answer",
    answer,
    citations: parsedCitations,
    basis: parseBasis(basis),
  };
}

function parseTool(body: Record<string, unknown>): SendMessageResult | null {
  const { tool } = body;

  if (typeof tool !== "string" || !tool) {
    return null;
  }

  return { ok: true, kind: "tool", tool };
}

/** A `reason` reply names one to three tools, and the token that binds them to the question. */
const MAX_REASON_TOOLS = 3;

function parseReason(body: Record<string, unknown>): SendMessageResult | null {
  const { tools, route_token: routeToken } = body;

  if (
    !Array.isArray(tools) ||
    tools.length < 1 ||
    tools.length > MAX_REASON_TOOLS ||
    !tools.every((tool) => typeof tool === "string" && tool.length > 0)
  ) {
    return null;
  }

  // Without the token the approved values could not be sent back, so a reply that lacks it
  // is not a reasoning reply the website can act on.
  if (typeof routeToken !== "string" || !routeToken) {
    return null;
  }

  return { ok: true, kind: "reason", tools, routeToken };
}

/** A body without `type` is an answer, as the contract says. */
export function parseChatResponse(body: unknown): SendMessageResult | null {
  if (!isRecord(body)) {
    return null;
  }

  if (body.type === "tool") {
    return parseTool(body);
  }

  if (body.type === "reason") {
    return parseReason(body);
  }

  if (body.type === undefined || body.type === "answer") {
    return parseAnswer(body);
  }

  return null;
}

/** One POST to the API, with the same timeout and error codes for both endpoints. */
async function post(
  path: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<SendMessageResult> {
  if (signal?.aborted) {
    return { ok: false, error: "aborted" };
  }

  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);

  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 200) {
      let body: unknown = null;

      try {
        body = await response.json();
      } catch {
        return { ok: false, error: "server_unavailable" };
      }

      return parseChatResponse(body) ?? { ok: false, error: "server_unavailable" };
    }

    if (response.status === 401) {
      return { ok: false, error: "unauthenticated" };
    }

    if (response.status === 422) {
      return { ok: false, error: "invalid" };
    }

    return { ok: false, error: "server_unavailable" };
  } catch {
    if (signal?.aborted) {
      return { ok: false, error: "aborted" };
    }

    if (timedOut) {
      return { ok: false, error: "server_unavailable" };
    }

    return { ok: false, error: "server_unavailable" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

export async function sendMessage({
  message,
  sessionId,
  signal,
}: SendMessageInput): Promise<SendMessageResult> {
  if (MODE === "mock") {
    const { mockSendMessage } = await import("./chatMock");
    return mockSendMessage({ message, sessionId, signal });
  }

  return post("/chat", { message, session_id: sessionId }, signal);
}

/**
 * Sends the values the student approved, once, for one question. Called only from the
 * consent card's approve button; nothing else reaches `/chat/with-data`.
 */
export async function sendWithData({
  message,
  sessionId,
  data,
  routeToken,
  signal,
}: SendWithDataInput): Promise<SendMessageResult> {
  if (MODE === "mock") {
    const { mockSendWithData } = await import("./chatMock");
    return mockSendWithData({ message, sessionId, data, routeToken, signal });
  }

  return post(
    "/chat/with-data",
    { message, session_id: sessionId, data, route_token: routeToken },
    signal,
  );
}
