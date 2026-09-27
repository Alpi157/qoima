const TIME_ZONE = 'Asia/Almaty'

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

/** "27.09.2026 14:30" in Asia/Almaty. Accepts an ISO string from the API or a Date. */
export function formatDateTime(value: string | Date): string {
  const p = localParts(value)
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`
}

/** "27.09.2026" in Asia/Almaty. */
export function formatDate(value: string | Date): string {
  const p = localParts(value)
  return `${p.day}.${p.month}.${p.year}`
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
