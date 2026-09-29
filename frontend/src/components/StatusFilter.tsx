import { Input, SegmentedControl } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'

import { WIDE_SCREEN } from '../lib/breakpoints'

export interface StatusFilterProps {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}

/**
 * Document status filter with a visible label. On a phone the options stand one under another:
 * side by side the Kazakh labels («Күші жойылғандар») would break in the middle of a word.
 */
export function StatusFilter({ label, options, value, onChange }: StatusFilterProps) {
  const isWide = useMediaQuery(WIDE_SCREEN, true)
  return (
    <Input.Wrapper label={label} w={isWide ? undefined : '100%'}>
      <SegmentedControl
        aria-label={label}
        data={options}
        value={value}
        onChange={onChange}
        orientation={isWide ? 'horizontal' : 'vertical'}
        fullWidth={!isWide}
        styles={{
          root: { minHeight: 'var(--q-control-md)' },
          label: {
            whiteSpace: isWide ? 'nowrap' : 'normal',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          },
        }}
      />
    </Input.Wrapper>
  )
}
