import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coursesData, readCourses } from "../../../src/readers/lms/ultra.js";

const MEMBERSHIPS: { results: unknown[] } = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../fixtures/lms-api/memberships.json", import.meta.url)),
    "utf8",
  ),
);

// The term window of the fixture's current courses is 2026-08-23 to 2026-12-24.
const NOW = new Date("2026-11-19T12:00:00.000Z");

function memberships(): unknown[] {
  return structuredClone(MEMBERSHIPS.results);
}

function firstMembership(items: unknown[]): Record<string, unknown> {
  return items[0] as Record<string, unknown>;
}

describe("readCourses", () => {
  it("keeps the current term courses and merges the sections of one subject", () => {
    const courses = readCourses(memberships(), NOW);

    expect(courses?.map((course) => course.code)).toEqual(["SWE 999", "ENG 999", null]);
    expect(courses?.[0]?.sections).toEqual(["99999", "99998"]);
    expect(courses?.[0]?.name).toBe("Software Engineering Project");
  });

  it("keeps every membership id of a merged subject, for the due date labels", () => {
    const courses = readCourses(memberships(), NOW);

    expect(courses?.[0]?.ids).toEqual(["_999_1", "_999_2", "_999_3"]);
  });

  it("leaves out an organization, a past term and a closed course without a term", () => {
    const courses = readCourses(memberships(), NOW);

    expect(courses?.map((course) => course.name)).toEqual([
      "Software Engineering Project",
      "Technical Writing",
      "Special Topic",
    ]);
  });

  it("keeps a course with no term when it is available and open", () => {
    const courses = readCourses(memberships(), NOW);

    expect(courses?.map((course) => course.code)).toContain("ENG 999");
  });

  it("has no code when the course id is not the subject-number pattern", () => {
    const courses = readCourses(memberships(), NOW);
    const special = courses?.find((course) => course.name === "Special Topic");

    expect(special?.code).toBeNull();
    expect(special?.sections).toEqual([]);
  });

  it("returns null when a membership has no course name", () => {
    const items = memberships();
    const membership = firstMembership(items);
    const course = membership.course as Record<string, unknown>;

    delete course.name;

    expect(readCourses(items, NOW)).toBeNull();
  });

  it("returns null when the term dates are not dates", () => {
    const items = memberships();
    const membership = firstMembership(items);
    const course = membership.course as Record<string, unknown>;
    const term = course.term as Record<string, unknown>;

    term.startDate = "next week";

    expect(readCourses(items, NOW)).toBeNull();
  });

  it("drops the internal ids from the contract data", () => {
    const courses = readCourses(memberships(), NOW);
    const data = coursesData(courses ?? []);

    expect(data.courses[0]).toEqual({
      code: "SWE 999",
      name: "Software Engineering Project",
      sections: ["99999", "99998"],
    });
    expect(JSON.stringify(data)).not.toContain("_999_1");
  });
});
