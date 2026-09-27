const TIYN_PER_TENGE = 100

const UNITS_MASCULINE = [
  '',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
]
const UNITS_FEMININE = ['', 'одна', 'две', ...UNITS_MASCULINE.slice(3)]
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
]
const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
]
const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
]

interface Scale {
  /** Forms for 1, 2-4 and 5-20: тысяча / тысячи / тысяч. */
  forms: [string, string, string]
  feminine: boolean
}

// Index = power of a thousand. Units (index 0) have no word: "тенге" follows the whole number.
const SCALES: Scale[] = [
  { forms: ['', '', ''], feminine: false },
  { forms: ['тысяча', 'тысячи', 'тысяч'], feminine: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], feminine: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], feminine: false },
  { forms: ['триллион', 'триллиона', 'триллионов'], feminine: false },
]

/** Russian plural form for a count: 1, 21 -> 0; 2-4, 22 -> 1; 5-20, 11-14 -> 2. */
function pluralIndex(n: number): 0 | 1 | 2 {
  const lastTwo = n % 100
  const last = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 2
  if (last === 1) return 0
  if (last >= 2 && last <= 4) return 1
  return 2
}

/** 0 < n < 1000 in words. */
function tripletWords(n: number, feminine: boolean): string[] {
  const words = [HUNDREDS[Math.floor(n / 100)]]
  const rest = n % 100
  if (rest >= 10 && rest < 20) {
    words.push(TEENS[rest - 10])
  } else {
    words.push(TENS[Math.floor(rest / 10)])
    words.push((feminine ? UNITS_FEMININE : UNITS_MASCULINE)[rest % 10])
  }
  return words.filter(Boolean)
}

/** A whole non-negative number in words, masculine: 21 -> "двадцать один". */
function numberWords(value: number): string {
  if (value === 0) return 'ноль'
  const words: string[] = []
  let rest = value
  for (let power = 0; rest > 0; power++) {
    const triplet = rest % 1000
    rest = Math.floor(rest / 1000)
    if (triplet === 0) continue
    const scale = SCALES[power]
    if (scale === undefined) throw new RangeError(`Слишком большое число: ${value}`)
    const part = tripletWords(triplet, scale.feminine)
    const scaleWord = scale.forms[pluralIndex(triplet)]
    if (scaleWord) part.push(scaleWord)
    words.unshift(...part)
  }
  return words.join(' ')
}

function checkWhole(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Некорректное число: ${value}`)
  }
}

/**
 * Amount in tiyn -> "двести пятьдесят четыре тысячи теңге 00 тиын", as on form З-2.
 * Negative or fractional amounts are a programming error.
 */
export function amountInWords(tiyn: number): string {
  checkWhole(tiyn)
  const tenge = Math.floor(tiyn / TIYN_PER_TENGE)
  const rest = String(tiyn % TIYN_PER_TENGE).padStart(2, '0')
  return `${numberWords(tenge)} теңге ${rest} тиын`
}

/** Quantity in words without a unit: 190 -> "сто девяносто", 1000 -> "одна тысяча". */
export function quantityInWords(qty: number): string {
  checkWhole(qty)
  return numberWords(qty)
}
