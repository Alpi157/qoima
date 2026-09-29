import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { queryKeys, type ProductListParams } from '../../api/queryKeys'
import type { components } from '../../api/schema'
import { PAGE_SIZE, pageOffset } from '../../lib/pagination'

export type Product = components['schemas']['ProductOut']
export type ProductCreate = components['schemas']['ProductCreate']
export type ProductUpdate = components['schemas']['ProductUpdate']
export type Movement = components['schemas']['MovementOut']

export function useProducts(params: ProductListParams) {
  return useQuery({
    queryKey: queryKeys.products(params),
    queryFn: () =>
      unwrap(
        api.GET('/api/products', {
          params: {
            query: {
              q: params.q || undefined,
              include_archived: params.includeArchived,
              limit: PAGE_SIZE,
              offset: pageOffset(params.page),
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

// Search results of the sale and receiving screens (docs/design/simple-ui.md): a few cards.
export const PRODUCT_SEARCH_LIMIT = 6

/** Active products matching the text; shared by the result list and Enter (first result). */
export function productSearchQuery(q: string) {
  return queryOptions({
    queryKey: queryKeys.productSearch(q),
    queryFn: () =>
      unwrap(api.GET('/api/products', { params: { query: { q, limit: PRODUCT_SEARCH_LIMIT } } })),
  })
}

/** Nothing is requested until there is text. */
export function useProductSearch(q: string) {
  const query = q.trim()
  return useQuery({
    ...productSearchQuery(query),
    enabled: query !== '',
    placeholderData: keepPreviousData,
  })
}

const FREQUENT_LIMIT = 6

/** «Жиі сатылатындар»: the products sold most often in the last 30 days. */
export function useFrequentProducts() {
  return useQuery({
    queryKey: queryKeys.frequentProducts,
    queryFn: () =>
      unwrap(api.GET('/api/products/frequent', { params: { query: { limit: FREQUENT_LIMIT } } })),
  })
}

function productQuery(id: number) {
  return queryOptions({
    queryKey: queryKeys.product(id),
    queryFn: () =>
      unwrap(api.GET('/api/products/{product_id}', { params: { path: { product_id: id } } })),
    meta: { handlesNotFound: true },
  })
}

/**
 * Products of the lines of a document being filled in, by id. A line added from the search
 * puts its product into the cache (no request); a restored draft loads them fresh, so the
 * stock and the price are the current ones.
 */
export function useProductsByIds(ids: number[]) {
  return useQueries({
    queries: ids.map((id) => productQuery(id)),
    combine: (results) => ({
      products: new Map(
        results.flatMap((result, index) =>
          result.data ? [[ids[index], result.data] as const] : [],
        ),
      ),
      /** Deleted (404) or hidden products: a document cannot take them, their lines go. */
      missing: ids.filter(
        (_, index) => results[index].isError || results[index].data?.is_archived === true,
      ),
      isPending: results.some((result) => result.isPending),
    }),
  })
}

/** Remembers a product from a search result, so its line needs no extra request. */
export function useRememberProduct() {
  const queryClient = useQueryClient()
  return (product: Product) => queryClient.setQueryData(queryKeys.product(product.id), product)
}

export function useProduct(id: number) {
  return useQuery(productQuery(id))
}

export function useProductMovements(id: number, page: number) {
  return useQuery({
    queryKey: queryKeys.productMovements(id, page),
    queryFn: () =>
      unwrap(
        api.GET('/api/products/{product_id}/movements', {
          params: {
            path: { product_id: id },
            query: { limit: PAGE_SIZE, offset: pageOffset(page) },
          },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

function useInvalidateProduct() {
  const queryClient = useQueryClient()
  return (product: Product) => {
    void queryClient.invalidateQueries({ queryKey: ['products'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.product(product.id) })
  }
}

export function useCreateProduct() {
  const invalidate = useInvalidateProduct()
  return useMutation({
    mutationFn: (body: ProductCreate) => unwrap(api.POST('/api/products', { body })),
    onSuccess: invalidate,
  })
}

export function useUpdateProduct(id: number) {
  const invalidate = useInvalidateProduct()
  return useMutation({
    mutationFn: (body: ProductUpdate) =>
      unwrap(
        api.PATCH('/api/products/{product_id}', { params: { path: { product_id: id } }, body }),
      ),
    onSuccess: invalidate,
  })
}
