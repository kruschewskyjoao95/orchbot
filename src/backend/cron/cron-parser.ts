export const CRON_PRESETS: Record<string, string> = {
  '@every_minute': '* * * * *',
  '@every_5_minutes': '*/5 * * * *',
  '@every_10_minutes': '*/10 * * * *',
  '@every_15_minutes': '*/15 * * * *',
  '@every_30_minutes': '*/30 * * * *',
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@morning_9am': '0 9 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
}

export function normalizeCronExpression(expression: string): string {
  const trimmed = expression.trim().toLowerCase()
  if (CRON_PRESETS[trimmed]) {
    return CRON_PRESETS[trimmed]
  }
  return expression.trim()
}

interface FieldLimits {
  min: number
  max: number
}

const FIELD_LIMITS: FieldLimits[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (0 & 7 = Sunday)
]

/** No dia da semana, 7 é domingo. O intervalo 5-7 também inclui o dia 0. */
function inCronRange(
  value: number,
  start: number,
  end: number,
  step: number,
  limits: FieldLimits,
): boolean {
  const hit = (v: number) => v >= start && v <= end && (v - start) % step === 0
  if (hit(value)) return true
  if (limits.max !== 7) return false
  if (value === 0 && hit(7)) return true
  if (value === 7 && hit(0)) return true
  return false
}

export function matchesCronField(value: number, fieldExpr: string, limits: FieldLimits): boolean {
  if (fieldExpr === '*') return true

  const parts = fieldExpr.split(',')
  for (const part of parts) {
    if (part === '*') return true

    // Step check, e.g. */5 or 10-20/2
    if (part.includes('/')) {
      const [rangePart, stepStr] = part.split('/')
      const step = Number.parseInt(stepStr, 10)
      if (Number.isNaN(step) || step <= 0) continue

      let start = limits.min
      let end = limits.max

      if (rangePart !== '*') {
        if (rangePart.includes('-')) {
          const [s, e] = rangePart.split('-').map((n) => Number.parseInt(n, 10))
          if (!Number.isNaN(s)) start = s
          if (!Number.isNaN(e)) end = e
        } else {
          const s = Number.parseInt(rangePart, 10)
          if (!Number.isNaN(s)) start = s
        }
      }

      if (inCronRange(value, start, end, step, limits)) return true
    } else if (part.includes('-')) {
      // Range check, e.g. 1-5
      const [s, e] = part.split('-').map((n) => Number.parseInt(n, 10))
      if (!Number.isNaN(s) && !Number.isNaN(e) && inCronRange(value, s, e, 1, limits)) {
        return true
      }
    } else {
      // Exact number
      const num = Number.parseInt(part, 10)
      if (!Number.isNaN(num)) {
        if (limits.max === 7 && num === 7 && value === 0) return true
        if (limits.max === 7 && num === 0 && value === 7) return true
        if (num === value) return true
      }
    }
  }

  return false
}

export function isValidCron(rawExpression: string): boolean {
  try {
    const expr = normalizeCronExpression(rawExpression)
    const fields = expr.split(/\s+/)
    if (fields.length !== 5) return false

    for (let i = 0; i < 5; i++) {
      const field = fields[i]
      const limits = FIELD_LIMITS[i]
      // Basic character sanity check
      if (!/^[0-9*,\-/]+$/.test(field)) return false
      // Test with min value to check structure
      matchesCronField(limits.min, field, limits)
    }

    return true
  } catch {
    return false
  }
}

export function matchesDate(cronExpr: string, date: Date): boolean {
  const expr = normalizeCronExpression(cronExpr)
  const fields = expr.split(/\s+/)
  if (fields.length !== 5) return false

  const minute = date.getMinutes()
  const hour = date.getHours()
  const dayOfMonth = date.getDate()
  const month = date.getMonth() + 1
  const dayOfWeek = date.getDay() // 0 = Sunday

  if (!matchesCronField(minute, fields[0], FIELD_LIMITS[0])) return false
  if (!matchesCronField(hour, fields[1], FIELD_LIMITS[1])) return false
  if (!matchesCronField(month, fields[3], FIELD_LIMITS[3])) return false

  const domOk = matchesCronField(dayOfMonth, fields[2], FIELD_LIMITS[2])
  const dowOk = matchesCronField(dayOfWeek, fields[4], FIELD_LIMITS[4])
  // Os dois restritos: um ou o outro. Campo que começa com * (inclusive */2) conta como livre, como no cron.
  if (!fields[2].startsWith('*') && !fields[4].startsWith('*')) return domOk || dowOk
  return domOk && dowOk
}

export function calculateNextRun(rawExpression: string, fromDate = new Date()): Date {
  const expr = normalizeCronExpression(rawExpression)
  if (!isValidCron(expr)) {
    throw new Error(`Expressão cron inválida: "${rawExpression}"`)
  }

  // Começa no próximo minuto exato (segundos e ms zerados)
  const candidate = new Date(fromDate.getTime())
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  // O intervalo entre 29/02 pode chegar a oito anos (2096 → 2104).
  const limit = new Date(candidate.getTime())
  limit.setFullYear(limit.getFullYear() + 8)
  const dayExpression = `* * ${expr.split(/\s+/).slice(2).join(' ')}`

  while (candidate < limit) {
    if (!matchesDate(dayExpression, candidate)) {
      candidate.setDate(candidate.getDate() + 1)
      candidate.setHours(0, 0, 0, 0)
      continue
    }
    if (matchesDate(expr, candidate)) {
      return candidate
    }
    candidate.setMinutes(candidate.getMinutes() + 1)
  }

  throw new Error(`Não foi possível calcular próxima execução para a cron: "${rawExpression}"`)
}

export function describeCron(rawExpression: string): string {
  const norm = normalizeCronExpression(rawExpression)

  if (norm === '* * * * *') return 'A cada minuto'
  if (norm === '*/5 * * * *') return 'A cada 5 minutos'
  if (norm === '*/10 * * * *') return 'A cada 10 minutos'
  if (norm === '*/15 * * * *') return 'A cada 15 minutos'
  if (norm === '*/30 * * * *') return 'A cada 30 minutos'
  if (norm === '0 * * * *') return 'A cada hora no minuto 0'
  if (norm === '0 9 * * *') return 'Todo dia às 09:00'
  if (norm === '0 0 * * *') return 'Todo dia à meia-noite (00:00)'
  if (norm === '0 0 * * 0') return 'Todo domingo às 00:00'
  if (norm === '0 0 * * 1-5') return 'De segunda a sexta à meia-noite'

  const fields = norm.split(/\s+/)
  if (fields.length === 5) {
    const [min, hour, dom, mon, dow] = fields
    if (dom === '*' && mon === '*' && dow === '*' && !hour.includes('*')) {
      const hStr = hour.padStart(2, '0')
      const mStr = min.padStart(2, '0')
      return `Todo dia às ${hStr}:${mStr}`
    }
  }

  return `Cron personalizada: ${rawExpression}`
}
