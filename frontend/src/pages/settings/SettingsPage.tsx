import { Alert, Button, Group, Stack, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import { Card, PageContainer, PageHeader, useBackToMore } from '../../components/ui'
import { serverFormErrors } from '../../lib/formErrors'
import {
  type BusinessSettings,
  type BusinessSettingsUpdate,
  useBusinessSettings,
  useSaveBusinessSettings,
} from './api'

// Same rule as the backend (app/settings/schemas.py); the text is its error type's.
const IIN_BIN_PATTERN = /^\d{12}$/

// Written on the invoice when there is no chief accountant; always in Kazakh, like the form.
const NO_ACCOUNTANT = 'Қамтамасыз етілмейді'

type SettingsFormValues = BusinessSettingsUpdate

const FIELD_MAP = {
  seller_name: 'seller_name',
  seller_iin_bin: 'seller_iin_bin',
  responsible_person: 'responsible_person',
  released_by_name: 'released_by_name',
  chief_accountant: 'chief_accountant',
}

function formValues(settings: BusinessSettings): SettingsFormValues {
  return {
    seller_name: settings.seller_name,
    seller_iin_bin: settings.seller_iin_bin,
    responsible_person: settings.responsible_person,
    released_by_name: settings.released_by_name,
    chief_accountant: settings.chief_accountant,
  }
}

function toBody(values: SettingsFormValues): BusinessSettingsUpdate {
  return {
    seller_name: values.seller_name.trim(),
    seller_iin_bin: values.seller_iin_bin.trim(),
    responsible_person: values.responsible_person.trim(),
    released_by_name: values.released_by_name.trim(),
    chief_accountant: values.chief_accountant.trim(),
  }
}

function SettingsForm({ settings }: { settings: BusinessSettings }) {
  const save = useSaveBusinessSettings()
  const [formError, setFormError] = useState<string | null>(null)
  const { t } = useTranslation()

  const form = useForm<SettingsFormValues>({
    initialValues: formValues(settings),
    validate: {
      seller_iin_bin: (value) => {
        const trimmed = value.trim()
        return trimmed && !IIN_BIN_PATTERN.test(trimmed) ? t('validation.iin_bin_format') : null
      },
    },
  })

  const submit = (values: SettingsFormValues) => {
    setFormError(null)
    save.mutate(toBody(values), {
      onSuccess: (saved) => {
        // Show the values as stored (trimmed).
        form.setValues(formValues(saved))
        notifications.show({ color: 'green', message: t('settings.saved') })
      },
      onError: (error) => {
        const { fields, message } = serverFormErrors(error, { fieldMap: FIELD_MAP })
        form.setErrors(fields)
        setFormError(message)
      },
    })
  }

  return (
    <form onSubmit={form.onSubmit(submit)} noValidate>
      <Stack gap="lg">
        <TextInput
          label={t('settings.sellerName')}
          placeholder={t('settings.sellerNamePlaceholder')}
          autoComplete="organization"
          {...form.getInputProps('seller_name')}
        />
        <TextInput
          label={t('settings.iinBin')}
          inputMode="numeric"
          maxLength={20}
          autoComplete="off"
          {...form.getInputProps('seller_iin_bin')}
        />
        <TextInput
          label={t('settings.responsiblePerson')}
          autoComplete="off"
          {...form.getInputProps('responsible_person')}
        />
        <TextInput
          label={t('settings.releasedBy')}
          description={t('settings.releasedByHint')}
          autoComplete="off"
          {...form.getInputProps('released_by_name')}
        />
        <Group align="flex-end" gap="md">
          <TextInput
            label={t('settings.chiefAccountant')}
            description={t('settings.chiefAccountantHint')}
            autoComplete="off"
            style={{ flex: '1 1 260px' }}
            {...form.getInputProps('chief_accountant')}
          />
          <Button
            variant="default"
            onClick={() => form.setFieldValue('chief_accountant', NO_ACCOUNTANT)}
          >
            {t('settings.noAccountant')}
          </Button>
        </Group>

        {formError && (
          <Alert color="red" role="alert">
            {formError}
          </Alert>
        )}

        <Group>
          <Button type="submit" size="lg" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export function SettingsPage() {
  const settings = useBusinessSettings()
  const { t } = useTranslation()
  const backToMore = useBackToMore()

  return (
    <PageContainer>
      <PageHeader back={backToMore} title={t('settings.title')} />
      <Card title={t('settings.invoiceDetails')} maw={720}>
        {settings.isPending ? (
          <PageLoader />
        ) : settings.isError ? (
          <QueryError error={settings.error} onRetry={() => settings.refetch()} />
        ) : (
          <SettingsForm settings={settings.data} />
        )}
      </Card>
    </PageContainer>
  )
}
