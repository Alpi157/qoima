import { useQueryClient } from '@tanstack/react-query'

// Everything that shows stock or stock documents; a posted or cancelled document changes all of it.
const STOCK_QUERY_PREFIXES = ['receipts', 'receipt', 'products', 'product', 'product-movements']

// A sale also changes the purchase history on its customer's page.
const SALE_QUERY_PREFIXES = [
  'sales',
  'sale',
  'products',
  'product',
  'product-movements',
  'customer',
]

function useInvalidatePrefixes(prefixes: string[]) {
  const queryClient = useQueryClient()
  return () => {
    for (const prefix of prefixes) {
      void queryClient.invalidateQueries({ queryKey: [prefix] })
    }
  }
}

/** Refreshes stock-related queries after a receipt, a cancellation or an adjustment. */
export function useInvalidateStock() {
  return useInvalidatePrefixes(STOCK_QUERY_PREFIXES)
}

/** Refreshes sales, stock and customer queries after a sale or its cancellation. */
export function useInvalidateSales() {
  return useInvalidatePrefixes(SALE_QUERY_PREFIXES)
}
