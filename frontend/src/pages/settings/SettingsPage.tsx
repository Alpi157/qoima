import { Alert, Button, Group, Loader, Paper, Stack, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'

import { QueryError } from '../../components/QueryError'
import { serverFormErrors } from '../../lib/formErrors'
import {
  type BusinessSettings,
  type BusinessSettingsUpdate,
  useBusinessSettings,
  useSaveBusinessSettings,
} from './api'

// Same rule and text as the backend (app/settings/schemas.py).
export const IIN_BIN_ERROR = 'ИИН/БИН должен состоять из 12 цифр'
const IIN_BIN_PATTERN = /^\d{12}$/

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

  const form = useForm<SettingsFormValues>({
    initialValues: formValues(settings),
    validate: {
      seller_iin_bin: (value) => {
        const trimmed = value.trim()
        return trimmed && !IIN_BIN_PATTERN.test(trimmed) ? IIN_BIN_ERROR : null
      },
    },
  })

  const submit = (values: SettingsFormValues) => {
    setFormError(null)
    save.mutate(toBody(values), {
      onSuccess: (saved) => {
        // Show the values as stored (trimmed).
        form.setValues(formValues(saved))
        notifications.show({ color: 'green', message: 'Настройки сохранены' })
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
      <Stack>
        <TextInput
          label="Организация (индивидуальный предприниматель)"
          placeholder="ИП Ахметов"
          autoComplete="organization"
          {...form.getInputProps('seller_name')}
        />
        <TextInput
          label="ИИН/БИН"
          inputMode="numeric"
          maxLength={20}
          autoComplete="off"
          {...form.getInputProps('seller_iin_bin')}
        />
        <TextInput
          label="Ответственный за поставку (Ф.И.О.)"
          autoComplete="off"
          {...form.getInputProps('responsible_person')}
        />
        <TextInput
          label="Отпустил (расшифровка подписи)"
          description="Если пусто, в накладной имя того, кто провёл продажу"
          autoComplete="off"
          {...form.getInputProps('released_by_name')}
        />
        <TextInput
          label="Главный бухгалтер (расшифровка подписи)"
          description="например, Қамтамасыз етілмейді"
          autoComplete="off"
          {...form.getInputProps('chief_accountant')}
        />

        {formError && (
          <Alert color="red" role="alert">
            {formError}
          </Alert>
        )}

        <Group>
          <Button type="submit" loading={save.isPending}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export function SettingsPage() {
  const settings = useBusinessSettings()

  return (
    <Stack maw={640}>
      <Title order={2}>Настройки</Title>
      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="sm">
          Реквизиты для накладной (форма З-2)
        </Title>
        {settings.isPending ? (
          <Loader />
        ) : settings.isError ? (
          <QueryError error={settings.error} onRetry={() => settings.refetch()} />
        ) : (
          <SettingsForm settings={settings.data} />
        )}
      </Paper>
    </Stack>
  )
}
