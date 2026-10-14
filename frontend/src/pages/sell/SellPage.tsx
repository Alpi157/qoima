import { isRequestConflict } from '../../components/flow/documentResultState'
import { Alert } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { hasErrorCode, type ApiError, isServerOrNetworkError } from '../../api/errors'
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
import { RequestConflictAlert, UnknownResult } from '../../components/flow/DocumentResult'
import { LineLoadNotice } from '../../components/flow/LineLoadNotice'
import { apiErrorText } from '../../i18n/errorText'
import { SellDonePage } from '../lazyPages'
import { type Product, useRememberProduct } from '../products/api'
import { usePostSale } from '../sales/api'
import {
  addSaleLine,
  createSaleDraft,
  isSaleDraftEmpty,
  parseSaleDraft,
  type PickedCustomer,
  saleBody,
  salePaymentError,
  type SaleDraftLine,
} from './saleDraft'
import { SellStepCustomer } from './SellStepCustomer'
import { SellStepProducts } from './SellStepProducts'
import { SellStepReview } from './SellStepReview'
import { saleTotals } from './saleTotals'

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
  const [checking, setChecking] = useState(false)
  const [conflict, setConflict] = useState<ApiError | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const previousStep = useRef<Step | null>(null)

  const changeLines = useCallback(
    (change: (lines: SaleDraftLine[]) => SaleDraftLine[]) => {
      update((current) => ({ ...current, lines: change(current.lines) }))
      setSaveError(null)
    },
    [update],
  )
  const dropMissing = useCallback(
    (ids: number[], products: Map<number, Product>) => {
      setRemoved((previous) => [
        ...new Set([
          ...previous,
          ...value.lines
            .filter((line) => ids.includes(line.productId))
            .map(
              (line) =>
                line.article ?? products.get(line.productId)?.article ?? t('common.notFoundShort'),
            ),
        ]),
      ])
      changeLines((lines) => lines.filter((line) => !ids.includes(line.productId)))
    },
    [changeLines, value.lines, t],
  )
  const {
    views,
    products,
    unresolved,
    incomplete,
    isPending: loadingLines,
    hasLoadError,
    reload,
  } = useLineProducts(value.lines, dropMissing)
  useEffect(() => {
    if (
      value.lines.some((line) => {
        const product = products.get(line.productId)
        return product && (line.article !== product.article || line.name !== product.name)
      })
    )
      update(
        (current) => ({
          ...current,
          lines: current.lines.map((line) => {
            const product = products.get(line.productId)
            return product ? { ...line, article: product.article, name: product.name } : line
          }),
        }),
        false,
      )
  }, [products, value.lines, update])

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

  useEffect(() => {
    if (previousStep.current !== null && previousStep.current !== step) draft.dismissRestored()
    previousStep.current = step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const addProduct = (product: Product) => {
    rememberProduct(product)
    changeLines((lines) =>
      addSaleLine(lines, product.id, { article: product.article, name: product.name }),
    )
  }

  const pickCustomer = (customer: PickedCustomer | 'none') => {
    update((current) => ({
      ...current,
      customer,
      payment:
        customer === 'none' ? { ...current.payment, mode: 'full', paid: '' } : current.payment,
    }))
    setSaveError(null)
    goForward(3)
  }

  const cancel = () => {
    clear()
    setConflict(null)
    setRemoved([])
    setConfirmCancel(false)
    navigate('/')
  }

  const submit = () => {
    if (
      incomplete ||
      value.lines.length === 0 ||
      post.isPending ||
      salePaymentError(value.payment, saleTotals(views).sum)
    )
      return
    setSaveError(null)
    setConflict(null)
    setChecking(value.unknown === true)
    update((current) => ({ ...current, unknown: true }))
    post.mutate(saleBody(value, views), {
      onSuccess: (sale) => {
        clear()
        navigate(`/sell/done/${sale.id}`)
      },
      onError: (error) => {
        // The draft keeps its request_id: pressing the button again cannot post twice.
        update((current) => ({ ...current, unknown: isServerOrNetworkError(error) }))
        if (isServerOrNetworkError(error)) return
        if (isRequestConflict(error)) {
          setConflict(error)
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
            setConflict(null)
            setRemoved([])
            navigate({ search: '' }, { replace: true })
          }}
          onClose={draft.dismissRestored}
        />
      )}

      <LineLoadNotice error={hasLoadError} reload={reload} removed={removed} />
      {step !== 3 && value.unknown && (!post.isPending || checking) && (
        <UnknownResult
          onRetry={submit}
          disabled={incomplete || value.customer === null || value.lines.length === 0}
        />
      )}
      {step === 1 && (
        <SellStepProducts
          draft={value}
          views={views}
          loadingLines={loadingLines}
          incomplete={incomplete}
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
          payment={value.payment}
          onPaymentChange={(payment) => {
            update((current) => ({ ...current, payment }))
            setSaveError(null)
          }}
          onBack={() => goBack(2)}
          onSubmit={submit}
          saving={post.isPending}
          error={
            <>
              {conflict && (
                <RequestConflictAlert
                  error={conflict}
                  onClear={() => {
                    clear()
                    setConflict(null)
                    setRemoved([])
                    navigate({ search: '' }, { replace: true })
                  }}
                />
              )}
              {value.unknown && (!post.isPending || checking) && (
                <UnknownResult
                  onRetry={submit}
                  busy={post.isPending}
                  disabled={incomplete || value.lines.length === 0}
                />
              )}
              {saveError}
            </>
          }
          incomplete={incomplete}
          unknown={value.unknown === true && (!post.isPending || checking)}
          unresolved={unresolved}
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
  useEffect(() => {
    void SellDonePage.preload().catch(console.error)
  }, [])
  const { data: me } = useMe()
  if (!me) return <PageLoader />
  return <SellFlow userId={me.id} />
}
