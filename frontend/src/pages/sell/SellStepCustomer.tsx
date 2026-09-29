import { Button, Group, Loader, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ArrowLeftIcon, PlusIcon, SearchIcon, UserIcon } from '../../components/icons'
import { SEARCH_DELAY_MS } from '../../components/SearchInput'
import { Card, PageHeader } from '../../components/ui'
import { serverFormErrors } from '../../lib/formErrors'
import {
  type Customer,
  useCreateCustomer,
  useCustomerSearch,
  useRecentCustomers,
} from '../customers/api'
import type { PickedCustomer } from './saleDraft'

function pick(customer: Customer): PickedCustomer {
  return { id: customer.id, name: customer.name, phone: customer.phone ?? null }
}

// A search made of digits is a phone number: it goes to the phone field of a new customer.
const PHONE_LIKE = /^[\d\s()+-]+$/

interface NewCustomerFormProps {
  initialText: string
  onSaved: (customer: Customer) => void
  onCancel: () => void
}

/** «Жаңа сатып алушы» right on the step: saved and chosen in one press. */
function NewCustomerForm({ initialText, onSaved, onCancel }: NewCustomerFormProps) {
  const { t } = useTranslation()
  const create = useCreateCustomer()
  const phoneLike = PHONE_LIKE.test(initialText)
  const [name, setName] = useState(phoneLike ? '' : initialText)
  const [phone, setPhone] = useState(phoneLike ? initialText : '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const submit = () => {
    if (!name.trim()) return
    create.mutate(
      { name: name.trim(), phone: phone.trim() || null },
      {
        onSuccess: onSaved,
        onError: (error) => {
          const { fields, message } = serverFormErrors(error, {
            fieldMap: { name: 'name', phone: 'phone' },
          })
          setErrors(fields)
          setFormError(message)
        },
      },
    )
  }

  return (
    <Card maw={720} style={{ borderColor: 'var(--q-color-receive)' }}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Stack gap="lg">
          <Title order={2}>{t('sell.customer.new')}</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            <TextInput
              label={t('sell.customer.name')}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              error={errors.name}
              data-autofocus
              autoFocus
              required
            />
            <TextInput
              label={t('sell.customer.phone')}
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.currentTarget.value)}
              error={errors.phone}
            />
          </SimpleGrid>
          {formError && (
            <Text c="red" role="alert">
              {formError}
            </Text>
          )}
          <Group gap="sm">
            <Button type="submit" color="green" disabled={!name.trim()} loading={create.isPending}>
              {t('sell.customer.saveAndPick')}
            </Button>
            <Button variant="default" onClick={onCancel}>
              {t('flow.cancel')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  )
}

function CustomerChoice({ customer, onPick }: { customer: Customer; onPick: () => void }) {
  return (
    <button type="button" className="flow-choice" onClick={onPick}>
      <UserIcon size={32} />
      <Stack gap={0} miw={0}>
        <span className="flow-choice-name">{customer.name}</span>
        {customer.phone && <Text c="dimmed">{customer.phone}</Text>}
      </Stack>
    </button>
  )
}

export interface SellStepCustomerProps {
  onPick: (customer: PickedCustomer | 'none') => void
  onBack: () => void
}

/** Step 2 «Кімге сатамыз?»: the latest customers, a search, a new customer on the spot. */
export function SellStepCustomer({ onPick, onBack }: SellStepCustomerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [debounced] = useDebouncedValue(query.trim(), SEARCH_DELAY_MS)
  const [creating, setCreating] = useState(false)
  const recent = useRecentCustomers()
  const search = useCustomerSearch(debounced)

  const searching = query.trim() !== ''
  const list = searching ? (search.data?.items ?? []) : (recent.data ?? [])
  const loading = searching ? search.isPending || debounced !== query.trim() : recent.isPending
  const nothingFound = searching && !loading && list.length === 0

  return (
    <>
      <PageHeader title={t('sell.customer.title')} />
      <Stack gap="lg">
        <TextInput
          label={t('sell.customer.search')}
          placeholder={t('sell.customer.placeholder')}
          type="search"
          autoComplete="off"
          autoFocus
          leftSection={<SearchIcon />}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          maw={720}
        />

        <Title order={2}>
          {searching ? t('sell.customer.results') : t('sell.customer.recent')}
        </Title>
        {loading && list.length === 0 && <Loader />}
        {list.length > 0 && (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {list.map((customer) => (
              <CustomerChoice
                key={customer.id}
                customer={customer}
                onPick={() => onPick(pick(customer))}
              />
            ))}
          </SimpleGrid>
        )}
        {nothingFound && (
          <div className="flow-empty" role="status">
            {t('sell.customer.notFound')}
          </div>
        )}

        {creating ? (
          <NewCustomerForm
            initialText={query.trim()}
            onSaved={(customer) => onPick(pick(customer))}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <Group gap="sm">
            <Button leftSection={<PlusIcon size={20} />} onClick={() => setCreating(true)}>
              {t('sell.customer.new')}
            </Button>
            <Button variant="default" onClick={() => onPick('none')}>
              {t('sell.customer.none')}
            </Button>
          </Group>
        )}

        <Group>
          <Button variant="default" leftSection={<ArrowLeftIcon size={20} />} onClick={onBack}>
            {t('sell.customer.back')}
          </Button>
        </Group>
      </Stack>
    </>
  )
}
