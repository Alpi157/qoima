import {
  Anchor,
  Badge,
  Button,
  Card,
  createTheme,
  type CSSVariablesResolver,
  defaultVariantColorsResolver,
  type MantineColorsTuple,
  Menu,
  Modal,
  Paper,
  PasswordInput,
  SegmentedControl,
  TextInput,
  type VariantColorsResolver,
} from '@mantine/core'
import type { CSSProperties } from 'react'

// Colors of docs/design/simple-ui.md, section «Тема». Mantine fills buttons with shade 6 and
// hovers with shade 7.

/** Selling: filled #17703F, hover #125A33, light #E3F1E8, light border #9CCBAE, text #0F5530. */
const green: MantineColorsTuple = [
  '#E3F1E8',
  '#D2E9DA',
  '#9CCBAE',
  '#6BB186',
  '#3F9563',
  '#27814D',
  '#17703F',
  '#125A33',
  '#0F5530',
  '#0A3F23',
]

/** Receiving goods and the primary color: filled #1D5AA6, hover #174A89. */
const blue: MantineColorsTuple = [
  '#E7EFF9',
  '#CFDFF2',
  '#A4C2E6',
  '#76A2D8',
  '#4E86CA',
  '#3470BA',
  '#1D5AA6',
  '#174A89',
  '#123B6E',
  '#0D2C53',
]

/** Errors and «out of stock»: #A32020. */
const red: MantineColorsTuple = [
  '#FBEAEA',
  '#F5CFCF',
  '#EBA0A0',
  '#E07070',
  '#D24848',
  '#BD2F2F',
  '#A32020',
  '#8A1A1A',
  '#721515',
  '#5A1010',
]

/**
 * Neutrals: 1 is the page background, 3 card borders, 4 field borders (Mantine's input border),
 * 6 secondary text (Mantine's "dimmed"), 9 the text color.
 */
const gray: MantineColorsTuple = [
  '#F3F6F9',
  '#EEF1F4',
  '#E3E8ED',
  '#D5DCE3',
  '#AEB8C4',
  '#8A96A3',
  '#4A5663',
  '#3B4652',
  '#2A3440',
  '#16202A',
]

// Secondary buttons (variant "default"): white with a 1.5px #AEB8C4 outline
// (design-system.md, «Элементы управления»). Cards keep the light border.
const variantColorResolver: VariantColorsResolver = (input) => {
  const colors = defaultVariantColorsResolver(input)
  if (input.variant === 'default') {
    return { ...colors, border: '1.5px solid var(--mantine-color-gray-4)' }
  }
  return colors
}

/** Passed to MantineProvider next to the theme. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-default-border': 'var(--mantine-color-gray-3)',
    '--mantine-color-disabled': '#D5DCE3',
    '--mantine-color-disabled-color': '#3B4652',
    '--mantine-color-disabled-border': '#D5DCE3',
  },
  dark: {},
})

// Mantine cuts badge and segmented control labels with an ellipsis. Kazakh labels are often
// longer than Russian ones ("Күші жойылғандар" for "Отменённые"), so on a phone such a label
// would lose its end: here it wraps to the next line instead, breaking a word only if it
// cannot fit.
const WRAPPING_LABEL: CSSProperties = {
  whiteSpace: 'normal',
  overflow: 'visible',
  overflowWrap: 'anywhere',
}

const FONT_FAMILY =
  "'Qoima Tenge', 'Fira Sans', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"

// Scales of docs/design/design-system.md; styles/global.css holds the same values as CSS
// variables. Mantine's names map to the design tokens:
//   font sizes: xs and sm caption 16, md body 18, lg lead 20, xl h3 22;
//   spacing: xs 8, sm 12, md 16, lg 24, xl 32 (48 and 64 as numbers);
//   controls: sm 44, md 56, lg 64 high (heights in global.css).
export const theme = createTheme({
  fontFamily: FONT_FAMILY,
  headings: {
    fontFamily: FONT_FAMILY,
    fontWeight: '700',
    sizes: {
      h1: { fontSize: '34px', lineHeight: '1.2', fontWeight: '700' },
      h2: { fontSize: '28px', lineHeight: '1.25', fontWeight: '700' },
      h3: { fontSize: '22px', lineHeight: '1.3', fontWeight: '600' },
      h4: { fontSize: '18px', lineHeight: '1.5', fontWeight: '600' },
      h5: { fontSize: '18px', lineHeight: '1.5', fontWeight: '600' },
      h6: { fontSize: '18px', lineHeight: '1.5', fontWeight: '600' },
    },
  },
  black: '#16202A',
  colors: { green, blue, red, gray },
  primaryColor: 'blue',
  primaryShade: 6,
  fontSizes: { xs: '16px', sm: '16px', md: '18px', lg: '20px', xl: '22px' },
  lineHeights: { xs: '1.45', sm: '1.45', md: '1.5', lg: '1.45', xl: '1.3' },
  spacing: { xs: '8px', sm: '12px', md: '16px', lg: '24px', xl: '32px' },
  radius: { xs: '8px', sm: '8px', md: '10px', lg: '12px', xl: '16px' },
  defaultRadius: 'md',
  shadows: { xs: 'none', sm: 'none', md: 'none', lg: 'none', xl: 'none' },
  respectReducedMotion: true,
  variantColorResolver,
  components: {
    TextInput: TextInput.extend({ defaultProps: { size: 'md' } }),
    PasswordInput: PasswordInput.extend({ defaultProps: { size: 'md' } }),
    // By name, not Component.extend(): importing these here would pull them (and Mantine
    // dates) from the pages' chunks into the main one.
    NumberInput: { defaultProps: { size: 'md' } },
    Select: { defaultProps: { size: 'md' } },
    Textarea: { defaultProps: { size: 'md' } },
    DatePickerInput: { defaultProps: { size: 'md' } },
    DateTimePicker: { defaultProps: { size: 'md' } },
    Button: Button.extend({
      defaultProps: { size: 'md' },
      styles: { root: { fontWeight: 600 } },
    }),
    Anchor: Anchor.extend({ defaultProps: { c: 'blue.6' } }),
    // Cards: white, 1px #D5DCE3 border, radius 12, 24 inside, no shadow.
    Card: Card.extend({ defaultProps: { withBorder: true, radius: 'lg', padding: 'lg' } }),
    Paper: Paper.extend({ defaultProps: { withBorder: true, radius: 'lg' } }),
    Modal: Modal.extend({
      defaultProps: {
        size: 'lg',
        radius: 'lg',
        padding: 'lg',
        transitionProps: { duration: 180 },
      },
      styles: { title: { fontSize: '22px', lineHeight: 1.3, fontWeight: 600 } },
    }),
    Menu: Menu.extend({ defaultProps: { transitionProps: { duration: 120 } } }),
    Badge: Badge.extend({
      styles: {
        root: {
          height: 'auto',
          minHeight: 'var(--badge-height)',
          maxWidth: '100%',
          lineHeight: 1.3,
          flexShrink: 0,
        },
        label: { ...WRAPPING_LABEL, textAlign: 'center' },
      },
    }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { size: 'md' },
      styles: { root: { maxWidth: '100%' }, label: WRAPPING_LABEL },
    }),
  },
})
