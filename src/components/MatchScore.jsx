import { useEffect, useState } from 'react'

/**
 * The score, placed on the scale it was judged against.
 *
 * A big number and a progress bar would tell a candidate what they scored but not
 * what it means, and "68" means nothing without knowing that 70 is where a strong
 * match starts. So the score rides a ruler divided into the exact bands the agent
 * is told to score against in agents/resume_analyzer.py — 0-39 weak, 40-69
 * partial, 70-100 strong — with those boundaries drawn and labelled. The reading
 * a candidate actually needs ("two points short of strong") is then visible
 * rather than inferred.
 *
 * Only the band the score lands in is tinted. Three lit zones would be a
 * decoration; one is a position.
 */
const BANDS = [
  {
    key: 'weak',
    min: 0,
    max: 40,
    label: 'Weak fit',
    chip: 'border-flag/25 bg-flag/8 text-flag',
    zone: 'bg-flag/25',
    note: 'Your resume does not yet evidence what this role asks for. Start with the gaps below.',
  },
  {
    key: 'partial',
    min: 40,
    max: 70,
    label: 'Partial fit',
    chip: 'border-azure/25 bg-azure/8 text-azure',
    zone: 'bg-azure/30',
    note: 'Close the gaps below before you send it.',
  },
  {
    key: 'strong',
    min: 70,
    max: 100,
    label: 'Strong fit',
    chip: 'border-mint/25 bg-mint/8 text-mint',
    zone: 'bg-mint/30',
    note: 'Worth sending as your resume stands.',
  },
]

const STRONG_FROM = 70

export function bandFor(score) {
  return BANDS.find((band) => score < band.max) ?? BANDS.at(-1)
}

/** The one sentence a candidate can act on, with the distance made explicit. */
export function verdictLine(score) {
  const band = bandFor(score)
  if (band.key !== 'partial') return band.note

  const gap = STRONG_FROM - score
  return `${gap} ${gap === 1 ? 'point' : 'points'} short of a strong match. ${band.note}`
}

export default function MatchScore({ score, children }) {
  const band = bandFor(score)

  // The marker travels to its reading on mount rather than on scroll: this card is
  // why the page exists, and a reveal that never fires would leave it blank.
  // Under prefers-reduced-motion index.css collapses the transition, so it simply
  // starts where it belongs.
  const [placed, setPlaced] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPlaced(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <span
            className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-eyebrow tracking-[0.14em] uppercase ${band.chip}`}
          >
            {band.label}
          </span>
          <p className="text-sm leading-snug text-slate">{verdictLine(score)}</p>
        </div>

        {/* Score movement, when there is a previous run to compare against — it
            belongs with the score, not up in the metadata. */}
        {children}
      </div>

      <div
        className="mt-6"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${score} out of 100 — ${band.label}`}
        aria-label="Match score"
      >
        {/* The zones, in reading order, sized to the width of the band they name. */}
        <div className="flex gap-px" aria-hidden="true">
          {BANDS.map((zone) => (
            <p
              key={zone.key}
              style={{ width: `${zone.max - zone.min}%` }}
              className={[
                'pb-1.5 font-mono text-eyebrow tracking-[0.14em] uppercase',
                zone.key === band.key ? 'text-ink-soft' : 'text-mist',
              ].join(' ')}
            >
              {zone.key}
            </p>
          ))}
        </div>

        {/* The pill is 2.5rem tall and rides the centre of the rail, so the rail
            gets that much clearance either side or the marker sits on top of the
            labels. */}
        <div className="relative py-5">
          <div className="flex h-2 gap-px overflow-hidden rounded-full" aria-hidden="true">
            {BANDS.map((zone) => (
              <span
                key={zone.key}
                style={{ width: `${zone.max - zone.min}%` }}
                className={zone.key === band.key ? zone.zone : 'bg-veil'}
              />
            ))}
          </div>

          {/* The score is the marker — see .score-marker in index.css. Azure, not
              navy: in this palette azure is the colour of measurement and navy is
              reserved for the one primary action on a screen. */}
          <div className="score-marker" style={{ '--at': placed ? `${score}%` : '0%' }}>
            <span className="flex h-10 items-center rounded-full bg-gradient-to-r from-azure to-azure-lift px-3.5 font-display text-xl font-extrabold tracking-[-0.03em] text-white shadow-lift tabular-nums">
              {score}
            </span>
          </div>
        </div>

        <div className="flex gap-px" aria-hidden="true">
          {BANDS.map((zone) => (
            <p
              key={zone.key}
              style={{ width: `${zone.max - zone.min}%` }}
              className="font-mono text-eyebrow text-mist"
            >
              {zone.min}
            </p>
          ))}
          <p className="font-mono text-eyebrow text-mist">100</p>
        </div>
      </div>
    </div>
  )
}
