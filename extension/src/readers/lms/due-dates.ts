// The LMS calendar's due dates, from /learn/api/v1/calendars/dueDateCalendarItems.
//
// Every item carries the id of the course calendar it sits on, so its course is the student's
// merged course for that id. An item on a calendar that is not one of the student's courses —
// an organization, a past term — is still the student's own due date, so it keeps the course name
// the LMS prints for it. The due time is `endDate`, which the API gives in UTC.

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
 * The course name the LMS prints on the calendar, from a calendar name such as
 * `SWE483_77947_1_481: هندسة البرمجيات`: the text after the colon, or the whole name when it
 * carries no colon.
 */
function calendarCourse(item: Record<string, unknown>): string | null {
  const localizable = item.calendarNameLocalizable;
  const raw = isRecord(localizable) ? text(localizable.rawValue) : null;

  if (raw === null) {
    return null;
  }

  const colon = raw.indexOf(":");
  const after = colon === -1 ? "" : raw.slice(colon + 1).trim();

  return after === "" ? raw : after;
}

/**
 * The due dates of the student's calendar, soonest first. An item without a title or without an
 * end date is skipped: it is one item the LMS has not filled in, not a reason to drop the rest.
 * Null only when the list is not the array the API documents.
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
      continue;
    }

    const title = text(item.title);
    const dueAt = riyadhTime(item.endDate);

    if (title === null || dueAt === null) {
      continue;
    }

    const calendarId = text(item.calendarId);
    const matched = calendarId === null ? null : courseOf(calendarId, courses);
    const course = matched?.name ?? calendarCourse(item);

    if (course === null) {
      continue;
    }

    due.push({ title, course, due_at: dueAt });
  }

  due.sort((left, right) =>
    left.due_at < right.due_at ? -1 : left.due_at > right.due_at ? 1 : 0,
  );

  return { items: due };
}
