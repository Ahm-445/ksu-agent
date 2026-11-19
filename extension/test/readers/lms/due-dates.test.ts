import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readCourses, type LmsCourse } from "../../../src/readers/lms/ultra.js";
import { readDueDates } from "../../../src/readers/lms/due-dates.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/lms-api/", import.meta.url));
const NOW = new Date("2026-11-19T12:00:00.000Z");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURES}${name}`, "utf8"));
}

function courses(): LmsCourse[] {
  const memberships = fixture("memberships.json") as { results: unknown[] };
  const read = readCourses(memberships.results, NOW);

  if (read === null) {
    throw new Error("the memberships fixture must be readable");
  }

  return read;
}

function items(): unknown[] {
  return (fixture("due-dates.json") as { results: unknown[] }).results;
}

describe("readDueDates", () => {
  it("reads the due dates of the current term, soonest first", () => {
    expect(readDueDates(items(), courses())).toEqual({
      items: [
        {
          title: "Essay draft",
          course: "Technical Writing",
          due_at: "2026-11-20T23:59:00+03:00",
        },
        {
          title: "Project proposal",
          course: "Software Engineering Project",
          due_at: "2026-11-21T23:59:00+03:00",
        },
        {
          title: "Sprint review",
          course: "Software Engineering Project",
          due_at: "2026-11-23T09:30:00+03:00",
        },
        {
          title: "Section quiz",
          course: "Software Engineering Project",
          due_at: "2026-11-25T13:00:00+03:00",
        },
      ],
    });
  });

  it("names the merged course of a second section, not its own id", () => {
    const due = readDueDates(items(), courses());
    const section = due?.items.find((item) => item.title === "Section quiz");

    expect(section?.course).toBe("Software Engineering Project");
  });

  it("leaves out an item of a course outside the current term", () => {
    const due = readDueDates(items(), courses());
    const titles = due?.items.map((item) => item.title) ?? [];

    expect(titles).not.toContain("Past course quiz");
  });

  it("returns null when an item has no title", () => {
    const list = items() as Array<Record<string, unknown>>;

    delete list[0]?.title;

    expect(readDueDates(list, courses())).toBeNull();
  });

  it("returns null when a due date is not a date", () => {
    const list = items() as Array<Record<string, unknown>>;

    list[0] = { ...list[0], start: "soon" };

    expect(readDueDates(list, courses())).toBeNull();
  });

  it("returns null when the item list is not a list", () => {
    expect(readDueDates({ results: [] }, courses())).toBeNull();
  });

  it("returns no items for a term with nothing due", () => {
    expect(readDueDates([], courses())).toEqual({ items: [] });
  });
});
