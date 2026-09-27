import { describe, expect, it } from 'vitest'

import { pageCount, pageOffset, parsePage } from './pagination'

describe('pagination', () => {
  it('computes offsets for 50 per page', () => {
    expect(pageOffset(1)).toBe(0)
    expect(pageOffset(3)).toBe(100)
  })

  it('counts pages', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(50)).toBe(1)
    expect(pageCount(51)).toBe(2)
  })

  it.each([
    [null, 1],
    ['', 1],
    ['0', 1],
    ['-2', 1],
    ['1.5', 1],
    ['abc', 1],
    ['4', 4],
  ])('parsePage(%j) -> %i', (value, expected) => {
    expect(parsePage(value)).toBe(expected)
  })
})
