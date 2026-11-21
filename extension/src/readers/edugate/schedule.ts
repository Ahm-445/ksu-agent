import selectors from "../../selectors.json" with { type: "json" };
import {
  asciiDigits,
  cellText,
  cellsOf,
  columnIndexes,
  dataRows,
  findTable,
  shownTerm,
  textOf,
} from "./dom.js";

export type ScheduleData = {
  term: string;
  classes: Array<{
    code: string;
    name: string;
    activity: string;
    section: string;
    days: number[];
    start: string;
    end: string;
  }>;
};

const TIME = /^(\d{1,2}):(\d{2})\s*(ص|م|AM|PM)?$/i;

function pad(value: string | number): string {
  return String(value).padStart(2, "0");
}

/**
 * A 12-hour time as the schedule shows it, as 24-hour HH:MM: 01:00 م -> 13:00,
 * 12:00 م -> 12:00, 12:05 ص -> 00:05. Null when the text is not a time.
 */
function to24Hour(value: string): string | null {
  const match = TIME.exec(asciiDigits(value).trim());

  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }

  const period = (match[3] ?? "").toUpperCase();
  const am = period === "ص" || period === "AM";
  const pm = period === "م" || period === "PM";
  let hour = Number(match[1]);

  if (pm && hour < 12) {
    hour += 12;
  } else if (am && hour === 12) {
    hour = 0;
  }

  return `${pad(hour)}:${match[2]}`;
}

/** The day codes of one slot: integers 1–7, or null when one is not. */
function daysOf(value: string): number[] | null {
  const codes = asciiDigits(value)
    .split(/[^0-9]+/)
    .filter((code) => code !== "")
    .map(Number);

  if (codes.length === 0 || codes.some((code) => code < 1 || code > 7)) {
    return null;
  }

  return Array.from(new Set(codes));
}

type Slot = { days: number[]; start: string; end: string };

/**
 * The slots of one row's اليوم الوقت cell: the nested table holds one row per slot, and each
 * slot row holds its own day codes and its own time range. A slot with no day and no time is
 * an activity with no time yet and is skipped. Null when a slot cannot be read.
 */
function slotsOf(cell: Element): Slot[] | null {
  const table = cell.querySelector("table");

  if (table === null) {
    return [];
  }

  const slots: Slot[] = [];

  for (const row of Array.from((table as HTMLTableElement).rows)) {
    const parts = cellsOf(row).map((part) => textOf(part));

    for (let index = 0; index + 1 < parts.length; index += 2) {
      const dayText = parts[index] ?? "";
      const timeText = parts[index + 1] ?? "";

      if (dayText === "" && timeText === "") {
        continue;
      }

      const days = daysOf(dayText);
      const [startText, endText] = timeText.split("-");
      const start = startText === undefined ? null : to24Hour(startText);
      const end = endText === undefined ? null : to24Hour(endText);

      if (days === null || start === null || end === null) {
        return null;
      }

      slots.push({ days, start, end });
    }
  }

  return slots;
}

/**
 * The class schedule of the page, or null.
 *
 * The term is the one the page's term selector shows. The اليوم الوقت cell holds a nested
 * table with one or more slots, each with its own day codes and time range, so a course that
 * meets twice becomes two classes entries. Times are 12-hour with ص/م and are returned as
 * 24-hour HH:MM. The التفاصيل cell holds the lecturer and the room and is never read. A
 * missing selector, table or heading, and a slot that cannot be read, make the page
 * unreadable rather than a guess.
 */
export function readSchedule(doc: Document): ScheduleData | null {
  const headings = selectors.schedule.headings;
  const headingClass = selectors.tables.headingClass;
  const term = shownTerm(doc, selectors.schedule.termSelectId);

  if (term === null) {
    return null;
  }

  const table =
    doc.getElementById(selectors.schedule.tableId) ??
    findTable(
      doc,
      [
        headings.code,
        headings.name,
        headings.activity,
        headings.section,
        headings.dayTime,
        headings.sectionType,
      ],
      headingClass,
    );

  if (table === null) {
    return null;
  }

  const columns = columnIndexes(table, headingClass);
  const dayTimeColumn = columns.get(headings.dayTime);

  if (dayTimeColumn === undefined) {
    return null;
  }

  const classes: ScheduleData["classes"] = [];

  for (const row of dataRows(table)) {
    const cells = cellsOf(row);

    if (cells.every((cell) => textOf(cell) === "")) {
      continue;
    }

    const code = cellText(row, columns.get(headings.code));
    const name = cellText(row, columns.get(headings.name));
    const dayTimeCell = cells[dayTimeColumn] ?? null;
    const slots = dayTimeCell === null ? null : slotsOf(dayTimeCell);

    if (code === "" || name === "" || slots === null) {
      return null;
    }

    for (const slot of slots) {
      classes.push({
        code,
        name,
        activity: cellText(row, columns.get(headings.activity)),
        section: cellText(row, columns.get(headings.section)),
        days: slot.days,
        start: slot.start,
        end: slot.end,
      });
    }
  }

  return { term, classes };
}
