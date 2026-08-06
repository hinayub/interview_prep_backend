import { useState } from 'react'

import { whenLabel } from '../lib/history'
import { ChevronIcon, PlusIcon } from './icons'

/**
 * Every resume-and-posting pair this candidate has run something against.
 *
 * A record is selected rather than navigated to: the two documents open in the same
 * two sections that hold the live ones, so the page reads the same whether you are
 * filling it in or reading what you filled in last week.
 *
 * The first row is not a record. It is the bench — the pair being worked on now,
 * behind the upload box and the role form — and selecting it is how you get back out
 * of a saved one. Once something has been run against that pair it becomes a record
 * like any other and appears in the list below, so the bench row is replaced by the
 * way to start the next application. That is `bench` being null: the tab's work is
 * finished with, and the only thing left up here is a clean one.
 *
 * On a wide screen this is a column beside the work. Below `lg` the grid stacks it
 * above, where a list of records would push the upload box off the bottom of the
 * screen — so there it collapses to one line and the rest is a disclosure. The
 * records still exist in the markup either way; only their visibility changes.
 */
export default function HistoryRail({ entries, selectedKey, onSelect, onNew, bench }) {
  const [listOpen, setListOpen] = useState(false)

  return (
    <nav aria-label="Your saved applications" className="panel p-3">
      <h2 className="eyebrow mb-3 px-2 pt-1">Your history</h2>

      {bench ? (
        <Record
          selected={selectedKey === null}
          onSelect={() => onSelect(null)}
          flag="Working on now"
          // Deliberately not the progress sidebar's wording for the same absence. Two
          // panels on one screen saying "No CV uploaded yet" reads as a stutter, and it
          // makes either of them impossible to point at unambiguously.
          title={bench.role?.title ?? 'Nothing pasted yet'}
          subtitle={bench.resume?.filename ?? 'Nothing uploaded yet'}
        />
      ) : (
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-seam px-3 py-2.5 text-left transition-colors duration-150 hover:border-sodium/45 hover:bg-sodium-veil"
        >
          <PlusIcon className="size-4 shrink-0 text-sodium" />
          <span className="min-w-0">
            <span className="block font-display text-sm font-semibold tracking-[-0.01em] text-lit">
              New application
            </span>
            <span className="mt-0.5 block truncate font-mono text-eyebrow text-shade">
              A fresh CV and posting
            </span>
          </span>
        </button>
      )}

      {entries.length === 0 ? (
        <p className="mt-3 border-t border-seam px-2 pt-3 pb-1 font-mono text-eyebrow leading-relaxed text-shade">
          Records appear here once you have matched or interviewed against a posting.
        </p>
      ) : (
        <div className="mt-3 border-t border-seam pt-3">
          <button
            type="button"
            onClick={() => setListOpen((open) => !open)}
            aria-expanded={listOpen}
            aria-controls="history-records"
            className="mb-1.5 flex w-full items-center justify-between gap-2 px-2 py-1 lg:hidden"
          >
            <span className="eyebrow">
              {entries.length} saved record{entries.length === 1 ? '' : 's'}
            </span>
            <ChevronIcon
              className={`size-3.5 text-dusk transition-transform duration-200 ${
                listOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          <ul
            id="history-records"
            className={[
              'max-h-[26rem] space-y-1.5 overflow-y-auto lg:max-h-[calc(100vh-14rem)]',
              // Always a column on a wide screen; a disclosure below it.
              listOpen ? '' : 'hidden',
              'lg:block',
            ].join(' ')}
          >
            {entries.map((entry) => (
              <li key={entry.key}>
                <Record
                  selected={selectedKey === entry.key}
                  onSelect={() => onSelect(entry.key)}
                  flag={whenLabel(entry.activeAt)}
                  title={entry.role?.title ?? 'Role no longer on file'}
                  subtitle={[entry.role?.company, entry.resume?.filename]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  {entry.match?.status === 'complete' && (
                    <Chip tone="lit">{entry.match.match_score} / 100</Chip>
                  )}
                  {entry.sessions.length > 0 && (
                    <Chip>
                      {entry.sessions.length} interview{entry.sessions.length === 1 ? '' : 's'}
                    </Chip>
                  )}
                </Record>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  )
}

/**
 * One row. A button rather than a link: nothing about the page's address changes,
 * and aria-current is what tells a screen reader which of them is open.
 */
function Record({ selected, onSelect, flag, title, subtitle, children }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={[
        'block w-full rounded-lg border px-3 py-2.5 text-left transition-colors duration-150',
        selected
          ? 'border-sodium/45 bg-sodium-veil'
          : 'border-transparent hover:border-seam hover:bg-flat/60',
      ].join(' ')}
    >
      {flag && (
        <span className="block font-mono text-eyebrow tracking-[0.14em] uppercase text-shade">
          {flag}
        </span>
      )}

      <span
        className={[
          'mt-1 block truncate font-display text-sm font-semibold tracking-[-0.01em]',
          selected ? 'text-sodium' : 'text-lit',
        ].join(' ')}
      >
        {title}
      </span>

      {subtitle && (
        <span className="mt-0.5 block truncate font-mono text-eyebrow text-dusk">{subtitle}</span>
      )}

      {children && <span className="mt-2 flex flex-wrap gap-1.5">{children}</span>}
    </button>
  )
}

function Chip({ tone, children }) {
  return (
    <span
      className={[
        'inline-flex rounded-full border px-2 py-0.5 font-mono text-eyebrow',
        tone === 'lit' ? 'border-sodium/35 bg-sodium/12 text-sodium' : 'border-seam bg-house text-dusk',
      ].join(' ')}
    >
      {children}
    </span>
  )
}
