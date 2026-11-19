// The LMS gradebook of one course, from /learn/api/v1/courses/{id}/gradebook/columns and
// .../gradebook/grades.
//
// The course grade is the grade of the course's overall column, and only when that column is
// visible to the student and its grades are released: a hidden column or one still being marked is
// not the grade the student sees. The class average is a grade row with no user id, so it is never
// taken, and no feedback text is read at all.

import { isRecord, text } from "./ultra.js";

export type Gradebook = { grade: string | null };

type Column = { id: string; overall: boolean };

const NOTHING: Gradebook = { grade: null };

/** The columns of the answer, or null when one of them is not the documented shape. */
function columnsOf(value: unknown): Column[] | null {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return null;
  }

  const columns: Column[] = [];

  for (const item of value.results) {
    if (!isRecord(item) || !isRecord(item.grading)) {
      return null;
    }

    const id = text(item.id);
    const type = text(item.grading.type);
    const visibility = text(item.visibility);

    if (id === null || type === null || visibility === null) {
      return null;
    }

    if (typeof item.gradesReleased !== "boolean") {
      return null;
    }

    columns.push({
      id,
      overall:
        type === "Calculated" &&
        visibility === "Visible" &&
        item.gradesReleased === true,
    });
  }

  return columns;
}

/**
 * The student's own grade of the course's overall column, or null when the course has none to
 * show. Null for the whole answer when the shapes are not the documented ones.
 */
export function readGradebook(
  columns: unknown,
  grades: unknown,
  userId: string,
): Gradebook | null {
  const list = columnsOf(columns);

  if (list === null) {
    return null;
  }

  const overall = list.find((column) => column.overall);

  if (overall === undefined) {
    return NOTHING;
  }

  if (!isRecord(grades) || !Array.isArray(grades.results)) {
    return null;
  }

  for (const item of grades.results) {
    if (!isRecord(item) || !("userId" in item)) {
      return null;
    }

    const columnId = text(item.columnId);

    if (columnId === null) {
      return null;
    }

    if (columnId !== overall.id || item.userId !== userId) {
      continue;
    }

    const shown = isRecord(item.displayGrade) ? text(item.displayGrade.text) : null;

    return { grade: shown };
  }

  return NOTHING;
}
