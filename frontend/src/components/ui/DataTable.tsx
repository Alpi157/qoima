import { Anchor, Card as MantineCard, Stack, Table } from '@mantine/core'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Card } from './Card'

export interface DataTableColumn<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Numbers and sums: right edge, no wrapping. */
  numeric?: boolean
  nowrap?: boolean
}

export interface DataTableProps<T> {
  rows: T[]
  rowKey: (row: T) => string | number
  columns: DataTableColumn<T>[]
  /** Clickable rows open this address (the first cell should hold a real link too). */
  rowHref?: (row: T) => string
  /** Grey rows: cancelled documents, hidden products. */
  dimmed?: (row: T) => boolean
  /** Content of a card per row on a phone; without it the table scrolls sideways. */
  mobileCard?: (row: T) => ReactNode
  /** Below this width the table scrolls inside its card instead of squeezing the columns. */
  minWidth?: number
  /** Last row under the lines, e.g. the total. */
  footer?: ReactNode
}

/**
 * The link in the first cell of a clickable row: a real link, so the row opens from the keyboard
 * and in a new tab. Stops the click, so the row does not navigate a second time.
 */
export function RowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Anchor component={Link} to={to} fw={600} onClick={(event) => event.stopPropagation()}>
      {children}
    </Anchor>
  )
}

/** A table inside a card: caption header on #F3F6F9, rows 56 high, sums on the right. */
export function DataTable<T>({
  rows,
  rowKey,
  columns,
  rowHref,
  dimmed,
  mobileCard,
  minWidth = 600,
  footer,
}: DataTableProps<T>) {
  const navigate = useNavigate()

  return (
    <>
      <Card padding={0} visibleFrom={mobileCard ? 'sm' : undefined}>
        <Table.ScrollContainer minWidth={minWidth} type="native">
          <Table className="q-table" highlightOnHover={Boolean(rowHref)} withRowBorders>
            <Table.Thead>
              <Table.Tr>
                {columns.map((column) => (
                  <Table.Th key={column.key} data-numeric={column.numeric || undefined}>
                    {column.header}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => {
                const href = rowHref?.(row)
                return (
                  <Table.Tr
                    key={rowKey(row)}
                    data-clickable={href ? true : undefined}
                    data-dimmed={dimmed?.(row) || undefined}
                    onClick={href ? () => navigate(href) : undefined}
                  >
                    {columns.map((column) => (
                      <Table.Td
                        key={column.key}
                        data-numeric={column.numeric || undefined}
                        data-nowrap={column.nowrap || undefined}
                      >
                        {column.cell(row)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
            {footer && <Table.Tfoot>{footer}</Table.Tfoot>}
          </Table>
        </Table.ScrollContainer>
      </Card>

      {mobileCard && (
        <Stack gap="md" hiddenFrom="sm">
          {rows.map((row) => {
            const href = rowHref?.(row)
            const content = mobileCard(row)
            return href ? (
              <MantineCard
                key={rowKey(row)}
                component={Link}
                to={href}
                c={dimmed?.(row) ? 'dimmed' : 'inherit'}
                style={{ textDecoration: 'none' }}
              >
                {content}
              </MantineCard>
            ) : (
              <Card key={rowKey(row)} c={dimmed?.(row) ? 'dimmed' : undefined}>
                {content}
              </Card>
            )
          })}
        </Stack>
      )}
    </>
  )
}
