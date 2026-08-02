/**
 * A step indicator that reads real pipeline state rather than decorating it —
 * "ready" means the backend actually holds that row, "live" means an agent is
 * working on it, "dark" means the prerequisite above it is not met yet.
 */
const STATES = {
  dark: 'border-line-strong bg-surface',
  live: 'border-azure bg-azure',
  ready: 'border-mint bg-mint',
}

export default function CueLamp({ state = 'dark', pulse = false }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'relative block size-2.5 shrink-0 rounded-full border transition-colors duration-300',
        STATES[state] ?? STATES.dark,
      ].join(' ')}
    >
      {pulse && state === 'live' && (
        <span className="absolute inset-0 animate-ping rounded-full bg-azure opacity-60" />
      )}
    </span>
  )
}
