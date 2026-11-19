// The LMS gradebook of one course, from /learn/api/v1/courses/{id}/gradebook/columns and
// .../gradebook/grades.
//
// The answer lists the columns the student can see and whose grades are released, each with the
// student's own score. This LMS has no overall or total column, so the items are what the
// student's grade is made of. The feedback, the class average, the effective score and the manual
// grade are never read: the student is shown their score and the status, and nothing else.

import { count, isRecord, text } from "./ultra.js";

export type GradeStatus = "graded" | "needs_grading" | "none";

export type GradeItem = {
  title: string;
  score: number | null;
  possible: number | null;
  status: GradeStatus;
};

export type Gradebook = { items: GradeItem[] };

type Column = {
  id: string;
  title: string;
  possible: number | null;
  position: number;
};

const STATUS: Record<string, GradeStatus> = {
  GRADED: "graded",
  NEEDS_GRADING: "needs_grading",
};

/**
 * The columns the student sees, by position. A column the course hides, one whose grades are not
 * released and one that was deleted are left out; a column without an id or a name cannot be
 * listed, so it is skipped too. Null only when the answer is not the documented shape.
 */
function columnsOf(value: unknown): Column[] | null {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    return null;
  }

  const columns: Column[] = [];

  for (const item of value.results) {
    if (!isRecord(item)) {
      continue;
    }

    const id = text(item.id);
    const title = text(item.effectiveColumnName) ?? text(item.columnName);

    if (id === null || title === null) {
      continue;
    }

    if (item.visible !== true || item.gradesReleased !== true || item.deleted === true) {
      continue;
    }

    columns.push({
      id,
      title,
      possible: count(item.possible),
      position: count(item.position) ?? 0,
    });
  }

  return columns.sort((left, right) => left.position - right.position);
}

/** The grade rows, or null when the answer is not the documented shape. */
function rowsOf(grades: unknown): Array<Record<string, unknown>> | null {
  if (!isRecord(grades) || !Array.isArray(grades.results)) {
    return null;
  }

  return grades.results.filter(isRecord);
}

/**
 * The student's own row of each column, by column id. A row of another student is not the
 * student's grade, so it is skipped; so is a row without a column.
 */
function ownRows(
  rows: readonly Record<string, unknown>[],
  userId: string,
): Map<string, Record<string, unknown>> {
  const byColumn = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const columnId = text(row.columnId);

    if (columnId === null || row.userId !== userId || byColumn.has(columnId)) {
      continue;
    }

    byColumn.set(columnId, row);
  }

  return byColumn;
}

/**
 * The student's grade items of one course, in column order. Null only when the answers are not
 * the documented shape; an empty course answers with no items.
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

  const rows = rowsOf(grades);

  if (rows === null) {
    return null;
  }

  const byColumn = ownRows(rows, userId);

  return {
    items: list.map((column) => {
      const row = byColumn.get(column.id);
      const shown = row?.displayGrade;
      const status = row === undefined ? "none" : (STATUS[text(row.status) ?? ""] ?? "none");

      return {
        title: column.title,
        score: isRecord(shown) ? count(shown.score) : null,
        possible: column.possible ?? (row === undefined ? null : count(row.pointsPossible)),
        status,
      };
    }),
  };
}
