import { AppShell, Box, Burger, Button, Group, NavLink, Text, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { api, unwrap } from '../api/client'
import { useChangeMyLanguage, useMe } from '../auth/useMe'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { PageLoader } from '../components/PageLoader'
import { LOGIN_PATH } from '../lib/nextPath'

const MENU = [
  { label: 'nav.sale', to: '/sale' },
  { label: 'nav.products', to: '/products' },
  { label: 'nav.customers', to: '/customers' },
  { label: 'nav.receipts', to: '/receipts' },
  { label: 'nav.sales', to: '/sales' },
  { label: 'nav.settings', to: '/settings' },
] as const

function isActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const { t } = useTranslation()
  const language = useChangeMyLanguage()

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
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label={t('nav.menu')}
            />
            <Title order={3}>Qoima</Title>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Box visibleFrom="xs">
              <LanguageSwitcher onChange={language.change} disabled={language.isPending} />
            </Box>
            <Text visibleFrom="md" truncate maw={240}>
              {me?.full_name}
            </Text>
            <Button variant="default" onClick={() => logout.mutate()} loading={logout.isPending}>
              {t('nav.logout')}
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
            label={t(item.label)}
            active={isActive(pathname, item.to)}
            onClick={close}
          />
        ))}
        {/* On a phone the header has no room for the languages: they live in the menu. */}
        <Box hiddenFrom="xs" mt="md">
          <LanguageSwitcher onChange={language.change} disabled={language.isPending} />
        </Box>
      </AppShell.Navbar>

      <AppShell.Main>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </AppShell.Main>
    </AppShell>
  )
}
