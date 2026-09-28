import i18n, { type TFunction } from 'i18next'

import {
  type ErrorParams,
  type FieldError,
  isApiError,
  isServerOrNetworkError,
} from '../api/errors'

// Keys built from the backend's `code` and `type` are not known at compile time.
type DynamicT = (key: string, options?: Record<string, unknown>) => string

/** Codes whose `params.items` lists stock shortages ({article, available, requested}). */
const SHORTAGE_CODES = new Set(['insufficient_stock', 'receipt_cancel_blocked'])

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** Params ready for interpolation: lists of scalars become "1, 2, 3", other objects are dropped. */
function interpolationValues(params: ErrorParams, t: TFunction): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(params)) {
    if (isScalar(value)) values[name] = value
    else if (Array.isArray(value) && value.every(isScalar)) {
      values[name] = value.join(t('common.listSeparator'))
    }
  }
  return values
}

/** "OC-90: на остатке 2, требуется 5; W712: ..." from `params.items`. */
function shortageItems(params: ErrorParams, t: TFunction): string {
  const items = Array.isArray(params.items) ? params.items : []
  return items
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) =>
      t('errors.shortageItem', {
        article: String(item.article),
        available: Number(item.available),
        requested: Number(item.requested),
      }),
    )
    .join(t('errors.shortageSeparator'))
}

/**
 * Text of a failed request for the user, in the current language (or `t`'s language).
 * A backend error is translated by `code` and `params` from `errors.*`; without a translation
 * its `detail` is shown. The backend unreachable or failing: "server unavailable".
 */
export function apiErrorText(error: unknown, t: TFunction = i18n.t): string {
  if (!isApiError(error) || (isServerOrNetworkError(error) && !error.code)) {
    return t('errors.serverUnavailable')
  }
  const key = `errors.${error.code}`
  if (!error.code || !i18n.exists(key)) return error.detail

  const values = interpolationValues(error.params, t)
  if (SHORTAGE_CODES.has(error.code)) values.items = shortageItems(error.params, t)
  // "document" picks a variant: errors.duplicate_line_sale, falling back to the plain key.
  if (typeof values.document === 'string') values.context = values.document
  return (t as DynamicT)(key, values)
}

/**
 * Text of a field error from the validation `errors` list: `validation.<type>` with the limits
 * from `params`, else the backend's message. `field` ("lines.0.sold_at") picks a variant by
 * its last part: validation.date_in_future_sold_at, falling back to validation.date_in_future.
 */
export function fieldErrorText(error: FieldError, field = '', t: TFunction = i18n.t): string {
  const key = `validation.${error.type}`
  if (!error.type || !i18n.exists(key)) return error.message
  const context = field.split('.').pop()
  return (t as DynamicT)(key, { ...interpolationValues(error.params, t), context })
}
