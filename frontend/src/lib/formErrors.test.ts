import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/errors'
import { serverFormErrors } from './formErrors'

const options = { fieldMap: { article: 'article', sale_price: 'price' }, conflictField: 'article' }

describe('serverFormErrors', () => {
  it('puts a 409 under the conflict field', () => {
    const error = new ApiError(409, 'Товар с артикулом «OC-90» уже есть')
    expect(serverFormErrors(error, options)).toEqual({
      fields: { article: 'Товар с артикулом «OC-90» уже есть' },
      message: null,
    })
  })

  it('maps field errors to form fields', () => {
    const error = new ApiError(422, 'Проверьте введённые данные', {
      sale_price: 'Должно быть не больше 100000000000',
    })
    expect(serverFormErrors(error, options)).toEqual({
      fields: { price: 'Должно быть не больше 100000000000' },
      message: null,
    })
  })

  it('shows the detail when a field is unknown to the form', () => {
    const error = new ApiError(422, 'Проверьте введённые данные', { '': 'Лишнее поле' })
    expect(serverFormErrors(error, options)).toEqual({
      fields: {},
      message: 'Проверьте введённые данные',
    })
  })

  it('shows the detail of a business error without fields', () => {
    const error = new ApiError(422, 'Артикул должен содержать буквы или цифры')
    expect(serverFormErrors(error, options).message).toBe(
      'Артикул должен содержать буквы или цифры',
    )
  })

  it('leaves server and network errors to the global notification', () => {
    expect(serverFormErrors(new ApiError(500, 'x'), options)).toEqual({ fields: {}, message: null })
    expect(serverFormErrors(new ApiError(0, 'x'), options)).toEqual({ fields: {}, message: null })
    expect(serverFormErrors(new Error('x'), options)).toEqual({ fields: {}, message: null })
  })
})
