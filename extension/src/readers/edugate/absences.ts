import selectors from "../../selectors.json" with { type: "json" };
import {
  cellText,
  cellsOf,
  columnIndexes,
  dataRows,
  findTable,
  percentValue,
  textOf,
  wholeNumber,
} from "./dom.js";

export type AbsenceData = {
  courses: Array<{
    code: string;
    name: string;
    absence_percent: number;
    absences: number;
    lates: number;
  }>;
};

/**
 * The absence summary of the page: one entry per course row.
 *
 * The page carries two tables. The short warning table has three headings and is not the
 * source; the summary table is the one whose headings include مجموع الغياب, مجموع التأخير
 * and نسبة الغياب. The percentage appears with or without the % sign, so both forms are
 * accepted and returned as a number. A missing table or heading, a row that cannot be read
 * and a percentage outside 0–100 make the page unreadable rather than a guess.
 */
export function readAbsences(doc: Document): AbsenceData | null {
  const headings = selectors.absences.headings;
  const table = findTable(
    doc,
    [
      headings.code,
      headings.name,
      headings.absences,
      headings.lates,
      headings.percent,
    ],
    selectors.tables.headingClass,
  );

  if (table === null) {
    return null;
  }

  const columns = columnIndexes(table, selectors.tables.headingClass);
  const courses: AbsenceData["courses"] = [];

  for (const row of dataRows(table)) {
    const cells = cellsOf(row);

    if (cells.every((cell) => textOf(cell) === "")) {
      continue;
    }

    const code = cellText(row, columns.get(headings.code));
    const name = cellText(row, columns.get(headings.name));
    const absences = wholeNumber(cellText(row, columns.get(headings.absences)));
    const lates = wholeNumber(cellText(row, columns.get(headings.lates)));
    const percent = percentValue(cellText(row, columns.get(headings.percent)));

    if (
      code === "" ||
      name === "" ||
      absences === null ||
      lates === null ||
      percent === null
    ) {
      return null;
    }

    courses.push({ code, name, absence_percent: percent, absences, lates });
  }

  return { courses };
}
