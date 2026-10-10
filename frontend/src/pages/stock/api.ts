import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '../../api/client'
import { queryKeys } from '../../api/queryKeys'

/** Shared by the stock page and the home stock alerts. */
export function useStockSummary() {
  return useQuery({
    queryKey: queryKeys.stockSummary,
    queryFn: () => unwrap(api.GET('/api/stock/summary')),
  })
}
