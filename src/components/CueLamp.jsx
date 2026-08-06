/**
 * A step indicator that reads real pipeline state rather than decorating it —
 * "ready" means the backend actually holds that row, "live" means an agent is
 * working on it, "dark" means the prerequisite above it is not met yet.
 *
 * Drawn as a lamp rather than a dot, because that is what the three states
 * already are: cold glass, lit, and struck. What separates them is the light each
 * one throws, so an unlit lamp is recessed into the surface rather than sitting
 * on it, and a lit one glows onto what is around it.
 */
const STATES = {
  dark: 'border-seam-lit bg-house',
  live: 'border-sodium bg-sodium',
  ready: 'border-jade bg-jade shadow-[0_0_10px_1px_rgba(65,201,155,0.45)]',
}

export default function CueLamp({ state = 'dark', pulse = false }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'block size-2.5 shrink-0 rounded-full border transition-colors duration-300',
        STATES[state] ?? STATES.dark,
        // A tungsten lamp does not blink, it settles: while an agent is working the
        // glow swells and falls. One that is merely on holds steady.
        state === 'live' ? (pulse ? 'animate-filament' : 'shadow-lamp') : '',
      ].join(' ')}
    />
  )
}
