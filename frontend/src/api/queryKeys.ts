export interface ProductListParams {
  q: string
  includeArchived: boolean
  page: number
}

export interface CustomerListParams {
  q: string
  page: number
}

export interface ReceiptListParams {
  /** "2026-09-01", local date in Asia/Almaty, or '' for no bound. */
  from: string
  to: string
  /** 'posted', 'cancelled' or '' for all. */
  status: string
  page: number
}

export interface SaleListParams {
  customerId?: number
  page: number
}

// Invalidating a prefix (for example ['products']) refreshes every list with any params.
export const queryKeys = {
  products: (params: ProductListParams) => ['products', params] as const,
  productSearch: (q: string) => ['products', 'search', q] as const,
  product: (id: number) => ['product', id] as const,
  productMovements: (id: number, page: number) => ['product-movements', id, page] as const,
  customers: (params: CustomerListParams) => ['customers', params] as const,
  customer: (id: number) => ['customer', id] as const,
  receipts: (params: ReceiptListParams) => ['receipts', params] as const,
  receipt: (id: number) => ['receipt', id] as const,
  sales: (params: SaleListParams) => ['sales', params] as const,
}
