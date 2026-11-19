import selectors from "../../selectors.json" with { type: "json" };
import {
  asciiDigits,
  cellText,
  cellsOf,
  columnIndexes,
  dataRows,
  textOf,
  wholeNumber,
} from "./dom.js";

export type PlanProgressData = {
  completed_hours: number;
  remaining_hours: number;
  remaining_courses: Array<{
    code: string;
    name: string;
    hours: number;
    group: string;
    type: string;
    level: string;
  }>;
};

type PlanRow = {
  code: string;
  name: string;
  hours: number;
  type: string;
  level: string;
};

type PlanGroup = { title: string; required: number; rows: PlanRow[] };

const HOURS = new RegExp(selectors.plan.groupHoursPattern);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The group title and its required hours from the group header, e.g.
 * "متطلبات الجامعة - عدد الساعات (4)" -> "متطلبات الجامعة" and 4. Null when the hours in
 * brackets or the title cannot be read.
 */
function parseGroupHeader(text: string): { title: string; required: number } | null {
  const ascii = asciiDigits(text);
  const match = HOURS.exec(ascii);
  const hours = match?.[1];

  if (match === null || hours === undefined) {
    return null;
  }

  const label = new RegExp(
    `\\s*[${escapeRegExp(selectors.plan.groupSeparators)}]?\\s*${escapeRegExp(
      selectors.plan.groupHoursLabel,
    )}\\s*$`,
  );

  const title = ascii
    .slice(0, match.index)
    .replace(label, "")
    .replace(new RegExp(`[${escapeRegExp(selectors.plan.groupSeparators)}]\\s*$`), "")
    .trim();

  return title === "" ? null : { title, required: Number(hours) };
}

/**
 * The requirement groups of one plan page: each group's title, its required hours from the
 * header, and its course rows. Null when the table, a header, a heading or a row cannot be
 * read.
 */
function readGroups(doc: Document, tableId: string): PlanGroup[] | null {
  const plan = doc.getElementById(tableId);

  if (plan === null) {
    return null;
  }

  const headings = selectors.plan.headings;
  const headingClass = selectors.tables.headingClass;
  const headers = Array.from(
    plan.querySelectorAll(`table[id$="${selectors.plan.groupHeaderIdSuffix}"]`),
  );

  if (headers.length === 0) {
    return null;
  }

  const groups: PlanGroup[] = [];

  for (const header of headers) {
    const parsed = parseGroupHeader(textOf(header));

    if (parsed === null) {
      return null;
    }

    const container = header.closest("div");
    const table =
      container?.querySelector(`table.${selectors.plan.dataTableClass}`) ?? null;

    if (table === null) {
      return null;
    }

    const columns = columnIndexes(table, headingClass);

    if (
      !columns.has(headings.code) ||
      !columns.has(headings.name) ||
      !columns.has(headings.hours) ||
      !columns.has(headings.type) ||
      !columns.has(headings.level)
    ) {
      return null;
    }

    const rows: PlanRow[] = [];

    for (const row of dataRows(table)) {
      const cells = cellsOf(row);

      if (cells.every((cell) => textOf(cell) === "")) {
        continue;
      }

      const code = cellText(row, columns.get(headings.code));
      const name = cellText(row, columns.get(headings.name));
      const hours = wholeNumber(cellText(row, columns.get(headings.hours)));

      if (code === "" || name === "" || hours === null) {
        return null;
      }

      rows.push({
        code,
        name,
        hours,
        type: cellText(row, columns.get(headings.type)),
        level: cellText(row, columns.get(headings.level)),
      });
    }

    groups.push({ ...parsed, rows });
  }

  return groups;
}

function hoursByTitle(groups: readonly PlanGroup[]): Map<string, number> {
  const hours = new Map<string, number>();

  for (const group of groups) {
    const done = group.rows.reduce((total, row) => total + row.hours, 0);

    hours.set(group.title, (hours.get(group.title) ?? 0) + done);
  }

  return hours;
}

/** The hours of the mandatory rows of a group; an elective option is never counted. */
function mandatoryHours(group: PlanGroup): number {
  const mandatory = selectors.plan.mandatoryTypes;

  return group.rows
    .filter((row) => mandatory.includes(row.type))
    .reduce((total, row) => total + row.hours, 0);
}

/**
 * The study plan progress from the two plan pages, or null.
 *
 * The pages are split per requirement group: the completed page lists the courses taken, the
 * remaining page lists every option of each group, so a six-hour elective group can list
 * twenty courses. The remaining rows are therefore never summed. `completed_hours` is the sum
 * of الساعات over the completed rows.
 *
 * A group needs its mandatory courses even when its electives already reach its hours: a
 * student can complete six hours of a four-hour elective group while a two-hour إجباري course
 * is still missing. So per group, matched by title across the two pages,
 * `remaining` is max(the hours of its إجباري rows on the remaining page, required - completed),
 * and `remaining_hours` is the sum of those over the groups. A missing table, a group title or
 * required hours that cannot be read, and a row without its hours make the page unreadable
 * rather than a guess.
 */
export function readPlanProgress(
  completed: Document,
  remaining: Document,
): PlanProgressData | null {
  const completedGroups = readGroups(completed, selectors.plan.completedTableId);
  const remainingGroups = readGroups(remaining, selectors.plan.remainingTableId);

  if (completedGroups === null || remainingGroups === null) {
    return null;
  }

  const completedByTitle = hoursByTitle(completedGroups);
  const completedHours = completedGroups.reduce(
    (total, group) => total + group.rows.reduce((sum, row) => sum + row.hours, 0),
    0,
  );

  let remainingHours = 0;

  for (const group of remainingGroups) {
    const done = completedByTitle.get(group.title) ?? 0;

    remainingHours += Math.max(mandatoryHours(group), group.required - done);
  }

  const remainingCourses: PlanProgressData["remaining_courses"] = [];

  for (const group of remainingGroups) {
    for (const row of group.rows) {
      remainingCourses.push({
        code: row.code,
        name: row.name,
        hours: row.hours,
        group: group.title,
        type: row.type,
        level: row.level,
      });
    }
  }

  return {
    completed_hours: completedHours,
    remaining_hours: remainingHours,
    remaining_courses: remainingCourses,
  };
}
