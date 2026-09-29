import { describe, expect, it } from 'vitest'

// docs/design/design-system.md: sizes and gaps only from the scales. The theme maps Mantine's
// names to them (fz "sm"..."xl", gap "xs"..."xl"), so the page code needs no raw numbers.
// The invoice has its own print rules and is not checked.

const SOURCES = import.meta.glob<string>(
  [
    '../**/*.{ts,tsx}',
    '!../**/*.test.{ts,tsx}',
    '!../**/InvoicePrintPage*',
    '!../theme.ts',
    '!../api/schema.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
)
const SPACING = new Set([0, 4, 8, 12, 16, 24, 32, 48, 64])

interface Rule {
  name: string
  pattern: RegExp
  allowed?: (match: RegExpExecArray) => boolean
}

const RULES: Rule[] = [
  { name: 'font size as a number', pattern: /\bfz=\{\s*[\d{]/g },
  { name: 'font size in a style', pattern: /fontSize:\s*\d/g },
  {
    name: 'size outside sm/md/lg',
    pattern: /<(Button|TextInput|Select|NumberInput)\b[^>]*size="(xs|xl|compact-\w+)"/g,
  },
  { name: 'border width other than the system one', pattern: /borderWidth/g },
  {
    name: 'gap or padding off the spacing scale',
    pattern: /\b(gap|p|px|py|pt|pb|m|mt|mb|mx|my|spacing)=\{(\d+)\}/g,
    allowed: (match) => SPACING.has(Number(match[2])),
  },
]

describe('design scale', () => {
  it('page code uses only values of the design system', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    const problems: string[] = []
    for (const [file, text] of Object.entries(SOURCES)) {
      for (const rule of RULES) {
        for (const match of text.matchAll(rule.pattern)) {
          if (rule.allowed?.(match as RegExpExecArray)) continue
          const line = text.slice(0, match.index).split('\n').length
          problems.push(`${file}:${line} ${rule.name}: ${match[0]}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
