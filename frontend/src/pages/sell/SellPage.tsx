import { Alert } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { hasErrorCode } from '../../api/errors'
import { useMe } from '../../auth/useMe'
import {
  CancelFlowModal,
  DraftNotice,
  StepIndicator,
  useDraft,
  useLineProducts,
} from '../../components/flow'
import { PageLoader } from '../../components/PageLoader'
import { PageContainer } from '../../components/ui'
import { apiErrorText } from '../../i18n/errorText'
import { type Product, useRememberProduct } from '../products/api'
import { SALE_REQUEST_CONFLICT, usePostSale } from '../sales/api'
import {
  addSaleLine,
  createSaleDraft,
  isSaleDraftEmpty,
  parseSaleDraft,
  type PickedCustomer,
  saleBody,
  type SaleDraftLine,
} from './saleDraft'
import { SellStepCustomer } from './SellStepCustomer'
import { SellStepProducts } from './SellStepProducts'
import { RequestConflictAlert, SellStepReview } from './SellStepReview'

type Step = 1 | 2 | 3

const STEP_LABELS = ['sell.steps.products', 'sell.steps.customer', 'sell.steps.review'] as const

function parseStep(value: string | null): Step {
  return value === '2' ? 2 : value === '3' ? 3 : 1
}

function stepSearch(step: Step): string {
  return step === 1 ? '' : `?step=${step}`
}

/** History state of a step entered with «Келесі»: «Артқа» then goes back in the history. */
interface StepState {
  fromStep: Step
}

function SellFlow({ userId }: { userId: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const rememberProduct = useRememberProduct()
  const post = usePostSale()

  const draft = useDraft({
    userId,
    flow: 'sale',
    create: createSaleDraft,
    parse: parseSaleDraft,
    isEmpty: isSaleDraftEmpty,
  })
  const { value, update, clear } = draft
  const [query, setQuery] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [saveError, setSaveError] = useState<ReactNode>(null)

  const changeLines = useCallback(
    (change: (lines: SaleDraftLine[]) => SaleDraftLine[]) => {
      update((current) => ({ ...current, lines: change(current.lines) }))
      setSaveError(null)
    },
    [update],
  )
  const dropMissing = useCallback(
    (ids: number[]) =>
      changeLines((lines) => lines.filter((line) => !ids.includes(line.productId))),
    [changeLines],
  )
  const { views, isPending: loadingLines } = useLineProducts(value.lines, dropMissing)

  // The step is in the address, so the browser's Back returns to the previous one. A step
  // that has nothing to show yet (no lines, no customer) leads to the one to fill first.
  const requested = parseStep(searchParams.get('step'))
  const step: Step =
    requested > 1 && value.lines.length === 0
      ? 1
      : requested === 3 && value.customer === null
        ? 2
        : requested
  useEffect(() => {
    if (step !== requested) navigate({ search: stepSearch(step) }, { replace: true })
  }, [step, requested, navigate])

  const goForward = (next: Step) =>
    navigate({ search: stepSearch(next) }, { state: { fromStep: step } satisfies StepState })

  const goBack = (previous: Step) => {
    const state = location.state as StepState | null
    if (state?.fromStep === previous) navigate(-1)
    else navigate({ search: stepSearch(previous) }, { replace: true })
  }

  const addProduct = (product: Product) => {
    rememberProduct(product)
    changeLines((lines) => addSaleLine(lines, product.id))
  }

  const pickCustomer = (customer: PickedCustomer | 'none') => {
    update((current) => ({ ...current, customer }))
    goForward(3)
  }

  const cancel = () => {
    clear()
    setConfirmCancel(false)
    navigate('/')
  }

  const submit = () => {
    if (post.isPending) return
    setSaveError(null)
    post.mutate(saleBody(value, views), {
      onSuccess: (sale) => {
        clear()
        navigate(`/sell/done/${sale.id}`)
      },
      onError: (error) => {
        // The draft keeps its request_id: pressing the button again cannot post twice.
        if (hasErrorCode(error, SALE_REQUEST_CONFLICT)) {
          setSaveError(<RequestConflictAlert />)
          return
        }
        if (hasErrorCode(error, 'insufficient_stock')) {
          // Fresh stock for the warnings on step 1.
          void queryClient.invalidateQueries({ queryKey: ['product'] })
        }
        setSaveError(
          <Alert color="red" role="alert">
            {apiErrorText(error, t)}
          </Alert>,
        )
      },
    })
  }

  return (
    <PageContainer>
      <StepIndicator
        steps={STEP_LABELS.map((key) => t(key))}
        current={step}
        label={t('sell.steps.label')}
      />
      {draft.restored && (
        <DraftNotice
          text={t('sell.draftRestored')}
          onClear={() => {
            clear()
            navigate({ search: '' }, { replace: true })
          }}
          onClose={draft.dismissRestored}
        />
      )}

      {step === 1 && (
        <SellStepProducts
          draft={value}
          views={views}
          loadingLines={loadingLines}
          query={query}
          onQueryChange={setQuery}
          onAdd={addProduct}
          onChangeLines={changeLines}
          onNext={() => goForward(2)}
          onCancel={() => (value.lines.length > 0 ? setConfirmCancel(true) : cancel())}
        />
      )}
      {step === 2 && <SellStepCustomer onPick={pickCustomer} onBack={() => goBack(1)} />}
      {step === 3 && loadingLines && <PageLoader />}
      {step === 3 && !loadingLines && (
        <SellStepReview
          views={views}
          customer={value.customer}
          onBack={() => goBack(2)}
          onSubmit={submit}
          saving={post.isPending}
          error={saveError}
        />
      )}

      <CancelFlowModal
        opened={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancel}
        text={t('sell.cancelText')}
      />
    </PageContainer>
  )
}

/** /sell: a sale in three steps (docs/design/simple-ui.md, «Продажа»). */
export function SellPage() {
  const { data: me } = useMe()
  if (!me) return <PageLoader />
  return <SellFlow userId={me.id} />
}
