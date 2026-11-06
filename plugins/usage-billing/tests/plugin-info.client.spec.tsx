// @vitest-environment jsdom
/**
 * PluginInfoCard component test: renders name, version, author and license
 * metadata. An absent version shows a placeholder rather than fabricating one.
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PluginInfoCard } from '../src/client/PluginInfoCard.tsx'
import { zh, type UsageBillingKey } from '../src/client/locales.ts'

const t = (key: UsageBillingKey): string => (zh as Record<string, string>)[key] ?? key

describe('PluginInfoCard', () => {
  it('renders name, version, author and license', () => {
    render(<PluginInfoCard t={t} version="0.9.4" />)
    expect(screen.getByTestId('billing-plugin-info')).toBeTruthy()
    expect(screen.getByText('dsh-plugin-usage-billing')).toBeTruthy()
    expect(screen.getByText('v0.9.4')).toBeTruthy()
    const author = screen.getByRole('link', { name: 'halp (halp1)' })
    expect(author.getAttribute('href')).toBe('https://github.com/halp1')
    expect(screen.getByText('MIT')).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('shows an em dash version when the server did not supply one (older snapshot)', () => {
    render(<PluginInfoCard t={t} version={undefined} />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})
