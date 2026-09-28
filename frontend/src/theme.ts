import {
  Badge,
  Button,
  createTheme,
  NavLink,
  PasswordInput,
  SegmentedControl,
  TextInput,
} from '@mantine/core'
import type { CSSProperties } from 'react'

// Mantine cuts badge and segmented control labels with an ellipsis. Kazakh labels are often
// longer than Russian ones ("Күші жойылғандар" for "Отменённые"), so on a phone such a label
// would lose its end: here it wraps to the next line instead, breaking a word only if it
// cannot fit.
const WRAPPING_LABEL: CSSProperties = {
  whiteSpace: 'normal',
  overflow: 'visible',
  overflowWrap: 'anywhere',
}

// Base text is 16px (Mantine's "md" = 1rem); inputs and buttons use "md" too, so the UI stays
// readable on a laptop and on a phone.
export const theme = createTheme({
  fontSizes: { md: '1rem' },
  components: {
    TextInput: TextInput.extend({ defaultProps: { size: 'md' } }),
    PasswordInput: PasswordInput.extend({ defaultProps: { size: 'md' } }),
    Button: Button.extend({ defaultProps: { size: 'md' } }),
    NavLink: NavLink.extend({
      styles: { label: { fontSize: 'var(--mantine-font-size-md)' } },
    }),
    Badge: Badge.extend({
      styles: {
        root: {
          height: 'auto',
          minHeight: 'var(--badge-height)',
          maxWidth: '100%',
          lineHeight: 1.3,
          paddingBlock: 2,
          flexShrink: 0,
        },
        label: { ...WRAPPING_LABEL, textAlign: 'center' },
      },
    }),
    SegmentedControl: SegmentedControl.extend({
      styles: { root: { maxWidth: '100%' }, label: WRAPPING_LABEL },
    }),
  },
})
