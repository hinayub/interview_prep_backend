import { useState } from 'react'

import { whenLabel } from '../lib/history'

/**
 * A job description that has already been saved, read-only.
 *
 * Deliberately not the form with its fields filled in. A JobDescription row is
 * immutable and saving is an INSERT, so an editable copy of a saved posting offers
 * one of two lies: that you are editing that record, or that saving is free. What a
 * candidate wants from a record is to read what they applied against — so it is
 * shown the same way the parsed resume is, as text they can check.
 */
export default function SavedRole({ role }) {
  const [expanded, setExpanded] = useState(false)

  if (!role) {
    return (
      <p className="panel p-5 text-sm leading-relaxed text-dusk">
        The posting behind this record is no longer on file, so there is nothing to read
        back. The runs below still hold their results.
      </p>
    )
  }

  const saved = whenLabel(role.created_at)

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b border-seam bg-flat/60 px-4 py-3">
        <h3 className="min-w-0 truncate font-display text-[0.9375rem] font-bold tracking-[-0.015em]">
          {role.title}
        </h3>
        <p className="font-mono text-eyebrow text-shade">
          {[role.company || 'No company given', saved && `saved ${saved}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <pre
        className={[
          'overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-dusk',
          expanded ? '' : 'max-h-44 overflow-y-hidden',
        ].join(' ')}
      >
        {role.raw_text}
      </pre>

      <footer className="border-t border-seam px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="font-mono text-eyebrow tracking-[0.14em] text-dusk uppercase transition-colors hover:text-sodium"
        >
          {expanded ? 'Collapse' : 'Show the whole posting'}
        </button>
      </footer>
    </section>
  )
}
