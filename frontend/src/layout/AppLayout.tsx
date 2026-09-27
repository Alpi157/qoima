import { AppShell, Burger, Button, Group, NavLink, Text, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Suspense } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { api, unwrap } from '../api/client'
import { useMe } from '../auth/useMe'
import { PageLoader } from '../components/PageLoader'
import { LOGIN_PATH } from '../lib/nextPath'

const MENU = [
  { label: 'Продажа', to: '/sale' },
  { label: 'Товары', to: '/products' },
  { label: 'Покупатели', to: '/customers' },
  { label: 'Приход', to: '/receipts' },
  { label: 'Продажи', to: '/sales' },
  { label: 'Настройки', to: '/settings' },
]

function isActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: me } = useMe()

  const logout = useMutation({
    mutationFn: () => unwrap(api.POST('/api/auth/logout')),
    onSuccess: () => {
      queryClient.clear()
      navigate(LOGIN_PATH, { replace: true })
    },
  })

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Меню" />
            <Title order={3}>Qoima</Title>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Text visibleFrom="xs" truncate maw={240}>
              {me?.full_name}
            </Text>
            <Button variant="default" onClick={() => logout.mutate()} loading={logout.isPending}>
              Выйти
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {MENU.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={item.label}
            active={isActive(pathname, item.to)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </AppShell.Main>
    </AppShell>
  )
}
