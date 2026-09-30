import './InvoicePrintPage.css'

import { Alert, Anchor, Box, Button, Group, Loader } from '@mantine/core'
import i18n from 'i18next'
import { useEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { NotFoundState } from '../../components/NotFoundState'
import { QueryError } from '../../components/QueryError'
import { amountInWords, quantityInWords } from '../../lib/amountInWords'
import { formatDate } from '../../lib/dates'
import { formatAmount, formatInteger } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { type BusinessSettings, useBusinessSettings } from '../settings/api'
import { type Sale, useSale } from './api'

// The invoice is a legal form: always in Russian, whatever the interface language.
const INVOICE_LANGUAGE = 'ru'

function invoiceT() {
  return i18n.getFixedT(INVOICE_LANGUAGE)
}

type SaleLineOut = Sale['lines'][number]

interface SignFieldProps {
  caption: string
  value?: string
  className?: string
  testId?: string
}

/** A signature line with its small caption underneath («подпись», «расшифровка подписи»). */
function SignField({ caption, value, className = 'z2-field-md', testId }: SignFieldProps) {
  return (
    <span className={`z2-field ${className}`}>
      <span className="z2-field-value" data-testid={testId}>
        {value || '\u00a0'}
      </span>
      <span className="z2-caption">{caption}</span>
    </span>
  )
}

function Slash() {
  return <span className="z2-slash">/</span>
}

function Header({ sale, settings }: { sale: Sale; settings: BusinessSettings }) {
  const t = invoiceT()
  return (
    <>
      <div className="z2-appendix">
        <div>{t('invoice.appendix.line1')}</div>
        <div>{t('invoice.appendix.line2')}</div>
        <div>{t('invoice.appendix.line3')}</div>
        <div>{t('invoice.appendix.line4')}</div>
      </div>
      <div className="z2-form-name">{t('invoice.formName')}</div>

      <div className="z2-org">
        <span className="z2-bold">{t('invoice.organization')}</span>
        <span className="z2-org-name">{settings.seller_name || '\u00a0'}</span>
        <span className="z2-bold">{t('invoice.iinBin')}</span>
        <span className="z2-iin">{settings.seller_iin_bin || '\u00a0'}</span>
      </div>

      <table className="z2-table z2-doc-number">
        <thead>
          <tr>
            <th>{t('invoice.documentNumber')}</th>
            <th>{t('invoice.documentDate')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{sale.number}</td>
            <td>{formatDate(sale.sold_at, INVOICE_LANGUAGE)}</td>
          </tr>
        </tbody>
      </table>

      <h1 className="z2-title">{t('invoice.title')}</h1>

      <table className="z2-table z2-parties">
        <thead>
          <tr>
            <th>{t('invoice.sender')}</th>
            <th>{t('invoice.receiver')}</th>
            <th>{t('invoice.responsiblePerson')}</th>
            <th>{t('invoice.carrier')}</th>
            <th>{t('invoice.waybill')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{settings.seller_name}</td>
            <td>{sale.customer?.name ?? t('invoice.retailCustomer')}</td>
            <td>{settings.responsible_person}</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </>
  )
}

function ItemsTable({
  lines,
  total,
  totalQty,
}: {
  lines: SaleLineOut[]
  total: number
  totalQty: number
}) {
  const t = invoiceT()
  return (
    <table className="z2-table z2-items">
      <colgroup>
        <col style={{ width: '6%' }} />
        <col />
        <col style={{ width: '20%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '10%' }} />
        <col style={{ width: '12%' }} />
        <col style={{ width: '8%' }} />
      </colgroup>
      <thead>
        <tr>
          <th rowSpan={2}>{t('invoice.items.index')}</th>
          <th rowSpan={2}>{t('invoice.items.name')}</th>
          <th rowSpan={2}>{t('invoice.items.article')}</th>
          <th rowSpan={2}>{t('invoice.items.unit')}</th>
          <th colSpan={2}>{t('invoice.items.qty')}</th>
          <th rowSpan={2}>{t('invoice.items.price')}</th>
          <th rowSpan={2}>{t('invoice.items.sum')}</th>
          <th rowSpan={2}>{t('invoice.items.vat')}</th>
        </tr>
        <tr>
          <th>{t('invoice.items.qtyToRelease')}</th>
          <th>{t('invoice.items.qtyReleased')}</th>
        </tr>
        <tr className="z2-column-numbers">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <th key={n}>{n}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={line.product_id}>
            <td className="z2-center">{index + 1}</td>
            <td>{line.name}</td>
            <td className="z2-article">{line.article}</td>
            <td className="z2-center">{line.unit}</td>
            <td className="z2-num">{formatInteger(line.qty)}</td>
            <td className="z2-num">{formatInteger(line.qty)}</td>
            <td className="z2-num">{formatAmount(line.unit_price)}</td>
            <td className="z2-num">{formatAmount(line.line_total)}</td>
            <td className="z2-num">0</td>
          </tr>
        ))}
        <tr className="z2-total-row" data-testid="invoice-total-row">
          <td className="z2-no-border" colSpan={3} />
          <td className="z2-center">{t('invoice.items.total')}</td>
          <td className="z2-num">{formatInteger(totalQty)}</td>
          <td className="z2-num">{formatInteger(totalQty)}</td>
          <td className="z2-center">{t('invoice.items.noValue')}</td>
          <td className="z2-num">{formatAmount(total)}</td>
          <td className="z2-num">0</td>
        </tr>
      </tbody>
    </table>
  )
}

function Footer({
  sale,
  settings,
  totalQty,
}: {
  sale: Sale
  settings: BusinessSettings
  totalQty: number
}) {
  const t = invoiceT()
  return (
    // Kept together, and after the totals when the page allows it.
    <div className="z2-footer">
      <div className="z2-in-words">
        <div>
          <div className="z2-bold">{t('invoice.qtyInWords')}</div>
          <div className="z2-words" data-testid="qty-in-words">
            {quantityInWords(totalQty)}
          </div>
        </div>
        <div>
          <div className="z2-bold">{t('invoice.amountInWords')}</div>
          <div className="z2-words" data-testid="amount-in-words">
            {amountInWords(sale.total)}
          </div>
        </div>
      </div>

      <div className="z2-signatures">
        <div className="z2-signatures-col">
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">{t('invoice.sign.allowed')}</span>
            <SignField caption={t('invoice.sign.position')} />
            <Slash />
            <SignField caption={t('invoice.sign.signature')} className="z2-field-sm" />
            <Slash />
            <SignField caption={t('invoice.sign.transcript')} />
          </div>
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">{t('invoice.sign.chiefAccountant')}</span>
            <SignField caption={t('invoice.sign.signature')} className="z2-field-sm" />
            <Slash />
            <SignField
              caption={t('invoice.sign.transcript')}
              value={settings.chief_accountant}
              testId="chief-accountant"
              className="z2-field-lg"
            />
          </div>
          <div className="z2-bold z2-stamp">{t('invoice.sign.stamp')}</div>
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">{t('invoice.sign.released')}</span>
            <SignField caption={t('invoice.sign.signature')} className="z2-field-sm" />
            <Slash />
            <SignField
              caption={t('invoice.sign.transcript')}
              value={settings.released_by_name || sale.created_by_name}
              testId="released-by"
              className="z2-field-lg"
            />
          </div>
        </div>

        <div className="z2-signatures-col">
          <div className="z2-bold">{t('invoice.sign.powerOfAttorney')}</div>
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">{t('invoice.sign.issuedTo')}</span>
            <span className="z2-field z2-field-lg">
              <span className="z2-field-value">{'\u00a0'}</span>
            </span>
          </div>
          <div className="z2-blank-line" />
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">{t('invoice.sign.received')}</span>
            <SignField caption={t('invoice.sign.signature')} className="z2-field-sm" />
            <Slash />
            <SignField caption={t('invoice.sign.transcript')} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Invoice({ sale, settings }: { sale: Sale; settings: BusinessSettings }) {
  const t = invoiceT()
  const totalQty = sale.lines.reduce((sum, line) => sum + line.qty, 0)
  return (
    <div className="invoice-sheet" data-testid="invoice" lang={INVOICE_LANGUAGE}>
      {sale.status === 'cancelled' && (
        <div className="invoice-cancelled" aria-label={t('invoice.cancelledLabel')}>
          {t('invoice.cancelledStamp')}
        </div>
      )}
      <Header sale={sale} settings={settings} />
      <ItemsTable lines={sale.lines} total={sale.total} totalQty={totalQty} />
      <Footer sale={sale} settings={settings} totalQty={totalQty} />
    </div>
  )
}

function InvoiceScreen({ sale, settings }: { sale: Sale; settings: BusinessSettings }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const printed = useRef(false)
  const autoPrint = searchParams.get('auto') === '1'
  const { t } = useTranslation()

  useEffect(() => {
    if (!autoPrint || printed.current) return
    printed.current = true
    window.print()
    // A reload of the page should not print again.
    setSearchParams({}, { replace: true })
  }, [autoPrint, setSearchParams])

  const back = () => {
    // The first page of the tab has the "default" key: there is nowhere to go back to.
    if (location.key !== 'default') navigate(-1)
    else navigate(`/sales/${sale.id}`)
  }

  return (
    <div className="invoice-screen">
      <div className="invoice-toolbar no-print">
        <Group mb="sm">
          <Button onClick={() => window.print()}>{t('sales.print.print')}</Button>
          <Button variant="default" onClick={back}>
            {t('sales.print.back')}
          </Button>
        </Group>
        {!settings.seller_name && (
          <Alert color="yellow" variant="filled" c="black" data-testid="settings-warning">
            <Trans
              i18nKey="sales.print.fillSettings"
              components={{
                settings: (
                  <Anchor
                    component={Link}
                    to="/settings"
                    inherit
                    c="black"
                    fw={700}
                    underline="always"
                  />
                ),
              }}
            />
          </Alert>
        )}
      </div>
      <Invoice sale={sale} settings={settings} />
    </div>
  )
}

function SaleNotFound() {
  const { t } = useTranslation()
  return (
    <Box p="md">
      <NotFoundState
        title={t('sales.notFound')}
        back={{ to: '/sales', label: t('sales.card.back') }}
      />
    </Box>
  )
}

function InvoiceLoader({ id }: { id: number }) {
  const sale = useSale(id)
  const settings = useBusinessSettings()

  if (sale.isError && isApiError(sale.error) && sale.error.status === 404) return <SaleNotFound />
  if (sale.isSuccess && settings.isSuccess) {
    return <InvoiceScreen sale={sale.data} settings={settings.data} />
  }
  // Outside the app layout: the loading and error states need their own padding.
  return (
    <Box p="md">
      {sale.isError ? (
        <QueryError error={sale.error} onRetry={() => sale.refetch()} />
      ) : settings.isError ? (
        <QueryError error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <Loader />
      )}
    </Box>
  )
}

/** Page outside the app layout: nothing but the invoice, ready to print. */
export function InvoicePrintPage() {
  const id = parseId(useParams().id)
  if (id === null) return <SaleNotFound />
  return <InvoiceLoader key={id} id={id} />
}
