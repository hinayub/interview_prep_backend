export default function Field({ id, label, error, hint, as = 'input', className = '', ...props }) {
  const Element = as
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ')

  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>

      <Element
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        className={[
          'field-input',
          as === 'textarea' ? 'min-h-40 resize-y leading-relaxed' : '',
          error ? 'border-flag focus:border-flag focus:ring-flag/12' : '',
        ].join(' ')}
        {...props}
      />

      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 font-mono text-eyebrow text-mist">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-flag">
          {error}
        </p>
      )}
    </div>
  )
}
