const EXTENSION_ID = (process.env.NEXT_PUBLIC_EXTENSION_ID ?? "").trim();
const PING_TIMEOUT_MS = 1500;

export type ExtensionStatus =
  | { installed: false }
  | { installed: true; version: string; categoriesAllowed: string[] };

type SendMessage = (
  extensionId: string,
  message: unknown,
  callback: (response?: unknown) => void,
) => void;

type Runtime = {
  sendMessage: SendMessage;
  lastError?: { message?: string };
};

function readRuntime(): Runtime | null {
  if (typeof window === "undefined") {
    return null;
  }

  const chrome = (
    window as Window & { chrome?: { runtime?: Partial<Runtime> } }
  ).chrome;
  const runtime = chrome?.runtime;

  if (!runtime || typeof runtime.sendMessage !== "function") {
    return null;
  }

  return runtime as Runtime;
}

function isPong(value: unknown): value is {
  version: string;
  categories_allowed: string[];
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (record.kind !== "pong") {
    return false;
  }

  if (typeof record.version !== "string" || !record.version) {
    return false;
  }

  const categories = record.categories_allowed;

  if (
    !Array.isArray(categories) ||
    !categories.every((entry) => typeof entry === "string")
  ) {
    return false;
  }

  return true;
}

function ping(runtime: Runtime, extensionId: string): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      resolve(undefined);
    }, PING_TIMEOUT_MS);

    const finish = (value: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    try {
      runtime.sendMessage(extensionId, { kind: "ping" }, (response?: unknown) => {
        if (runtime.lastError) {
          finish(undefined);
          return;
        }

        finish(response);
      });
    } catch {
      finish(undefined);
    }
  });
}

export async function detectExtension(): Promise<ExtensionStatus> {
  try {
    const runtime = readRuntime();

    if (!runtime || !EXTENSION_ID) {
      return { installed: false };
    }

    const response = await ping(runtime, EXTENSION_ID);

    if (!isPong(response)) {
      return { installed: false };
    }

    return {
      installed: true,
      version: response.version,
      categoriesAllowed: response.categories_allowed,
    };
  } catch {
    return { installed: false };
  }
}
