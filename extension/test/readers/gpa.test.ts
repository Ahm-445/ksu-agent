import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { isEdugateLoginPage, readGpa } from "../../src/readers/edugate/gpa.js";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/edugate/academic-record.html", import.meta.url),
);

function pageFrom(html: string): Document {
  return new JSDOM(html).window.document as unknown as Document;
}

function fixture(): Document {
  return pageFrom(readFileSync(FIXTURE, "utf8"));
}

const NEWEST_TERM = "الفصل الأول 1448/1449";

function termBlock(doc: Document, term: string): Element | null {
  const blocks = Array.from(
    doc.querySelectorAll('[id^="myForm:allTranscriptTable:"][id$=":default"]'),
  );

  return (
    blocks.find(
      (block) =>
        block
          .querySelector(".fontTextWhite")
          ?.textContent?.replace(/\s+/g, " ")
          .trim() === term,
    ) ?? null
  );
}

/** The المعدل cell of the newest term's تراكمي row: the value the reader must report. */
function cumulativeGpaCell(doc: Document): Element | null {
  const block = termBlock(doc, NEWEST_TERM);
  const rows = Array.from(block?.querySelectorAll("tbody tr") ?? []).filter(
    (row) =>
      Array.from(row.querySelectorAll("td"))[0]?.textContent?.trim() === "تراكمي",
  );
  const cells = Array.from(rows[0]?.querySelectorAll("td") ?? []);

  return cells[cells.length - 1] ?? null;
}

describe("readGpa", () => {
  it("reads the newest term on the record", () => {
    expect(readGpa(fixture())).toEqual({
      cumulative_gpa: "2",
      scale: "5",
      earned_hours: 987,
      registered_hours: 911,
      as_of_term: "الفصل الأول 1448/1449",
    });
  });

  it("returns the five contract fields with their contract types", () => {
    const data = readGpa(fixture());

    expect(data).not.toBeNull();
    expect(typeof data?.cumulative_gpa).toBe("string");
    expect(data?.scale).toBe("5");
    expect(typeof data?.earned_hours).toBe("number");
    expect(typeof data?.registered_hours).toBe("number");
    expect(typeof data?.as_of_term).toBe("string");
  });

  it("normalises Arabic-Indic digits", () => {
    const doc = fixture();
    const cell = cumulativeGpaCell(doc);

    if (cell === null) {
      throw new Error("the fixture lost its cumulative المعدل cell");
    }

    cell.textContent = "٣٫٥";

    expect(readGpa(doc)?.cumulative_gpa).toBe("3.5");
  });

  it("returns null when the transcript table is missing", () => {
    const doc = fixture();
    doc.getElementById("myForm:allTranscriptTable")?.remove();

    expect(readGpa(doc)).toBeNull();
  });

  it("returns null when the cumulative row is missing", () => {
    const doc = fixture();

    for (const row of Array.from(doc.querySelectorAll("tbody tr"))) {
      if (Array.from(row.querySelectorAll("td"))[0]?.textContent?.trim() === "تراكمي") {
        row.remove();
      }
    }

    expect(readGpa(doc)).toBeNull();
  });

  it("returns null when a summary heading is renamed", () => {
    const doc = fixture();

    for (const heading of Array.from(doc.querySelectorAll("th.HEADING"))) {
      if (heading.textContent?.trim() === "المعدل") {
        heading.textContent = "التقدير";
      }
    }

    expect(readGpa(doc)).toBeNull();
  });

  it("returns null when the latest term has no readable number", () => {
    const doc = fixture();
    const cell = cumulativeGpaCell(doc);

    if (cell === null) {
      throw new Error("the fixture lost its cumulative المعدل cell");
    }

    cell.textContent = "—";

    expect(readGpa(doc)).toBeNull();
  });
});

type TermFixture = {
  label: string;
  /** null when the term has no summary table yet. */
  gpa: string | null;
  /** false when the summary table has no تراكمي row. */
  withCumulative?: boolean;
};

function summaryTable(gpa: string, withCumulative: boolean): string {
  const cumulative = withCumulative
    ? `<tr><td>تراكمي</td><td>40</td><td>36</td><td>${gpa}</td></tr>`
    : "";

  return `<table class="responsiveDataTable"><thead><tr>
      <th class="HEADING"> </th>
      <th class="HEADING">الساعات المسجلة</th>
      <th class="HEADING">الساعات المكتسبة</th>
      <th class="HEADING">المعدل</th>
    </tr></thead><tbody>
      <tr><td>فصلي</td><td>12</td><td>12</td><td>0</td></tr>
      ${cumulative}
    </tbody></table>`;
}

function record(terms: TermFixture[]): Document {
  const blocks = terms
    .map(
      ({ label, gpa, withCumulative = true }, index) =>
        `<div id="myForm:allTranscriptTable:${index + 1}:default">
          <span class="fontTextWhite">${label}</span>
          ${gpa === null ? "" : summaryTable(gpa, withCumulative)}
        </div>`,
    )
    .join("");

  return pageFrom(
    `<!DOCTYPE html><html><body><div id="myForm:allTranscriptTable">${blocks}</div></body></html>`,
  );
}

describe("term selection", () => {
  const FIRST_1448 = "الفصل الأول 1448/1449";
  const SUMMER_1447 = "الفصل الصيفي 1447/1448";
  const SECOND_1447 = "الفصل الثاني 1447/1448";
  const FIRST_1447 = "الفصل الأول 1447/1448";

  it("takes the newest term when the record is newest first", () => {
    const doc = record([
      { label: FIRST_1448, gpa: "4.5" },
      { label: SECOND_1447, gpa: "4.2" },
      { label: FIRST_1447, gpa: "3.9" },
    ]);

    expect(readGpa(doc)).toMatchObject({
      as_of_term: FIRST_1448,
      cumulative_gpa: "4.5",
    });
  });

  it("takes the newest term when the record is oldest first", () => {
    const doc = record([
      { label: FIRST_1447, gpa: "3.9" },
      { label: SECOND_1447, gpa: "4.2" },
      { label: FIRST_1448, gpa: "4.5" },
    ]);

    expect(readGpa(doc)).toMatchObject({
      as_of_term: FIRST_1448,
      cumulative_gpa: "4.5",
    });
  });

  it("falls back to the previous term when the newest has no summary yet", () => {
    const doc = record([
      { label: FIRST_1448, gpa: null },
      { label: SECOND_1447, gpa: "4.2" },
    ]);

    expect(readGpa(doc)).toMatchObject({
      as_of_term: SECOND_1447,
      cumulative_gpa: "4.2",
    });
  });

  it("skips a summary table without a تراكمي row", () => {
    const doc = record([
      { label: FIRST_1448, gpa: "4.5", withCumulative: false },
      { label: SECOND_1447, gpa: "4.2" },
    ]);

    expect(readGpa(doc)).toMatchObject({
      as_of_term: SECOND_1447,
      cumulative_gpa: "4.2",
    });
  });

  it("sorts the summer term after الثاني of the same year", () => {
    const doc = record([
      { label: SECOND_1447, gpa: "4.2" },
      { label: SUMMER_1447, gpa: "4.4" },
      { label: FIRST_1447, gpa: "3.9" },
    ]);

    expect(readGpa(doc)).toMatchObject({
      as_of_term: SUMMER_1447,
      cumulative_gpa: "4.4",
    });
  });

  it("returns null when any term label cannot be parsed", () => {
    const doc = record([
      { label: FIRST_1448, gpa: "4.5" },
      { label: "الفصل الرابع 1447/1448", gpa: "4.2" },
    ]);

    expect(readGpa(doc)).toBeNull();
  });

  it("returns null for an unparseable label even without a summary", () => {
    const doc = record([
      { label: FIRST_1448, gpa: "4.5" },
      { label: "بدون فصل", gpa: null },
    ]);

    expect(readGpa(doc)).toBeNull();
  });

  it("reads Arabic-Indic digits in the year", () => {
    const doc = record([
      { label: "الفصل الأول ١٤٤٧/١٤٤٨", gpa: "3.9" },
      { label: "الفصل الثاني ١٤٤٨/١٤٤٩", gpa: "4.6" },
    ]);

    expect(readGpa(doc)).toMatchObject({
      as_of_term: "الفصل الثاني ١٤٤٨/١٤٤٩",
      cumulative_gpa: "4.6",
    });
  });
});

describe("isEdugateLoginPage", () => {
  it("is false for the academic record page", () => {
    expect(isEdugateLoginPage(fixture())).toBe(false);
  });

  it("is true for the login form", () => {
    const doc = pageFrom(
      '<!DOCTYPE html><html><body><form id="loginForm"><input name="username" /></form></body></html>',
    );

    expect(isEdugateLoginPage(doc)).toBe(true);
  });
});
