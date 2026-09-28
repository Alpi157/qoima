import i18n from 'i18next'
import { describe, expect, it } from 'vitest'

import { ApiError, networkError } from '../api/errors'
import { fieldError } from '../test/fixtures'
import { onlyKazakh } from '../test/i18n'
import { apiErrorText, fieldErrorText } from './errorText'

describe('apiErrorText', () => {
  it('builds insufficient_stock from params.items', () => {
    const error = new ApiError(409, 'detail', {}, 'insufficient_stock', {
      items: [
        { article: 'OC-90', available: 2, requested: 5 },
        { article: 'W712', available: 0, requested: 1 },
      ],
    })
    expect(apiErrorText(error)).toBe(
      'Недостаточно товара. OC-90: на остатке 2, требуется 5; W712: на остатке 0, требуется 1',
    )
  })

  it('builds insufficient_stock in Kazakh and Chinese', async () => {
    const error = new ApiError(409, 'detail', {}, 'insufficient_stock', {
      items: [
        { article: 'OC-90', available: 2, requested: 5 },
        { article: 'W712', available: 0, requested: 1 },
      ],
    })
    await i18n.changeLanguage('kk')
    expect(apiErrorText(error)).toBe(
      'Қоймада тауар жетпейді. OC-90: қоймада 2, керегі 5; W712: қоймада 0, керегі 1',
    )
    await i18n.changeLanguage('zh')
    expect(apiErrorText(error)).toBe('库存不足。OC-90：库存 2，需要 5；W712：库存 0，需要 1')
  })

  it('builds receipt_cancel_blocked from the same items', () => {
    const error = new ApiError(409, 'detail', {}, 'receipt_cancel_blocked', {
      items: [{ article: 'OC-90', available: 2, requested: 5 }],
    })
    expect(apiErrorText(error)).toBe(
      'Нельзя отменить приход: товара на остатке меньше, чем было в приходе. ' +
        'Недостаточно товара. OC-90: на остатке 2, требуется 5',
    )
  })

  it('interpolates params', () => {
    const archived = new ApiError(409, 'detail', {}, 'product_archived', { article: 'ARH-1' })
    expect(apiErrorText(archived)).toBe('Товар ARH-1 в архиве')
    const missing = new ApiError(422, 'detail', {}, 'line_product_not_found', {
      product_ids: [3, 7],
    })
    expect(apiErrorText(missing)).toBe('Товар не найден: 3, 7')
  })

  it('picks the variant by params.document', () => {
    const inSale = new ApiError(422, 'detail', {}, 'duplicate_line', {
      article: 'OC-90',
      document: 'sale',
    })
    expect(apiErrorText(inSale)).toBe('Товар OC-90 указан в продаже дважды')
    const inReceipt = new ApiError(422, 'detail', {}, 'duplicate_line', {
      article: 'OC-90',
      document: 'receipt',
    })
    expect(apiErrorText(inReceipt)).toBe('Товар OC-90 указан в приходе дважды')
  })

  it('shows the detail when the code has no translation', () => {
    expect(apiErrorText(new ApiError(409, 'Текст с сервера', {}, 'brand_new_code'))).toBe(
      'Текст с сервера',
    )
    expect(apiErrorText(new ApiError(400, 'Без кода'))).toBe('Без кода')
  })

  it('reports an unreachable or failing server', () => {
    expect(apiErrorText(networkError())).toBe('Сервер недоступен, попробуйте позже')
    expect(apiErrorText(new ApiError(502, 'Bad Gateway'))).toBe(
      'Сервер недоступен, попробуйте позже',
    )
    expect(apiErrorText(new Error('boom'))).toBe('Сервер недоступен, попробуйте позже')
  })

  it('uses the current language and falls back to Russian', async () => {
    await onlyKazakh({ errors: { product_archived: '{{article}} тауары мұрағатта' } })
    const archived = new ApiError(409, 'detail', {}, 'product_archived', { article: 'ARH-1' })
    expect(apiErrorText(archived)).toBe('ARH-1 тауары мұрағатта')
    const cancelled = new ApiError(409, 'detail', {}, 'sale_already_cancelled')
    expect(apiErrorText(cancelled)).toBe('Продажа уже отменена')
  })

  it('translates with the given t', () => {
    const error = new ApiError(404, 'detail', {}, 'sale_not_found')
    expect(apiErrorText(error, i18n.getFixedT('ru'))).toBe('Продажа не найдена')
  })
})

describe('fieldErrorText', () => {
  it('translates by type with the limits from params', () => {
    const error = fieldError('backend', 'less_than_equal', { le: 200 })
    expect(fieldErrorText(error, 'query.limit')).toBe('Должно быть не больше 200')
  })

  it('picks the variant by the field name', () => {
    const error = fieldError('backend', 'date_in_future')
    expect(fieldErrorText(error, 'sold_at')).toBe('Дата продажи не может быть в будущем')
    expect(fieldErrorText(error, 'received_at')).toBe('Дата прихода не может быть в будущем')
    expect(fieldErrorText(error, 'other')).toBe('Дата не может быть в будущем')
  })

  it('joins list params', () => {
    const error = fieldError('backend', 'null_not_allowed', { fields: ['name', 'unit'] })
    expect(fieldErrorText(error)).toBe('Поле не может быть пустым: name, unit')
  })

  it('keeps the backend message for an unknown or missing type', () => {
    expect(fieldErrorText(fieldError('Своё сообщение', 'unknown_type'))).toBe('Своё сообщение')
    expect(fieldErrorText(fieldError('Без типа'))).toBe('Без типа')
  })
})
