import { useEffect, useState } from 'react'

/**
 * What the resume evidences, and what it does not.
 *
 * The reading a candidate actually needs from this section is the ratio. The
 * posting asks for a fixed set of things, and the one number that says where they
 * stand is how much of that set their resume covers — so the section opens with
 * it, and the two lists underneath say which are which.
 *
 * Named for what the candidate does about each list rather than for the field it
 * came from: "what you have" is the material for their answers, "what to close"
 * is the work. Both get equal weight — hiding the second list below a fold would
 * be hiding the only part they can act on.
 *
 * Gaps are drawn as dashed outlines, not in red. A missing skill is work to do,
 * where red would read as a mistake already made.
 */

/**
 * The coverage rail: one segment per skill the posting asks for, lit where the
 * resume evidences it.
 *
 * Segments rather than a percentage bar, because these are discrete, countable,
 * nameable things and every segment is one of the chips below it. "8 of 15" is
 * something a candidate can act on; "53%" is not.
 */
function Coverage({ matched, missing }) {
  const total = matched + missing

  // The rail counts itself out on mount rather than on scroll — this is the first
  // thing in the section and a reveal that never fires would leave it dark. Under
  // prefers-reduced-motion index.css collapses the transition, so every covered
  // segment simply starts lit.
  const [struck, setStruck] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setStruck(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!total) return null

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="eyebrow">What the posting asks for</h4>
        <p className="font-mono text-eyebrow text-dusk">
          <span className="text-jade">{matched}</span> of {total} evidenced
        </p>
      </div>

      <div className="mt-2.5 flex gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            // Capped so a posting asking for thirty things does not leave the last
            // segment waiting a second and a half to light.
            style={{ transitionDelay: `${Math.min(index, 16) * 45}ms` }}
            className={[
              'h-1.5 flex-1 rounded-full transition-colors duration-500',
              struck && index < matched
                ? 'bg-jade shadow-[0_0_6px_-1px_rgba(65,201,155,0.55)]'
                : 'bg-seam',
            ].join(' ')}
          />
        ))}
      </div>
    </div>
  )
}

function Chip({ tone, index, children }) {
  const styles =
    tone === 'have'
      ? 'border-jade/35 bg-jade/12 text-jade'
      : 'border-dashed border-seam-lit bg-house text-lit-soft'

  return (
    <li
      // animate-rise, not [data-stagger]: the stagger utility only becomes visible
      // under an ancestor's scroll reveal, and these chips must never depend on
      // one firing. The delay is capped so the last chip is not left waiting.
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className={`animate-rise inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition-transform duration-200 hover:-translate-y-0.5 ${styles}`}
    >
      {children}
    </li>
  )
}

/**
 * The count leads the heading, at display size. It is the thing worth seeing from
 * across the room, and in mono at eyebrow size it was the easiest thing on the
 * card to miss.
 */
function Column({ heading, tone, skills, empty, footnote }) {
  return (
    <div>
      <h4 className="flex items-baseline gap-2.5">
        <span
          className={[
            'font-display text-2xl font-extrabold tracking-[-0.03em] tabular-nums',
            tone === 'have' ? 'text-jade' : 'text-lit',
          ].join(' ')}
        >
          {skills.length}
        </span>
        <span className="eyebrow">{heading}</span>
      </h4>

      {skills.length ? (
        <ul className="mt-3.5 flex flex-wrap gap-2">
          {skills.map((skill, index) => (
            <Chip key={skill} tone={tone} index={index}>
              {skill}
            </Chip>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-shade">{empty}</p>
      )}

      {footnote && skills.length > 0 && (
        <p className="mt-3.5 text-sm leading-relaxed text-dusk">{footnote}</p>
      )}
    </div>
  )
}

export default function SkillTally({ matched = [], missing = [] }) {
  return (
    <div>
      <Coverage matched={matched.length} missing={missing.length} />

      {/* A hairline between the two columns, so they read as two halves of one
          set rather than as two unrelated lists that happen to sit side by side. */}
      <div className="mt-7 grid gap-7 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-seam">
        <div className="sm:pr-8">
          <Column
            heading="What you have"
            tone="have"
            skills={matched}
            empty="Nothing in your resume lines up with what this posting asks for."
            footnote="Lead with these. They are the evidence the interview will ask you to expand on."
          />
        </div>

        <div className="sm:pl-8">
          <Column
            heading="What to close"
            tone="gap"
            skills={missing}
            empty="Everything the posting asks for is accounted for in your resume."
            footnote="Add evidence of these to your resume, or be ready to say how you would pick them up."
          />
        </div>
      </div>
    </div>
  )
}
