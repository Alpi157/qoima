import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/errors'
import { fieldError } from '../test/fixtures'
import { serverFormErrors } from './formErrors'

const options = { fieldMap: { article: 'article', sale_price: 'price' }, conflictField: 'article' }

describe('serverFormErrors', () => {
  it('puts a 409 under the conflict field, translated by code', () => {
    const error = new ApiError(409, 'detail', {}, 'duplicate_article', {
      article: 'OC-90',
      existing_name: 'Фильтр масляный',
    })
    expect(serverFormErrors(error, options)).toEqual({
      fields: { article: 'Товар с артикулом «OC-90» уже есть: Фильтр масляный' },
      message: null,
    })
  })

  it('maps field errors to form fields, translated by type', () => {
    const error = new ApiError(
      422,
      'Проверьте введённые данные',
      { sale_price: fieldError('backend text', 'less_than_equal', { le: 100000000000 }) },
      'validation_error',
    )
    expect(serverFormErrors(error, options)).toEqual({
      fields: { price: 'Должно быть не больше 100000000000' },
      message: null,
    })
  })

  it('keeps the backend message of an unknown field error type', () => {
    const error = new ApiError(422, 'x', { sale_price: fieldError('Своё сообщение', 'new_type') })
    expect(serverFormErrors(error, options).fields).toEqual({ price: 'Своё сообщение' })
  })

  it('shows the whole-form message when a field is unknown to the form', () => {
    const error = new ApiError(
      422,
      'Проверьте введённые данные',
      { '': fieldError('Лишнее поле', 'extra_forbidden') },
      'validation_error',
    )
    expect(serverFormErrors(error, options)).toEqual({
      fields: {},
      message: 'Проверьте введённые данные',
    })
  })

  it('shows the detail of a business error without a translation', () => {
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
