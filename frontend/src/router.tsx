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
  NewReceiptPage,
  NewSalePage,
  NotFoundPage,
  ProductPage,
  ProductsPage,
  ReceiptPage,
  ReceiptsPage,
  SalePage,
  SalesPage,
  SettingsPage,
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
          // Until steps 16.2 and 16.3 the simple screens show the existing ones.
          { path: 'sell', element: <NewSalePage /> },
          { path: 'receive', element: <NewReceiptPage /> },
          { path: 'stock', element: <ProductsPage /> },
          { path: 'sale', element: <Navigate to="/sell" replace /> },
          // Detailed sections opened from «Тағы»: their lists lead back with «← Тағы».
          { path: 'products', element: <ProductsPage /> },
          { path: 'products/:id', element: <ProductPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'customers/:id', element: <CustomerPage /> },
          { path: 'receipts', element: <ReceiptsPage /> },
          { path: 'receipts/new', element: <NewReceiptPage /> },
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
