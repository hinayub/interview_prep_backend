import { useEffect, useRef, useState } from 'react'

/**
 * Reveals an element once, the first time it scrolls into view.
 *
 * Returns [ref, state] where state is the value for a `data-reveal` attribute —
 * index.css handles the actual transition, including the reduced-motion and
 * no-JS fallbacks. Reveal is one-way on purpose: content that fades back out
 * when you scroll up reads as broken rather than animated.
 */
export default function useReveal({ threshold = 0.15, rootMargin = '0px 0px -10% 0px' } = {}) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    // Browsers without IntersectionObserver get the content immediately rather
    // than a permanently invisible page.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { threshold, rootMargin },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [threshold, rootMargin])

  return [ref, shown ? 'shown' : 'hidden']
}
