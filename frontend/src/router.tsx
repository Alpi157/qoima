import { createBrowserRouter, Navigate } from 'react-router-dom'

import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppLayout } from './layout/AppLayout'
import { DEFAULT_PATH, LOGIN_PATH } from './lib/nextPath'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlaceholderPage } from './pages/PlaceholderPage'

export const router = createBrowserRouter([
  { path: LOGIN_PATH, element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to={DEFAULT_PATH} replace /> },
          { path: 'sale', element: <PlaceholderPage title="Продажа" /> },
          { path: 'products', element: <PlaceholderPage title="Товары" /> },
          { path: 'customers', element: <PlaceholderPage title="Покупатели" /> },
          { path: 'receipts', element: <PlaceholderPage title="Приход" /> },
          { path: 'sales', element: <PlaceholderPage title="Продажи" /> },
          { path: 'settings', element: <PlaceholderPage title="Настройки" /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
