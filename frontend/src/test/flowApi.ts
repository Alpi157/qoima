import { vi } from 'vitest'

import { api } from '../api/client'
import { ApiError } from '../api/errors'
import type { Customer } from '../pages/customers/api'
import type { Product } from '../pages/products/api'
import type { Receipt } from '../pages/receipts/api'
import type { Sale } from '../pages/sales/api'
import { ok } from './fixtures'

export interface FlowData {
  userId?: number
  products?: Product[]
  frequent?: Product[]
  customers?: Customer[]
  recent?: Customer[]
  sale?: Sale
  receipt?: Receipt
}

interface GetInit {
  params?: { query?: { q?: string }; path?: Record<string, number> }
}

function matches(text: string, q: string): boolean {
  return text.toLowerCase().includes(q.trim().toLowerCase())
}

/**
 * GET answers of the sale and receiving screens from a small in-memory catalog: the search
 * filters by article or name, a product by id is found or 404. Returns the spy.
 */
export function mockFlowGet(data: FlowData = {}) {
  const { userId = 1, products = [], frequent = [], customers = [], recent = [] } = data
  const owner = {
    id: userId,
    username: `user${userId}`,
    full_name: 'Владелец',
    role: 'owner',
    locale: 'ru',
  }
  return vi.spyOn(api, 'GET').mockImplementation(((path: string, init?: GetInit) => {
    const q = init?.params?.query?.q ?? ''
    const id = Object.values(init?.params?.path ?? {})[0]
    switch (path) {
      case '/api/auth/me':
        return ok(owner)
      case '/api/products': {
        const items = products.filter((p) => matches(p.article, q) || matches(p.name, q))
        return ok({ items, total: items.length })
      }
      case '/api/products/frequent':
        return ok(frequent)
      case '/api/products/{product_id}': {
        const product = products.find((p) => p.id === id)
        return product ? ok(product) : Promise.reject(new ApiError(404, 'Товар не найден'))
      }
      case '/api/customers': {
        const items = customers.filter((c) => matches(c.name, q) || matches(c.phone ?? '', q))
        return ok({ items, total: items.length })
      }
      case '/api/customers/recent':
        return ok(recent)
      case '/api/sales/{sale_id}':
        return data.sale ? ok(data.sale) : Promise.reject(new ApiError(404, 'Продажа не найдена'))
      case '/api/receipts/{receipt_id}':
        return data.receipt
          ? ok(data.receipt)
          : Promise.reject(new ApiError(404, 'Приход не найден'))
      default:
        return ok({ items: [], total: 0, sum_posted: 0 })
    }
  }) as never)
}

/** Body of the n-th call of a POST spy. */
export function postBody<T>(spy: { mock: { calls: unknown[][] } }, index = 0): T {
  const [, init] = spy.mock.calls[index] as [string, { body: T }]
  return init.body
}
