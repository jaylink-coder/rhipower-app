// RhiPower — Shared CSV export helper. Extracted from AdminSettings.jsx's
// Data Management tab once the Accounting module's financial statements
// (Phase 6) needed the same thing — one implementation, not two.
export function toCSV(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = v => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
}

export function downloadCSV(rows, filename) {
  if (!rows?.length) return false
  const blob = new Blob([toCSV(rows)], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return true
}
