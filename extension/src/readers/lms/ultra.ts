// The LMS (Blackboard Ultra) builds its pages in the browser, so a fetch of a page returns an
// empty shell. The readers work from the JSON API the page itself calls, in the student's own
// session; this module holds what the three LMS readers share.

import selectors from "../../selectors.json" with { type: "json" };

/** One course, with every membership it was merged from. The ids never leave the extension. */
export type LmsCourse = {
  code: string | null;
  name: string;
  sections: string[];
  ids: string[];
};

export type LmsCoursesData = {
  courses: Array<{ code: string | null; name: string; sections: string[] }>;
};

const COURSE_ID = new RegExp(selectors.lms.courseCodePattern);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty string, or null when the value is anything else. */
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A finite number, or null. */
export function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The subject code and the section of a course id such as `SWE485_83301_1_481`, by the
 * pattern in selectors.json. Both are null when the id is not that shape.
 */
function codeAndSection(courseId: unknown): { code: string | null; section: string | null } {
  const match = typeof courseId === "string" ? COURSE_ID.exec(courseId) : null;
  const { subject, number, section } = match?.groups ?? {};

  if (subject === undefined || number === undefined) {
    return { code: null, section: null };
  }

  return { code: `${subject} ${number}`, section: section ?? null };
}

/**
 * True when the course runs now: its term window contains `now`, or — when it has no term —
 * it is available and not closed. Null when a term is there but its dates are not.
 */
function inSession(course: Record<string, unknown>, now: Date): boolean | null {
  const term = course.term;

  if (term === undefined || term === null) {
    return course.isAvailable === true && course.isClosed !== true;
  }

  if (!isRecord(term)) {
    return null;
  }

  const start = text(term.startDate);
  const end = text(term.endDate);

  if (start === null || end === null) {
    return null;
  }

  const from = Date.parse(start);
  const to = Date.parse(end);

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  const at = now.getTime();

  return at >= from && at <= to;
}

/**
 * The courses of the student's current term, one entry per subject: the memberships of the same
 * subject (its sections) are merged, and their section numbers kept once each.
 * An organization, a course outside its term window, and a closed course without a term are left
 * out. Null means the membership list is not the shape the page map describes, so the caller
 * reports `page_unreadable` rather than a guess.
 */
export function readCourses(
  memberships: readonly unknown[],
  now: Date,
): LmsCourse[] | null {
  const byCode = new Map<string, LmsCourse>();
  const courses: LmsCourse[] = [];

  for (const membership of memberships) {
    if (!isRecord(membership) || !isRecord(membership.course)) {
      return null;
    }

    const course = membership.course;
    const id = text(course.id);
    const name = text(course.name);

    if (id === null || name === null) {
      return null;
    }

    if (course.isOrganization === true) {
      continue;
    }

    const kept = inSession(course, now);

    if (kept === null) {
      return null;
    }

    if (!kept) {
      continue;
    }

    const { code, section } = codeAndSection(course.courseId);
    // A course id outside the pattern has no code to merge by, so it stays its own entry.
    const key = code ?? `#${id}`;
    const merged = byCode.get(key);

    if (merged !== undefined) {
      merged.ids.push(id);

      if (section !== null && !merged.sections.includes(section)) {
        merged.sections.push(section);
      }

      continue;
    }

    const entry: LmsCourse = {
      code,
      name,
      sections: section === null ? [] : [section],
      ids: [id],
    };

    byCode.set(key, entry);
    courses.push(entry);
  }

  return courses;
}

/** The courses as the contract lists them: no membership ids. */
export function coursesData(courses: readonly LmsCourse[]): LmsCoursesData {
  return {
    courses: courses.map(({ code, name, sections }) => ({ code, name, sections })),
  };
}
