import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import MatchScore, { bandFor, verdictLine } from './MatchScore'

describe('MatchScore', () => {
  it('uses the same bands the agent is told to score against', () => {
    // agents/resume_analyzer.py: 0-39 weak, 40-69 partial, 70-100 strong. A band
    // that disagreed with the prompt would label the model's own answer wrongly.
    expect(bandFor(0).label).toBe('Weak fit')
    expect(bandFor(39).label).toBe('Weak fit')
    expect(bandFor(40).label).toBe('Partial fit')
    expect(bandFor(69).label).toBe('Partial fit')
    expect(bandFor(70).label).toBe('Strong fit')
    expect(bandFor(100).label).toBe('Strong fit')
  })

  it('exposes the score to assistive tech as a measurement, not just big type', () => {
    render(<MatchScore score={61} />)

    const meter = screen.getByRole('meter', { name: 'Match score' })
    expect(meter).toHaveAttribute('aria-valuenow', '61')
    expect(meter).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByText('61')).toBeInTheDocument()
    expect(screen.getByText('Partial fit')).toBeInTheDocument()
  })

  it('says how far short of a strong match a partial score is', () => {
    // The number alone does not answer "should I send this?" — the distance does.
    expect(verdictLine(68)).toMatch('2 points short of a strong match')
    expect(verdictLine(69)).toMatch('1 point short')
    // Weak and strong get direction instead of a countdown; there is nothing
    // useful about telling a 12 that it is 28 points from partial.
    expect(verdictLine(84)).toMatch('Worth sending')
    expect(verdictLine(12)).toMatch('does not yet evidence')
  })

  it('marks the score on the scale on mount, not on scroll', async () => {
    // Regression: the card used to draw only under [data-reveal="shown"], so on a
    // short viewport the whole report stayed invisible until you scrolled.
    render(<MatchScore score={34} />)

    const marker = screen.getByText('34').closest('.score-marker')
    await waitFor(() => expect(marker.style.getPropertyValue('--at')).toBe('34%'))
  })
})
