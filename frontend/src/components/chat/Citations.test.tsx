import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Citations } from "@/components/chat/Citations";
import { dictionary } from "@/lib/i18n";

// The note reads its words from the language provider; the test fixes them to Arabic.
vi.mock("@/components/LanguageProvider", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");

  return {
    useLanguage: () => ({ lang: "ar", setLang: () => {}, t: actual.dictionary.ar }),
  };
});

const t = dictionary.ar;

const CITATION = {
  title: "لائحة الدراسة والاختبارات",
  article: "25",
  url: "https://dar.ksu.edu.sa/regulations.pdf",
};

describe("the note under an answer with no citations", () => {
  it("says the answer rests on the student's data when that is its basis", () => {
    render(<Citations citations={[]} basis="student_data" />);

    expect(screen.getByText(t.chat.notFromRegulation)).toBeTruthy();
    expect(screen.queryByText(t.chat.noSource)).toBeNull();
  });

  it("keeps today's no-source note for an answer that rests on the regulation", () => {
    render(<Citations citations={[]} basis="regulation" />);

    expect(screen.getByText(t.chat.noSource)).toBeTruthy();
    expect(screen.queryByText(t.chat.notFromRegulation)).toBeNull();
  });

  it("lists the articles it has, whatever the basis", () => {
    render(<Citations citations={[CITATION]} basis="student_data" />);

    expect(screen.getByText(CITATION.title)).toBeTruthy();
    expect(screen.queryByText(t.chat.notFromRegulation)).toBeNull();
    expect(screen.queryByText(t.chat.noSource)).toBeNull();
  });

  it("has the note in both languages", () => {
    expect(dictionary.ar.chat.notFromRegulation).toContain("بياناتك");
    expect(dictionary.en.chat.notFromRegulation).toContain("your own data");
  });
});
