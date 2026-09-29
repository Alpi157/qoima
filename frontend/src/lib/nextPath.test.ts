import { describe, expect, it } from 'vitest'

import { loginPathFor, safeNext } from './nextPath'

describe('safeNext', () => {
  it.each([
    ['/products', '/products'],
    ['/products?q=oc', '/products?q=oc'],
    [null, '/'],
    ['', '/'],
    ['products', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['/login', '/'],
    ['/login?next=%2Fsell', '/'],
  ])('%j -> %j', (value, expected) => {
    expect(safeNext(value)).toBe(expected)
  })
})

describe('loginPathFor', () => {
  it('encodes the path with its query', () => {
    expect(loginPathFor('/products', '?q=oc 90')).toBe('/login?next=%2Fproducts%3Fq%3Doc%2090')
  })
})
