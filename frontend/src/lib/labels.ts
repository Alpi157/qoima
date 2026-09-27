export const MOVEMENT_KINDS = [
  'receipt',
  'receipt_cancel',
  'sale',
  'sale_cancel',
  'adjustment',
] as const

export type MovementKind = (typeof MOVEMENT_KINDS)[number]

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  receipt: 'Приход',
  receipt_cancel: 'Отмена прихода',
  sale: 'Продажа',
  sale_cancel: 'Отмена продажи',
  adjustment: 'Корректировка',
}

/** The API types `kind` as a plain string; an unknown value is shown as is. */
export function movementKindLabel(kind: string): string {
  return MOVEMENT_KIND_LABELS[kind as MovementKind] ?? kind
}

export const DOCUMENT_STATUSES = ['posted', 'cancelled'] as const

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

// A receipt ("приход") is masculine in Russian, a sale ("продажа") is feminine.
const RECEIPT_STATUS_LABELS: Record<DocumentStatus, string> = {
  posted: 'Проведён',
  cancelled: 'Отменён',
}

const SALE_STATUS_LABELS: Record<DocumentStatus, string> = {
  posted: 'Проведена',
  cancelled: 'Отменена',
}

export function receiptStatusLabel(status: string): string {
  return RECEIPT_STATUS_LABELS[status as DocumentStatus] ?? status
}

export function saleStatusLabel(status: string): string {
  return SALE_STATUS_LABELS[status as DocumentStatus] ?? status
}
