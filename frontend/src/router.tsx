import { createBrowserRouter, Navigate } from 'react-router-dom'

import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppLayout } from './layout/AppLayout'
import { DEFAULT_PATH, LOGIN_PATH } from './lib/nextPath'
import {
  CustomerPage,
  CustomersPage,
  InvoicePrintPage,
  LoginPage,
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

export const router = createBrowserRouter([
  { path: LOGIN_PATH, element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      // The invoice is printed as is: no menu or header around it.
      { path: 'sales/:id/print', element: <InvoicePrintPage /> },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to={DEFAULT_PATH} replace /> },
          { path: 'sale', element: <NewSalePage /> },
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
])
