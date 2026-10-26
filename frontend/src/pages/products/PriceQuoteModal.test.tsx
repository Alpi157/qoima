import { screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { ApiError, networkError } from '../../api/errors'
import type { components } from '../../api/schema'
import { postBody } from '../../test/flowApi'
import { ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { fill, setupUser } from '../../test/user'
import { todayLocal } from '../../lib/dates'
import { PriceQuoteModal } from './PriceQuoteModal'

type QuoteCreate = components['schemas']['PriceQuoteCreate']
afterEach(() => vi.restoreAllMocks())

function renderModal() {
  const close = vi.fn()
  const view = renderWithProviders(<PriceQuoteModal productId={1} opened onClose={close} />)
  return { ...view, close }
}

it('saves foreign minor units and defaults to the Almaty date', async () => {
  const user = setupUser()
  const post = vi.spyOn(api, 'POST').mockReturnValue(ok({ id: 1 }))
  const { close } = renderModal()
  await user.click(screen.getByRole('button', { name: '¥ Юань' }))
  await fill(user, screen.getByRole('textbox', { name: 'Цена, ¥' }), '123,45')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(close).toHaveBeenCalled())
  expect(postBody<QuoteCreate>(post)).toEqual({
    request_id: expect.any(String),
    currency: 'CNY',
    price_minor: 12345,
    quoted_on: todayLocal(),
  })
})

it('retries the exact composition after an unknown result with disabled fields', async () => {
  const user = setupUser()
  const post = vi
    .spyOn(api, 'POST')
    .mockRejectedValueOnce(networkError())
    .mockReturnValueOnce(ok({ id: 1 }))
  const { close } = renderModal()
  await fill(user, screen.getByRole('textbox', { name: 'Цена, ₸' }), '100')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByTestId('unknown-result')
  const price = screen.getByRole('textbox', { name: 'Цена, ₸' }) as HTMLInputElement
  expect(price.matches(':disabled')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Проверить ещё раз' }))
  await waitFor(() => expect(close).toHaveBeenCalled())
  expect(postBody<QuoteCreate>(post, 1)).toEqual(postBody<QuoteCreate>(post))
})

it('shows a conflict and starts a new request only after explicit clearing', async () => {
  const user = setupUser()
  const post = vi
    .spyOn(api, 'POST')
    .mockRejectedValueOnce(
      new ApiError(409, 'Conflict', {}, 'price_quote_request_conflict', { id: 17 }),
    )
    .mockReturnValueOnce(ok({ id: 18 }))
  renderModal()
  await fill(user, screen.getByRole('textbox', { name: 'Цена, ₸' }), '100')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect((await screen.findByTestId('request-conflict')).textContent).toContain('№17')
  await user.click(screen.getByRole('button', { name: 'Очистить' }))
  await fill(user, screen.getByRole('textbox', { name: 'Цена, ₸' }), '200')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(postBody<QuoteCreate>(post, 1).request_id).not.toBe(postBody<QuoteCreate>(post).request_id)
})

it('rejects zero and a future date before posting', async () => {
  const user = setupUser()
  const post = vi.spyOn(api, 'POST')
  renderModal()
  await fill(user, screen.getByRole('textbox', { name: 'Цена, ₸' }), '0')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(post).not.toHaveBeenCalled()
  expect(await screen.findByRole('alert')).toBeTruthy()
})
