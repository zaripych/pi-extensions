const pad = (value: number): string => String(value).padStart(2, '0')

export function toLocalDayString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function fromLocalDayString(day: string): Date {
  const parts = day.split('-').map(Number)
  const year = parts[0]
  const month = parts[1]
  const date = parts[2]
  if (year === undefined || month === undefined || date === undefined) {
    throw new Error(`malformed local day "${day}"`)
  }
  return new Date(year, month - 1, date)
}

export function dayPlusMonths(params: { day: string; months: number }): string {
  const date = fromLocalDayString(params.day)
  const target = new Date(
    date.getFullYear(),
    date.getMonth() + params.months,
    1
  )
  const lastDayOfMonth = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate()
  target.setDate(Math.min(date.getDate(), lastDayOfMonth))
  return toLocalDayString(target)
}
