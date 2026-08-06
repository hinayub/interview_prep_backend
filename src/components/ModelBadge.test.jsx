import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import ModelCredit, { ModelBadge } from './ModelBadge'

describe('ModelCredit', () => {
  it('names the model that produced the result', () => {
    render(<ModelCredit model="gemini" prefix="Scored by" />)

    expect(screen.getByText('Scored by')).toBeInTheDocument()
    expect(screen.getByText('Gemini')).toBeInTheDocument()
    expect(screen.getByText('hosted')).toBeInTheDocument()
  })

  it('shows the note, which is where a fallback is explained', () => {
    // The whole point of storing it: a 61 from the local model because the hosted
    // one was unreachable is a different number from a 61 the hosted one gave.
    render(
      <ModelCredit
        model="llama"
        note="Gemini (hosted) failed, so Llama 3 (local) answered instead."
        prefix="Scored by"
      />
    )

    expect(screen.getByText('Llama 3')).toBeInTheDocument()
    expect(screen.getByText(/Gemini \(hosted\) failed/)).toBeInTheDocument()
  })

  it('renders nothing for a row that has no attribution', () => {
    // Rows written before racing existed, and any result a test built by hand.
    const { container } = render(<ModelCredit model="" note="" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows an unrecognised backend by name rather than hiding it', () => {
    render(<ModelBadge model="mistral" />)

    expect(screen.getByText('mistral')).toBeInTheDocument()
  })
})
