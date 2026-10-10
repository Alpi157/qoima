import { describe, expect, it } from 'vitest'

import { parseSaleDraft } from './saleDraft'

describe('sale draft payment compatibility', () => {
  it('reads the existing version without payment as full and preserves the request id', () => {
    const draft = parseSaleDraft({ version: 1, requestId: 'existing', lines: [], customer: 'none' })
    expect(draft?.version).toBe(1)
    expect(draft?.requestId).toBe('existing')
    expect(draft?.payment).toEqual({ mode: 'full', paid: '' })
  })

  it('restores debt text with a customer but resets debt without a customer', () => {
    const raw = {
      version: 1,
      requestId: 'existing',
      lines: [],
      customer: { id: 7, name: 'Ержан' },
      payment: { mode: 'debt', paid: '12,50' },
    }
    expect(parseSaleDraft(raw)?.payment).toEqual(raw.payment)
    expect(parseSaleDraft({ ...raw, customer: 'none' })?.payment.mode).toBe('full')
  })
})
