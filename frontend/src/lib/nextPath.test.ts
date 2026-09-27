import { describe, expect, it } from 'vitest'

import { loginPathFor, safeNext } from './nextPath'

describe('safeNext', () => {
  it.each([
    ['/products', '/products'],
    ['/products?q=oc', '/products?q=oc'],
    [null, '/sale'],
    ['', '/sale'],
    ['products', '/sale'],
    ['//evil.example', '/sale'],
    ['/\\evil.example', '/sale'],
    ['https://evil.example', '/sale'],
    ['/login', '/sale'],
    ['/login?next=%2Fsale', '/sale'],
  ])('%j -> %j', (value, expected) => {
    expect(safeNext(value)).toBe(expected)
  })
})

describe('loginPathFor', () => {
  it('encodes the path with its query', () => {
    expect(loginPathFor('/products', '?q=oc 90')).toBe('/login?next=%2Fproducts%3Fq%3Doc%2090')
  })
})
