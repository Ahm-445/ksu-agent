import selectors from "../../selectors.json" with { type: "json" };

export type GpaData = {
  cumulative_gpa: string;
  scale: "5";
  earned_hours: number;
  registered_hours: number;
  as_of_term: string;
};

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;

// Edugate may print the decimal separator as the Arabic comma.
const DECIMAL_SEPARATORS = /[\u066b,]/g;

const NUMBER = /^\d+(?:\.\d+)?$/;

function textOf(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function asciiDigits(value: string): string {
  return value.replace(ARABIC_INDIC_DIGITS, (digit) =>
    String(digit.charCodeAt(0) & 0xf),
  );
}

function cellText(cells: ArrayLike<Element>, index: number | undefined): string {
  return index === undefined ? "" : textOf(cells[index] ?? null);
}

function asciiNumber(value: string): string {
  return asciiDigits(value).replace(DECIMAL_SEPARATORS, ".");
}

function hours(value: string): number | null {
  const text = asciiNumber(value);

  return NUMBER.test(text) ? Number(text) : null;
}

function columnIndexes(table: Element): Map<string, number> {
  const indexes = new Map<string, number>();

  table
    .querySelectorAll(`thead th.${selectors.transcript.headingClass}`)
    .forEach((heading, index) => {
      const text = textOf(heading);

      if (text && !indexes.has(text)) {
        indexes.set(text, index);
      }
    });

  return indexes;
}

type Summary = { table: Element; columns: Map<string, number> };

function summaryTable(block: Element): Summary | null {
  const wanted = [
    selectors.headings.registeredHours,
    selectors.headings.earnedHours,
    selectors.headings.gpa,
  ];

  for (const table of block.querySelectorAll(
    `table.${selectors.transcript.summaryTableClass}`,
  )) {
    const columns = columnIndexes(table);

    if (wanted.every((heading) => columns.has(heading))) {
      return { table, columns };
    }
  }

  return null;
}

function termBlocks(transcript: Element): Element[] {
  const selector = `[id^="${selectors.transcript.termBlockIdPrefix}"][id$="${selectors.transcript.termBlockIdSuffix}"]`;

  return Array.from(transcript.querySelectorAll(selector));
}

function cumulativeRow(summary: Summary): ArrayLike<Element> | null {
  for (const row of summary.table.querySelectorAll("tbody tr")) {
    const cells = row.querySelectorAll("td");

    if (textOf(cells[0] ?? null) === selectors.rows.cumulative) {
      return cells;
    }
  }

  return null;
}

/**
 * The cumulative GPA of the latest term on the academic record page, or null.
 *
 * Null means the page is not the shape the page map describes — a different table,
 * heading or row — and the caller reports `page_unreadable` instead of guessing.
 */
export function readGpa(doc: Document): GpaData | null {
  const transcript = doc.getElementById(selectors.transcript.tableId);

  if (transcript === null) {
    return null;
  }

  const blocks = termBlocks(transcript);
  const block = blocks[blocks.length - 1];

  if (block === undefined) {
    return null;
  }

  const term = textOf(
    block.querySelector(`.${selectors.transcript.termLabelClass}`),
  );

  if (!term) {
    return null;
  }

  const summary = summaryTable(block);

  if (summary === null) {
    return null;
  }

  const cells = cumulativeRow(summary);

  if (cells === null) {
    return null;
  }

  const cumulativeGpa = asciiNumber(
    cellText(cells, summary.columns.get(selectors.headings.gpa)),
  );
  const earnedHours = hours(cellText(cells, summary.columns.get(selectors.headings.earnedHours)));
  const registeredHours = hours(
    cellText(cells, summary.columns.get(selectors.headings.registeredHours)),
  );

  if (!NUMBER.test(cumulativeGpa) || earnedHours === null || registeredHours === null) {
    return null;
  }

  return {
    cumulative_gpa: cumulativeGpa,
    scale: "5",
    earned_hours: earnedHours,
    registered_hours: registeredHours,
    as_of_term: term,
  };
}

/** True when the page is Edugate's login form, so the student is not signed in. */
export function isEdugateLoginPage(doc: Document): boolean {
  return doc.getElementById(selectors.login.formId) !== null;
}
