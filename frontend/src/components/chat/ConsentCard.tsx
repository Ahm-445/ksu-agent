"use client";

import { useId, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { BrandMark, EyeIcon } from "@/components/icons";
import type { ConsentRequest } from "@/lib/consent";

type ConsentCardProps = {
  request: ConsentRequest;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
};

/**
 * The consent step for one reasoning question: what would be sent, in plain words, the exact
 * JSON behind a toggle, and one decision. The values live in the request this renders and
 * nowhere else; approving or cancelling removes the card (ADR 0001, rule 5).
 */
export function ConsentCard({
  request,
  busy,
  onApprove,
  onCancel,
}: ConsentCardProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const jsonId = useId();

  return (
    <div className="flex items-start gap-2.5">
      <BrandMark className="mt-0.5 h-7 w-7 shrink-0" />

      <section
        role="group"
        aria-labelledby={titleId}
        aria-busy={busy}
        className="min-w-0 max-w-[92%] flex-1 rounded-2xl rounded-es-md bg-white px-4 py-3 ring-1 ring-teal/45"
      >
        <p id={titleId} className="text-sm font-semibold text-navy" dir="auto">
          {t.chat.consent.title}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted" dir="auto">
          {t.chat.consent.intro}
        </p>

        <ul className="mt-3 space-y-2">
          {request.tools.map((tool) => (
            <li
              key={tool.tool}
              className="rounded-xl bg-surface px-3 py-2 ring-1 ring-slate-200"
            >
              <p className="text-xs font-semibold text-ink" dir="auto">
                {tool.description}
              </p>
              <p
                className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted"
                dir="ltr"
              >
                {t.chat.consent.fields.replace("{fields}", tool.fields.join(", "))}
              </p>
              <p className="text-[11px] text-muted">
                {t.chat.consent.items.replace("{count}", String(tool.items))}
              </p>
            </li>
          ))}
        </ul>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={jsonId}
          onClick={() => setOpen((current) => !current)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-navy transition-colors hover:bg-surface"
        >
          <EyeIcon className="h-3.5 w-3.5" />
          {open ? t.chat.consent.hideJson : t.chat.consent.showJson}
        </button>

        {open ? (
          <pre
            id={jsonId}
            dir="ltr"
            className="mt-2 max-h-56 overflow-auto rounded-xl bg-navy/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-ink"
          >
            {JSON.stringify(request.data, null, 2)}
          </pre>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="rounded-xl bg-teal-deep px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-dark disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {t.chat.consent.approve}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-navy transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:text-muted"
          >
            {t.chat.consent.cancel}
          </button>
        </div>
      </section>
    </div>
  );
}
