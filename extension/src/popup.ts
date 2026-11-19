// The popup holds the student's consent. Step 5 replaces this one switch with the
// full consent screen; until then the switch covers the grades category only.

const CONSENT_KEY = "categoriesAllowed";
const GRADES = "grades";

const version = chrome.runtime.getManifest().version;

for (const node of document.querySelectorAll("[data-version]")) {
  node.textContent = version;
}

const switches = Array.from(
  document.querySelectorAll<HTMLInputElement>("input[data-consent='grades']"),
);

function paint(allowed: readonly string[]): void {
  for (const input of switches) {
    input.checked = allowed.includes(GRADES);
  }
}

async function readAllowed(): Promise<string[]> {
  try {
    const stored = await chrome.storage.local.get({ [CONSENT_KEY]: [] });
    const value: unknown = stored[CONSENT_KEY];

    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

async function writeAllowed(allowed: string[]): Promise<boolean> {
  try {
    await chrome.storage.local.set({ [CONSENT_KEY]: allowed });

    return true;
  } catch {
    return false;
  }
}

for (const input of switches) {
  input.addEventListener("change", () => {
    void (async () => {
      const stored = await readAllowed();
      const next = input.checked
        ? Array.from(new Set([...stored, GRADES]))
        : stored.filter((entry) => entry !== GRADES);

      // A failed write shows the stored value again rather than a switch that lies.
      paint((await writeAllowed(next)) ? next : stored);
    })();
  });
}

void readAllowed().then(paint);
