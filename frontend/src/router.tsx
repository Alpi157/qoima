import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'

import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppLayout } from './layout/AppLayout'
import { LOGIN_PATH } from './lib/nextPath'
import {
  CustomerPage,
  CustomersPage,
  HomePage,
  InvoicePrintPage,
  LoginPage,
  MorePage,
  NotFoundPage,
  ProductPage,
  ProductsPage,
  ReceiptPage,
  ReceiptsPage,
  ReceiveDonePage,
  ReceivePage,
  SalePage,
  SalesPage,
  SellDonePage,
  SellPage,
  SettingsPage,
  StockPage,
} from './pages/lazyPages'

export const routes: RouteObject[] = [
  { path: LOGIN_PATH, element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      // The invoice is printed as is: no menu or header around it.
      { path: 'sales/:id/print', element: <InvoicePrintPage /> },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'more', element: <MorePage /> },
          // The simple screens of the main page (docs/design/simple-ui.md).
          { path: 'sell', element: <SellPage /> },
          { path: 'sell/done/:id', element: <SellDonePage /> },
          { path: 'receive', element: <ReceivePage /> },
          { path: 'receive/done/:id', element: <ReceiveDonePage /> },
          { path: 'stock', element: <StockPage /> },
          { path: 'sale', element: <Navigate to="/sell" replace /> },
          // Detailed sections opened from «Тағы»: their lists lead back with «Тағы».
          { path: 'products', element: <ProductsPage /> },
          { path: 'products/:id', element: <ProductPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'customers/:id', element: <CustomerPage /> },
          { path: 'receipts', element: <ReceiptsPage /> },
          { path: 'receipts/new', element: <Navigate to="/receive" replace /> },
          { path: 'receipts/:id', element: <ReceiptPage /> },
          { path: 'sales', element: <SalesPage /> },
          { path: 'sales/:id', element: <SalePage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
