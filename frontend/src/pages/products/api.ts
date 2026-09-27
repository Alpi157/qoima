import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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

export function useProduct(id: number) {
  return useQuery({
    queryKey: queryKeys.product(id),
    queryFn: () =>
      unwrap(api.GET('/api/products/{product_id}', { params: { path: { product_id: id } } })),
    meta: { handlesNotFound: true },
  })
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
