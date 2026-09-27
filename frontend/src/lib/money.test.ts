import { describe, expect, it } from 'vitest'

import {
  formatAmount,
  formatInteger,
  formatMoney,
  MONEY_INPUT_ERROR,
  parseMoney,
  tiynToInput,
  validateMoneyText,
} from './money'

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

describe('formatAmount', () => {
  it.each([
    [0, '0'],
    [5, '0,05'],
    [7200000, `72${NBSP}000`],
    [180050, `1${NBSP}800,50`],
    [123456789, `1${NBSP}234${NBSP}567,89`],
    [-150, '-1,50'],
  ])('%i tiyn -> %j', (tiyn, expected) => {
    expect(formatAmount(tiyn)).toBe(expected)
  })
})

describe('formatInteger', () => {
  it.each([
    [0, '0'],
    [190, '190'],
    [1250, `1${NBSP}250`],
    [-1250, `-1${NBSP}250`],
  ])('%i -> %j', (value, expected) => {
    expect(formatInteger(value)).toBe(expected)
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

describe('tiynToInput', () => {
  it.each([
    [0, '0'],
    [1250000, '12500'],
    [1250050, '12500,50'],
    [1250005, '12500,05'],
  ])('%i tiyn -> %j', (tiyn, expected) => {
    expect(tiynToInput(tiyn)).toBe(expected)
    expect(parseMoney(expected)).toBe(tiyn)
  })
})

describe('validateMoneyText', () => {
  it.each(['', '  ', '12 500', '0', '12500,5'])('%j is valid', (text) => {
    expect(validateMoneyText(text)).toBeNull()
  })

  it.each(['abc', '-5', '12,345', '1.2.3'])('%j is invalid', (text) => {
    expect(validateMoneyText(text)).toBe(MONEY_INPUT_ERROR)
  })
})
