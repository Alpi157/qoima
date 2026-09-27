import { describe, expect, it } from 'vitest'

import { parseId } from './routeParams'

describe('parseId', () => {
  it.each([
    ['7', 7],
    [undefined, null],
    ['', null],
    ['0', null],
    ['-1', null],
    ['1.5', null],
    ['abc', null],
  ])('%j -> %j', (value, expected) => {
    expect(parseId(value)).toBe(expected)
  })
})
