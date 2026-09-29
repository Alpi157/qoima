import { currentLanguage, type Language } from '../i18n/language'

const TIME_ZONE = 'Asia/Almaty'

// Splits a moment into Almaty calendar parts; the digits do not depend on the language.
const formatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

interface LocalParts {
  year: string
  month: string
  day: string
  hour: string
  minute: string
}

function localParts(value: string | Date): LocalParts {
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(value))) {
    parts[part.type] = part.value
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  }
}

/**
 * The date in Asia/Almaty in the language's own format: "27.09.2026" in Russian and Kazakh,
 * "2026/09/27" in Chinese. Accepts an ISO string from the API or a Date.
 *
 * Built from the calendar parts, not from the locale's pattern: browsers disagree on Kazakh
 * (Chromium's ICU gives "2026-09-27" for kk-KZ, Node gives "27.09.2026").
 */
export function formatDate(value: string | Date, language: Language = currentLanguage()): string {
  const p = localParts(value)
  return language === 'zh' ? `${p.year}/${p.month}/${p.day}` : `${p.day}.${p.month}.${p.year}`
}

/** formatDate plus the time: "27.09.2026 14:30". */
export function formatDateTime(
  value: string | Date,
  language: Language = currentLanguage(),
): string {
  const p = localParts(value)
  return `${formatDate(value, language)} ${p.hour}:${p.minute}`
}

/** Today's date in Asia/Almaty as "2026-09-27", regardless of the browser's time zone. */
export function todayLocal(now: Date = new Date()): string {
  const p = localParts(now)
  return `${p.year}-${p.month}-${p.day}`
}

/** The current Asia/Almaty time as "2026-09-27 14:30:00", the value format of Mantine date pickers. */
export function nowLocalInput(now: Date = new Date()): string {
  const p = localParts(now)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:00`
}

const LOCAL_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * "2026-09-27 14:30:00" read as Asia/Almaty time -> "2026-09-27T09:30:00.000Z".
 * The browser's own time zone does not matter. Malformed input -> null.
 */
export function localInputToIso(value: string): string | null {
  const match = LOCAL_INPUT_PATTERN.exec(value.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map((part) => Number(part ?? 0))
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  // How far Almaty is ahead of UTC at about that moment.
  const p = localParts(new Date(asUtc))
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  const offset = shown - (asUtc - second * 1000)
  return new Date(asUtc - offset).toISOString()
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A date from the address, "2026-09-27"; anything else is ignored instead of failing a list. */
export function dateParam(value: string | null): string {
  return value && DATE_PATTERN.test(value) ? value : ''
}

export type QuickRange = 'today' | 'week' | 'month'

/** "2026-09-27" -> the same calendar day as a UTC Date, for day arithmetic only. */
function calendarDay(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function dateString(day: Date): string {
  return day.toISOString().slice(0, 10)
}

/**
 * Period ending today in Asia/Almaty, as [from, to] in "2026-09-27" format:
 * today, the current week from Monday, or the current month from the 1st.
 */
export function quickRange(range: QuickRange, now: Date = new Date()): [string, string] {
  const today = todayLocal(now)
  const day = calendarDay(today)
  if (range === 'week') {
    // getUTCDay: Sunday is 0; step back to Monday.
    const sinceMonday = (day.getUTCDay() + 6) % 7
    day.setUTCDate(day.getUTCDate() - sinceMonday)
  } else if (range === 'month') {
    day.setUTCDate(1)
  }
  return [dateString(day), today]
}
