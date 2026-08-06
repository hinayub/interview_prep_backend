import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'

import Reveal from '../components/Reveal'
import SiteHeader from '../components/SiteHeader'
import { ArrowIcon, CheckIcon, CortexMark } from '../components/icons'
import { selectIsAuthenticated } from '../store/authSlice'

/**
 * The three steps are a real sequence — a match analysis has to exist before a
 * session can be generated from it, and feedback only exists after a session is
 * answered. That is why they are numbered, and why the light rail connecting
 * them runs one way.
 *
 * The number is the only marker each step gets. It used to carry an icon as well,
 * which said nothing the title did not: two markers for one cue.
 */
const STEPS = [
  {
    n: 1,
    title: 'Match your resume',
    body: 'Match your resume to the job description. Get a match score, missing skills, and concrete next steps.',
  },
  {
    n: 2,
    title: 'Take a mock interview',
    body: 'Answer 8 personalized questions covering technical, behavioral, and role-specific ground.',
  },
  {
    n: 3,
    title: 'See scored feedback',
    body: 'Per-question feedback, skill-area breakdown, strengths, and weaknesses — kept in your history.',
  },
]

const SKILL_AREAS = [
  { label: 'Python / Django', score: 84 },
  { label: 'System design', score: 61 },
  { label: 'Communication', score: 72 },
]

export default function Home() {
  const isAuthenticated = useSelector(selectIsAuthenticated)
  const primaryTo = isAuthenticated ? '/app' : '/create-account'

  return (
    <div className="relative flex min-h-full flex-col">
      {/* The key light. One warm pool thrown from above the fold onto the thing
          the page opens with, and the room falling off around it — the page is
          lit rather than coloured. It starts at the very top of the document,
          behind the header, so there is no seam where the light begins.

          Two slow-drifting lobes sit inside the throw: a lamp is never perfectly
          even, and they keep it from reading as a static gradient without ever
          moving fast enough to notice directly. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[42rem] overflow-hidden"
      >
        <div className="key-light absolute inset-0" />
        <div className="animate-drift absolute -top-64 left-[4%] size-[38rem] rounded-full bg-sodium/12 blur-3xl" />
        <div className="animate-drift-slow absolute -top-40 right-0 size-[30rem] rounded-full bg-[#c2569b]/12 blur-3xl" />
        <div className="vignette absolute inset-0" />
      </div>

      <SiteHeader />

      <main className="relative z-10 flex-1">
        {/* ---------------------------------------------------------------- hero */}
        <section className="px-5 pt-10 pb-16 sm:px-8 sm:pt-14 lg:pb-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-3xl text-center sm:max-w-2xl lg:max-w-3xl">
              {/* The room slate. A studio labels the space rather than advertising
                  it, and the one thing a nervous candidate needs to know before
                  anything else is that this run does not count. */}
              <p className="animate-rise inline-flex items-center gap-2.5 rounded-full border border-seam bg-riser/70 px-3.5 py-1.5 font-mono text-eyebrow uppercase tracking-[0.18em] text-dusk shadow-card backdrop-blur-sm">
                <span
                  aria-hidden="true"
                  className="animate-filament size-1.5 rounded-full bg-sodium"
                />
                Rehearsal room · nothing here counts
              </p>

              <h1 className="poster mt-6 font-display font-extrabold tracking-[-0.045em] text-[clamp(2.5rem,6.4vw,4.5rem)] leading-[0.98]">
                <span className="animate-rise block [animation-delay:120ms]">
                  Practice the interview
                </span>
                <span className="animate-rise block text-sodium [animation-delay:240ms]">
                  before it happens.
                </span>
              </h1>

              <p className="animate-rise mx-auto mt-6 max-w-[38rem] text-[1.0625rem] leading-relaxed text-dusk [animation-delay:360ms]">
                Upload your resume and a job description. Cortex scores your match, runs a
                mock interview tailored to the role, and tells you exactly where to improve.
              </p>

              <div className="animate-rise mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row [animation-delay:480ms]">
                <Link to={primaryTo} className="btn-lamp group w-full sm:w-auto">
                  {isAuthenticated ? 'Open Cortex' : 'Start free'}
                  <ArrowIcon className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
                <a href="#how-it-works" className="btn-plain w-full sm:w-auto">
                  How it works
                </a>
              </div>
            </div>

            {/* --------------------------------------------------- the three steps */}
            <Reveal
              id="how-it-works"
              as="ol"
              className="relative mt-14 grid scroll-mt-24 gap-5 sm:mt-16 md:grid-cols-3 md:gap-7"
            >
              {/* The filament threads the icon tiles at their vertical centre. */}
              <span
                aria-hidden="true"
                className="filament top-[3.375rem] left-6 right-6 hidden md:block"
              />

              {STEPS.map((step, index) => (
                <li
                  key={step.n}
                  data-stagger=""
                  style={{ '--reveal-delay': `${140 + index * 130}ms` }}
                  className="panel group relative z-10 p-6 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-sodium/35 hover:shadow-lift"
                >
                  {/* The cue number, on a plate the light rail runs through. It
                      strikes when you hover the step it belongs to. */}
                  <span className="flex size-11 items-center justify-center rounded-full border border-seam bg-flat font-mono text-[0.9375rem] text-sodium transition-[background-color,color,box-shadow] duration-300 group-hover:bg-sodium group-hover:text-house group-hover:shadow-lamp">
                    {step.n}
                  </span>

                  <h3 className="mt-5 font-display text-base font-bold tracking-[-0.015em]">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-dusk">{step.body}</p>
                </li>
              ))}
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------- the scorecard */}
        <section className="border-t border-seam bg-riser px-5 py-20 sm:px-8 lg:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16">
            <Reveal>
              <p className="eyebrow">What comes back</p>
              <h2 className="mt-4 font-display text-3xl font-extrabold tracking-[-0.035em] sm:text-[2.75rem] sm:leading-[1.05]">
                A scorecard, not a<br className="hidden sm:block" /> gut feeling.
              </h2>
              <p className="mt-5 max-w-md leading-relaxed text-dusk">
                Every rehearsal is graded the way an interview panel would grade it: per
                answer, per skill area, against the role you actually applied for.
              </p>

              <ul className="mt-8 space-y-3.5">
                {[
                  'A match score with the skills the posting wants and your resume does not mention.',
                  'Eight questions written from your resume and the posting, not from a template.',
                  'Every session kept, so you can watch a weak area turn into a strong one.',
                ].map((line) => (
                  <li key={line} className="flex gap-3 text-sm leading-relaxed text-lit-soft">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-jade/12 text-jade">
                      <CheckIcon className="size-3" />
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
            </Reveal>

            {/* A rendering of the real artifact: the scorecard the app produces. */}
            <Reveal delay={120} className="panel overflow-hidden">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-seam bg-flat/60 px-5 py-4">
                <div>
                  <p className="font-display text-sm font-bold tracking-[-0.01em]">
                    Senior Backend Engineer
                  </p>
                  <p className="mt-0.5 font-mono text-eyebrow text-shade">Acme · 8 questions</p>
                </div>
                <p className="flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-extrabold tracking-[-0.04em] text-sodium">
                    78
                  </span>
                  <span className="eyebrow">match</span>
                </p>
              </header>

              <div className="space-y-5 px-5 py-5">
                <div className="meter h-2" style={{ '--meter': '78%' }}>
                  <span className="meter-fill" />
                </div>

                <div>
                  <p className="eyebrow mb-3.5">Skill areas</p>
                  <ul className="space-y-3">
                    {SKILL_AREAS.map((area, index) => (
                      <li key={area.label}>
                        <p className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-lit-soft">{area.label}</span>
                          <span className="font-mono text-eyebrow text-dusk">{area.score}</span>
                        </p>
                        <div
                          className="meter"
                          style={{ '--meter': `${area.score}%`, '--meter-delay': `${200 + index * 140}ms` }}
                        >
                          <span className="meter-fill" />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-seam bg-house p-4">
                  <p className="font-mono text-eyebrow text-shade">Question 3 · System design</p>
                  <p className="mt-2 font-display text-sm font-semibold leading-snug">
                    “Walk me through a cache invalidation bug you have had to fix.”
                  </p>
                  <p className="mt-2.5 text-sm leading-relaxed text-dusk">
                    Good specifics on the symptom. Say what you changed and how you knew it
                    worked — the fix is missing from the answer.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------- closing action */}
        <section className="px-5 py-20 sm:px-8 lg:py-24">
          {/* The empty stage: the darkest panel on the page, with the key light
              struck once more above it. The lamp is the only lit thing in it. */}
          <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl border border-seam bg-house px-6 py-14 text-center sm:px-12">
            <div
              aria-hidden="true"
              className="animate-drift pointer-events-none absolute -top-40 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-sodium/22 blur-3xl"
            />
            <div className="relative">
              <CortexMark className="mx-auto size-8 text-sodium" />
              <h2 className="poster mx-auto mt-6 max-w-xl font-display text-3xl font-extrabold tracking-[-0.035em] sm:text-[2.5rem] sm:leading-[1.06]">
                Your next interview is the practice run either way.
              </h2>
              <p className="mx-auto mt-4 max-w-md leading-relaxed text-dusk">
                Make it the one that does not count. Upload a resume and run your first
                rehearsal in a couple of minutes.
              </p>
              <Link to={primaryTo} className="btn-lamp group mt-8 px-6 py-3">
                {isAuthenticated ? 'Open Cortex' : 'Start free'}
                <ArrowIcon className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-seam px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <p className="flex items-center gap-2 font-display text-sm font-bold tracking-[-0.01em]">
            <CortexMark className="size-5 text-sodium" />
            Cortex
          </p>
          <p className="font-mono text-eyebrow text-shade">
            Practice the interview before it happens.
          </p>
        </div>
      </footer>
    </div>
  )
}
