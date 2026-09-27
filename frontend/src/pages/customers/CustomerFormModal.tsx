import { Alert, Button, Group, Modal, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'

import { serverFormErrors } from '../../lib/formErrors'
import { type Customer, type CustomerCreate, useCreateCustomer, useUpdateCustomer } from './api'

interface CustomerFormValues {
  name: string
  phone: string
  note: string
}

const FIELD_MAP = { name: 'name', phone: 'phone', note: 'note' }

function toBody(values: CustomerFormValues): CustomerCreate {
  return {
    name: values.name.trim(),
    phone: values.phone.trim() || null,
    note: values.note.trim() || null,
  }
}

interface CustomerFormProps {
  customer?: Customer
  initialName?: string
  onSaved: (customer: Customer) => void
  onCancel: () => void
}

function CustomerForm({ customer, initialName = '', onSaved, onCancel }: CustomerFormProps) {
  const create = useCreateCustomer()
  const update = useUpdateCustomer(customer?.id ?? 0)
  const mutation = customer ? update : create
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<CustomerFormValues>({
    initialValues: {
      name: customer?.name ?? initialName,
      phone: customer?.phone ?? '',
      note: customer?.note ?? '',
    },
    validate: {
      name: (value) => (value.trim() ? null : 'Введите имя'),
    },
  })

  const save = (values: CustomerFormValues) => {
    setFormError(null)
    mutation.mutate(toBody(values), {
      onSuccess: (saved) => {
        notifications.show({
          color: 'green',
          message: customer
            ? `Покупатель ${saved.name} сохранён`
            : `Покупатель ${saved.name} добавлен`,
        })
        onSaved(saved)
      },
      onError: (error) => {
        const { fields, message } = serverFormErrors(error, { fieldMap: FIELD_MAP })
        form.setErrors(fields)
        setFormError(message)
      },
    })
  }

  return (
    <form onSubmit={form.onSubmit(save)} noValidate>
      <Stack>
        <TextInput
          label="Имя"
          required
          autoComplete="off"
          data-autofocus
          {...form.getInputProps('name')}
        />
        <TextInput
          label="Телефон"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="+7 701 123 45 67"
          {...form.getInputProps('phone')}
        />
        <Textarea label="Заметка" autosize minRows={2} {...form.getInputProps('note')} />

        {formError && (
          <Alert color="red" role="alert">
            {formError}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export interface CustomerFormModalProps {
  opened: boolean
  onClose: () => void
  /** The customer to edit; without it the form creates a new one. */
  customer?: Customer
  /** Name to start a new customer with, for example the text typed in a search. */
  initialName?: string
  onSaved?: (customer: Customer) => void
}

export function CustomerFormModal({
  opened,
  onClose,
  customer,
  initialName,
  onSaved,
}: CustomerFormModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={customer ? 'Изменить покупателя' : 'Новый покупатель'}
    >
      {/* The form is mounted only while the modal is open, so it starts clean every time. */}
      {opened && (
        <CustomerForm
          customer={customer}
          initialName={initialName}
          onCancel={onClose}
          onSaved={(saved) => {
            onClose()
            onSaved?.(saved)
          }}
        />
      )}
    </Modal>
  )
}
