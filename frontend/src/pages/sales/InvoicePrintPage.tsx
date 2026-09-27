import './InvoicePrintPage.css'

import { Alert, Anchor, Box, Button, Group, Loader } from '@mantine/core'
import { useEffect, useRef } from 'react'
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

export const RETAIL_CUSTOMER = 'Розничный покупатель'

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
  return (
    <>
      <div className="z2-appendix">
        <div>Приложение 26</div>
        <div>к приказу Министра финансов</div>
        <div>Республики Казахстан</div>
        <div>20 декабря 2012 г. № 562</div>
      </div>
      <div className="z2-form-name">Форма З-2</div>

      <div className="z2-org">
        <span className="z2-bold">Организация (индивидуальный предприниматель)</span>
        <span className="z2-org-name">{settings.seller_name || '\u00a0'}</span>
        <span className="z2-bold">ИИН/БИН</span>
        <span className="z2-iin">{settings.seller_iin_bin || '\u00a0'}</span>
      </div>

      <table className="z2-table z2-doc-number">
        <thead>
          <tr>
            <th>Номер документа</th>
            <th>Дата составления</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{sale.number}</td>
            <td>{formatDate(sale.sold_at)}</td>
          </tr>
        </tbody>
      </table>

      <h1 className="z2-title">Накладная на отпуск запасов на сторону</h1>

      <table className="z2-table z2-parties">
        <thead>
          <tr>
            <th>Организация (индивидуальный предприниматель) - отправитель</th>
            <th>Организация (индивидуальный предприниматель) - получатель</th>
            <th>Ответственный за поставку (Ф.И.О.)</th>
            <th>Транспортная организация</th>
            <th>Товарно-транспортная накладная (номер, дата)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{settings.seller_name}</td>
            <td>{sale.customer?.name ?? RETAIL_CUSTOMER}</td>
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
  return (
    <table className="z2-table z2-items">
      <colgroup>
        <col style={{ width: '6%' }} />
        <col />
        <col style={{ width: '15%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '10%' }} />
        <col style={{ width: '12%' }} />
        <col style={{ width: '8%' }} />
      </colgroup>
      <thead>
        <tr>
          <th rowSpan={2}>Номер по порядку</th>
          <th rowSpan={2}>Наименование, характеристика</th>
          <th rowSpan={2}>Номенклатурный номер</th>
          <th rowSpan={2}>Единица измерения</th>
          <th colSpan={2}>Количество</th>
          <th rowSpan={2}>Цена за единицу, в тенге</th>
          <th rowSpan={2}>Сумма с НДС, в тенге</th>
          <th rowSpan={2}>Сумма НДС, в тенге</th>
        </tr>
        <tr>
          <th>подлежит отпуску</th>
          <th>отпущено</th>
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
          <td className="z2-center">Итого</td>
          <td className="z2-num">{formatInteger(totalQty)}</td>
          <td className="z2-num">{formatInteger(totalQty)}</td>
          <td className="z2-center">х</td>
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
  return (
    // Kept together, and after the totals when the page allows it.
    <div className="z2-footer">
      <div className="z2-in-words">
        <div>
          <div className="z2-bold">Всего отпущено количество запасов (прописью)</div>
          <div className="z2-words" data-testid="qty-in-words">
            {quantityInWords(totalQty)}
          </div>
        </div>
        <div>
          <div className="z2-bold">на сумму (прописью), в тенге</div>
          <div className="z2-words" data-testid="amount-in-words">
            {amountInWords(sale.total)}
          </div>
        </div>
      </div>

      <div className="z2-signatures">
        <div className="z2-signatures-col">
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">Отпуск разрешил</span>
            <SignField caption="должность" />
            <Slash />
            <SignField caption="подпись" className="z2-field-sm" />
            <Slash />
            <SignField caption="расшифровка подписи" />
          </div>
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">Главный бухгалтер</span>
            <SignField caption="подпись" className="z2-field-sm" />
            <Slash />
            <SignField
              caption="расшифровка подписи"
              value={settings.chief_accountant}
              testId="chief-accountant"
              className="z2-field-lg"
            />
          </div>
          <div className="z2-bold z2-stamp">М.П.</div>
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">Отпустил</span>
            <SignField caption="подпись" className="z2-field-sm" />
            <Slash />
            <SignField
              caption="расшифровка подписи"
              value={settings.released_by_name || sale.created_by_name}
              testId="released-by"
              className="z2-field-lg"
            />
          </div>
        </div>

        <div className="z2-signatures-col">
          <div className="z2-bold">По доверенности №_____ от «____»____________20 __ года</div>
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">выданной</span>
            <span className="z2-field z2-field-lg">
              <span className="z2-field-value">{'\u00a0'}</span>
            </span>
          </div>
          <div className="z2-blank-line" />
          <div className="z2-sign">
            <span className="z2-bold z2-sign-label">Запасы получил</span>
            <SignField caption="подпись" className="z2-field-sm" />
            <Slash />
            <SignField caption="расшифровка подписи" />
          </div>
        </div>
      </div>
    </div>
  )
}

function Invoice({ sale, settings }: { sale: Sale; settings: BusinessSettings }) {
  const totalQty = sale.lines.reduce((sum, line) => sum + line.qty, 0)
  return (
    <div className="invoice-sheet" data-testid="invoice">
      {sale.status === 'cancelled' && (
        <div className="invoice-cancelled" aria-label="Продажа отменена">
          ОТМЕНЕНА
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
          <Button onClick={() => window.print()}>Печать</Button>
          <Button variant="default" onClick={back}>
            Назад
          </Button>
        </Group>
        {!settings.seller_name && (
          <Alert color="yellow" variant="filled" c="black" data-testid="settings-warning">
            Заполните реквизиты в{' '}
            <Anchor component={Link} to="/settings" inherit c="black" fw={700} underline="always">
              настройках
            </Anchor>
          </Alert>
        )}
      </div>
      <Invoice sale={sale} settings={settings} />
    </div>
  )
}

function SaleNotFound() {
  return (
    <Box p="md">
      <NotFoundState title="Продажа не найдена" backTo="/sales" backLabel="К истории продаж" />
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
