import { handleMessage } from "./handler.js";
import type { ExtensionResponse } from "./protocol.js";

const DEFAULT_CATEGORIES: string[] = [];

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

export async function respondToMessage(
  message: unknown,
  senderOrigin: string | undefined,
): Promise<ExtensionResponse | null> {
  const categoriesAllowed = await readCategoriesAllowed();

  return handleMessage(message, senderOrigin, { categoriesAllowed });
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
