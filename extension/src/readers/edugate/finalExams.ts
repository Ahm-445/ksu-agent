import selectors from "../../selectors.json" with { type: "json" };
import {
  asciiDigits,
  cellText,
  cellsOf,
  columnIndexes,
  dataRows,
  textOf,
} from "./dom.js";

export type FinalExamData = {
  exams: Array<{
    code: string;
    name: string;
    day: string | null;
    date: string | null;
    time: string;
    location: string | null;
  }>;
};

const CLOCK = /^(\d{1,2}):(\d{2})$/;
/** A 24-hour time as the exam page shows it, or null when the text is not one. */
function clockTime(value: string): string | null {
  const match = CLOCK.exec(asciiDigits(value));

  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/**
 * The location parts of one row: the الوحدة/المبنى/الطابق/الجناح/القاعة cells of the nested
 * room table, in order. The room table wraps the real row in one cell, so the row is the one
 * with as many cells as the heading lists parts.
 */
function locationParts(cell: Element): string[] {
  const room = cell.querySelector(
    `table[id$="${selectors.finalExams.roomTableIdSuffix}"]`,
  );

  if (room === null) {
    return [];
  }

  const wanted = selectors.finalExams.locationParts.length;
  const row = Array.from(room.querySelectorAll("tr")).find(
    (candidate) => (candidate as HTMLTableRowElement).cells.length === wanted,
  );

  return row === undefined ? [] : cellsOf(row).map((part) => textOf(part));
}

function locationOf(cell: Element): string | null {
  const empty = selectors.finalExams.emptyPart;
  const kept = locationParts(cell).filter(
    (part) => part !== "" && part !== empty,
  );

  return kept.length === 0
    ? null
    : kept.join(selectors.finalExams.locationSeparator);
}

function optionalText(cell: Element | null): string | null {
  const text = textOf(cell);

  return text === "" ? null : text;
}

/**
 * The final exam schedule of the page, or null.
 *
 * The location heading spans five nested cells (الوحدة/المبنى/الطابق/الجناح/القاعة) inside a
 * room table on every row, so the table is found by its headings and the location read from
 * that nested row. A row whose day and date are not announced yet keeps them as null; the date
 * is the Hijri date as shown and is never converted. A missing table or heading, a row without a
 * course or without a readable time, and a time that is not HH:MM make the page unreadable.
 */
export function readFinalExams(doc: Document): FinalExamData | null {
  const headings = selectors.finalExams.headings;
  const headingClass = selectors.tables.headingClass;
  const wanted = [
    headings.code,
    headings.name,
    headings.day,
    headings.time,
    headings.date,
  ];

  let table: Element | null = null;
  let columns: Map<string, number> | null = null;

  for (const candidate of doc.querySelectorAll("table")) {
    const indexes = columnIndexes(candidate, headingClass);
    const hasLocation = Array.from(indexes.keys()).some((heading) =>
      heading.includes(selectors.finalExams.locationHeading),
    );

    if (hasLocation && wanted.every((heading) => indexes.has(heading))) {
      table = candidate;
      columns = indexes;
      break;
    }
  }

  if (table === null || columns === null) {
    return null;
  }

  const locationColumn = Array.from(columns.entries()).find(([heading]) =>
    heading.includes(selectors.finalExams.locationHeading),
  )?.[1];

  const exams: FinalExamData["exams"] = [];

  for (const row of dataRows(table)) {
    const cells = cellsOf(row);

    if (cells.every((cell) => textOf(cell) === "")) {
      continue;
    }

    const code = cellText(row, columns.get(headings.code));
    const name = cellText(row, columns.get(headings.name));
    const time = clockTime(cellText(row, columns.get(headings.time)));
    const locationCell =
      locationColumn === undefined ? null : (cells[locationColumn] ?? null);

    if (code === "" || name === "" || time === null) {
      return null;
    }

    exams.push({
      code,
      name,
      day: optionalText(cells[columns.get(headings.day) ?? -1] ?? null),
      date: optionalText(cells[columns.get(headings.date) ?? -1] ?? null),
      time,
      location: locationCell === null ? null : locationOf(locationCell),
    });
  }

  return { exams };
}
