import {
  isCategory,
  isRecord,
  isToolName,
  type Category,
  type ToolErrorCode,
  type ToolName,
} from "./protocol.js";

export const CONSENT_KEY = "categoriesAllowed";
export const ACTIVITY_KEY = "activity";
export const MAX_ACTIVITY = 50;

export type ActivityKind = "read" | "blocked" | "consent";

/**
 * One line of the local history. It holds the category, the tool, the time and the
 * outcome, never a value a tool read.
 */
export type ActivityEntry = {
  at: string;
  kind: ActivityKind;
  category: Category;
  tool?: ToolName;
  outcome?: "ok" | ToolErrorCode;
  allowed?: boolean;
};

/** The part of `chrome.storage.local` this module uses; tests pass a fake. */
export type StorageArea = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
};

const OUTCOMES: readonly ("ok" | ToolErrorCode)[] = [
  "ok",
  "no_consent",
  "not_logged_in",
  "page_unreadable",
  "unknown_tool",
  "timeout",
  "bad_request",
];

const ENTRY_KEYS: readonly string[] = [
  "at",
  "kind",
  "category",
  "tool",
  "outcome",
  "allowed",
];

function isOutcome(value: unknown): value is "ok" | ToolErrorCode {
  return typeof value === "string" && (OUTCOMES as readonly string[]).includes(value);
}

function hasOnlyKnownKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => ENTRY_KEYS.includes(key));
}

/**
 * Reads one activity entry and returns it with only the fields its kind allows, or null
 * when it has a missing, mistyped or extra field. An entry carrying a read value (a GPA,
 * a grade, a course) is refused here, before it is ever written.
 */
export function readActivityEntry(value: unknown): ActivityEntry | null {
  if (!isRecord(value) || !hasOnlyKnownKeys(value)) {
    return null;
  }

  const { at, kind, category, tool, outcome, allowed } = value;

  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
    return null;
  }

  if (!isCategory(category)) {
    return null;
  }

  if (kind === "read") {
    return isToolName(tool) && isOutcome(outcome) && allowed === undefined
      ? { at, kind, category, tool, outcome }
      : null;
  }

  if (kind === "blocked") {
    return isToolName(tool) &&
      outcome === undefined &&
      (allowed === undefined || allowed === false)
      ? { at, kind, category, tool, allowed: false }
      : null;
  }

  if (kind === "consent") {
    return tool === undefined &&
      outcome === undefined &&
      typeof allowed === "boolean"
      ? { at, kind, category, allowed }
      : null;
  }

  return null;
}

export type Store = {
  getConsent(): Promise<Category[]>;
  setConsent(category: Category, allowed: boolean): Promise<Category[]>;
  getActivity(): Promise<ActivityEntry[]>;
  addActivity(entry: ActivityEntry): Promise<boolean>;
  disconnect(): Promise<void>;
};

/**
 * The one place that touches `chrome.storage.local`: the consent list and the local
 * history, and nothing else.
 */
export function createStore(area: StorageArea): Store {
  async function getConsent(): Promise<Category[]> {
    try {
      const stored = await area.get([CONSENT_KEY]);
      const value = stored[CONSENT_KEY];

      return Array.isArray(value) ? value.filter(isCategory) : [];
    } catch {
      return [];
    }
  }

  async function getActivity(): Promise<ActivityEntry[]> {
    try {
      const stored = await area.get([ACTIVITY_KEY]);
      const value = stored[ACTIVITY_KEY];

      if (!Array.isArray(value)) {
        return [];
      }

      return value
        .map(readActivityEntry)
        .filter((entry): entry is ActivityEntry => entry !== null);
    } catch {
      return [];
    }
  }

  async function addActivity(entry: ActivityEntry): Promise<boolean> {
    const valid = readActivityEntry(entry);

    if (valid === null) {
      return false;
    }

    const current = await getActivity();

    await area.set({
      [ACTIVITY_KEY]: [valid, ...current].slice(0, MAX_ACTIVITY),
    });

    return true;
  }

  async function setConsent(
    category: Category,
    allowed: boolean,
  ): Promise<Category[]> {
    const current = await getConsent();
    const next = allowed
      ? Array.from(new Set([...current, category]))
      : current.filter((entry) => entry !== category);

    await area.set({ [CONSENT_KEY]: next });
    await addActivity({
      at: new Date().toISOString(),
      kind: "consent",
      category,
      allowed,
    });

    return next;
  }

  async function disconnect(): Promise<void> {
    await area.remove([CONSENT_KEY, ACTIVITY_KEY]);
  }

  return { getConsent, setConsent, getActivity, addActivity, disconnect };
}
