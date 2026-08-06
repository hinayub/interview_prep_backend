import { Link } from 'react-router-dom'

import { CortexMark } from '../components/icons'

/**
 * The auth screens keep the landing page's one bold move — an oversized headline
 * standing in the key light — with the form as a small disciplined block beside
 * it. The app past sign-in is quiet, so the boldness is spent here and nowhere
 * else.
 */
export default function AuthStage({ headline, lede, children }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_minmax(24rem,0.9fr)]">
      <section className="relative flex flex-col justify-center overflow-hidden px-5 py-14 sm:px-8 lg:py-20">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          {/* Aimed at the headline rather than at the top of the panel: the light
              has to be on the words, because they are what is being said. */}
          <div
            className="key-light absolute inset-0"
            style={{ '--throw-x': '26%', '--throw-y': '44%', '--throw-w': '78%', '--throw-h': '82%' }}
          />
          <div className="animate-drift absolute -top-16 -left-24 size-[34rem] rounded-full bg-sodium/12 blur-3xl" />
          <div className="animate-drift-slow absolute -bottom-40 right-0 size-[26rem] rounded-full bg-[#c2569b]/12 blur-3xl" />
          <div className="vignette absolute inset-0" />
        </div>

        <Link
          to="/"
          className="animate-rise relative z-10 flex w-fit items-center gap-2.5 rounded-lg"
          aria-label="Cortex home"
        >
          <CortexMark className="size-6 text-sodium" />
          <span className="font-display text-lg font-extrabold tracking-[-0.02em]">Cortex</span>
        </Link>

        <h1 className="poster relative z-10 mt-10 font-display font-extrabold tracking-[-0.045em] text-lit">
          {headline.map((line, index) => (
            <span
              key={line}
              className="animate-rise block text-[clamp(2.5rem,8vw,5.25rem)] leading-[0.94]"
              style={{ animationDelay: `${100 + index * 110}ms` }}
            >
              {index === headline.length - 1 ? <span className="text-sodium">{line}</span> : line}
            </span>
          ))}
        </h1>

        <p
          className="animate-rise relative z-10 mt-8 max-w-md text-base leading-relaxed text-dusk"
          style={{ animationDelay: `${100 + headline.length * 110}ms` }}
        >
          {lede}
        </p>
      </section>

      <section className="flex items-center border-t border-seam bg-riser px-5 py-14 sm:px-10 lg:border-t-0 lg:border-l">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </div>
  )
}
