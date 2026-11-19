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

/** The المعدل cell of the last تراكمي row: the value the reader must report. */
function cumulativeGpaCell(doc: Document): Element | null {
  const rows = Array.from(doc.querySelectorAll("tbody tr")).filter(
    (row) => Array.from(row.querySelectorAll("td"))[0]?.textContent?.trim() === "تراكمي",
  );
  const cells = Array.from(rows[rows.length - 1]?.querySelectorAll("td") ?? []);

  return cells[cells.length - 1] ?? null;
}

describe("readGpa", () => {
  it("reads the cumulative row of the latest term block", () => {
    expect(readGpa(fixture())).toEqual({
      cumulative_gpa: "3",
      scale: "5",
      earned_hours: 82,
      registered_hours: 77,
      as_of_term: "الفصل الأول 1476/1402",
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
