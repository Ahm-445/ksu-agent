import { describe, expect, it } from "vitest";
import {
  createStore,
  MAX_ACTIVITY,
  readActivityEntry,
  type ActivityEntry,
} from "../src/storage.js";

function fakeArea() {
  const data: Record<string, unknown> = {};

  return {
    data,
    area: {
      get: async (keys: string[]) => {
        const stored: Record<string, unknown> = {};

        for (const key of keys) {
          if (key in data) {
            stored[key] = data[key];
          }
        }

        return stored;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(data, items);
      },
      remove: async (keys: string[]) => {
        for (const key of keys) {
          delete data[key];
        }
      },
    },
  };
}

function readEntry(at: string): ActivityEntry {
  return { at, kind: "read", category: "grades", tool: "get_gpa", outcome: "ok" };
}

describe("consent", () => {
  it("is empty by default", async () => {
    const { area } = fakeArea();

    await expect(createStore(area).getConsent()).resolves.toEqual([]);
  });

  it("turns a category on and off", async () => {
    const { area, data } = fakeArea();
    const store = createStore(area);

    await expect(store.setConsent("grades", true)).resolves.toEqual(["grades"]);
    await expect(store.getConsent()).resolves.toEqual(["grades"]);
    expect(data.categoriesAllowed).toEqual(["grades"]);

    await expect(store.setConsent("grades", false)).resolves.toEqual([]);
    await expect(store.getConsent()).resolves.toEqual([]);
  });

  it("keeps the categories apart", async () => {
    const { area } = fakeArea();
    const store = createStore(area);

    await store.setConsent("grades", true);
    await store.setConsent("lms", true);
    await store.setConsent("grades", false);

    await expect(store.getConsent()).resolves.toEqual(["lms"]);
  });

  it("records one consent entry for each change", async () => {
    const { area } = fakeArea();
    const store = createStore(area);

    await store.setConsent("schedule", true);
    await store.setConsent("schedule", false);

    const activity = await store.getActivity();

    expect(activity).toHaveLength(2);
    expect(activity[0]).toEqual({
      at: expect.any(String),
      kind: "consent",
      category: "schedule",
      allowed: false,
    });
    expect(activity[1]).toEqual({
      at: expect.any(String),
      kind: "consent",
      category: "schedule",
      allowed: true,
    });
  });

  it("keeps only stored values that are category names", async () => {
    const { area, data } = fakeArea();
    data.categoriesAllowed = ["grades", 42, "payroll", null, "lms"];

    await expect(createStore(area).getConsent()).resolves.toEqual([
      "grades",
      "lms",
    ]);
  });
});

describe("activity", () => {
  it("is empty by default", async () => {
    const { area } = fakeArea();

    await expect(createStore(area).getActivity()).resolves.toEqual([]);
  });

  it("keeps the newest 50 entries, newest first", async () => {
    const { area } = fakeArea();
    const store = createStore(area);

    for (let minute = 0; minute < 60; minute += 1) {
      const at = new Date(2026, 0, 1, 0, minute).toISOString();

      await store.addActivity(readEntry(at));
    }

    const activity = await store.getActivity();

    expect(activity).toHaveLength(MAX_ACTIVITY);
    expect(activity[0]?.at).toBe(new Date(2026, 0, 1, 0, 59).toISOString());
    expect(activity.at(-1)?.at).toBe(new Date(2026, 0, 1, 0, 10).toISOString());
  });

  it("drops invalid entries instead of writing them", async () => {
    const { area, data } = fakeArea();
    const store = createStore(area);
    const at = new Date(2026, 10, 19, 14, 5).toISOString();

    const invalid: unknown[] = [
      { kind: "read", category: "grades", tool: "get_gpa", outcome: "ok" },
      { at, kind: "write", category: "grades", allowed: true },
      { at, kind: "read", category: "payroll", tool: "get_gpa", outcome: "ok" },
      { at, kind: "read", category: "grades", tool: "get_gpa" },
      { at, kind: "read", category: "grades", tool: "get_gpa", outcome: "fine" },
      { at, kind: "consent", category: "grades" },
      { at, kind: "blocked", category: "grades", tool: "get_gpa", allowed: true },
      { at, kind: "read", category: "grades", tool: "get_payroll", outcome: "ok" },
      { at: "yesterday", kind: "read", category: "grades", tool: "get_gpa", outcome: "ok" },
      "activity",
      null,
    ];

    for (const entry of invalid) {
      await expect(store.addActivity(entry as ActivityEntry)).resolves.toBe(false);
    }

    await expect(store.getActivity()).resolves.toEqual([]);
    expect(data.activity).toBeUndefined();
  });

  it.each([
    ["a GPA", { gpa: "4.31" }],
    ["read data", { data: { cumulative_gpa: "4.31" } }],
    ["a student name", { student_name: "طالب" }],
  ])("rejects an entry carrying %s", async (_label, extra) => {
    const { area, data } = fakeArea();
    const store = createStore(area);
    const at = new Date(2026, 10, 19, 14, 5).toISOString();

    await expect(
      store.addActivity({ ...readEntry(at), ...extra } as ActivityEntry),
    ).resolves.toBe(false);

    await expect(store.getActivity()).resolves.toEqual([]);
    expect(data.activity).toBeUndefined();
  });

  it("drops a stored entry that carries a value", async () => {
    const { area, data } = fakeArea();
    const at = new Date(2026, 10, 19, 14, 5).toISOString();
    data.activity = [readEntry(at), { ...readEntry(at), gpa: "4.31" }];

    await expect(createStore(area).getActivity()).resolves.toEqual([
      readEntry(at),
    ]);
  });

  it("returns a blocked entry with the category and no outcome", () => {
    expect(
      readActivityEntry({
        at: new Date(2026, 10, 19, 14, 5).toISOString(),
        kind: "blocked",
        category: "attendance",
        tool: "get_absences",
        allowed: false,
      }),
    ).toEqual({
      at: new Date(2026, 10, 19, 14, 5).toISOString(),
      kind: "blocked",
      category: "attendance",
      tool: "get_absences",
      allowed: false,
    });
  });
});

describe("disconnect", () => {
  it("removes both keys and leaves nothing behind", async () => {
    const { area, data } = fakeArea();
    const store = createStore(area);

    await store.setConsent("grades", true);
    await store.addActivity(readEntry(new Date(2026, 10, 19, 14, 5).toISOString()));

    expect(Object.keys(data).sort()).toEqual(["activity", "categoriesAllowed"]);

    await store.disconnect();

    expect(Object.keys(data)).toEqual([]);
    await expect(store.getConsent()).resolves.toEqual([]);
    await expect(store.getActivity()).resolves.toEqual([]);
  });
});
