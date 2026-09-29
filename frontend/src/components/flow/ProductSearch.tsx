import { Button, Group, Loader, Stack, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode, Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { type Product, productSearchQuery, useProductSearch } from '../../pages/products/api'
import { PlusIcon, SearchIcon } from '../icons'
import { SEARCH_DELAY_MS } from '../SearchInput'
import { Card } from '../ui'

export interface ProductSearchProps {
  /** Text of the field, kept by the page: it clears it after adding and prefills forms from it. */
  query: string
  onQueryChange: (query: string) => void
  onAdd: (product: Product) => void
  label: string
  placeholder: string
  /** The right part of a result card: price and stock as the flow shows them. */
  details: (product: Product) => ReactNode
  /** Under an empty field: «Жиі сатылатындар» on the sale screen. */
  idle?: ReactNode
  /** Nothing matches the text. */
  notFound: (query: string) => ReactNode
  inputRef?: Ref<HTMLInputElement>
}

/**
 * Product search of the sale and receiving screens: a large field that has the focus at once,
 * results as cards with «Қосу». Enter adds the first result.
 */
export function ProductSearch({
  query,
  onQueryChange,
  onAdd,
  label,
  placeholder,
  details,
  idle,
  notFound,
  inputRef,
}: ProductSearchProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [debounced] = useDebouncedValue(query.trim(), SEARCH_DELAY_MS)
  const search = useProductSearch(debounced)
  const text = query.trim()
  // Results of an older text stay on screen while the new one loads; hide them once cleared.
  const results = text && search.data ? search.data.items : []
  const settled = text !== '' && text === debounced && !search.isFetching && search.isSuccess

  const add = (product: Product) => {
    onAdd(product)
    onQueryChange('')
  }

  // Enter does not wait for the pause after typing: it asks for this exact text.
  const addFirst = async () => {
    if (!text) return
    const page = await queryClient.fetchQuery(productSearchQuery(text))
    if (page.items.length > 0) add(page.items[0])
  }

  return (
    <Stack gap="md">
      <TextInput
        ref={inputRef}
        size="lg"
        label={label}
        placeholder={placeholder}
        type="search"
        autoComplete="off"
        // The first thing to do on this screen is to type an article.
        autoFocus
        leftSection={<SearchIcon />}
        rightSection={search.isFetching && text ? <Loader size="sm" /> : null}
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void addFirst()
          }
        }}
      />

      {!text && idle}

      {results.length > 0 && (
        <Stack gap="sm" component="section" aria-label={t('flow.results')}>
          {results.map((product) => (
            <Card key={product.id} padding="md">
              <Group justify="space-between" gap="md" wrap="wrap">
                <Stack gap={4} miw={0} style={{ flex: '1 1 200px' }}>
                  <Text className="flow-article">{product.article}</Text>
                  <Text c="dimmed">{product.name}</Text>
                </Stack>
                <Group gap="lg" wrap="wrap" justify="flex-end">
                  {details(product)}
                  <Button
                    color="green"
                    variant="light"
                    leftSection={<PlusIcon size={20} />}
                    onClick={() => add(product)}
                    aria-label={t('flow.addOf', { article: product.article })}
                  >
                    {t('flow.add')}
                  </Button>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      {settled && results.length === 0 && notFound(text)}
    </Stack>
  )
}
