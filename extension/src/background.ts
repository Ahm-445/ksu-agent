import { keepContractFields } from "./contract.js";
import { handleMessage, type ToolOutcome } from "./handler.js";
import {
  isRecord,
  isToolName,
  readRunTool,
  TOOL_CATEGORIES,
  type ExtensionResponse,
  type ToolName,
} from "./protocol.js";
import { createStore } from "./storage.js";

const store = createStore(chrome.storage.local);

// The academic record page, from docs/phase2-page-map.md. The content script
// fetches it in the student's own Edugate session.
const EDUGATE_TAB_QUERY = { url: "https://edugate.ksu.edu.sa/*" };

// Every tool with a page reader in this step. The LMS tools come later.
const TOOLS_WITH_READER: readonly ToolName[] = [
  "get_gpa",
  "get_absences",
  "get_final_exams",
  "get_schedule",
  "get_grades",
];

const READ_TIMEOUT_MS = 20_000;

const READING_BADGE = "…";

type ReadReply =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

function isReadReply(value: unknown): value is ReadReply {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const reply = value as Record<string, unknown>;

  if (reply.ok === true) {
    return typeof reply.data === "object" && reply.data !== null;
  }

  return reply.ok === false && typeof reply.error === "string";
}

async function findEdugateTab(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query(EDUGATE_TAB_QUERY);

    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        return tab.id;
      }
    }
  } catch {
    return null;
  }

  return null;
}

type AskResult =
  | { kind: "reply"; reply: ReadReply }
  | { kind: "timeout" }
  | { kind: "no_receiver" };

function askTab(tabId: number, tool: ToolName): Promise<AskResult> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (outcome: AskResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => finish({ kind: "timeout" }), READ_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, { kind: "read", tool }, (reply: unknown) => {
      // Reading lastError stops Chrome reporting it as unchecked. It means the tab has
      // no content script: the page was open before the extension was installed or
      // reloaded, so the student has to open or reload Edugate.
      const failure = chrome.runtime.lastError;

      if (failure) {
        finish({ kind: "no_receiver" });
        return;
      }

      finish(
        isReadReply(reply)
          ? { kind: "reply", reply }
          : { kind: "no_receiver" },
      );
    });
  });
}

/**
 * Runs one tool in the student's browser: asks the Edugate tab's content script,
 * which fetches the page in the student's session and returns the fields only.
 */
export async function runToolInBrowser(tool: ToolName): Promise<ToolOutcome> {
  if (!TOOLS_WITH_READER.includes(tool)) {
    return { ok: false, error: "page_unreadable" };
  }

  const tabId = await findEdugateTab();

  if (tabId === null) {
    return { ok: false, error: "not_logged_in" };
  }

  const answer = await askTab(tabId, tool);

  if (answer.kind === "timeout") {
    return { ok: false, error: "timeout" };
  }

  if (answer.kind === "no_receiver") {
    return { ok: false, error: "not_logged_in" };
  }

  if (!answer.reply.ok) {
    return {
      ok: false,
      error:
        answer.reply.error === "not_logged_in" ? "not_logged_in" : "page_unreadable",
    };
  }

  const data = keepContractFields(tool, answer.reply.data);

  return data === null
    ? { ok: false, error: "page_unreadable" }
    : { ok: true, data };
}

/** The badge is a courtesy: a browser that refuses it must not fail a tool run. */
async function setBadge(text: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text });
  } catch {
    // Nothing to do: the student still gets the answer.
  }
}

/**
 * One history entry per run_tool: what was read or refused, never a value the tool
 * returned. A failed write must not change the answer either.
 */
async function recordActivity(
  message: unknown,
  response: ExtensionResponse | null,
): Promise<void> {
  if (response === null || response.kind !== "tool_result") {
    return;
  }

  if (!isRecord(message) || message.kind !== "run_tool") {
    return;
  }

  const fields = readRunTool(message);

  if (!fields || !isToolName(fields.tool)) {
    return;
  }

  const tool = fields.tool;
  const at = new Date().toISOString();
  const category = TOOL_CATEGORIES[tool];

  if (response.ok) {
    await store.addActivity({ at, kind: "read", category, tool, outcome: "ok" });
    return;
  }

  if (response.error === "no_consent") {
    await store.addActivity({
      at,
      kind: "blocked",
      category,
      tool,
      allowed: false,
    });
    return;
  }

  await store.addActivity({
    at,
    kind: "read",
    category,
    tool,
    outcome: response.error,
  });
}

export async function respondToMessage(
  message: unknown,
  senderOrigin: string | undefined,
  runTool: (tool: ToolName) => Promise<ToolOutcome> = runToolInBrowser,
): Promise<ExtensionResponse | null> {
  const categoriesAllowed = await store.getConsent();

  const response = await handleMessage(
    message,
    senderOrigin,
    { categoriesAllowed },
    async (tool) => {
      await setBadge(READING_BADGE);

      try {
        return await runTool(tool);
      } finally {
        await setBadge("");
      }
    },
  );

  try {
    await recordActivity(message, response);
  } catch {
    // The history is best effort; the answer is already on its way.
  }

  return response;
}

chrome.runtime.onMessageExternal.addListener(
  (message: unknown, sender, sendResponse) => {
    void respondToMessage(message, sender.origin).then((response) => {
      if (response !== null) {
        sendResponse(response);
      }
    });

    return true;
  },
);
