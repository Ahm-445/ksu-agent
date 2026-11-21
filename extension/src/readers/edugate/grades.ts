import selectors from "../../selectors.json" with { type: "json" };
import {
  cellText,
  cellsOf,
  columnIndexes,
  dataRows,
  findTable,
  shownTerm,
  textOf,
} from "./dom.js";

export type GradesData = {
  term: string;
  courses: Array<{ code: string; name: string; grade: string | null }>;
};

/**
 * The course results of the term the page shows, or null.
 *
 * The page opens on the current term, where every grade is still empty until it is
 * recorded; the other terms are options of the term selector, which is not submitted. The
 * term is the selected option. An empty grade cell and the "not recorded" mark are both
 * null. A missing selector, table or heading, and a row without a course, make the page
 * unreadable rather than a guess.
 */
export function readGrades(doc: Document): GradesData | null {
  const headings = selectors.grades.headings;
  const headingClass = selectors.tables.headingClass;
  const term = shownTerm(doc, selectors.grades.termSelectId);

  if (term === null) {
    return null;
  }

  const table =
    doc.getElementById(selectors.grades.tableId) ??
    findTable(
      doc,
      [headings.code, headings.name, headings.grade],
      headingClass,
    );

  if (table === null) {
    return null;
  }

  const columns = columnIndexes(table, headingClass);

  if (
    !columns.has(headings.code) ||
    !columns.has(headings.name) ||
    !columns.has(headings.grade)
  ) {
    return null;
  }

  const courses: GradesData["courses"] = [];

  for (const row of dataRows(table)) {
    const cells = cellsOf(row);

    if (cells.every((cell) => textOf(cell) === "")) {
      continue;
    }

    const code = cellText(row, columns.get(headings.code));
    const name = cellText(row, columns.get(headings.name));
    const gradeText = cellText(row, columns.get(headings.grade));

    if (code === "" || name === "") {
      return null;
    }

    const notRecorded =
      gradeText === "" ||
      (selectors.grades.notRecorded as readonly string[]).includes(gradeText);

    courses.push({ code, name, grade: notRecorded ? null : gradeText });
  }

  return { term, courses };
}
