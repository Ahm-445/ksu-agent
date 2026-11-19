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

function columns(courseId: string): { results: Array<Record<string, unknown>> } {
  return book(courseId).columns as { results: Array<Record<string, unknown>> };
}

describe("readGradebook", () => {
  it("lists the released columns by position, with the student's own score", () => {
    const { columns, grades } = book("_999_1");

    expect(readGradebook(columns, grades, STUDENT)).toEqual({
      items: [
        { title: "Project proposal", score: 8.5, possible: 10, status: "graded" },
        { title: "Sprint quiz", score: null, possible: 5, status: "needs_grading" },
        { title: "Midterm total", score: 17, possible: 20, status: "none" },
      ],
    });
  });

  it("orders the items by the column position", () => {
    const list = columns("_999_1");

    list.results.reverse();

    const read = readGradebook(list, book("_999_1").grades, STUDENT);

    expect(read?.items.map((item) => item.title)).toEqual([
      "Project proposal",
      "Sprint quiz",
      "Midterm total",
    ]);
  });

  it("lists a column calculated by a custom formula like any other", () => {
    const read = readGradebook(book("_999_1").columns, book("_999_1").grades, STUDENT);
    const custom = read?.items.find((item) => item.title === "Midterm total");

    expect(custom).toEqual({
      title: "Midterm total",
      score: 17,
      possible: 20,
      status: "none",
    });
  });

  it("has no items for a course with no columns", () => {
    expect(readGradebook(book("_999_2").columns, book("_999_2").grades, STUDENT)).toEqual({
      items: [],
    });
  });

  it("leaves out a hidden column, a deleted column and an unreleased one", () => {
    const { columns, grades } = book("_999_3");
    const read = readGradebook(columns, grades, STUDENT);

    expect(read?.items).toEqual([
      { title: "Lab task (lab)", score: 4, possible: 4, status: "graded" },
    ]);
  });

  it("lists a column with no grade row as not graded", () => {
    const { columns, grades } = book("_994_1");

    expect(readGradebook(columns, grades, STUDENT)).toEqual({
      items: [{ title: "Discussion", score: null, possible: 10, status: "none" }],
    });
  });

  it("takes the student's own row and never another student's", () => {
    const { columns, grades } = book("_999_1");
    const read = readGradebook(columns, grades, STUDENT);

    expect(read?.items[0]?.score).toBe(8.5);
    expect(JSON.stringify(read)).not.toContain("99.5");
  });

  it("never returns the feedback, the average, the effective score or the manual grade", () => {
    const { columns, grades } = book("_999_1");
    const read = JSON.stringify(readGradebook(columns, grades, STUDENT));

    expect(read).not.toContain("Well argued.");
    expect(read).not.toContain("7.25");
    expect(read).not.toContain("manualGrade");
    expect(read).not.toContain("instructorFeedback");
  });

  it("ignores a key the reader does not know", () => {
    const { columns, grades } = book("_999_1");
    const list = grades as { results: Array<Record<string, unknown>> };

    list.results[0] = { ...list.results[0], attemptUrls: ["https://lms.example/x"] };

    expect(readGradebook(columns, grades, STUDENT)?.items[0]?.score).toBe(8.5);
  });

  it("returns null when the column list is not a list", () => {
    expect(readGradebook({ results: "none" }, book("_999_1").grades, STUDENT)).toBeNull();
  });

  it("returns null when the grade list is not a list", () => {
    expect(readGradebook(book("_999_1").columns, { results: 7 }, STUDENT)).toBeNull();
  });

  it("skips a column without an id instead of failing the course", () => {
    const list = columns("_999_1");

    list.results[0] = { ...list.results[0], id: undefined };

    const read = readGradebook(list, book("_999_1").grades, STUDENT);

    expect(read?.items.map((item) => item.title)).toEqual(["Sprint quiz", "Midterm total"]);
  });

  it("reads the possible score from the grade row when the column has none", () => {
    const list = columns("_999_1");

    list.results[0] = { ...list.results[0], possible: undefined };

    const read = readGradebook(list, book("_999_1").grades, STUDENT);

    expect(read?.items[0]?.possible).toBe(10);
  });
});
