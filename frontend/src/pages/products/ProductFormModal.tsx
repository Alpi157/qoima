import {
  Alert,
  Button,
  Collapse,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'

import { MoneyInput } from '../../components/MoneyInput'
import { serverFormErrors } from '../../lib/formErrors'
import { parseMoney, tiynToInput, validateMoneyText } from '../../lib/money'
import { type Product, type ProductCreate, useCreateProduct, useUpdateProduct } from './api'

export const DEFAULT_UNIT = 'шт'

interface ProductFormValues {
  article: string
  name: string
  price: string
  unit: string
  brand: string
  note: string
}

const EMPTY_VALUES: ProductFormValues = {
  article: '',
  name: '',
  price: '',
  unit: DEFAULT_UNIT,
  brand: '',
  note: '',
}

const FIELD_MAP = {
  article: 'article',
  name: 'name',
  sale_price: 'price',
  unit: 'unit',
  brand: 'brand',
  note: 'note',
}

function toFormValues(product: Product): ProductFormValues {
  return {
    article: product.article,
    name: product.name,
    price: tiynToInput(product.sale_price),
    unit: product.unit,
    brand: product.brand ?? '',
    note: product.note ?? '',
  }
}

function toBody(values: ProductFormValues): ProductCreate {
  return {
    article: values.article.trim(),
    name: values.name.trim(),
    // An empty price means 0: the product can be priced later.
    sale_price: parseMoney(values.price) ?? 0,
    unit: values.unit.trim(),
    brand: values.brand.trim() || null,
    note: values.note.trim() || null,
  }
}

interface ProductFormProps {
  product?: Product
  onSaved: (product: Product) => void
  onCancel: () => void
}

function ProductForm({ product, onSaved, onCancel }: ProductFormProps) {
  const create = useCreateProduct()
  const update = useUpdateProduct(product?.id ?? 0)
  const mutation = product ? update : create
  const [moreOpened, { toggle: toggleMore, open: openMore }] = useDisclosure(
    Boolean(product?.brand || product?.note),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [addingMore, setAddingMore] = useState(false)

  const form = useForm<ProductFormValues>({
    initialValues: product ? toFormValues(product) : EMPTY_VALUES,
    validate: {
      article: (value) => (value.trim() ? null : 'Введите артикул'),
      name: (value) => (value.trim() ? null : 'Введите наименование'),
      price: validateMoneyText,
      unit: (value) => (value.trim() ? null : 'Введите единицу'),
    },
  })

  const save = (values: ProductFormValues, addMore: boolean) => {
    setFormError(null)
    setAddingMore(addMore)
    mutation.mutate(toBody(values), {
      onSuccess: (saved) => {
        notifications.show({
          color: 'green',
          message: product ? `Товар ${saved.article} сохранён` : `Товар ${saved.article} добавлен`,
        })
        if (addMore) {
          form.reset()
          form.getInputNode('article')?.focus()
        } else {
          onSaved(saved)
        }
      },
      onError: (error) => {
        const { fields, message } = serverFormErrors(error, {
          fieldMap: FIELD_MAP,
          conflictField: 'article',
        })
        form.setErrors(fields)
        setFormError(message)
        if (fields.brand || fields.note) openMore()
      },
    })
  }

  return (
    // Enter in any field submits the form, which is "Сохранить".
    <form onSubmit={form.onSubmit((values) => save(values, false))} noValidate>
      <Stack>
        <TextInput
          label="Артикул"
          required
          autoComplete="off"
          data-autofocus
          {...form.getInputProps('article')}
        />
        <TextInput
          label="Наименование"
          required
          autoComplete="off"
          {...form.getInputProps('name')}
        />
        <SimpleGrid cols={2}>
          <MoneyInput label="Цена" placeholder="0" {...form.getInputProps('price')} />
          <TextInput
            label="Единица"
            required
            autoComplete="off"

            {...form.getInputProps('unit')}
          />
        </SimpleGrid>

        <UnstyledButton onClick={toggleMore} c="blue" aria-expanded={moreOpened}>
          {moreOpened ? 'Скрыть дополнительное' : 'Дополнительно: бренд, заметка'}
        </UnstyledButton>
        <Collapse expanded={moreOpened}>
          <Stack>
            <TextInput
              label="Бренд"
              autoComplete="off"

              {...form.getInputProps('brand')}
            />
            <Textarea
              label="Заметка"
              autosize
              minRows={2}

              {...form.getInputProps('note')}
            />
          </Stack>
        </Collapse>

        {formError && (
          <Alert color="red" role="alert">
            {formError}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={mutation.isPending}>
            Отмена
          </Button>
          {!product && (
            <Button
              variant="light"
              onClick={() => form.onSubmit((values) => save(values, true))()}
              loading={mutation.isPending && addingMore}
              disabled={mutation.isPending && !addingMore}
            >
              Сохранить и добавить ещё
            </Button>
          )}
          <Button
            type="submit"
            loading={mutation.isPending && !addingMore}
            disabled={mutation.isPending && addingMore}
          >
            Сохранить
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export interface ProductFormModalProps {
  opened: boolean
  onClose: () => void
  /** The product to edit; without it the form creates a new one. */
  product?: Product
  onSaved?: (product: Product) => void
}

export function ProductFormModal({ opened, onClose, product, onSaved }: ProductFormModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={product ? 'Изменить товар' : 'Новый товар'}
      size="lg"
    >
      {/* The form is mounted only while the modal is open, so it starts clean every time. */}
      {opened && (
        <ProductForm
          product={product}
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
