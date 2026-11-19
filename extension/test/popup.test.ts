// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { data: Record<string, unknown> } = { data: {} };

vi.stubGlobal("chrome", {
  runtime: { getManifest: () => ({ version: "0.1.0" }) },
  storage: {
    local: {
      get: async (keys: string[]) => {
        const stored: Record<string, unknown> = {};

        for (const key of keys) {
          if (key in state.data) {
            stored[key] = state.data[key];
          }
        }

        return stored;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(state.data, items);
      },
      remove: async (keys: string[]) => {
        for (const key of keys) {
          delete state.data[key];
        }
      },
    },
  },
});

const markup = readFileSync(join(process.cwd(), "popup.html"), "utf8");

const CATEGORIES = ["grades", "schedule", "attendance", "plan", "lms"] as const;

async function loadPopup(): Promise<void> {
  const parsed = new DOMParser().parseFromString(markup, "text/html");

  document.body.replaceChildren(
    ...Array.from(parsed.body.childNodes, (node) => node.cloneNode(true)),
  );

  vi.resetModules();
  await import("../src/popup.js");
}

function field(category: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    `input[data-consent="${category}"]`,
  );

  if (!found) {
    throw new Error(`popup.html has no switch for ${category}`);
  }

  return found;
}

function button(id: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`#${id}`);

  if (!found) {
    throw new Error(`popup.html has no button ${id}`);
  }

  return found;
}

function confirmBox(): HTMLDivElement {
  const found = document.querySelector<HTMLDivElement>("#disconnect-confirm");

  if (!found) {
    throw new Error("popup.html has no confirmation");
  }

  return found;
}

function history(): HTMLLIElement[] {
  return Array.from(document.querySelectorAll<HTMLLIElement>("#history li"));
}

function lines(index: number): string[] {
  const item = history()[index];

  return Array.from(item?.children ?? [], (child) => child.textContent ?? "");
}

function toggle(category: string, checked: boolean): void {
  const input = field(category);
  input.checked = checked;
  input.dispatchEvent(new Event("change"));
}

const AT = new Date(2026, 10, 19, 14, 5).toISOString();

beforeEach(() => {
  state.data = {};
});

describe("the consent screen", () => {
  it("starts with every switch off and an empty history", async () => {
    await loadPopup();

    await vi.waitFor(() => {
      expect(history()).toHaveLength(1);
    });

    for (const category of CATEGORIES) {
      expect(field(category).checked).toBe(false);
    }

    expect(history()[0]?.textContent).toContain("لا يوجد نشاط بعد");
    expect(history()[0]?.textContent).toContain("No activity yet");
  });

  it("shows the stored consent", async () => {
    state.data.categoriesAllowed = ["grades", "lms"];

    await loadPopup();

    await vi.waitFor(() => {
      expect(field("grades").checked).toBe(true);
    });

    expect(field("schedule").checked).toBe(false);
    expect(field("attendance").checked).toBe(false);
    expect(field("plan").checked).toBe(false);
    expect(field("lms").checked).toBe(true);
  });

  it("ties every switch to a label", async () => {
    await loadPopup();

    for (const category of CATEGORIES) {
      const input = field(category);

      expect(input.id).not.toBe("");
      expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    }
  });

  it("writes the consent and a consent entry when a switch changes", async () => {
    await loadPopup();

    await vi.waitFor(() => {
      expect(history()).toHaveLength(1);
    });

    toggle("schedule", true);

    await vi.waitFor(() => {
      expect(state.data.categoriesAllowed).toEqual(["schedule"]);
    });

    await vi.waitFor(() => {
      expect(state.data.activity).toEqual([
        {
          at: expect.any(String),
          kind: "consent",
          category: "schedule",
          allowed: true,
        },
      ]);
    });

    await vi.waitFor(() => {
      expect(history()[0]?.textContent).toContain("السماح بالجدول الدراسي");
    });

    toggle("schedule", false);

    await vi.waitFor(() => {
      expect(state.data.categoriesAllowed).toEqual([]);
    });
  });
});

describe("the history", () => {
  it("shows the newest entries first with labels only", async () => {
    state.data.activity = [
      { at: AT, kind: "read", category: "grades", tool: "get_gpa", outcome: "ok" },
      { at: AT, kind: "blocked", category: "grades", tool: "get_gpa", allowed: false },
    ];

    await loadPopup();

    await vi.waitFor(() => {
      expect(history()).toHaveLength(2);
    });

    expect(lines(0)).toEqual([
      "قراءة المعدل — نجحت — 14:05",
      "Read GPA — ok — 14:05",
    ]);
    expect(lines(1)).toEqual([
      "رُفضت: لم يُسمح بالدرجات — 14:05",
      "Blocked: grades not allowed — 14:05",
    ]);
  });

  it("shows at most 20 entries", async () => {
    state.data.activity = Array.from({ length: 25 }, (_value, index) => ({
      at: new Date(2026, 10, 19, 14, 24 - index).toISOString(),
      kind: "read",
      category: "grades",
      tool: "get_gpa",
      outcome: "ok",
    }));

    await loadPopup();

    await vi.waitFor(() => {
      expect(history()).toHaveLength(20);
    });

    expect(lines(0)[0]).toContain("14:24");
    expect(lines(19)[0]).toContain("14:05");
  });

  it("skips a stored entry that carries a value", async () => {
    state.data.activity = [
      { at: AT, kind: "read", category: "grades", tool: "get_gpa", outcome: "ok", gpa: "4.31" },
      { at: AT, kind: "consent", category: "grades", allowed: true },
    ];

    await loadPopup();

    await vi.waitFor(() => {
      expect(history()).toHaveLength(1);
    });

    expect(lines(0)[0]).toBe("السماح بالدرجات — 14:05");
  });
});

describe("Disconnect", () => {
  it("asks for a confirmation first", async () => {
    state.data.categoriesAllowed = ["grades"];
    state.data.activity = [
      { at: AT, kind: "consent", category: "grades", allowed: true },
    ];

    await loadPopup();

    await vi.waitFor(() => {
      expect(field("grades").checked).toBe(true);
    });

    button("disconnect").click();

    expect(confirmBox().hidden).toBe(false);
    expect(document.activeElement).toBe(button("confirm-yes"));
    expect(state.data.categoriesAllowed).toEqual(["grades"]);
    expect(state.data.activity).toHaveLength(1);

    button("confirm-cancel").click();

    expect(confirmBox().hidden).toBe(true);
    expect(document.activeElement).toBe(button("disconnect"));
    expect(state.data.categoriesAllowed).toEqual(["grades"]);
    expect(state.data.activity).toHaveLength(1);
  });

  it("clears the consent and the history once confirmed", async () => {
    state.data.categoriesAllowed = ["grades", "lms"];
    state.data.activity = [
      { at: AT, kind: "consent", category: "grades", allowed: true },
    ];

    await loadPopup();

    await vi.waitFor(() => {
      expect(field("grades").checked).toBe(true);
    });

    button("disconnect").click();
    button("confirm-yes").click();

    await vi.waitFor(() => {
      expect(Object.keys(state.data)).toEqual([]);
    });

    await vi.waitFor(() => {
      expect(field("grades").checked).toBe(false);
      expect(field("lms").checked).toBe(false);
      expect(history()[0]?.textContent).toContain("لا يوجد نشاط بعد");
    });

    expect(confirmBox().hidden).toBe(true);
  });
});
