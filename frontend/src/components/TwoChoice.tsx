import { Button, SimpleGrid, Stack, Text } from '@mantine/core'

interface Choice<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

/** Two equally sized, labelled choices, using the existing payment selection pattern. */
export function TwoChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  heading = false,
}: {
  label: string
  heading?: boolean
  value: T
  options: readonly [Choice<T>, Choice<T>]
  onChange: (value: T) => void
}) {
  return (
    <Stack gap="md">
      <Text
        fw={600}
        fz={heading ? 'var(--q-fz-h3)' : undefined}
        lh={heading ? 'var(--q-lh-h3)' : undefined}
      >
        {label}
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            key={option.value}
            variant={value === option.value ? 'light' : 'default'}
            color="blue"
            aria-pressed={value === option.value}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </SimpleGrid>
    </Stack>
  )
}
