import { describe, expect, it } from 'vitest'

import { amountInWords, quantityInWords } from './amountInWords'

const tenge = (value: number) => value * 100

describe('amountInWords', () => {
  it.each([
    [0, 'ноль теңге 00 тиын'],
    [tenge(1), 'один теңге 00 тиын'],
    [tenge(2), 'два теңге 00 тиын'],
    [tenge(11), 'одиннадцать теңге 00 тиын'],
    [tenge(21), 'двадцать один теңге 00 тиын'],
    [tenge(101), 'сто один теңге 00 тиын'],
    [tenge(1000), 'одна тысяча теңге 00 тиын'],
    [tenge(1001), 'одна тысяча один теңге 00 тиын'],
    [tenge(2000), 'две тысячи теңге 00 тиын'],
    [tenge(5000), 'пять тысяч теңге 00 тиын'],
    [tenge(11000), 'одиннадцать тысяч теңге 00 тиын'],
    [tenge(14_000), 'четырнадцать тысяч теңге 00 тиын'],
    [tenge(21000), 'двадцать одна тысяча теңге 00 тиын'],
    // The sample invoice.
    [tenge(254_000), 'двести пятьдесят четыре тысячи теңге 00 тиын'],
    [tenge(1_000_000), 'один миллион теңге 00 тиын'],
    [tenge(2_000_000), 'два миллиона теңге 00 тиын'],
    [tenge(5_000_000), 'пять миллионов теңге 00 тиын'],
    [tenge(1_000_001), 'один миллион один теңге 00 тиын'],
    [tenge(2_500_000), 'два миллиона пятьсот тысяч теңге 00 тиын'],
    [
      tenge(12_345_678) + 90,
      'двенадцать миллионов триста сорок пять тысяч шестьсот семьдесят восемь теңге 90 тиын',
    ],
    [tenge(1_000_000_000), 'один миллиард теңге 00 тиын'],
    [tenge(2_000_000_000), 'два миллиарда теңге 00 тиын'],
    [tenge(5_000_000_000), 'пять миллиардов теңге 00 тиын'],
    [5, 'ноль теңге 05 тиын'],
  ])('%i tiyn -> %s', (tiyn, words) => {
    expect(amountInWords(tiyn)).toBe(words)
  })

  it('uses single spaces only', () => {
    expect(amountInWords(tenge(254_000))).not.toMatch(/\s{2}/)
  })

  it('rejects negative and fractional amounts', () => {
    expect(() => amountInWords(-100)).toThrow(RangeError)
    expect(() => amountInWords(1.5)).toThrow(RangeError)
  })
})

describe('quantityInWords', () => {
  it.each([
    [0, 'ноль'],
    [1, 'один'],
    [2, 'два'],
    [5, 'пять'],
    [12, 'двенадцать'],
    [21, 'двадцать один'],
    [40, 'сорок'],
    [101, 'сто один'],
    // The sample invoice.
    [190, 'сто девяносто'],
    [1000, 'одна тысяча'],
    [2002, 'две тысячи два'],
    [100_000, 'сто тысяч'],
  ])('%i -> %s', (qty, words) => {
    expect(quantityInWords(qty)).toBe(words)
  })

  it('rejects negative and fractional quantities', () => {
    expect(() => quantityInWords(-1)).toThrow(RangeError)
    expect(() => quantityInWords(0.5)).toThrow(RangeError)
  })
})
