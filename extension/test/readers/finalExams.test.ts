import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { readFinalExams } from "../../src/readers/edugate/finalExams.js";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/edugate/final-exams.html", import.meta.url),
);

function pageFrom(html: string): Document {
  return new JSDOM(html).window.document as unknown as Document;
}

function fixture(): Document {
  return pageFrom(readFileSync(FIXTURE, "utf8"));
}

function examTable(doc: Document): Element | null {
  return doc.querySelector("table[id*=finalExamsTable]");
}

function row(doc: Document, index: number): HTMLTableRowElement {
  const rows = examTable(doc)?.querySelectorAll(":scope > tbody > tr") ?? [];
  const found = rows[index];

  if (found === undefined) {
    throw new Error(`the fixture lost row ${index}`);
  }

  return found as HTMLTableRowElement;
}

function cell(doc: Document, index: number, column: number): Element {
  const found = row(doc, index).cells[column];

  if (found === undefined) {
    throw new Error(`the fixture lost cell ${column} of row ${index}`);
  }

  return found;
}

/** The five الوحدة/المبنى/الطابق/الجناح/القاعة cells of one exam's room table. */
function locationCells(doc: Document, index: number): HTMLTableCellElement[] {
  const room = cell(doc, index, 3).querySelector("table[id*=roomTable]");
  const found = Array.from(room?.querySelectorAll("tr") ?? []).find(
    (candidate) => (candidate as HTMLTableRowElement).cells.length === 5,
  );

  if (found === undefined) {
    throw new Error(`the fixture lost the location row of exam ${index}`);
  }

  return Array.from((found as HTMLTableRowElement).cells);
}

describe("readFinalExams", () => {
  it("reads every exam of the table", () => {
    expect(readFinalExams(fixture())).toEqual({
      exams: [
        {
          code: "969 نال",
          name: "بيانات موضوع بيانات",
          day: null,
          date: null,
          time: "88:33",
          location: null,
        },
        {
          code: "930 نال",
          name: "تجريبي موضوع نموذج",
          day: "الثلاثاء",
          date: "4-77-1456",
          time: "88:33",
          location: null,
        },
        {
          code: "900 نال",
          name: "الاختبار عينة نموذج بيانات",
          day: "مقرر",
          date: "28-94-1481",
          time: "92:50",
          location: null,
        },
        {
          code: "922 نال",
          name: "مقرر قيمة -3",
          day: null,
          date: null,
          time: "88:33",
          location: null,
        },
        {
          code: "908 نال",
          name: "مادة قيمة قيمة قيمة مثال بيانات",
          day: "الخميس",
          date: "5-24-1460",
          time: "92:50",
          location: null,
        },
        {
          code: "922 نال",
          name: "قيمة وحدة قيمة مثال بيانات",
          day: "الاثنين",
          date: "64-22-1437",
          time: "88:33",
          location: null,
        },
        {
          code: "948 نال",
          name: "مقرر عينة بيانات",
          day: "السبت",
          date: "45-83-1481",
          time: "88:33",
          location: null,
        },
      ],
    });
  });

  it("keeps the day and date null when the exam is not scheduled yet", () => {
    const exams = readFinalExams(fixture())?.exams ?? [];

    expect(exams[0]).toMatchObject({ day: null, date: null });
    expect(exams[1]?.day).toBe("الثلاثاء");
    expect(exams[1]?.date).toBe("4-77-1456");
  });

  it("returns the date as shown, without converting it", () => {
    const exams = readFinalExams(fixture())?.exams ?? [];

    expect(exams[1]?.date).toBe("4-77-1456");
  });

  it("returns null for a location whose parts are all ---", () => {
    expect(readFinalExams(fixture())?.exams[0]?.location).toBeNull();
  });

  it("joins the non-empty location parts", () => {
    const doc = fixture();
    const parts = locationCells(doc, 0);
    const values = ["وحدة", "---", "الطابق الأول", "", "قاعة"];

    parts.forEach((part, index) => {
      part.textContent = values[index] ?? "";
    });

    expect(readFinalExams(doc)?.exams[0]?.location).toBe(
      "وحدة - الطابق الأول - قاعة",
    );
  });

  it("reads a time with Arabic-Indic digits", () => {
    const doc = fixture();

    cell(doc, 0, 5).textContent = "٠٨:٠٥";

    expect(readFinalExams(doc)?.exams[0]?.time).toBe("08:05");
  });

  it("returns null when a time is not HH:MM", () => {
    const doc = fixture();

    cell(doc, 0, 5).textContent = "8 صباحا";

    expect(readFinalExams(doc)).toBeNull();
  });

  it("returns null when the location heading is missing", () => {
    const doc = fixture();

    examTable(doc)?.querySelector("thead th:nth-child(4)")?.remove();

    expect(readFinalExams(doc)).toBeNull();
  });

  it("returns null when the table is missing", () => {
    const doc = fixture();

    examTable(doc)?.remove();

    expect(readFinalExams(doc)).toBeNull();
  });

  it("returns null when a row has no course code", () => {
    const doc = fixture();

    cell(doc, 1, 0).textContent = "";

    expect(readFinalExams(doc)).toBeNull();
  });
});
