import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { readAbsences } from "../../src/readers/edugate/absences.js";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/edugate/absences.html", import.meta.url),
);

function pageFrom(html: string): Document {
  return new JSDOM(html).window.document as unknown as Document;
}

function fixture(): Document {
  return pageFrom(readFileSync(FIXTURE, "utf8"));
}

/** The summary table: the one whose headings carry مجموع الغياب. */
function summaryTable(doc: Document): Element | null {
  for (const table of doc.querySelectorAll("table")) {
    if (table.textContent?.includes("مجموع الغياب")) {
      return table;
    }
  }

  return null;
}

function cellsOf(doc: Document, index: number): Element[] {
  const rows = summaryTable(doc)?.querySelectorAll(":scope > tbody > tr") ?? [];

  return Array.from(rows[index]?.querySelectorAll("td") ?? []);
}

describe("readAbsences", () => {
  it("reads every course of the summary table", () => {
    expect(readAbsences(fixture())).toEqual({
      courses: [
        {
          code: "939 نال",
          name: "الاختبار عينة وحدة مثال",
          absence_percent: 31.96,
          absences: 5,
          lates: 4,
        },
        {
          code: "985 نال",
          name: "نموذج موضوع مثال",
          absence_percent: 5.34,
          absences: 1,
          lates: 4,
        },
        {
          code: "920 نال",
          name: "وهمي نموذج مثال",
          absence_percent: 31.96,
          absences: 5,
          lates: 4,
        },
        {
          code: "979 نال",
          name: "مقرر موضوع موضوع",
          absence_percent: 82.86,
          absences: 91,
          lates: 4,
        },
        {
          code: "917 نال",
          name: "تجريبي عينة نص وحدة مثال",
          absence_percent: 1.1,
          absences: 3,
          lates: 4,
        },
      ],
    });
  });

  it("reads the contract fields with their contract types", () => {
    const data = readAbsences(fixture());

    expect(data).not.toBeNull();
    expect(data?.courses).toHaveLength(5);

    for (const course of data?.courses ?? []) {
      expect(typeof course.code).toBe("string");
      expect(typeof course.name).toBe("string");
      expect(typeof course.absence_percent).toBe("number");
      expect(typeof course.absences).toBe("number");
      expect(typeof course.lates).toBe("number");
    }
  });

  it("does not read the warning table", () => {
    const doc = fixture();
    const warning = doc.querySelector('table[id$=":warningTable"]');
    const summary = summaryTable(doc);

    if (warning === null || summary === null) {
      throw new Error("the fixture lost one of its two tables");
    }

    // The warning table carries a different percentage; it must not be the source.
    const warningPercent = warning.querySelector("tbody tr td:last-child");

    if (warningPercent !== null) {
      warningPercent.textContent = "99%";
    }

    const data = readAbsences(doc);

    expect(data?.courses.map((course) => course.absence_percent)).not.toContain(99);
    expect(data?.courses).toHaveLength(5);
  });

  it("returns null when only the warning table is on the page", () => {
    const doc = fixture();
    const warning = doc.querySelector('table[id$=":warningTable"]');
    const summary = summaryTable(doc);

    if (warning === null || summary === null) {
      throw new Error("the fixture lost one of its two tables");
    }

    const body = doc.querySelector("body");

    if (body === null) {
      throw new Error("the fixture lost its body");
    }

    body.innerHTML = warning.outerHTML;

    expect(readAbsences(doc)).toBeNull();
  });

  it("accepts the percentage with the % sign", () => {
    const doc = fixture();
    const percent = cellsOf(doc, 0)[7];

    if (percent === undefined) {
      throw new Error("the fixture lost its percentage cell");
    }

    percent.textContent = "11.86%";

    expect(readAbsences(doc)?.courses[0]?.absence_percent).toBe(11.86);
  });

  it("accepts the percentage without the % sign", () => {
    const doc = fixture();
    const percent = cellsOf(doc, 0)[7];

    if (percent === undefined) {
      throw new Error("the fixture lost its percentage cell");
    }

    percent.textContent = "11.86";

    expect(readAbsences(doc)?.courses[0]?.absence_percent).toBe(11.86);
  });

  it("normalises Arabic-Indic digits", () => {
    const doc = fixture();
    const percent = cellsOf(doc, 0)[7];
    const absences = cellsOf(doc, 0)[5];
    const lates = cellsOf(doc, 0)[6];

    if (percent === undefined || absences === undefined || lates === undefined) {
      throw new Error("the fixture lost its numbers");
    }

    percent.textContent = "١١٫٨٦";
    absences.textContent = "٣";
    lates.textContent = "٢";

    expect(readAbsences(doc)?.courses[0]).toMatchObject({
      absence_percent: 11.86,
      absences: 3,
      lates: 2,
    });
  });

  it("returns null when a percentage is outside 0-100", () => {
    const doc = fixture();
    const percent = cellsOf(doc, 0)[7];

    if (percent === undefined) {
      throw new Error("the fixture lost its percentage cell");
    }

    percent.textContent = "120";

    expect(readAbsences(doc)).toBeNull();
  });

  it("returns null when a heading is missing", () => {
    const doc = fixture();
    const summary = summaryTable(doc);
    const heading = summary?.querySelector("thead th:last-child");

    if (heading === null || heading === undefined) {
      throw new Error("the fixture lost its last heading");
    }

    heading.remove();

    expect(readAbsences(doc)).toBeNull();
  });

  it("returns null when the table is missing", () => {
    const doc = fixture();
    const summary = summaryTable(doc);

    summary?.remove();

    expect(readAbsences(doc)).toBeNull();
  });

  it("returns null when a course row cannot be read", () => {
    const doc = fixture();
    const absences = cellsOf(doc, 1)[5];

    if (absences === undefined) {
      throw new Error("the fixture lost its absences cell");
    }

    absences.textContent = "—";

    expect(readAbsences(doc)).toBeNull();
  });
});
