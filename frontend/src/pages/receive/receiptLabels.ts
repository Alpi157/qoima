import type { ExpenseKind } from './receiptDraft'

export const EXPENSE_KINDS: ExpenseKind[] = [
  'delivery',
  'customs_duty',
  'import_vat',
  'broker',
  'bank',
  'other',
  'antidumping_duty',
]
export const METHOD_KEYS = {
  amount: 'receive.expenses.amountMethod',
  quantity: 'receive.expenses.quantityMethod',
  selected: 'receive.expenses.selectedMethod',
  manual: 'receive.expenses.manualMethod',
} as const
