import useReveal from '../lib/useReveal'

/**
 * Wraps a block so it settles into place the first time it scrolls into view.
 *
 * `delay` staggers siblings — pass increasing values to a row of cards so they
 * arrive in reading order instead of all at once.
 */
export default function Reveal({
  as: Tag = 'div',
  delay = 0,
  threshold,
  className = '',
  style,
  children,
  ...props
}) {
  const [ref, state] = useReveal(threshold === undefined ? undefined : { threshold })

  return (
    <Tag
      ref={ref}
      data-reveal={state}
      className={className}
      style={{ '--reveal-delay': `${delay}ms`, ...style }}
      {...props}
    >
      {children}
    </Tag>
  )
}
