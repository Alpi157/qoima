import { createBrowserRouter, Navigate } from 'react-router-dom'

import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppLayout } from './layout/AppLayout'
import { DEFAULT_PATH, LOGIN_PATH } from './lib/nextPath'
import { CustomerPage } from './pages/customers/CustomerPage'
import { CustomersPage } from './pages/customers/CustomersPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProductPage } from './pages/products/ProductPage'
import { ProductsPage } from './pages/products/ProductsPage'
import { NewReceiptPage } from './pages/receipts/NewReceiptPage'
import { ReceiptPage } from './pages/receipts/ReceiptPage'
import { ReceiptsPage } from './pages/receipts/ReceiptsPage'
import { InvoicePrintPage } from './pages/sales/InvoicePrintPage'
import { NewSalePage } from './pages/sales/NewSalePage'
import { SalePage } from './pages/sales/SalePage'
import { SalesPage } from './pages/sales/SalesPage'
import { SettingsPage } from './pages/settings/SettingsPage'

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
