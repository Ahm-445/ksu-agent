import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readCourses, type LmsCourse } from "../../../src/readers/lms/ultra.js";
import { readDueDates, riyadhTime } from "../../../src/readers/lms/due-dates.js";

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

describe("riyadhTime", () => {
  it("turns a UTC end date into Riyadh time with its offset", () => {
    expect(riyadhTime("2026-11-19T05:45:00.000Z")).toBe("2026-11-19T08:45:00+03:00");
  });

  it("moves the date forward when Riyadh time crosses midnight", () => {
    expect(riyadhTime("2026-11-20T22:30:00.000Z")).toBe("2026-11-21T01:30:00+03:00");
  });

  it("has no time for a value that is not a date", () => {
    expect(riyadhTime("soon")).toBeNull();
    expect(riyadhTime(undefined)).toBeNull();
  });
});

describe("readDueDates", () => {
  it("reads the due dates soonest first, from the item's end date", () => {
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
          title: "Past course quiz",
          course: "Calculus II",
          due_at: "2026-11-22T13:00:00+03:00",
        },
        {
          title: "Sprint review",
          course: "Software Engineering Project",
          due_at: "2026-11-23T09:30:00+03:00",
        },
        {
          title: "Section quiz",
          course: "Software Engineering Project",
          due_at: "2026-11-25T01:30:00+03:00",
        },
      ],
    });
  });

  it("names the merged course of a second section, not its own id", () => {
    const due = readDueDates(items(), courses());
    const section = due?.items.find((item) => item.title === "Section quiz");

    expect(section?.course).toBe("Software Engineering Project");
  });

  it("names a course outside the current term from its calendar name", () => {
    const due = readDueDates(items(), courses());
    const other = due?.items.find((item) => item.title === "Past course quiz");

    expect(other?.course).toBe("Calculus II");
  });

  it("skips an item the LMS has not filled in, and keeps the rest", () => {
    const list = items() as Array<Record<string, unknown>>;

    delete list[0]?.title;
    list[1] = { ...list[1], endDate: undefined };

    const due = readDueDates(list, courses());

    expect(due?.items.map((item) => item.title)).toEqual([
      "Essay draft",
      "Past course quiz",
      "Section quiz",
    ]);
  });

  it("skips an item without a course name", () => {
    const list = items() as Array<Record<string, unknown>>;

    list[4] = { ...list[4], calendarNameLocalizable: undefined };

    const due = readDueDates(list, courses());

    expect(due?.items.map((item) => item.title)).not.toContain("Past course quiz");
  });

  it("returns null when the item list is not a list", () => {
    expect(readDueDates({ results: [] }, courses())).toBeNull();
  });

  it("returns no items for a calendar with nothing due", () => {
    expect(readDueDates([], courses())).toEqual({ items: [] });
  });
});
