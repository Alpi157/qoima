import { lazy } from 'react'

// Every page is its own chunk, loaded on first visit.
// Suspense boundaries: main.tsx (whole screen) and AppLayout (content area).
export const CustomerPage = lazy(() =>
  import('./customers/CustomerPage').then((m) => ({ default: m.CustomerPage })),
)
export const CustomersPage = lazy(() =>
  import('./customers/CustomersPage').then((m) => ({ default: m.CustomersPage })),
)
export const LoginPage = lazy(() => import('./LoginPage').then((m) => ({ default: m.LoginPage })))
export const NotFoundPage = lazy(() =>
  import('./NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)
export const ProductPage = lazy(() =>
  import('./products/ProductPage').then((m) => ({ default: m.ProductPage })),
)
export const ProductsPage = lazy(() =>
  import('./products/ProductsPage').then((m) => ({ default: m.ProductsPage })),
)
export const ReceiptPage = lazy(() =>
  import('./receipts/ReceiptPage').then((m) => ({ default: m.ReceiptPage })),
)
export const ReceiptsPage = lazy(() =>
  import('./receipts/ReceiptsPage').then((m) => ({ default: m.ReceiptsPage })),
)
export const InvoicePrintPage = lazy(() =>
  import('./sales/InvoicePrintPage').then((m) => ({ default: m.InvoicePrintPage })),
)
export const SalePage = lazy(() =>
  import('./sales/SalePage').then((m) => ({ default: m.SalePage })),
)
export const SalesPage = lazy(() =>
  import('./sales/SalesPage').then((m) => ({ default: m.SalesPage })),
)
export const SettingsPage = lazy(() =>
  import('./settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
export const HomePage = lazy(() => import('./home/HomePage').then((m) => ({ default: m.HomePage })))
export const MorePage = lazy(() => import('./more/MorePage').then((m) => ({ default: m.MorePage })))
export const SellPage = lazy(() => import('./sell/SellPage').then((m) => ({ default: m.SellPage })))
export const SellDonePage = lazy(() =>
  import('./sell/SellDonePage').then((m) => ({ default: m.SellDonePage })),
)
export const ReceivePage = lazy(() =>
  import('./receive/ReceivePage').then((m) => ({ default: m.ReceivePage })),
)
export const ReceiveDonePage = lazy(() =>
  import('./receive/ReceiveDonePage').then((m) => ({ default: m.ReceiveDonePage })),
)
export const StockPage = lazy(() =>
  import('./stock/StockPage').then((m) => ({ default: m.StockPage })),
)
