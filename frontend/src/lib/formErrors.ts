import { isApiError } from '../api/errors'
import { apiErrorText, fieldErrorText } from '../i18n/errorText'

export interface ServerFormErrors {
  /** Form field -> message, ready for `form.setErrors`. */
  fields: Record<string, string>
  /** Message for the form as a whole, or null. */
  message: string | null
}

export interface ServerFormErrorOptions {
  /** API field name -> form field name, for fields the form knows about. */
  fieldMap: Record<string, string>
  /** Form field that a 409 conflict belongs to (for example a duplicate article). */
  conflictField?: string
}

/**
 * Splits a failed save into messages under fields and a message for the whole form,
 * in the current language. 5xx and network errors return nothing: the global notification
 * already shows them.
 */
export function serverFormErrors(
  error: unknown,
  options: ServerFormErrorOptions,
): ServerFormErrors {
  const result: ServerFormErrors = { fields: {}, message: null }
  if (!isApiError(error) || error.status === 0 || error.status >= 500) return result

  if (error.status === 409 && options.conflictField) {
    result.fields[options.conflictField] = apiErrorText(error)
    return result
  }

  let unmapped = false
  for (const [apiField, fieldError] of Object.entries(error.fieldErrors)) {
    const formField = options.fieldMap[apiField]
    if (formField) result.fields[formField] = fieldErrorText(fieldError, apiField)
    else unmapped = true
  }
  if (unmapped || Object.keys(result.fields).length === 0) result.message = apiErrorText(error)
  return result
}
