import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'

import Reveal from '../components/Reveal'
import SiteHeader from '../components/SiteHeader'
import { ArrowIcon, ChartIcon, CheckIcon, CortexMark, DocumentIcon, SparkIcon, TargetIcon } from '../components/icons'
import { selectIsAuthenticated } from '../store/authSlice'

/**
 * The three steps are a real sequence — a match analysis has to exist before a
 * session can be generated from it, and feedback only exists after a session is
 * answered. That is why they are numbered, and why the filament connecting them
 * runs one way.
 */
const STEPS = [
  {
    n: 1,
    title: 'Match your resume',
    icon: DocumentIcon,
    body: 'Match your resume to the job description. Get a match score, missing skills, and concrete next steps.',
  },
  {
    n: 2,
    title: 'Take a mock interview',
    icon: TargetIcon,
    body: 'Answer 8 personalized questions covering technical, behavioral, and role-specific ground.',
  },
  {
    n: 3,
    title: 'See scored feedback',
    icon: ChartIcon,
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
      {/* The wash: a cool blue room that fades to paper by the time you reach the
          steps. It starts at the very top of the document, behind the header, so
          there is no seam where the colour begins. Two slow-drifting lobes keep
          it from reading as a static gradient without ever moving fast enough to
          notice directly. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[36rem] overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#cfe3fa] via-[#e6f0fc] to-transparent" />
        <div className="animate-drift absolute -top-64 left-[4%] size-[38rem] rounded-full bg-azure-lift/18 blur-3xl" />
        <div className="animate-drift-slow absolute -top-40 right-0 size-[30rem] rounded-full bg-[#8ed0f2]/20 blur-3xl" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(31,99,214,0.16) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(85% 100% at 50% -10%, #000 0%, transparent 68%)',
            WebkitMaskImage: 'radial-gradient(85% 100% at 50% -10%, #000 0%, transparent 68%)',
          }}
        />
      </div>

      <SiteHeader />

      <main className="relative z-10 flex-1">
        {/* ---------------------------------------------------------------- hero */}
        <section className="px-5 pt-10 pb-16 sm:px-8 sm:pt-14 lg:pb-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-3xl text-center sm:max-w-2xl lg:max-w-3xl">
              <p className="animate-rise inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3.5 py-1.5 text-xs font-medium text-ink-soft shadow-card backdrop-blur-sm">
                <SparkIcon className="animate-breathe size-3.5 text-azure" />
                Personalized AI mock interviews
              </p>

              <h1 className="mt-6 font-display font-extrabold tracking-[-0.045em] text-[clamp(2.375rem,6vw,4.25rem)] leading-[1.02]">
                <span className="animate-rise block [animation-delay:120ms]">
                  Practice the interview
                </span>
                <span className="animate-rise block text-azure [animation-delay:240ms]">
                  before it happens.
                </span>
              </h1>

              <p className="animate-rise mx-auto mt-6 max-w-[38rem] text-[1.0625rem] leading-relaxed text-slate [animation-delay:360ms]">
                Upload your resume and a job description. Cortex scores your match, runs a
                mock interview tailored to the role, and tells you exactly where to improve.
              </p>

              <div className="animate-rise mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row [animation-delay:480ms]">
                <Link to={primaryTo} className="btn-ink group w-full sm:w-auto">
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
                  className="panel group relative z-10 p-6 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-azure-veil hover:shadow-lift"
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-veil text-azure transition-colors duration-300 group-hover:bg-azure group-hover:text-white">
                    <step.icon className="size-5" />
                  </span>

                  <h3 className="mt-5 font-display text-[0.9375rem] font-bold tracking-[-0.01em]">
                    <span className="text-azure">{step.n}.</span> {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate">{step.body}</p>
                </li>
              ))}
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------- the scorecard */}
        <section className="border-t border-line bg-surface px-5 py-20 sm:px-8 lg:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16">
            <Reveal>
              <p className="eyebrow">What comes back</p>
              <h2 className="mt-4 font-display text-3xl font-extrabold tracking-[-0.035em] sm:text-[2.75rem] sm:leading-[1.05]">
                A scorecard, not a<br className="hidden sm:block" /> gut feeling.
              </h2>
              <p className="mt-5 max-w-md leading-relaxed text-slate">
                Every rehearsal is graded the way an interview panel would grade it: per
                answer, per skill area, against the role you actually applied for.
              </p>

              <ul className="mt-8 space-y-3.5">
                {[
                  'A match score with the skills the posting wants and your resume does not mention.',
                  'Eight questions written from your resume and the posting, not from a template.',
                  'Every session kept, so you can watch a weak area turn into a strong one.',
                ].map((line) => (
                  <li key={line} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-mint/12 text-mint">
                      <CheckIcon className="size-3" />
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
            </Reveal>

            {/* A rendering of the real artifact: the scorecard the app produces. */}
            <Reveal delay={120} className="panel overflow-hidden">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-veil/60 px-5 py-4">
                <div>
                  <p className="font-display text-sm font-bold tracking-[-0.01em]">
                    Senior Backend Engineer
                  </p>
                  <p className="mt-0.5 font-mono text-eyebrow text-mist">Acme · 8 questions</p>
                </div>
                <p className="flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-extrabold tracking-[-0.04em] text-azure">
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
                          <span className="text-ink-soft">{area.label}</span>
                          <span className="font-mono text-eyebrow text-slate">{area.score}</span>
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

                <div className="rounded-lg border border-line bg-canvas p-4">
                  <p className="font-mono text-eyebrow text-mist">Question 3 · System design</p>
                  <p className="mt-2 font-display text-sm font-semibold leading-snug">
                    “Walk me through a cache invalidation bug you have had to fix.”
                  </p>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate">
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
          <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl bg-ink px-6 py-14 text-center sm:px-12">
            <div
              aria-hidden="true"
              className="animate-drift pointer-events-none absolute -top-32 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-azure/35 blur-3xl"
            />
            <div className="relative">
              <CortexMark className="mx-auto size-8 text-azure-lift" />
              <h2 className="mx-auto mt-6 max-w-xl font-display text-3xl font-extrabold tracking-[-0.035em] text-white sm:text-4xl">
                Your next interview is the practice run either way.
              </h2>
              <p className="mx-auto mt-4 max-w-md leading-relaxed text-[#a9bfe0]">
                Make it the one that does not count. Upload a resume and run your first
                rehearsal in a couple of minutes.
              </p>
              <Link
                to={primaryTo}
                className="group mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 font-medium text-ink transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-16px_rgba(88,150,244,0.5)]"
              >
                {isAuthenticated ? 'Open Cortex' : 'Start free'}
                <ArrowIcon className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <p className="flex items-center gap-2 font-display text-sm font-bold tracking-[-0.01em]">
            <CortexMark className="size-5 text-azure" />
            Cortex
          </p>
          <p className="font-mono text-eyebrow text-mist">
            Practice the interview before it happens.
          </p>
        </div>
      </footer>
    </div>
  )
}
