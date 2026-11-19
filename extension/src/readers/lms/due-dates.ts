// The LMS calendar's due dates, from /learn/api/v1/calendars/dueDateCalendarItems.
//
// Every item carries a `calendarId` of the course calendar it sits on, and the course id is
// its prefix (`_999_1_1` is the calendar of the course `_999_1`). An item whose course is not
// one of the student's current courses is not this term's work, so it is left out.

import { isRecord, text, type LmsCourse } from "./ultra.js";

export type LmsAssignmentsData = {
  items: Array<{ title: string; course: string; due_at: string }>;
};

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * A due date as the contract shows it: Riyadh time with its offset, to the second, such as
 * `2026-11-21T23:59:00+03:00`. Saudi Arabia keeps one offset all year, so no zone lookup is
 * needed. Null when the value is not a date.
 */
export function riyadhTime(value: unknown): string | null {
  const iso = text(value);

  if (iso === null) {
    return null;
  }

  const at = Date.parse(iso);

  if (!Number.isFinite(at)) {
    return null;
  }

  const local = new Date(at + RIYADH_OFFSET_MS).toISOString();

  return `${local.slice(0, 19)}+03:00`;
}

/** The course whose calendar the item sits on, by the longest matching id, or null. */
function courseOf(calendarId: string, courses: readonly LmsCourse[]): LmsCourse | null {
  let found: LmsCourse | null = null;
  let length = 0;

  for (const course of courses) {
    for (const id of course.ids) {
      const fits = calendarId === id || calendarId.startsWith(`${id}_`);

      if (fits && id.length > length) {
        found = course;
        length = id.length;
      }
    }
  }

  return found;
}

/**
 * The due dates of the student's current courses, soonest first, or null when an item is not
 * the shape the API documents.
 */
export function readDueDates(
  items: unknown,
  courses: readonly LmsCourse[],
): LmsAssignmentsData | null {
  if (!Array.isArray(items)) {
    return null;
  }

  const due: LmsAssignmentsData["items"] = [];

  for (const item of items) {
    if (!isRecord(item)) {
      return null;
    }

    const title = text(item.title);
    const calendarId = text(item.calendarId);
    const dueAt = riyadhTime(item.start);

    if (title === null || calendarId === null || dueAt === null) {
      return null;
    }

    const course = courseOf(calendarId, courses);

    if (course === null) {
      continue;
    }

    due.push({ title, course: course.name, due_at: dueAt });
  }

  due.sort((left, right) =>
    left.due_at < right.due_at ? -1 : left.due_at > right.due_at ? 1 : 0,
  );

  return { items: due };
}
