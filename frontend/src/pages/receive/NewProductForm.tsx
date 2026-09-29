import { Button, Group, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MoneyInput } from '../../components/MoneyInput'
import { Card } from '../../components/ui'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { serverFormErrors } from '../../lib/formErrors'
import { UNITS, unitLabel } from '../../lib/labels'
import { parseMoney } from '../../lib/money'
import { type Product, useCreateProduct } from '../products/api'

export interface NewProductFormProps {
  /** The searched text: most often it is the article. */
  initialArticle: string
  onSaved: (product: Product) => void
  onCancel: () => void
}

/** «Жаңа тауар» right on the receiving screen: saved and added as a line in one press. */
export function NewProductForm({ initialArticle, onSaved, onCancel }: NewProductFormProps) {
  const { t } = useTranslation()
  const create = useCreateProduct()
  const [article, setArticle] = useState(initialArticle)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [unit, setUnit] = useState<string>(UNITS[0])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const priceTiyn = parseMoney(price)
  const complete = article.trim() !== '' && name.trim() !== '' && priceTiyn !== null

  const submit = () => {
    if (!complete) return
    create.mutate(
      { article: article.trim(), name: name.trim(), sale_price: priceTiyn, unit },
      {
        onSuccess: onSaved,
        onError: (error) => {
          const { fields, message } = serverFormErrors(error, {
            fieldMap: { article: 'article', name: 'name', sale_price: 'price', unit: 'unit' },
            conflictField: 'article',
          })
          setErrors(fields)
          setFormError(message)
        },
      },
    )
  }

  return (
    <Card style={{ borderColor: 'var(--q-color-receive)' }} data-testid="new-product-form">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Stack gap="lg">
          <Title order={2}>{t('receive.newProduct.title')}</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            <TextInput
              label={t('receive.newProduct.article')}
              value={article}
              onChange={(event) => setArticle(event.currentTarget.value)}
              error={errors.article}
              required
            />
            <TextInput
              label={t('receive.newProduct.name')}
              placeholder={t('receive.newProduct.namePlaceholder')}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              error={errors.name}
              required
              autoFocus
            />
          </SimpleGrid>
          <Group gap="lg" align="flex-start">
            <MoneyInput
              label={t('receive.newProduct.price')}
              placeholder={t('receive.newProduct.pricePlaceholder')}
              value={price}
              onChange={(text) => setPrice(text)}
              error={errors.price}
              required
              w={FIELD_WIDTH.price}
            />
            <Select
              label={t('receive.newProduct.unit')}
              data={UNITS.map((value) => ({ value, label: unitLabel(value) }))}
              value={unit}
              onChange={(value) => setUnit(value ?? UNITS[0])}
              allowDeselect={false}
              error={errors.unit}
              w={FIELD_WIDTH.price}
            />
          </Group>
          {formError && (
            <Text c="red" role="alert">
              {formError}
            </Text>
          )}
          <Group gap="sm">
            <Button type="submit" color="green" disabled={!complete} loading={create.isPending}>
              {t('receive.newProduct.save')}
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
