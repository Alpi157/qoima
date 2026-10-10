import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Link } from 'react-router-dom'

import { renderWithDataRouter, renderWithProviders } from '../../test/render'
import { setupUser } from '../../test/user'
import { DataTable, RowLink } from './DataTable'
import { PageHeader } from './PageHeader'
import { Stat } from './Stat'
import { StatusBadge } from './StatusBadge'

describe('PageHeader', () => {
  it('renders one h1, the way back and the actions', () => {
    renderWithProviders(
      <PageHeader
        back={{ to: '/products', label: 'Тауарлар' }}
        title="IKH16TT"
        subtitle="Свеча"
        actions={<button>Өзгерту</button>}
      />,
    )

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('IKH16TT')
    const back = screen.getByRole('link', { name: 'Тауарлар' })
    expect(back.getAttribute('href')).toBe('/products')
    // The arrow is an icon of the link's color, hidden from screen readers.
    const arrow = back.querySelector('svg')
    expect(arrow?.getAttribute('width')).toBe('20')
    expect(arrow?.getAttribute('stroke')).toBe('currentColor')
    expect(back.textContent).toBe('Тауарлар')
    expect(screen.getByText('Свеча')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Өзгерту' })).toBeTruthy()
  })

  it('has no link when the page has no way back', () => {
    renderWithProviders(<PageHeader title="Тағы" />)

    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('StatusBadge', () => {
  it('marks the tone for the colors', () => {
    renderWithProviders(<StatusBadge tone="cancelled">Күші жойылған</StatusBadge>)

    expect(
      screen.getByText('Күші жойылған').closest('[data-tone]')?.getAttribute('data-tone'),
    ).toBe('cancelled')
  })
})

describe('Stat', () => {
  it('shows the caption and the number with its unit', () => {
    renderWithProviders(<Stat label="Қалдық" value={10} unit="дана" testId="stock" />)

    expect(screen.getByText('Қалдық')).toBeTruthy()
    expect(screen.getByTestId('stock').textContent).toBe('10 дана')
  })
})

describe('DataTable', () => {
  const rows = [
    { id: 1, article: 'IKH16TT', price: '1 500 ₸' },
    { id: 2, article: 'IKH20TT', price: '1 500 ₸' },
  ]
  const columns = [
    { key: 'article', header: 'Артикул', cell: (row: (typeof rows)[number]) => row.article },
    {
      key: 'price',
      header: 'Бағасы',
      numeric: true,
      cell: (row: (typeof rows)[number]) => row.price,
    },
  ]

  it('puts numbers on the right edge', () => {
    renderWithProviders(<DataTable rows={rows} rowKey={(row) => row.id} columns={columns} />)

    expect(screen.getByRole('columnheader', { name: 'Бағасы' }).hasAttribute('data-numeric')).toBe(
      true,
    )
    expect(screen.getAllByRole('cell', { name: '1 500 ₸' })[0].hasAttribute('data-numeric')).toBe(
      true,
    )
  })

  it('opens the row address on click', async () => {
    const user = setupUser()
    const { router } = renderWithDataRouter(
      [
        {
          path: '/products',
          element: (
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              columns={columns}
              rowHref={(row) => `/products/${row.id}`}
            />
          ),
        },
        { path: '/products/:id', element: <p>card</p> },
      ],
      { route: '/products' },
    )

    await user.click(screen.getByRole('cell', { name: 'IKH20TT' }))

    expect(router.state.location.pathname).toBe('/products/2')
  })

  it.each([0, 1])('preserves a separate document link in view %s', async (view) => {
    const user = setupUser()
    const { router } = renderWithDataRouter(
      [
        {
          path: '/returns',
          element: (
            <DataTable
              rows={[{ id: 1 }]}
              rowKey={(row) => row.id}
              rowHref={() => '/returns/1'}
              columns={[
                {
                  key: 'sale',
                  header: 'Продажа',
                  cell: () => <Link to="/sales/2">Накладная №2</Link>,
                },
              ]}
              mobileCardWithLinks
              mobileCard={() => (
                <>
                  <RowLink to="/returns/1">Возврат №1</RowLink>
                  <Link to="/sales/2">Накладная №2</Link>
                </>
              )}
            />
          ),
        },
        { path: '/returns/:id', element: <p>Возврат</p> },
        { path: '/sales/:id', element: <p>Продажа</p> },
      ],
      { route: '/returns' },
    )
    const links = screen.getAllByRole('link', { name: 'Накладная №2' })
    expect(links[1].parentElement?.closest('a')).toBeNull()
    await user.click(links[view])
    expect(router.state.location.pathname).toBe('/sales/2')
  })
})
