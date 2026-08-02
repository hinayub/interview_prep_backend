import CueLamp from './CueLamp'

/**
 * What the system has, and what it still needs, in pipeline order.
 *
 * Each cue corresponds to one row in the database (Resume, JobDescription,
 * MatchAnalysis, InterviewSession), so this is a readout of real state, not a
 * progress bar. All four can be lit by real rows now; see lib/cues.js for what each
 * state is claiming.
 */
export default function CallSheet({ cues }) {
  return (
    <nav aria-label="Preparation progress" className="panel p-5">
      <h2 className="eyebrow mb-5">Your progress</h2>

      <ol className="space-y-0">
        {cues.map((cue, index) => (
          <li key={cue.id} className="relative flex gap-3 pb-5 last:pb-0">
            {index < cues.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute top-4 left-[4.5px] h-full w-px bg-line"
              />
            )}

            <span className="relative z-10 mt-1.5 bg-surface">
              <CueLamp state={cue.state} pulse={cue.state === 'live'} />
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={[
                  'font-display text-sm font-semibold leading-tight tracking-[-0.01em]',
                  cue.state === 'dark' ? 'text-mist' : 'text-ink',
                ].join(' ')}
              >
                {cue.label}
              </p>
              {cue.detail && (
                <p className="mt-1 font-mono text-eyebrow break-words text-slate">{cue.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </nav>
  )
}
