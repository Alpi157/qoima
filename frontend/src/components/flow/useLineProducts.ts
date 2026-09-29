import { useEffect } from 'react'

import { type Product, useProductsByIds } from '../../pages/products/api'

export interface LineView<L> {
  line: L
  product: Product
}

/**
 * Lines of a document being filled in with their products. Lines of products that are gone
 * or hidden are reported once through `onMissing`, so the page drops them from the draft.
 */
export function useLineProducts<L extends { productId: number }>(
  lines: L[],
  onMissing: (productIds: number[]) => void,
) {
  const { products, missing, isPending } = useProductsByIds(lines.map((line) => line.productId))
  const missingKey = missing.join(',')

  useEffect(() => {
    if (missingKey) onMissing(missingKey.split(',').map(Number))
  }, [missingKey, onMissing])

  const views: LineView<L>[] = lines.flatMap((line) => {
    const product = products.get(line.productId)
    return product && !product.is_archived ? [{ line, product }] : []
  })
  return { views, isPending }
}
