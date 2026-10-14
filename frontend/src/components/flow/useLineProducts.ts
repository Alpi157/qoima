import { useEffect, useRef } from 'react'

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
  onMissing: (productIds: number[], products: Map<number, Product>) => void,
) {
  const { products, missing, isPending, hasLoadError, reload } = useProductsByIds(
    lines.map((line) => line.productId),
  )
  const missingKey = missing.join(',')
  const reported = useRef('')

  useEffect(() => {
    if (missingKey && reported.current !== missingKey) {
      reported.current = missingKey
      onMissing(missingKey.split(',').map(Number), products)
    }
    if (!missingKey) reported.current = ''
  }, [missingKey, onMissing, products])

  const views: LineView<L>[] = lines.flatMap((line) => {
    const product = products.get(line.productId)
    return product && !product.is_archived && !missing.includes(line.productId)
      ? [{ line, product }]
      : []
  })
  return {
    views,
    products,
    isPending,
    hasLoadError,
    reload,
    incomplete: views.length !== lines.length,
    unresolved: lines.filter(
      (line) => !products.has(line.productId) && !missing.includes(line.productId),
    ),
  }
}
