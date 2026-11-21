import { ALLOWED_ORIGINS, VERSION } from "./config.js";
import {
  isCategory,
  isRecord,
  isToolName,
  readRunTool,
  TOOL_CATEGORIES,
  type Category,
  type ExtensionResponse,
  type ToolErrorCode,
  type ToolName,
} from "./protocol.js";

export type HandlerState = {
  categoriesAllowed: string[];
};

/** What a tool run produced: the fields a tool needs, or why it could not run. */
export type ToolOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: ToolErrorCode };

/**
 * Runs one tool. Injected so the handler stays pure: the tests pass a fake, and the
 * service worker passes the one that talks to the Edugate tab.
 */
export type ToolRunner = (tool: ToolName) => Promise<ToolOutcome>;

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

export async function handleMessage(
  message: unknown,
  senderOrigin: string | undefined,
  state: HandlerState,
  runTool: ToolRunner,
): Promise<ExtensionResponse | null> {
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

  const tool = fields.tool;

  if (!isToolName(tool)) {
    return {
      kind: "tool_result",
      request_id: fields.request_id,
      ok: false,
      error: "unknown_tool",
    };
  }

  if (!state.categoriesAllowed.includes(TOOL_CATEGORIES[tool])) {
    return {
      kind: "tool_result",
      request_id: fields.request_id,
      ok: false,
      error: "no_consent",
    };
  }

  const outcome = await runTool(tool);

  if (!outcome.ok) {
    return {
      kind: "tool_result",
      request_id: fields.request_id,
      ok: false,
      error: outcome.error,
    };
  }

  return {
    kind: "tool_result",
    request_id: fields.request_id,
    ok: true,
    data: outcome.data,
    read_at: new Date().toISOString(),
  };
}
