import { ALLOWED_ORIGINS, VERSION } from "./config.js";
import {
  isCategory,
  isRecord,
  isToolName,
  readRunTool,
  TOOL_CATEGORIES,
  type Category,
  type ExtensionResponse,
} from "./protocol.js";

export type HandlerState = {
  categoriesAllowed: string[];
};

function isAllowedOrigin(origin: string | undefined): boolean {
  return (
    typeof origin === "string" &&
    (ALLOWED_ORIGINS as readonly string[]).includes(origin)
  );
}

function requestIdOf(message: Record<string, unknown>): string | undefined {
  const requestId = message.request_id;

  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : undefined;
}

function badRequest(requestId?: string): ExtensionResponse {
  return requestId === undefined
    ? { kind: "tool_result", ok: false, error: "bad_request" }
    : { kind: "tool_result", request_id: requestId, ok: false, error: "bad_request" };
}

function allowedCategories(values: string[]): Category[] {
  return values.filter(isCategory);
}

export function handleMessage(
  message: unknown,
  senderOrigin: string | undefined,
  state: HandlerState,
): ExtensionResponse | null {
  if (!isAllowedOrigin(senderOrigin)) {
    return null;
  }

  if (!isRecord(message)) {
    return badRequest();
  }

  if (message.kind === "ping") {
    return {
      kind: "pong",
      version: VERSION,
      categories_allowed: allowedCategories(state.categoriesAllowed),
    };
  }

  if (message.kind !== "run_tool") {
    return badRequest(requestIdOf(message));
  }

  const fields = readRunTool(message);

  if (!fields) {
    return badRequest(requestIdOf(message));
  }

  if (!isToolName(fields.tool)) {
    return {
      kind: "tool_result",
      request_id: fields.request_id,
      ok: false,
      error: "unknown_tool",
    };
  }

  const category = TOOL_CATEGORIES[fields.tool];

  if (!state.categoriesAllowed.includes(category)) {
    return {
      kind: "tool_result",
      request_id: fields.request_id,
      ok: false,
      error: "no_consent",
    };
  }

  // Step 4 adds the page readers. Until then a consented tool has no page to read.
  return {
    kind: "tool_result",
    request_id: fields.request_id,
    ok: false,
    error: "page_unreadable",
  };
}
