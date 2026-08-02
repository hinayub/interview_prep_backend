import { CheckIcon } from './icons'

/**
 * What the resume evidences, and what it does not.
 *
 * Named for what the candidate does about each list rather than for the field it
 * came from: "what you have" is the material for their answers, "what to close"
 * is the work. Both get equal weight — hiding the second list below a fold would
 * be hiding the only part they can act on.
 *
 * Gaps are drawn as dashed outlines, not in red. A missing skill is work to do,
 * where red would read as a mistake already made.
 */
function Chip({ tone, index, children }) {
  const styles =
    tone === 'have'
      ? 'border-mint/25 bg-mint/8 text-[#0a7355]'
      : 'border-dashed border-line-strong bg-canvas text-ink-soft'

  return (
    <li
      // animate-rise, not [data-stagger]: the stagger utility only becomes visible
      // under an ancestor's scroll reveal, and these chips must never depend on
      // one firing. The delay is capped so the last chip is not left waiting.
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className={`animate-rise inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-transform duration-200 hover:-translate-y-0.5 ${styles}`}
    >
      {tone === 'have' && <CheckIcon className="size-3 shrink-0 text-mint" />}
      {children}
    </li>
  )
}

function Column({ heading, tone, skills, empty, footnote }) {
  return (
    <div>
      <h4 className="eyebrow mb-3.5">
        {heading} <span className="text-line-strong">·</span> {skills.length}
      </h4>

      {skills.length ? (
        <ul className="flex flex-wrap gap-2">
          {skills.map((skill, index) => (
            <Chip key={skill} tone={tone} index={index}>
              {skill}
            </Chip>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-mist">{empty}</p>
      )}

      {footnote && skills.length > 0 && (
        <p className="mt-3.5 text-sm leading-relaxed text-slate">{footnote}</p>
      )}
    </div>
  )
}

export default function SkillTally({ matched = [], missing = [] }) {
  return (
    <div className="grid gap-7 sm:grid-cols-2 sm:gap-8">
      <Column
        heading="What you have"
        tone="have"
        skills={matched}
        empty="Nothing in your resume lines up with what this posting asks for."
        footnote="Lead with these. They are the evidence the interview will ask you to expand on."
      />
      <Column
        heading="What to close"
        tone="gap"
        skills={missing}
        empty="Everything the posting asks for is accounted for in your resume."
        footnote="Add evidence of these to your resume, or be ready to say how you would pick them up."
      />
    </div>
  )
}
