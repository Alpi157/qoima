import { describe, expect, it } from 'vitest'

import { qtyError, QTY_ERROR, reasonError, REASON_ERROR } from './validation'

describe('qtyError', () => {
  it('accepts whole numbers from 1 to 100 000', () => {
    expect(qtyError(1)).toBeNull()
    expect(qtyError(100_000)).toBeNull()
  })

  it('rejects zero, fractions, too much and an empty field', () => {
    expect(qtyError(0)).toBe(QTY_ERROR)
    expect(qtyError(1.5)).toBe(QTY_ERROR)
    expect(qtyError(100_001)).toBe(QTY_ERROR)
    expect(qtyError('')).toBe(QTY_ERROR)
  })
})

describe('reasonError', () => {
  it('needs at least 3 characters besides spaces', () => {
    expect(reasonError('Брак')).toBeNull()
    expect(reasonError('  аб  ')).toBe(REASON_ERROR)
    expect(reasonError('')).toBe(REASON_ERROR)
  })
})
