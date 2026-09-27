import { describe, expect, it } from 'vitest'

import { formatMoney, parseMoney } from './money'

const NBSP = '\u00a0'

describe('formatMoney', () => {
  it.each([
    [0, `0${NBSP}₸`],
    [100, `1${NBSP}₸`],
    [99900, `999${NBSP}₸`],
    [1250000, `12${NBSP}500${NBSP}₸`],
    [1250050, `12${NBSP}500,50${NBSP}₸`],
    [1250005, `12${NBSP}500,05${NBSP}₸`],
    [123456789, `1${NBSP}234${NBSP}567,89${NBSP}₸`],
    [-1250000, `-12${NBSP}500${NBSP}₸`],
  ])('%i tiyn -> %j', (tiyn, expected) => {
    expect(formatMoney(tiyn)).toBe(expected)
  })

  it('uses only non-breaking spaces', () => {
    expect(formatMoney(1250050)).not.toContain(' ')
  })
})

describe('parseMoney', () => {
  it.each([
    ['12500', 1250000],
    ['12 500', 1250000],
    [`12${NBSP}500`, 1250000],
    ['12\u202f500', 1250000],
    ['12500,5', 1250050],
    ['12500.50', 1250050],
    ['12500,05', 1250005],
    ['  12500  ', 1250000],
    ['0', 0],
    ['0,01', 1],
  ])('%j -> %i', (input, expected) => {
    expect(parseMoney(input)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    '-5',
    '-12500,50',
    '12a',
    'abc',
    '12500,123',
    '1,234',
    '12,',
    ',5',
    '1.2.3',
    '+5',
  ])('rejects %j', (input) => {
    expect(parseMoney(input)).toBeNull()
  })

  it('rejects numbers beyond the safe integer range', () => {
    expect(parseMoney('999999999999999999')).toBeNull()
  })

  it('round-trips with formatMoney', () => {
    expect(parseMoney(formatMoney(1250050).replace(`${NBSP}₸`, ''))).toBe(1250050)
  })
})
