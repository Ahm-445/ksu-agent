import { describe, expect, it, vi } from "vitest";

import { buildConsent, readForConsent } from "@/lib/consent";
import type { GpaData, PlanProgressData, ToolResult } from "@/lib/extension";
import { dictionary } from "@/lib/i18n";

const GPA: GpaData = {
  cumulative_gpa: "4.21",
  scale: "5",
  earned_hours: 96,
  registered_hours: 987654,
  as_of_term: "الفصل الأول 1448/1449",
};

const PLAN: PlanProgressData = {
  completed_hours: 96,
  remaining_hours: 6,
  remaining_courses: [
    {
      code: "444",
      name: "مشروع التخرج",
      hours: 3,
      group: "تخصص",
      type: "إجباري",
      level: "7",
    },
    {
      code: "445",
      name: "مقرر اختياري",
      hours: 3,
      group: "اختياري",
      type: "اختياري",
      level: "7",
    },
  ],
};

const AR = dictionary.ar;
const EN = dictionary.en;

function reading(values: Record<string, unknown>) {
  return vi.fn(
    async (tool: string): Promise<ToolResult> => ({
      ok: true,
      data: values[tool] as ToolResult extends { ok: true; data: infer D }
        ? D
        : never,
      readAt: "2026-11-20T10:00:00+03:00",
    }),
  );
}

describe("the consent card's contents", () => {
  it("describes each tool in plain words, with its fields and its item count", () => {
    const request = buildConsent(
      "هل أقدر أتخرج الفصل القادم؟",
      [
        { tool: "get_gpa", data: GPA },
        { tool: "get_plan_progress", data: PLAN },
      ],
      AR,
    );

    expect(request.question).toBe("هل أقدر أتخرج الفصل القادم؟");
    expect(request.tools.map((tool) => tool.tool)).toEqual([
      "get_gpa",
      "get_plan_progress",
    ]);
    expect(request.tools[0].description).toBe(AR.chat.consent.tools.get_gpa);
    expect(request.tools[0].fields).toEqual([
      "cumulative_gpa",
      "scale",
      "earned_hours",
      "registered_hours",
      "as_of_term",
    ]);
    expect(request.tools[0].items).toBe(1);
    expect(request.tools[1].items).toBe(2);
  });

  it("keeps exactly the values that will be sent", () => {
    const request = buildConsent(
      "سؤال",
      [
        { tool: "get_gpa", data: GPA },
        { tool: "get_plan_progress", data: PLAN },
      ],
      AR,
    );

    expect(request.data).toEqual({ get_gpa: GPA, get_plan_progress: PLAN });
  });

  it("speaks the student's language", () => {
    const request = buildConsent("q", [{ tool: "get_gpa", data: GPA }], EN);

    expect(request.tools[0].description).toBe(EN.chat.consent.tools.get_gpa);
    expect(request.tools[0].description).not.toBe(AR.chat.consent.tools.get_gpa);
  });
});

describe("reading the values for the card", () => {
  it("runs each tool once, in the order the reply named them", async () => {
    const run = reading({ get_gpa: GPA, get_plan_progress: PLAN });

    const outcome = await readForConsent(
      "هل أقدر أتخرج الفصل القادم؟",
      ["get_plan_progress", "get_gpa"],
      AR,
      run,
    );

    expect(run.mock.calls.map(([tool]) => tool)).toEqual([
      "get_plan_progress",
      "get_gpa",
    ]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.request.tools.map((tool) => tool.tool)).toEqual([
        "get_plan_progress",
        "get_gpa",
      ]);
      expect(outcome.request.data).toEqual({
        get_plan_progress: PLAN,
        get_gpa: GPA,
      });
    }
  });

  it("stops at the first page it cannot read, and says which one", async () => {
    const run = vi.fn(async (tool: string): Promise<ToolResult> => {
      if (tool === "get_gpa") {
        return { ok: false, error: "no_consent" };
      }

      return { ok: true, data: PLAN, readAt: "now" };
    });

    const outcome = await readForConsent(
      "سؤال",
      ["get_gpa", "get_plan_progress"],
      AR,
      run,
    );

    expect(outcome).toEqual({
      ok: false,
      tool: "get_gpa",
      error: "no_consent",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
