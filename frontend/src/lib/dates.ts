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
