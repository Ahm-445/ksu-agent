import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readGradebook } from "../../../src/readers/lms/grades.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/lms-api/", import.meta.url));
const STUDENT = "_999_0";

type Book = { columns: unknown; grades: unknown };

function book(courseId: string): Book {
  const all = JSON.parse(readFileSync(`${FIXTURES}gradebook.json`, "utf8")) as Record<
    string,
    Book
  >;

  return structuredClone(all[courseId] as Book);
}

describe("readGradebook", () => {
  it("reads the overall grade of the course", () => {
    const { columns, grades } = book("_999_1");

    expect(readGradebook(columns, grades, STUDENT)).toEqual({ grade: "88.50" });
  });

  it("ignores a column whose grades are not released yet", () => {
    const { columns, grades } = book("_999_2");

    expect(readGradebook(columns, grades, STUDENT)).toEqual({ grade: null });
  });

  it("ignores a column the course hides", () => {
    const { columns, grades } = book("_999_3");

    expect(readGradebook(columns, grades, STUDENT)).toEqual({ grade: null });
  });

  it("has no grade when the student has none in the overall column", () => {
    const { columns, grades } = book("_994_1");

    expect(readGradebook(columns, grades, STUDENT)).toEqual({ grade: null });
  });

  it("takes the student's own grade and never the class average", () => {
    const { columns, grades } = book("_999_1");

    expect(readGradebook(columns, grades, STUDENT)).toEqual({ grade: "88.50" });
    expect(readGradebook(columns, grades, "_999_9")).toEqual({ grade: null });
  });

  it("returns the grade alone, with no feedback and no column names", () => {
    const { columns, grades } = book("_999_1");
    const read = readGradebook(columns, grades, STUDENT);

    expect(JSON.stringify(read)).not.toContain("Good work");
    expect(JSON.stringify(read)).not.toContain("Overall Grade");
    expect(JSON.stringify(read)).not.toContain("Project proposal");
  });

  it("has no grade when the course has no overall column", () => {
    const { columns, grades } = book("_996_1");

    expect(readGradebook(columns, grades, STUDENT)).toEqual({ grade: null });
  });

  it("returns null when the column list is not a list", () => {
    const { grades } = book("_999_1");

    expect(readGradebook({ results: "none" }, grades, STUDENT)).toBeNull();
  });

  it("returns null when the grade list is not a list", () => {
    const { columns } = book("_999_1");

    expect(readGradebook(columns, { results: 7 }, STUDENT)).toBeNull();
  });

  it("returns null when a column has no id or no visibility", () => {
    const { columns, grades } = book("_999_1");
    const list = columns as { results: Array<Record<string, unknown>> };

    list.results[0] = { ...list.results[0], visibility: undefined };

    expect(readGradebook(columns, grades, STUDENT)).toBeNull();
  });

  it("returns null when the overall column is not marked as calculated", () => {
    const { columns, grades } = book("_999_1");
    const list = columns as { results: Array<Record<string, unknown>> };

    list.results[0] = { ...list.results[0], grading: { type: "Manual" } };

    expect(readGradebook(columns, grades, STUDENT)).toEqual({ grade: null });
  });
});
