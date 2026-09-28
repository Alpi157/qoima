// Checks the translation keys: every key used in src/ exists in ru.json, ru.json has no
// unused keys. kk.json and zh.json have exactly the keys of ru.json, with the plural forms of
// their own language (Intl.PluralRules) and without invoice.* (the invoice is always Russian),
// and every text has the same {{variables}} and <tags> as the Russian one. Prints how much of
// kk and zh is filled. Usage: npm run i18n:check
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const LOCALES = join(SRC, 'i18n', 'locales')
const OTHER_LANGUAGES = ['kk', 'zh']
// Sections shown only in Russian, whatever the interface language.
const RUSSIAN_ONLY = ['invoice.']

// Top-level sections of ru.json; a string literal "section.x" in code is a key.
const SECTIONS = [
  'common',
  'nav',
  'auth',
  'products',
  'customers',
  'receipts',
  'sales',
  'settings',
  'errors',
  'validation',
  'invoice',
]
// i18next suffixes: plural forms and the context used for errors and validation variants.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

function readJson(name) {
  return JSON.parse(readFileSync(join(LOCALES, `${name}.json`), 'utf8'))
}

/** {"a": {"b": "x"}} -> Map {"a.b" => "x"} */
function flatten(tree, prefix = '', out = new Map()) {
  for (const [name, value] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${name}` : name
    if (value && typeof value === 'object') flatten(value, key, out)
    else out.set(key, value)
  }
  return out
}

function sourceFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path)
  }
  return files
}

const keyPattern = new RegExp(`^(${SECTIONS.join('|')})(\\.[A-Za-z0-9_]+)+$`)
// Start of a key built at run time: `errors.${code}` has the head "errors.".
const prefixPattern = new RegExp(`^(${SECTIONS.join('|')})(\\.[A-Za-z0-9_]+)*\\.$`)

/** Literal keys and dynamic prefixes (`errors.${code}` -> "errors.") used in the code. */
function usedKeys() {
  const literal = new Map()
  const dynamic = new Set()
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const where = relative(ROOT, file)
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (keyPattern.test(node.text) && !literal.has(node.text)) literal.set(node.text, where)
      } else if (ts.isTemplateExpression(node)) {
        if (prefixPattern.test(node.head.text)) dynamic.add(node.head.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { literal, dynamic }
}

/** "x_one", "x_few" -> "x"; "errors.duplicate_line_sale" stays (a context variant). */
function baseKey(key) {
  return key.replace(PLURAL_SUFFIX, '')
}

const ru = flatten(readJson('ru'))
const ruBaseKeys = new Set([...ru.keys()].map(baseKey))
const { literal, dynamic } = usedKeys()
const problems = []

for (const [key, where] of literal) {
  if (!ruBaseKeys.has(key)) problems.push(`missing in ru.json: ${key} (${where})`)
}

// errors.<code> is built from the backend's code: it must be a code from the OpenAPI schema
// (or a variant of one, errors.duplicate_line_sale), else it is a leftover.
const errorCodes = JSON.parse(readFileSync(join(ROOT, 'openapi.json'), 'utf8')).components.schemas
  .ErrorCode.enum
const isErrorCodeKey = (key) => {
  const name = key.slice('errors.'.length)
  return errorCodes.some((code) => name === code || name.startsWith(`${code}_`))
}

const isDynamic = (key) => [...dynamic].some((prefix) => key.startsWith(prefix))
for (const key of ru.keys()) {
  if (literal.has(baseKey(key))) continue
  if (!isDynamic(key)) problems.push(`unused in ru.json: ${key}`)
  else if (key.startsWith('errors.') && !isErrorCodeKey(key)) {
    problems.push(`not an error code in ru.json: ${key}`)
  }
}

for (const [key, value] of ru) {
  if (typeof value !== 'string' || value === '') problems.push(`empty text in ru.json: ${key}`)
}

/** Plural forms of a language: ru -> one, few, many, other; kk -> one, other; zh -> other. */
function pluralForms(language) {
  return new Intl.PluralRules(language).resolvedOptions().pluralCategories
}

/**
 * Base keys that have plural forms in ru.json: "common.found" for "common.found_other".
 * i18next always needs "_other", so "validation.qty_zero" without "validation.qty_other"
 * is a plain key.
 */
const pluralBases = new Set(
  [...ru.keys()]
    .filter((key) => key.endsWith('_other'))
    .map((key) => key.slice(0, -'_other'.length)),
)
const isPluralForm = (key) => PLURAL_SUFFIX.test(key) && pluralBases.has(baseKey(key))

/** The keys a language must have: plain ru keys plus the plural forms of that language. */
function expectedKeys(language) {
  const keys = []
  for (const key of ru.keys()) {
    if (!isPluralForm(key)) keys.push(key)
  }
  for (const base of pluralBases) {
    for (const form of pluralForms(language)) keys.push(`${base}_${form}`)
  }
  return keys
}

/** The Russian text a translated key is compared with: a plural form against ru's "other". */
function russianText(key) {
  return isPluralForm(key) ? ru.get(`${baseKey(key)}_other`) : ru.get(key)
}

/** "{{count}} <b>x</b>" -> "{{count}} <b> </b>": variables as a set, tags as a sorted list. */
function markup(text) {
  const variables = new Set(
    [...text.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((match) => `{{${match[1]}}}`),
  )
  const tags = [...text.matchAll(/<\/?[A-Za-z0-9]+\s*\/?>/g)].map((match) =>
    match[0].replace(/\s/g, ''),
  )
  return [...[...variables].sort(), ...tags.sort()].join(' ')
}

const ruExpected = new Set(expectedKeys('ru'))
for (const key of ru.keys()) {
  if (!ruExpected.has(key)) problems.push(`not a Russian plural form in ru.json: ${key}`)
}
for (const key of ruExpected) {
  if (!ru.has(key)) problems.push(`missing plural form in ru.json: ${key}`)
}

console.log(`ru: ${ru.size} keys`)
for (const language of OTHER_LANGUAGES) {
  const texts = flatten(readJson(language))
  const expected = expectedKeys(language).filter(
    (key) => !RUSSIAN_ONLY.some((prefix) => key.startsWith(prefix)),
  )
  const expectedSet = new Set(expected)
  for (const key of texts.keys()) {
    if (!expectedSet.has(key)) problems.push(`extra key in ${language}.json: ${key}`)
  }
  let filled = 0
  for (const key of expected) {
    const text = texts.get(key)
    if (typeof text !== 'string' || text === '') {
      problems.push(`missing in ${language}.json: ${key}`)
      continue
    }
    filled += 1
    const want = markup(russianText(key))
    const got = markup(text)
    if (got !== want) {
      problems.push(
        `other {{variables}} or <tags> in ${language}.json: ${key}: "${got}", ru "${want}"`,
      )
    }
  }
  const percent = expected.length ? Math.floor((filled / expected.length) * 100) : 100
  console.log(`${language}: ${filled} of ${expected.length} translated (${percent}%)`)
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
