import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { readGrades } from "../../src/readers/edugate/grades.js";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/edugate/course-results.html", import.meta.url),
);

function pageFrom(html: string): Document {
  return new JSDOM(html).window.document as unknown as Document;
}

function fixture(): Document {
  return pageFrom(readFileSync(FIXTURE, "utf8"));
}

function gradeTable(doc: Document): Element | null {
  return doc.getElementById("myForm:courseTable");
}

function gradeCell(doc: Document, index: number): Element {
  const rows = gradeTable(doc)?.querySelectorAll(":scope > tbody > tr") ?? [];
  const cell = (rows[index] as HTMLTableRowElement | undefined)?.cells[2];

  if (cell === undefined) {
    throw new Error(`the fixture lost the grade cell of row ${index}`);
  }

  return cell;
}

describe("readGrades", () => {
  it("reads the term the page shows and every course", () => {
    const data = readGrades(fixture());

    expect(data?.term).toBe("الفصل الأول 1448/1449");
    expect(data?.courses).toEqual([
      { code: "996 حال", name: "نموذج مقرر عينة", grade: null },
      { code: "949 حال", name: "قيمة وهمي عينة", grade: null },
      { code: "986 حال", name: "الاختبار نص مثال عينة", grade: null },
      { code: "904 حال", name: "تجريبي وحدة عينة عينة موضوع عينة", grade: null },
      { code: "945 حال", name: "تجريبي موضوع -1", grade: null },
      { code: "946 حال", name: "مقرر وهمي عينة موضوع عينة", grade: null },
      { code: "959 حال", name: "بيانات نموذج تجريبي", grade: null },
    ]);
  });

  it("keeps an empty grade null on the current term", () => {
    const grades = readGrades(fixture())?.courses ?? [];

    expect(grades).toHaveLength(7);
    expect(grades.every((course) => course.grade === null)).toBe(true);
  });

  it("reads a recorded grade", () => {
    const doc = fixture();

    gradeCell(doc, 0).textContent = "A+";

    expect(readGrades(doc)?.courses[0]?.grade).toBe("A+");
  });

  it("treats the not-recorded mark ت as null", () => {
    const doc = fixture();

    gradeCell(doc, 0).textContent = "ت";

    expect(readGrades(doc)?.courses[0]?.grade).toBeNull();
  });

  it("reads the term from the selected option, not the first one", () => {
    const doc = fixture();
    const options = doc.getElementById("myForm:selectSemester")?.querySelectorAll("option");

    options?.forEach((option) => option.removeAttribute("selected"));
    options?.[1]?.setAttribute("selected", "selected");

    expect(readGrades(doc)?.term).toBe("الفصل الصيفي 1417/1463");
  });

  it("returns null when the term selector is missing", () => {
    const doc = fixture();

    doc.getElementById("myForm:selectSemester")?.remove();

    expect(readGrades(doc)).toBeNull();
  });

  it("returns null when the table is missing", () => {
    const doc = fixture();

    gradeTable(doc)?.remove();

    expect(readGrades(doc)).toBeNull();
  });

  it("returns null when the grade heading is missing", () => {
    const doc = fixture();

    gradeTable(doc)?.querySelector("thead th:nth-child(3)")?.remove();

    expect(readGrades(doc)).toBeNull();
  });

  it("returns null when a row has no course code", () => {
    const doc = fixture();
    const rows = gradeTable(doc)?.querySelectorAll(":scope > tbody > tr") ?? [];
    const code = (rows[1] as HTMLTableRowElement | undefined)?.cells[0];

    if (code === undefined) {
      throw new Error("the fixture lost a course code");
    }

    code.textContent = "";

    expect(readGrades(doc)).toBeNull();
  });
});
