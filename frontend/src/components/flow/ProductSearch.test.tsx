import { screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../api/client'
import { makeProduct, ok } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { ProductSearch } from './ProductSearch'

afterEach(() => vi.restoreAllMocks())

describe('ProductSearch', () => {
  it.each(['kk', 'ru', 'zh'])(
    'shows three more results for 9 matches and 6 cards (%s)',
    async (language) => {
      await i18n.changeLanguage(language)
      vi.spyOn(api, 'GET').mockReturnValue(
        ok({
          items: Array.from({ length: 6 }, (_, i) =>
            makeProduct({ id: i + 1, article: `TEST-${i}` }),
          ),
          total: 9,
        }),
      )
      renderWithProviders(
        <ProductSearch
          query="TEST"
          onQueryChange={vi.fn()}
          onAdd={vi.fn()}
          label="Search"
          placeholder="Article"
          details={() => null}
          notFound={() => null}
        />,
      )
      expect(await screen.findByText(i18n.t('flow.moreResults', { more: 3 }))).toBeTruthy()
      expect(screen.getAllByRole('button')).toHaveLength(6)
    },
  )

  it('does not show the caption when all six results are shown', async () => {
    vi.spyOn(api, 'GET').mockReturnValue(
      ok({
        items: Array.from({ length: 6 }, (_, i) =>
          makeProduct({ id: i + 1, article: `TEST-${i}` }),
        ),
        total: 6,
      }),
    )
    renderWithProviders(
      <ProductSearch
        query="TEST"
        onQueryChange={vi.fn()}
        onAdd={vi.fn()}
        label="Search"
        placeholder="Article"
        details={() => null}
        notFound={() => null}
      />,
    )
    await screen.findAllByRole('button')
    expect(screen.queryByText(/Найдено ещё/)).toBeNull()
  })
})
