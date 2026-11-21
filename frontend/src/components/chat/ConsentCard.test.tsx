import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConsentCard } from "@/components/chat/ConsentCard";
import { buildConsent } from "@/lib/consent";
import type { GpaData, PlanProgressData } from "@/lib/extension";
import { dictionary } from "@/lib/i18n";

// The card reads its words from the language provider; the test fixes them to Arabic.
vi.mock("@/components/LanguageProvider", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");

  return {
    useLanguage: () => ({ lang: "ar", setLang: () => {}, t: actual.dictionary.ar }),
  };
});

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

const REQUEST = buildConsent(
  "هل أقدر أتخرج الفصل القادم؟",
  [
    { tool: "get_gpa", data: GPA },
    { tool: "get_plan_progress", data: PLAN },
  ],
  dictionary.ar,
);

function renderCard(overrides: Partial<Parameters<typeof ConsentCard>[0]> = {}) {
  const onApprove = vi.fn();
  const onCancel = vi.fn();

  render(
    <ConsentCard
      request={REQUEST}
      busy={false}
      onApprove={onApprove}
      onCancel={onCancel}
      {...overrides}
    />,
  );

  return { onApprove, onCancel };
}

describe("the consent card", () => {
  it("says what each tool reads, in plain words, and how many items it sends", () => {
    renderCard();

    const card = screen.getByRole("group", { name: dictionary.ar.chat.consent.title });

    expect(card.textContent).toContain(
      dictionary.ar.chat.consent.tools.get_gpa,
    );
    expect(card.textContent).toContain(
      dictionary.ar.chat.consent.tools.get_plan_progress,
    );
    expect(card.textContent).toContain("cumulative_gpa");
    expect(card.textContent).toContain("registered_hours");
    expect(card.textContent).toContain(
      dictionary.ar.chat.consent.items.replace("{count}", "2"),
    );
  });

  it("keeps the exact JSON behind a toggle, and shows it on request", () => {
    renderCard();


    fireEvent.click(
      screen.getByRole("button", {
        name: dictionary.ar.chat.consent.showJson,
      }),
    );

    const shown = screen.getByText(/"cumulative_gpa"/);
    expect(shown.textContent).toBe(JSON.stringify(REQUEST.data, null, 2));

    fireEvent.click(
      screen.getByRole("button", { name: dictionary.ar.chat.consent.hideJson }),
    );

    expect(screen.queryByText(/"cumulative_gpa"/)).toBeNull();
  });

  it("sends only when the student approves, and cancels only when they cancel", () => {
    const { onApprove, onCancel } = renderCard();

    expect(onApprove).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: dictionary.ar.chat.consent.approve }),
    );
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cannot be approved twice: the buttons are disabled while it is busy", () => {
    renderCard({ busy: true });

    const approve = screen.getByRole("button", {
      name: dictionary.ar.chat.consent.approve,
    }) as HTMLButtonElement;
    const cancel = screen.getByRole("button", {
      name: dictionary.ar.chat.consent.cancel,
    }) as HTMLButtonElement;

    expect(approve.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  it("never puts the values in the page as anything but text", () => {
    renderCard();

    fireEvent.click(
      screen.getByRole("button", {
        name: dictionary.ar.chat.consent.showJson,
      }),
    );

    const shown = screen.getByText(/"cumulative_gpa"/);
    expect(shown.tagName).toBe("PRE");
    expect(shown.querySelector("*")).toBeNull();
  });
});
