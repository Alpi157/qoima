import i18n from 'i18next'

import { localInputToIso } from '../../lib/dates'
import { parseMoney, validateMoneyText } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import type { ReceiptCreate } from '../receipts/api'

export interface ReceiptDraftLine {
  productId: number
  /** A number, or '' while the field is empty. */
  qty: number | string
  /** Purchase price as typed in «Қосымша»; '' when not given. */
  cost: string
}

/** The unfinished receiving kept in localStorage (simple-ui.md, «Черновики»). */
export interface ReceiptDraft {
  version: 1
  lines: ReceiptDraftLine[]
  supplier: string
  note: string
  /** Local date and time from the picker; null: the server takes the moment of saving. */
  receivedAt: string | null
  /** «Қосымша» is open. */
  extrasOpen: boolean
}

export function createReceiptDraft(): ReceiptDraft {
  return { version: 1, lines: [], supplier: '', note: '', receivedAt: null, extrasOpen: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseLine(value: unknown): ReceiptDraftLine | null {
  if (!isRecord(value) || typeof value.productId !== 'number') return null
  const qty = typeof value.qty === 'number' || typeof value.qty === 'string' ? value.qty : 1
  return { productId: value.productId, qty, cost: text(value.cost) }
}

export function parseReceiptDraft(raw: unknown): ReceiptDraft | null {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.lines)) return null
  return {
    version: 1,
    lines: raw.lines.map(parseLine).filter((line) => line !== null),
    supplier: text(raw.supplier),
    note: text(raw.note),
    receivedAt: typeof raw.receivedAt === 'string' ? raw.receivedAt : null,
    extrasOpen: raw.extrasOpen === true,
  }
}

export function isReceiptDraftEmpty(draft: ReceiptDraft): boolean {
  return draft.lines.length === 0
}

/** Adding a product that is already a line raises its quantity. */
export function addReceiptLine(lines: ReceiptDraftLine[], productId: number): ReceiptDraftLine[] {
  const existing = lines.find((line) => line.productId === productId)
  if (!existing) return [...lines, { productId, qty: 1, cost: '' }]
  return lines.map((line) =>
    line === existing ? { ...line, qty: typeof line.qty === 'number' ? line.qty + 1 : 1 } : line,
  )
}

/** What to fix in the line, in the current language; null when it is fine. */
export function receiptLineWarning(line: ReceiptDraftLine): string | null {
  if (qtyError(line.qty) !== null) return i18n.t('flow.warn.qty')
  if (validateMoneyText(line.cost) !== null) return i18n.t('receive.warn.cost')
  return null
}

/** Request body: optional fields only when filled in; no date means «now» on the server. */
export function receiptBody(draft: ReceiptDraft): ReceiptCreate {
  const receivedAt = draft.receivedAt === null ? null : localInputToIso(draft.receivedAt)
  return {
    supplier: draft.supplier.trim() || null,
    note: draft.note.trim() || null,
    ...(receivedAt !== null ? { received_at: receivedAt } : {}),
    lines: draft.lines.map((line) => {
      const cost = parseMoney(line.cost)
      return {
        product_id: line.productId,
        qty: line.qty as number,
        ...(cost !== null ? { unit_cost: cost } : {}),
      }
    }),
  }
}
