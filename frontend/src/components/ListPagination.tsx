import { Group, Pagination } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import { pageCount, PAGE_SIZE } from '../lib/pagination'

const CONTROL_LABELS = {
  first: 'common.pagination.first',
  previous: 'common.pagination.previous',
  next: 'common.pagination.next',
  last: 'common.pagination.last',
} as const

export interface ListPaginationProps {
  total: number
  page: number
  onChange: (page: number) => void
}

/** Pages of 50 based on `total` from the API; hidden when everything fits on one page. */
export function ListPagination({ total, page, onChange }: ListPaginationProps) {
  const { t } = useTranslation()
  if (total <= PAGE_SIZE && page === 1) return null
  return (
    <Group justify="center">
      <Pagination
        total={pageCount(total)}
        value={page}
        onChange={onChange}
        getControlProps={(control) => ({ 'aria-label': t(CONTROL_LABELS[control]) })}
      />
    </Group>
  )
}
