import { handleMessage, type ToolOutcome } from "./handler.js";
import type { ExtensionResponse, ToolName } from "./protocol.js";

const DEFAULT_CATEGORIES: string[] = [];

// The academic record page, from docs/phase2-page-map.md. The content script
// fetches it in the student's own Edugate session.
const EDUGATE_TAB_QUERY = { url: "https://edugate.ksu.edu.sa/*" };

// The only tool with a page reader in this step; the rest are added one at a time.
const TOOLS_WITH_READER: readonly ToolName[] = ["get_gpa"];

const READ_TIMEOUT_MS = 20_000;

type ReadReply =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

async function readCategoriesAllowed(): Promise<string[]> {
  try {
    const stored = await chrome.storage.local.get({ categoriesAllowed: [] });
    const value: unknown = stored.categoriesAllowed;

    if (!Array.isArray(value)) {
      return DEFAULT_CATEGORIES;
    }

    return value.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

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
 * The contract fields of one tool, and only those: a value the contract does not list
 * is dropped, and a missing or mistyped one makes the page unreadable.
 */
function keepContractFields(
  tool: ToolName,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  if (tool !== "get_gpa") {
    return null;
  }

  const { cumulative_gpa, scale, earned_hours, registered_hours, as_of_term } = data;

  if (
    typeof cumulative_gpa !== "string" ||
    typeof scale !== "string" ||
    typeof earned_hours !== "number" ||
    typeof registered_hours !== "number" ||
    typeof as_of_term !== "string"
  ) {
    return null;
  }

  return { cumulative_gpa, scale, earned_hours, registered_hours, as_of_term };
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

export async function respondToMessage(
  message: unknown,
  senderOrigin: string | undefined,
  runTool: (tool: ToolName) => Promise<ToolOutcome> = runToolInBrowser,
): Promise<ExtensionResponse | null> {
  const categoriesAllowed = await readCategoriesAllowed();

  return handleMessage(message, senderOrigin, { categoriesAllowed }, runTool);
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
