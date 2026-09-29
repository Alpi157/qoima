import { Button, Group, Input } from '@mantine/core'

export interface StatusFilterProps {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

/**
 * Document status filter with a visible label: one sm button per option, the chosen one filled
 * blue. When the row does not fit (Kazakh labels on a phone) the buttons wrap to the next line.
 */
export function StatusFilter({ label, options, value, onChange }: StatusFilterProps) {
  return (
    <Input.Wrapper label={label} component="div">
      <Group gap="xs" wrap="wrap" role="group" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value
          return (
            <Button
              key={option.value}
              size="sm"
              variant={selected ? 'filled' : 'default'}
              color="blue"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          )
        })}
      </Group>
    </Input.Wrapper>
  )
}
