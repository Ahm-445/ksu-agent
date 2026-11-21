import { activityLines } from "./labels.js";
import { isCategory, type Category } from "./protocol.js";
import { createStore, type ActivityEntry } from "./storage.js";

const HISTORY_LIMIT = 20;

const store = createStore(chrome.storage.local);

const version = chrome.runtime.getManifest().version;

for (const node of document.querySelectorAll("[data-version]")) {
  node.textContent = version;
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);

  if (!found) {
    throw new Error(`popup.html is missing ${selector}`);
  }

  return found;
}

const switches = Array.from(
  document.querySelectorAll<HTMLInputElement>("input[data-consent]"),
);
const historyList = element<HTMLUListElement>("#history");
const disconnectButton = element<HTMLButtonElement>("#disconnect");
const confirmBox = element<HTMLDivElement>("#disconnect-confirm");
const confirmButton = element<HTMLButtonElement>("#confirm-yes");
const cancelButton = element<HTMLButtonElement>("#confirm-cancel");

function paint(allowed: readonly Category[]): void {
  for (const input of switches) {
    const category = input.dataset.consent;
    input.checked = isCategory(category) && allowed.includes(category);
  }
}

function line(ar: string, en: string, className: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = className;

  const arabic = document.createElement("span");
  arabic.textContent = ar;

  const english = document.createElement("span");
  english.className = "en";
  english.lang = "en";
  english.dir = "ltr";
  english.textContent = en;

  item.append(arabic, english);

  return item;
}

function renderHistory(entries: readonly ActivityEntry[]): void {
  const newest = entries.slice(0, HISTORY_LIMIT);

  if (newest.length === 0) {
    historyList.replaceChildren(
      line("لا يوجد نشاط بعد", "No activity yet", "history-empty"),
    );
    return;
  }

  historyList.replaceChildren(
    ...newest.map((entry) => {
      const text = activityLines(entry);

      return line(text.ar, text.en, "history-item");
    }),
  );
}

async function refreshHistory(): Promise<void> {
  renderHistory(await store.getActivity());
}

for (const input of switches) {
  input.addEventListener("change", () => {
    void (async () => {
      const category = input.dataset.consent;

      if (!isCategory(category)) {
        return;
      }

      try {
        paint(await store.setConsent(category, input.checked));
      } catch {
        // A failed write shows the stored consent, not a switch that lies.
        paint(await store.getConsent());
      }

      await refreshHistory();
    })();
  });
}

function showConfirm(): void {
  confirmBox.hidden = false;
  confirmButton.focus();
}

function hideConfirm(focusTarget: HTMLElement): void {
  confirmBox.hidden = true;
  focusTarget.focus();
}

disconnectButton.addEventListener("click", showConfirm);
cancelButton.addEventListener("click", () => hideConfirm(disconnectButton));

confirmBox.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    hideConfirm(disconnectButton);
  }
});

confirmButton.addEventListener("click", () => {
  void (async () => {
    try {
      await store.disconnect();
    } finally {
      paint([]);
      renderHistory([]);
      hideConfirm(disconnectButton);
    }
  })();
});

void (async () => {
  paint(await store.getConsent());
  await refreshHistory();
})();
