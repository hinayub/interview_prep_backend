/**
 * The icon set, inline so there is no request and no runtime dependency.
 *
 * All of them are drawn on a 24-unit grid with a 1.6 stroke, which keeps the
 * weight close to the display face at the sizes we use them.
 */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
}

/**
 * The Cortex mark: a cortex read as a circuit — a rounded lobe with three taps
 * leaving it. It is the only place in the identity where the two ideas the
 * product joins (a person's thinking, a machine's scoring) share one shape.
 */
export function CortexMark({ className = 'size-7' }) {
  return (
    <svg {...base} className={className} strokeWidth={1.5}>
      <path d="M14.5 3.5A5.5 5.5 0 0 0 9 9v6a5.5 5.5 0 0 0 5.5 5.5" />
      <path d="M9 6.5A3.5 3.5 0 1 0 5.6 11" />
      <path d="M9 17.5A3.5 3.5 0 1 1 5.6 13" />
      <path d="M14.5 7.5h3M14.5 12h4.5M14.5 16.5h3" />
      <circle cx="19" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="20.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="16.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function DocumentIcon({ className = 'size-5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  )
}

export function TargetIcon({ className = 'size-5' }) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ChartIcon({ className = 'size-5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M4 19h16" />
      <path d="M5 15l4.5-5 3.5 3L19 6" />
      <path d="M19 6h-3.5M19 6v3.5" />
    </svg>
  )
}

export function SparkIcon({ className = 'size-3.5' }) {
  return (
    <svg {...base} className={className} strokeWidth={1.4}>
      <path d="M12 3.5 13.4 9 19 10.5 13.4 12 12 17.5 10.6 12 5 10.5 10.6 9z" />
      <path d="M18.5 16.5l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6z" />
    </svg>
  )
}

export function ArrowIcon({ className = 'size-4' }) {
  return (
    <svg {...base} className={className} strokeWidth={1.8}>
      <path d="M5 12h13" />
      <path d="M12.5 6.5 19 12l-6.5 5.5" />
    </svg>
  )
}

export function CheckIcon({ className = 'size-3.5' }) {
  return (
    <svg {...base} className={className} strokeWidth={2.2}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

/** A question being asked. Used to mark the question the candidate is on. */
export function AskIcon({ className = 'size-5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1v.3" />
      <circle cx="12" cy="14.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Time spent on an answer. */
export function ClockIcon({ className = 'size-3.5' }) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  )
}

/** A worked example — the model answer the evaluator writes. */
export function LightbulbIcon({ className = 'size-3.5' }) {
  return (
    <svg {...base} className={className}>
      <path d="M9.5 17.5h5M10 20.5h4" />
      <path d="M12 3.5a5.5 5.5 0 0 0-3.2 9.9c.5.4.7.9.7 1.5v.6h5v-.6c0-.6.2-1.1.7-1.5A5.5 5.5 0 0 0 12 3.5z" />
    </svg>
  )
}
