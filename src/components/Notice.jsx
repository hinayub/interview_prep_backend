const TONES = {
  problem: 'border-tally/35 bg-tally/12 text-tally',
  done: 'border-jade/35 bg-jade/12 text-jade',
  // For things that are neither a failure nor a success — "your session ended"
  // is information, and colouring it like an error implies they did something wrong.
  note: 'border-sodium/35 bg-sodium/12 text-lit-soft',
}

/**
 * Errors state what happened and what to do about it — they do not apologise and
 * they are never vague. The message itself comes from lib/errors.js.
 */
export default function Notice({ tone = 'problem', children }) {
  if (!children) return null

  return (
    <p role={tone === 'problem' ? 'alert' : 'status'} className={`rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed ${TONES[tone]}`}>
      {children}
    </p>
  )
}
