import type { Dictionary, Lang } from "@/lib/i18n";
import { categoryOfTool, type GpaData, type ToolErrorKind } from "@/lib/extension";

// Factual answers about the student's own data are built here, in the browser, from
// fixed templates (ADR 0001). The values are filled in and never leave the device.

const GPA_TEMPLATES: Record<Lang, string> = {
  ar: "معدلك التراكمي {gpa} من {scale}، والساعات المكتسبة {earned} ساعة (حسب Edugate، {term}).",
  en: "Your cumulative GPA is {gpa} out of {scale}, with {earned} earned hours (from Edugate, {term}).",
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? values[key] : placeholder,
  );
}

/** The GPA answer in the student's language, from the values read on their device. */
export function gpaAnswer(data: GpaData, lang: Lang): string {
  return fill(GPA_TEMPLATES[lang], {
    gpa: data.cumulative_gpa,
    scale: data.scale,
    earned: String(data.earned_hours),
    term: data.as_of_term,
  });
}

export type ToolErrorKey =
  | "extensionMissing"
  | "consentMissing"
  | "notSignedIn"
  | "readFailed";

/** The message key for a failed tool run: what the student can do about it. */
export function toolErrorKey(error: ToolErrorKind): ToolErrorKey {
  switch (error) {
    case "not_installed":
      return "extensionMissing";
    case "no_consent":
      return "consentMissing";
    case "not_logged_in":
      return "notSignedIn";
    default:
      return "readFailed";
  }
}

/**
 * The message for a failed tool run. When the student has not allowed the category
 * the tool needs, the message names that category.
 */
export function toolErrorText(
  t: Dictionary,
  error: ToolErrorKind,
  tool: string,
): string {
  if (error === "no_consent") {
    const category = categoryOfTool(tool);

    return category
      ? t.chat.errors.consentMissingFor.replace(
          "{category}",
          t.chat.categories[category],
        )
      : t.chat.errors.consentMissing;
  }

  return t.chat.errors[toolErrorKey(error)];
}
