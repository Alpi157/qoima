import { Button, createTheme, NavLink, PasswordInput, TextInput } from '@mantine/core'

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
  },
})
