import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { readPlanProgress } from "../../src/readers/edugate/plan.js";

const COMPLETED = fileURLToPath(
  new URL("../fixtures/edugate/plan-completed.html", import.meta.url),
);
const REMAINING = fileURLToPath(
  new URL("../fixtures/edugate/plan-remaining.html", import.meta.url),
);

function pageFrom(html: string): Document {
  return new JSDOM(html).window.document as unknown as Document;
}

function fixture(path: string): Document {
  return pageFrom(readFileSync(path, "utf8"));
}

function completed(): Document {
  return fixture(COMPLETED);
}

function remaining(): Document {
  return fixture(REMAINING);
}

type GroupFixture = {
  header: string;
  rows: Array<{ code: string; name: string; hours: string; type: string; level: string }>;
};

/** A plan page with the same shape the real page has: a group per accordion block. */
function planPage(tableId: string, groups: GroupFixture[]): Document {
  const blocks = groups
    .map(
      (group, index) => `
      <div class="pui-accordion" id="${tableId}:${index + 1}:default">
        <h3><span class="ui-icon"></span></h3>
        <table id="${tableId}:${index + 1}:headerArray"><tbody><tr><td>
          <span class="fontTextWhite">${group.header}</span>
        </td></tr></tbody></table>
        <div class="pui-accordion-content">
          <table class="responsiveDataTable" id="${tableId}:${index + 1}:table">
            <thead><tr>
              <th class="HEADING">رمز المقرر</th>
              <th class="HEADING">اسم المقرر</th>
              <th class="HEADING"> الساعات </th>
              <th class="HEADING">نوع المجموعة</th>
              <th class="HEADING">المستوى</th>
            </tr></thead>
            <tbody>
              ${group.rows
                .map(
                  (row) =>
                    `<tr><td>${row.code}</td><td>${row.name}</td><td>${row.hours}</td><td>${row.type}</td><td>${row.level}</td></tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>`,
    )
    .join("");

  return pageFrom(
    `<!DOCTYPE html><html><body><table id="${tableId}"><tbody><tr><td>${blocks}</td></tr></tbody></table></body></html>`,
  );
}

const COURSE = { type: "إجباري", level: "الأول" };
const OPTION = { type: "اختياري", level: "الأول" };

describe("readPlanProgress", () => {
  it("reads the completed hours and the remaining courses of the fixtures", () => {
    const data = readPlanProgress(completed(), remaining());

    expect(data?.completed_hours).toBe(107);
    expect(data?.remaining_hours).toBe(45);
    expect(data?.remaining_courses).toHaveLength(37);
    expect(data?.remaining_courses[0]).toEqual({
      code: "910 احص",
      name: "عينة قيمة",
      hours: 2,
      group: "موضوع مادة - تجريبي مادة",
      type: "عينة",
      level: "بيانات",
    });
  });

  it("returns the contract fields of each remaining course", () => {
    const courses = readPlanProgress(completed(), remaining())?.remaining_courses ?? [];

    expect(courses.length).toBeGreaterThan(0);

    for (const course of courses) {
      expect(typeof course.code).toBe("string");
      expect(typeof course.name).toBe("string");
      expect(typeof course.hours).toBe("number");
      expect(typeof course.group).toBe("string");
      expect(typeof course.type).toBe("string");
      expect(typeof course.level).toBe("string");
    }
  });

  it("never sums the remaining rows: a group counts its required hours", () => {
    const data = readPlanProgress(completed(), remaining());
    const optionHours = (data?.remaining_courses ?? []).reduce(
      (total, course) => total + course.hours,
      0,
    );

    // The remaining page lists every option of each group, so its rows sum to far more than
    // the 45 required hours.
    expect(optionHours).toBeGreaterThan(data?.remaining_hours ?? 0);
    expect(data?.remaining_hours).toBe(45);
  });

  it("matches the groups by title across the two pages", () => {
    const done = planPage("myForm:takenPlanTable", [
      {
        header: "متطلبات الجامعة - عدد الساعات (4)",
        rows: [
          { code: "101", name: "أ", hours: "2", ...COURSE },
          { code: "102", name: "ب", hours: "2", ...COURSE },
        ],
      },
      {
        header: "متطلبات الكلية - عدد الساعات (79)",
        rows: [{ code: "201", name: "ج", hours: "60", ...COURSE }],
      },
    ]);

    const options = planPage("myForm:remainPlanTable", [
      {
        header: "متطلبات الجامعة - عدد الساعات (4)",
        rows: [
          { code: "103", name: "د", hours: "3", ...OPTION },
          { code: "104", name: "ه", hours: "3", ...OPTION },
          { code: "105", name: "و", hours: "3", ...OPTION },
        ],
      },
      {
        header: "متطلبات الكلية - عدد الساعات (79)",
        rows: [
          { code: "202", name: "ز", hours: "3", ...OPTION },
          { code: "203", name: "ح", hours: "3", ...OPTION },
          { code: "204", name: "ط", hours: "3", ...OPTION },
          { code: "205", name: "ي", hours: "3", ...OPTION },
        ],
      },
    ]);

    expect(readPlanProgress(done, options)).toEqual({
      completed_hours: 64,
      remaining_hours: 19,
      remaining_courses: [
        { code: "103", name: "د", hours: 3, group: "متطلبات الجامعة", type: "اختياري", level: "الأول" },
        { code: "104", name: "ه", hours: 3, group: "متطلبات الجامعة", type: "اختياري", level: "الأول" },
        { code: "105", name: "و", hours: 3, group: "متطلبات الجامعة", type: "اختياري", level: "الأول" },
        { code: "202", name: "ز", hours: 3, group: "متطلبات الكلية", type: "اختياري", level: "الأول" },
        { code: "203", name: "ح", hours: 3, group: "متطلبات الكلية", type: "اختياري", level: "الأول" },
        { code: "204", name: "ط", hours: 3, group: "متطلبات الكلية", type: "اختياري", level: "الأول" },
        { code: "205", name: "ي", hours: 3, group: "متطلبات الكلية", type: "اختياري", level: "الأول" },
      ],
    });
  });

  it("counts a mandatory remaining course when electives already exceeded the group", () => {
    // The real case: a 4-hour group, 6 hours of electives already completed, and a 2-hour
    // إجباري course still missing. The group needs 2 more hours, not 0.
    const done = planPage("myForm:takenPlanTable", [
      {
        header: "متطلبات الجامعة - عدد الساعات (4)",
        rows: [
          { code: "101", name: "أ", hours: "3", ...OPTION },
          { code: "102", name: "ب", hours: "3", ...OPTION },
        ],
      },
    ]);

    const options = planPage("myForm:remainPlanTable", [
      {
        header: "متطلبات الجامعة - عدد الساعات (4)",
        rows: [
          { code: "201", name: "ج", hours: "2", ...COURSE },
          { code: "202", name: "د", hours: "3", ...OPTION },
          { code: "203", name: "ه", hours: "3", ...OPTION },
        ],
      },
    ]);

    expect(readPlanProgress(done, options)).toMatchObject({
      completed_hours: 6,
      remaining_hours: 2,
    });
  });

  it("keeps a completed group that is not on the remaining page out of the sum", () => {
    const done = planPage("myForm:takenPlanTable", [
      {
        header: "متطلبات التحضيري - عدد الساعات (32)",
        rows: [{ code: "301", name: "ك", hours: "32", ...COURSE }],
      },
    ]);

    const options = planPage("myForm:remainPlanTable", [
      {
        header: "متطلبات الكلية - عدد الساعات (6)",
        rows: [{ code: "401", name: "ل", hours: "6", ...COURSE }],
      },
    ]);

    expect(readPlanProgress(done, options)).toMatchObject({
      completed_hours: 32,
      remaining_hours: 6,
    });
  });

  it("returns null when a group has no readable required hours", () => {
    const done = completed();
    const options = remaining();
    const header = options.querySelector('table[id$=":headerArray"]');

    if (header === null) {
      throw new Error("the fixture lost its first group header");
    }

    header.textContent = header.textContent?.replace(/\s*\(\d+\)\s*$/, "") ?? "";

    expect(readPlanProgress(done, options)).toBeNull();
  });

  it("returns null when a group title is empty", () => {
    const done = completed();
    const options = remaining();
    const header = options.querySelector('table[id$=":headerArray"]');

    if (header === null) {
      throw new Error("the fixture lost its first group header");
    }

    header.textContent = "(4)";

    expect(readPlanProgress(done, options)).toBeNull();
  });

  it("returns null when a remaining table is missing", () => {
    const done = completed();
    const options = remaining();

    options.getElementById("myForm:remainPlanTable")?.remove();

    expect(readPlanProgress(done, options)).toBeNull();
  });

  it("returns null when the completed table is missing", () => {
    const done = completed();
    const options = remaining();

    done.getElementById("myForm:takenPlanTable")?.remove();

    expect(readPlanProgress(done, options)).toBeNull();
  });

  it("returns null when a row has no hours", () => {
    const done = completed();
    const options = remaining();
    const table = options.querySelector("table.responsiveDataTable");
    const rows = table?.querySelectorAll(":scope > tbody > tr") ?? [];
    const hours = (rows[0] as HTMLTableRowElement | undefined)?.cells[2];

    if (hours === undefined) {
      throw new Error("the fixture lost its first remaining row");
    }

    hours.textContent = "—";

    expect(readPlanProgress(done, options)).toBeNull();
  });
});
