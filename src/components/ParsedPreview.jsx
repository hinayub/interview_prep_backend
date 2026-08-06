import { useState } from 'react'

/**
 * Shows the candidate exactly the text that was extracted from their file.
 *
 * This is deliberate: the single most common failure in this product is a CV that
 * parses badly (odd column layouts, scanned pages), and the symptom is a nonsense
 * match score two screens later. Showing the extracted text at upload time makes
 * a bad parse obvious while it is still cheap to fix.
 */
export default function ParsedPreview({ text, filename }) {
  const [expanded, setExpanded] = useState(false)

  if (!text) return null

  const words = text.trim().split(/\s+/).length

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-seam bg-flat/60 px-4 py-3">
        <h3 className="eyebrow text-jade">What we read</h3>
        <p className="font-mono text-eyebrow text-shade">
          {filename} · {words.toLocaleString()} words · {text.length.toLocaleString()} chars
        </p>
      </header>

      <pre
        className={[
          'overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-dusk',
          expanded ? '' : 'max-h-44 overflow-y-hidden',
        ].join(' ')}
      >
        {text}
      </pre>

      <footer className="border-t border-seam px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="font-mono text-eyebrow tracking-[0.14em] text-dusk uppercase transition-colors hover:text-sodium"
        >
          {expanded ? 'Collapse' : 'Show all text'}
        </button>
      </footer>
    </section>
  )
}
