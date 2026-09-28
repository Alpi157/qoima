import i18n from 'i18next'

export const MOVEMENT_KINDS = [
  'receipt',
  'receipt_cancel',
  'sale',
  'sale_cancel',
  'adjustment',
] as const

export type MovementKind = (typeof MOVEMENT_KINDS)[number]

const MOVEMENT_KIND_LABELS = {
  receipt: 'products.movementKind.receipt',
  receipt_cancel: 'products.movementKind.receipt_cancel',
  sale: 'products.movementKind.sale',
  sale_cancel: 'products.movementKind.sale_cancel',
  adjustment: 'products.movementKind.adjustment',
} as const satisfies Record<MovementKind, string>

/** The API types `kind` as a plain string; an unknown value is shown as is. */
export function movementKindLabel(kind: string): string {
  const key = MOVEMENT_KIND_LABELS[kind as MovementKind]
  return key ? i18n.t(key) : kind
}

export const DOCUMENT_STATUSES = ['posted', 'cancelled'] as const

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

// Separate labels: a receipt ("приход") is masculine in Russian, a sale ("продажа") is feminine.
const RECEIPT_STATUS_LABELS = {
  posted: 'receipts.status.posted',
  cancelled: 'receipts.status.cancelled',
} as const satisfies Record<DocumentStatus, string>

const SALE_STATUS_LABELS = {
  posted: 'sales.status.posted',
  cancelled: 'sales.status.cancelled',
} as const satisfies Record<DocumentStatus, string>

export function receiptStatusLabel(status: string): string {
  const key = RECEIPT_STATUS_LABELS[status as DocumentStatus]
  return key ? i18n.t(key) : status
}

export function saleStatusLabel(status: string): string {
  const key = SALE_STATUS_LABELS[status as DocumentStatus]
  return key ? i18n.t(key) : status
}

/** Units offered in the product form, as the database stores them (always Russian). */
export const UNITS = ['шт', 'компл.', 'пара', 'л', 'кг', 'м', 'упак.'] as const

export type Unit = (typeof UNITS)[number]

const UNIT_LABELS = {
  шт: 'common.units.pcs',
  'компл.': 'common.units.set',
  пара: 'common.units.pair',
  л: 'common.units.liter',
  кг: 'common.units.kg',
  м: 'common.units.meter',
  'упак.': 'common.units.pack',
} as const satisfies Record<Unit, string>

/**
 * The unit in the interface language: "шт" -> "дана" in Kazakh. An unknown unit is shown
 * as is. The invoice shows the stored Russian unit and does not use this.
 */
export function unitLabel(unit: string): string {
  const key = UNIT_LABELS[unit as Unit]
  return key ? i18n.t(key) : unit
}
