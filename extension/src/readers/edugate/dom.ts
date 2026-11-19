// Helpers shared by the Edugate readers. A reader finds its table and columns by the
// heading text the page shows, never by position or by a generated id, because Edugate
// generates a new id on every page load.

export function textOf(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g;

// Edugate may print the decimal separator as the Arabic comma.
const DECIMAL_SEPARATORS = /[\u066b,]/g;

const INTEGER = /^\d+$/;

const PERCENT = /^(\d+(?:\.\d+)?)\s*%?$/;

const NUMBER = /^\d+(?:\.\d+)?$/;

export function asciiDigits(value: string): string {
  return value.replace(ARABIC_INDIC_DIGITS, (digit) =>
    String(digit.charCodeAt(0) & 0xf),
  );
}

export function asciiNumber(value: string): string {
  return asciiDigits(value).replace(DECIMAL_SEPARATORS, ".");
}

/** A whole number as the page shows it, or null when the text is not one. */
export function wholeNumber(value: string): number | null {
  const text = asciiNumber(value);

  return INTEGER.test(text) ? Number(text) : null;
}

/** A percentage with or without the % sign, or null outside 0–100. */
export function percentValue(value: string): number | null {
  const match = PERCENT.exec(asciiNumber(value));

  if (match === null || match[1] === undefined) {
    return null;
  }

  const percent = Number(match[1]);

  return percent >= 0 && percent <= 100 ? percent : null;
}

/** A decimal number as the page shows it, or null when the text is not one. */
export function decimalNumber(value: string): number | null {
  const text = asciiNumber(value);

  return NUMBER.test(text) ? Number(text) : null;
}

/**
 * The column of each heading, keyed by its whitespace-normalised text. Only the table's own
 * header row counts: a layout table that merely wraps the real one has no headings of its own.
 */
export function columnIndexes(
  table: Element,
  headingClass: string,
): Map<string, number> {
  const indexes = new Map<string, number>();

  table
    .querySelectorAll(`:scope > thead > tr > th.${headingClass}`)
    .forEach((heading, index) => {
      const text = textOf(heading);

      if (text && !indexes.has(text)) {
        indexes.set(text, index);
      }
    });

  return indexes;
  return indexes;
}

/**
 * The first table on the page whose headings include every wanted heading, or null.
 * A page with two tables (the absences page has a short warning table) is matched by
 * the headings only the real table carries.
 */
export function findTable(
  doc: Document,
  headings: readonly string[],
  headingClass: string,
): Element | null {
  for (const table of doc.querySelectorAll("table")) {
    const columns = columnIndexes(table, headingClass);

    if (headings.every((heading) => columns.has(heading))) {
      return table;
    }
  }

  return null;
}

/** The data rows of a table, never the rows of a table nested inside one of them. */
export function dataRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll(":scope > tbody > tr"));
}

export function cellsOf(row: Element): Element[] {
  return Array.from((row as HTMLTableRowElement).cells ?? []);
}

export function cellText(row: Element, index: number | undefined): string {
  return index === undefined ? "" : textOf(cellsOf(row)[index] ?? null);
}

/**
 * The term the page shows in its term selector: the selected option, or the first one
 * when the page marks none. Null when the page has no selector or no option text.
 */
export function shownTerm(doc: Document, selectId: string): string | null {
  const select = doc.getElementById(selectId);

  if (select === null) {
    return null;
  }

  const options = Array.from(select.querySelectorAll("option"));
  const shown =
    options.find((option) => option.hasAttribute("selected")) ?? options[0];
  const term = textOf(shown ?? null);

  return term === "" ? null : term;
}
