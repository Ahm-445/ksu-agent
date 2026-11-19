import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { readSchedule } from "../../src/readers/edugate/schedule.js";

const FIXTURE = fileURLToPath(
  new URL("../fixtures/edugate/schedule.html", import.meta.url),
);

function pageFrom(html: string): Document {
  return new JSDOM(html).window.document as unknown as Document;
}

function fixture(): Document {
  return pageFrom(readFileSync(FIXTURE, "utf8"));
}

function scheduleTable(doc: Document): Element | null {
  return doc.getElementById("myForm:studScheduleTable");
}

function row(doc: Document, index: number): HTMLTableRowElement {
  const rows =
    scheduleTable(doc)?.querySelectorAll(":scope > tbody > tr") ?? [];
  const found = rows[index];

  if (found === undefined) {
    throw new Error(`the fixture lost row ${index}`);
  }

  return found as HTMLTableRowElement;
}

/** The day and time spans of the first slot of one row. */
function firstSlot(doc: Document, index: number): { day: Element; time: Element } {
  const cell = row(doc, index).cells[6];
  const spans = cell?.querySelectorAll("span.fontTextSmall") ?? [];
  const day = spans[0];
  const time = spans[1];

  if (day === undefined || time === undefined) {
    throw new Error(`the fixture lost the first slot of row ${index}`);
  }

  return { day, time };
}

describe("readSchedule", () => {
  it("reads the term and every class of the table", () => {
    const data = readSchedule(fixture());

    expect(data?.term).toBe("الفصل الأول 1448/1449");
    expect(data?.classes).toHaveLength(11);
    expect(data?.classes[0]).toEqual({
      code: "900 نال",
      name: "قيمة نموذج نموذج",
      activity: "وحدة",
      section: "91073",
      days: [4, 3],
      start: "47:87",
      end: "52:64",
    });
  });

  it("emits one entry per slot when a course meets twice", () => {
    const classes = readSchedule(fixture())?.classes ?? [];
    const twice = classes.filter(
      (entry) => entry.code === "979 نال" && entry.section === "93745",
    );

    expect(twice).toHaveLength(2);
    expect(twice.map((entry) => entry.days)).toEqual([[2], [3]]);
    expect(twice[0]?.start).not.toBe(twice[1]?.start);
  });

  it("converts a 12-hour time to 24-hour", () => {
    const doc = fixture();
    const slot = firstSlot(doc, 0);

    slot.day.textContent = "4";
    slot.time.textContent = "01:00 م - 01:50 م";

    expect(readSchedule(doc)?.classes[0]).toMatchObject({
      days: [4],
      start: "13:00",
      end: "13:50",
    });
  });

  it("reads 12:00 م as noon and 12:05 ص as after midnight", () => {
    const doc = fixture();
    const slot = firstSlot(doc, 0);

    slot.day.textContent = "1";
    slot.time.textContent = "12:00 م - 12:05 ص";

    expect(readSchedule(doc)?.classes[0]).toMatchObject({
      start: "12:00",
      end: "00:05",
    });
  });

  it("keeps the day codes of a slot as integers", () => {
    const doc = fixture();
    const slot = firstSlot(doc, 0);

    slot.day.textContent = "1 3 5";

    expect(readSchedule(doc)?.classes[0]?.days).toEqual([1, 3, 5]);
  });

  it("skips an activity slot with no day and no time", () => {
    const doc = fixture();
    const slot = firstSlot(doc, 0);

    slot.day.textContent = "";
    slot.time.textContent = "";

    const data = readSchedule(doc);

    expect(data?.classes).toHaveLength(10);
    expect(data?.classes.every((entry) => entry.days.length > 0)).toBe(true);
  });

  it("never reads the lecturer or the room from the التفاصيل cell", () => {
    const doc = fixture();
    const details = row(doc, 0).cells[8];
    const lecturer = details?.querySelector("span[id*=instructor]")?.textContent ?? "";

    expect(lecturer).not.toBe("");

    const data = readSchedule(doc);

    expect(JSON.stringify(data)).not.toContain(lecturer);
    expect(JSON.stringify(data)).not.toContain("المحاضر");
  });

  it("returns null when the term selector is missing", () => {
    const doc = fixture();

    doc.getElementById("myForm:selectSemester")?.remove();

    expect(readSchedule(doc)).toBeNull();
  });

  it("returns null when the table is missing", () => {
    const doc = fixture();

    scheduleTable(doc)?.remove();

    expect(readSchedule(doc)).toBeNull();
  });

  it("returns null when the day and time heading is missing", () => {
    const doc = fixture();
    const heading = Array.from(
      scheduleTable(doc)?.querySelectorAll("thead th") ?? [],
    ).find((th) => th.textContent?.replace(/\s+/g, " ").trim() === "اليوم الوقت");

    heading?.remove();

    expect(readSchedule(doc)).toBeNull();
  });

  it("returns null when a slot cannot be read", () => {
    const doc = fixture();
    const slot = firstSlot(doc, 0);

    slot.time.textContent = "وقت غير معروف";

    expect(readSchedule(doc)).toBeNull();
  });

  it("returns null when a day code is outside 1-7", () => {
    const doc = fixture();
    const slot = firstSlot(doc, 0);

    slot.day.textContent = "9";

    expect(readSchedule(doc)).toBeNull();
  });
});
