import { AppShell, Box, Button, Group, Menu, Text, UnstyledButton } from '@mantine/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { api, unwrap } from '../api/client'
import { useChangeMyLanguage, useMe } from '../auth/useMe'
import { HomeIcon, LogoutIcon, MenuIcon, UserIcon } from '../components/icons'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { PageLoader } from '../components/PageLoader'
import { currentLanguage, LANGUAGES } from '../i18n/language'
import { HOME_PATH, LOGIN_PATH } from '../lib/nextPath'

export function AppLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const { t } = useTranslation()
  const language = useChangeMyLanguage()
  const activeLanguage = currentLanguage()

  const logout = useMutation({
    mutationFn: () => unwrap(api.POST('/api/auth/logout')),
    onSuccess: () => {
      queryClient.clear()
      navigate(LOGIN_PATH, { replace: true })
    },
  })

  return (
    <AppShell header={{ height: 72 }}>
      {/* design-system.md, «Шапка»: 72 high, white, 1px border, the same 1200 container. */}
      <AppShell.Header withBorder>
        <Group
          h="100%"
          maw="var(--q-container)"
          mx="auto"
          px="var(--q-gutter)"
          gap="lg"
          wrap="nowrap"
        >
          <UnstyledButton component={Link} to={HOME_PATH} fz="xl" fw={700} lh="xl">
            Qoima
          </UnstyledButton>
          {pathname !== HOME_PATH && (
            <Button
              component={Link}
              to={HOME_PATH}
              size="sm"
              variant="default"
              leftSection={<HomeIcon size={20} />}
            >
              {t('nav.home')}
            </Button>
          )}

          <Group gap="md" wrap="nowrap" visibleFrom="sm" ml="auto">
            <LanguageSwitcher onChange={language.change} disabled={language.isPending} />
            <Group gap="xs" wrap="nowrap" visibleFrom="md">
              <UserIcon size={20} />
              <Text truncate maw={220}>
                {me?.full_name}
              </Text>
            </Group>
            <Button
              size="sm"
              variant="default"
              leftSection={<LogoutIcon size={20} />}
              onClick={() => logout.mutate()}
              loading={logout.isPending}
            >
              {t('nav.logout')}
            </Button>
          </Group>

          {/* On a phone the header has no room: languages and logout live in a menu. */}
          <Box hiddenFrom="sm" ml="auto">
            <Menu position="bottom-end" width={240}>
              <Menu.Target>
                <Button size="sm" variant="default" leftSection={<MenuIcon size={20} />}>
                  {t('nav.menu')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {me && <Menu.Label fz="md">{me.full_name}</Menu.Label>}
                <Menu.Label>{t('common.language')}</Menu.Label>
                {LANGUAGES.map(({ code, label }) => (
                  <Menu.Item
                    key={code}
                    lang={code}
                    fz="md"
                    fw={code === activeLanguage ? 600 : 400}
                    aria-current={code === activeLanguage}
                    disabled={language.isPending}
                    rightSection={code === activeLanguage ? '✓' : null}
                    onClick={() => {
                      if (code !== activeLanguage) language.change(code)
                    }}
                  >
                    {label}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item
                  fz="md"
                  leftSection={<LogoutIcon size={20} />}
                  onClick={() => logout.mutate()}
                >
                  {t('nav.logout')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Box>
        </Group>
      </AppShell.Header>

      {/* Each page sets its own grid with PageContainer. */}
      <AppShell.Main>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </AppShell.Main>
    </AppShell>
  )
}
