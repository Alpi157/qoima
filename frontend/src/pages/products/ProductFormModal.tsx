import {
  Alert,
  Button,
  Collapse,
  Group,
  Modal,
  Select,
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
import { useTranslation } from 'react-i18next'

import { MoneyInput } from '../../components/MoneyInput'
import { serverFormErrors } from '../../lib/formErrors'
import { type Unit, UNITS, unitLabel } from '../../lib/labels'
import { parseMoney, tiynToInput, validateMoneyText } from '../../lib/money'
import { type Product, type ProductCreate, useCreateProduct, useUpdateProduct } from './api'

export const DEFAULT_UNIT: Unit = 'шт'

/**
 * The unit list plus the product's own unit if it is not in the list, so editing keeps it.
 * The value is stored as is (Russian), the label is in the interface language.
 */
function unitOptions(current: string): { value: string; label: string }[] {
  const units: string[] = [...UNITS]
  if (current && !units.includes(current)) units.push(current)
  return units.map((unit) => ({ value: unit, label: unitLabel(unit) }))
}

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
    // The validator has already rejected an empty or malformed price.
    sale_price: parseMoney(values.price) ?? 0,
    unit: values.unit.trim(),
    brand: values.brand.trim() || null,
    note: values.note.trim() || null,
  }
}

interface ProductFormProps {
  product?: Product
  initialArticle?: string
  withAddMore: boolean
  onSaved: (product: Product) => void
  onCancel: () => void
}

function ProductForm({
  product,
  initialArticle = '',
  withAddMore,
  onSaved,
  onCancel,
}: ProductFormProps) {
  const create = useCreateProduct()
  const update = useUpdateProduct(product?.id ?? 0)
  const mutation = product ? update : create
  const [moreOpened, { toggle: toggleMore, open: openMore }] = useDisclosure(
    Boolean(product?.brand || product?.note),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [addingMore, setAddingMore] = useState(false)
  const { t } = useTranslation()

  const form = useForm<ProductFormValues>({
    initialValues: product ? toFormValues(product) : { ...EMPTY_VALUES, article: initialArticle },
    validate: {
      article: (value) => (value.trim() ? null : t('products.form.articleRequired')),
      name: (value) => (value.trim() ? null : t('products.form.nameRequired')),
      price: (value) => (value.trim() ? validateMoneyText(value) : t('common.input.priceRequired')),
      unit: (value) => (value.trim() ? null : t('products.form.unitRequired')),
    },
  })

  const save = (values: ProductFormValues, addMore: boolean) => {
    setFormError(null)
    setAddingMore(addMore)
    mutation.mutate(toBody(values), {
      onSuccess: (saved) => {
        notifications.show({
          color: 'green',
          message: product
            ? t('products.form.saved', { article: saved.article })
            : t('products.form.added', { article: saved.article }),
        })
        if (addMore) {
          // The next product starts empty, without the prefilled article.
          form.setInitialValues(EMPTY_VALUES)
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
    // Enter in any field submits the form, which is "Save".
    <form onSubmit={form.onSubmit((values) => save(values, false))} noValidate>
      <Stack>
        <TextInput
          label={t('products.form.article')}
          required
          autoComplete="off"
          data-autofocus
          {...form.getInputProps('article')}
        />
        <TextInput
          label={t('products.form.name')}
          required
          autoComplete="off"
          {...form.getInputProps('name')}
        />
        <SimpleGrid cols={2}>
          <MoneyInput
            label={t('products.form.price')}
            required
            placeholder={t('products.form.pricePlaceholder')}
            {...form.getInputProps('price')}
          />
          <Select
            label={t('products.form.unit')}
            required
            data={unitOptions(form.values.unit)}
            allowDeselect={false}
            {...form.getInputProps('unit')}
          />
        </SimpleGrid>

        <UnstyledButton onClick={toggleMore} c="blue" aria-expanded={moreOpened}>
          {moreOpened ? t('products.form.hideMore') : t('products.form.showMore')}
        </UnstyledButton>
        <Collapse expanded={moreOpened}>
          <Stack>
            <TextInput
              label={t('products.form.brand')}
              autoComplete="off"
              {...form.getInputProps('brand')}
            />
            <Textarea
              label={t('products.form.note')}
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
            {t('common.cancel')}
          </Button>
          {withAddMore && !product && (
            <Button
              variant="light"
              onClick={() => form.onSubmit((values) => save(values, true))()}
              loading={mutation.isPending && addingMore}
              disabled={mutation.isPending && !addingMore}
            >
              {t('products.form.saveAndAddMore')}
            </Button>
          )}
          <Button
            type="submit"
            loading={mutation.isPending && !addingMore}
            disabled={mutation.isPending && addingMore}
          >
            {t('common.save')}
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
  /** Prefills the article of a new product (for example, the search that found nothing). */
  initialArticle?: string
  /** "Save and add more" for a new product; off where the caller needs the saved one. */
  withAddMore?: boolean
  onSaved?: (product: Product) => void
}

export function ProductFormModal({
  opened,
  onClose,
  product,
  initialArticle,
  withAddMore = true,
  onSaved,
}: ProductFormModalProps) {
  const { t } = useTranslation()
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={product ? t('products.form.editTitle') : t('products.form.newTitle')}
      size="lg"
    >
      {/* The form is mounted only while the modal is open, so it starts clean every time. */}
      {opened && (
        <ProductForm
          product={product}
          initialArticle={initialArticle}
          withAddMore={withAddMore}
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
