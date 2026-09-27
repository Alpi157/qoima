import { Group, Pagination } from '@mantine/core'

import { pageCount, PAGE_SIZE } from '../lib/pagination'

const CONTROL_LABELS = {
  first: 'Первая страница',
  previous: 'Предыдущая страница',
  next: 'Следующая страница',
  last: 'Последняя страница',
}

export interface ListPaginationProps {
  total: number
  page: number
  onChange: (page: number) => void
}

/** Pages of 50 based on `total` from the API; hidden when everything fits on one page. */
export function ListPagination({ total, page, onChange }: ListPaginationProps) {
  if (total <= PAGE_SIZE && page === 1) return null
  return (
    <Group justify="center">
      <Pagination
        total={pageCount(total)}
        value={page}
        onChange={onChange}
        getControlProps={(control) => ({ 'aria-label': CONTROL_LABELS[control] })}
      />
    </Group>
  )
}
