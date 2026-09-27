import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { renderWithProviders } from '../test/render'
import { LoginPage } from './LoginPage'

function renderLogin(route: string) {
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/products" element={<p>Страница товаров</p>} />
      <Route path="/sale" element={<p>Страница продажи</p>} />
    </Routes>,
    { route },
  )
}

function mockLoggedIn() {
  vi.spyOn(api, 'GET').mockResolvedValue({
    data: { id: 1, username: 'owner', full_name: 'Владелец', role: 'owner' },
    response: new Response(),
  } as never)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LoginPage', () => {
  it('sends a logged-in user to the "next" page', async () => {
    mockLoggedIn()
    renderLogin('/login?next=%2Fproducts')
    expect(await screen.findByText('Страница товаров')).toBeTruthy()
  })

  it('sends a logged-in user to the sale page when "next" is unsafe', async () => {
    mockLoggedIn()
    renderLogin('/login?next=%2F%2Fevil.example')
    expect(await screen.findByText('Страница продажи')).toBeTruthy()
  })
})
