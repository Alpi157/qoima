import { lazy, type ComponentType } from 'react'

import { clearPageReload, PageModuleError, tryPageReload } from '../lib/pageReload'

/** Share the import promise, but recover background failures separately from rendering. */
export function lazyPage<T extends ComponentType>(loader: () => Promise<{ default: T }>) {
  let pending: Promise<{ default: T }> | undefined
  const importPage = () => {
    pending ??= loader().then((module) => {
      // Vite resolves to undefined when preloadError is prevented for a reload.
      // That is not a successful import: keep the guard for the next document.
      if (!module?.default) throw new Error('Page import was interrupted')
      clearPageReload()
      return module
    })
    return pending
  }
  const load = () =>
    importPage().catch((error: unknown) => {
      tryPageReload()
      throw new PageModuleError(error)
    })
  return Object.assign(lazy(load), {
    preload: async (): Promise<void> => {
      // Keep the global Vite handler from reloading during a background import.
      // Do not preventDefault: Vite must reject the promise so this catch can retry later.
      // Concurrent rendering still handles its rejection through load().
      const backgroundError = (event: Event) => event.stopImmediatePropagation()
      window.addEventListener('vite:preloadError', backgroundError, true)
      let preloading: typeof pending
      try {
        preloading = importPage()
        await preloading
      } catch (error: unknown) {
        if (pending === preloading) pending = undefined
        console.warn(error)
      } finally {
        window.removeEventListener('vite:preloadError', backgroundError, true)
      }
    },
  })
}

export const ReturnCreatePage = lazyPage(() =>
  import('./returns/ReturnCreatePage').then((m) => ({ default: m.ReturnCreatePage })),
)
export const ReturnPage = lazyPage(() =>
  import('./returns/ReturnPage').then((m) => ({ default: m.ReturnPage })),
)
export const ReturnsPage = lazyPage(() =>
  import('./returns/ReturnsPage').then((m) => ({ default: m.ReturnsPage })),
)

export const DebtsPage = lazyPage(() =>
  import('./debts/DebtsPage').then((m) => ({ default: m.DebtsPage })),
)

// Every page is its own chunk, loaded on first visit.
// Suspense boundaries: main.tsx (whole screen) and AppLayout (content area).
export const CustomerPage = lazyPage(() =>
  import('./customers/CustomerPage').then((m) => ({ default: m.CustomerPage })),
)
export const CustomersPage = lazyPage(() =>
  import('./customers/CustomersPage').then((m) => ({ default: m.CustomersPage })),
)
export const LoginPage = lazyPage(() =>
  import('./LoginPage').then((m) => ({ default: m.LoginPage })),
)
export const NotFoundPage = lazyPage(() =>
  import('./NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)
export const ProductPage = lazyPage(() =>
  import('./products/ProductPage').then((m) => ({ default: m.ProductPage })),
)
export const ProductsPage = lazyPage(() =>
  import('./products/ProductsPage').then((m) => ({ default: m.ProductsPage })),
)
export const ReceiptPage = lazyPage(() =>
  import('./receipts/ReceiptPage').then((m) => ({ default: m.ReceiptPage })),
)
export const ReceiptsPage = lazyPage(() =>
  import('./receipts/ReceiptsPage').then((m) => ({ default: m.ReceiptsPage })),
)
export const InvoicePrintPage = lazyPage(() =>
  import('./sales/InvoicePrintPage').then((m) => ({ default: m.InvoicePrintPage })),
)
export const SalePage = lazyPage(() =>
  import('./sales/SalePage').then((m) => ({ default: m.SalePage })),
)
export const SalesPage = lazyPage(() =>
  import('./sales/SalesPage').then((m) => ({ default: m.SalesPage })),
)
export const SettingsPage = lazyPage(() =>
  import('./settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
export const HomePage = lazyPage(() =>
  import('./home/HomePage').then((m) => ({ default: m.HomePage })),
)
export const MorePage = lazyPage(() =>
  import('./more/MorePage').then((m) => ({ default: m.MorePage })),
)
export const SellPage = lazyPage(() =>
  import('./sell/SellPage').then((m) => ({ default: m.SellPage })),
)
export const SellDonePage = lazyPage(() =>
  import('./sell/SellDonePage').then((m) => ({ default: m.SellDonePage })),
)
export const ReceivePage = lazyPage(() =>
  import('./receive/ReceivePage').then((m) => ({ default: m.ReceivePage })),
)
export const ReceiveDonePage = lazyPage(() =>
  import('./receive/ReceiveDonePage').then((m) => ({ default: m.ReceiveDonePage })),
)
export const StockPage = lazyPage(() =>
  import('./stock/StockPage').then((m) => ({ default: m.StockPage })),
)

export const ReportPage = lazyPage(() =>
  import('./report/ReportPage').then((m) => ({ default: m.ReportPage })),
)
