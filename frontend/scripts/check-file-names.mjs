// Fails when a file or folder name contains a word that ad blockers cut from URLs (uBlock,
// AdBlock: EasyList and the lists against SEO spam). A blocked module breaks the lazy import of
// the whole page. A word counts when it is a separate part of the name (split on - _ . spaces
// and camelCase), in the plural too, or two neighbouring parts glued together (Back + Link).
// Parts of other words (header, loader, badge) are fine.
// Usage: node scripts/check-file-names.mjs src            (npm run names:check, in npm run lint)
//        node scripts/check-file-names.mjs --hashed dist  (after vite build: drops the -HASH)
import { readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BLOCKED_WORDS = [
  'ad',
  'ads',
  'advert',
  'banner',
  'backlink',
  'sponsor',
  'promo',
  'track',
  'tracking',
  'analytics',
  'pixel',
  'share',
  'social',
  'popup',
]

const BLOCKED = new Set(BLOCKED_WORDS.flatMap((word) => [word, `${word}s`]))

// Vite appends "-" and an 8-character hash that may itself contain "-" and "_".
const VITE_HASH = /-[A-Za-z0-9_-]{8}$/

function nameParts(name) {
  return name
    .split(/[^A-Za-z0-9]+/)
    .flatMap((chunk) => chunk.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+/g) ?? [])
    .map((part) => part.toLowerCase())
}

// A folder is checked by its whole name, a file without the extension (and the Vite hash).
function blockedWords(entry, hashed) {
  let stem = entry.name
  if (entry.isFile()) {
    stem = stem.replace(/\.[^.]*$/, '')
    if (hashed) stem = stem.replace(VITE_HASH, '')
  }
  const parts = nameParts(stem)
  const candidates = [...parts, ...parts.slice(1).map((part, i) => parts[i] + part)]
  return [...new Set(candidates.filter((candidate) => BLOCKED.has(candidate)))]
}

function walk(dir, found, hashed) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const words = blockedWords(entry, hashed)
    if (words.length > 0) found.push({ path, words })
    found.checked += 1
    if (entry.isDirectory()) walk(path, found, hashed)
  }
  return found
}

const args = process.argv.slice(2)
const hashed = args.includes('--hashed')
const dirs = args.filter((arg) => arg !== '--hashed')

const found = []
found.checked = 0
for (const dir of dirs.length > 0 ? dirs : ['src']) walk(join(ROOT, dir), found, hashed)

if (found.length > 0) {
  console.error('Names that ad blockers cut (see "Соглашения по коду" in CLAUDE.md):')
  for (const { path, words } of found) {
    console.error(`  ${relative(ROOT, path)}: ${words.join(', ')}`)
  }
  process.exit(1)
}
console.log(`File names: ok, ${found.checked} checked.`)
