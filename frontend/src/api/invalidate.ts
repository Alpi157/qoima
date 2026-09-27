import { useQueryClient } from '@tanstack/react-query'

// Everything that shows stock or stock documents; a posted or cancelled document changes all of it.
const STOCK_QUERY_PREFIXES = ['receipts', 'receipt', 'products', 'product', 'product-movements']

/** Refreshes stock-related queries after a receipt, a cancellation or an adjustment. */
export function useInvalidateStock() {
  const queryClient = useQueryClient()
  return () => {
    for (const prefix of STOCK_QUERY_PREFIXES) {
      void queryClient.invalidateQueries({ queryKey: [prefix] })
    }
  }
}
