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
export const NewReceiptPage = lazy(() =>
  import('./receipts/NewReceiptPage').then((m) => ({ default: m.NewReceiptPage })),
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
export const NewSalePage = lazy(() =>
  import('./sales/NewSalePage').then((m) => ({ default: m.NewSalePage })),
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
