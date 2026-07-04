// RhiPower — Branded Proposal PDF Generator
// Client-side (jsPDF), so it works instantly with no server round-trip.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { BUSINESS } from '../config.js'
import { TIER_META } from '../data/skuInventory.js'
import { KENYA_LOCATIONS } from '../lib/nasaPower.js'

const NAVY  = [17, 24, 39]     // gray-900
const GOLD  = [217, 119, 6]    // amber-600
const GREEN = [4, 120, 87]     // emerald-700
const GRAY  = [107, 114, 128]  // gray-500

function money(n) {
  return 'Ksh ' + Math.round(n).toLocaleString('en-KE')
}

// jsPDF's built-in fonts can't render emoji glyphs (they render as broken
// characters), and tier labels already end in "Tier" — strip both so PDF
// text stays clean.
function tierName(tier) {
  const label = TIER_META[tier]?.label || tier
  return label.replace(/[^\x20-\x7E]/g, '').trim()
}

function addFooter(doc, pageNum, pageCount) {
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  doc.setDrawColor(...GRAY)
  doc.setLineWidth(0.1)
  doc.line(14, h - 16, w - 14, h - 16)
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text(`${BUSINESS.name} · ${BUSINESS.whatsapp} · ${BUSINESS.email}`, 14, h - 10)
  doc.text(`Page ${pageNum} of ${pageCount}`, w - 14, h - 10, { align: 'right' })
}

function sectionHeading(doc, text, y) {
  doc.setFillColor(...NAVY)
  doc.rect(14, y, 3, 6, 'F')
  doc.setFontSize(12)
  doc.setTextColor(...NAVY)
  doc.setFont(undefined, 'bold')
  doc.text(text, 20, y + 5)
  doc.setFont(undefined, 'normal')
  return y + 12
}

export function generateProposalPDF({ client, siteConfig, results, tier, backupDays }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const loc   = KENYA_LOCATIONS[siteConfig.location]?.label || siteConfig.location
  const eng   = results.engineering

  // ── HEADER ─────────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, pageW, 32, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(20)
  doc.setFont(undefined, 'bold')
  doc.text(BUSINESS.name, 14, 15)
  doc.setFontSize(9)
  doc.setFont(undefined, 'normal')
  doc.text(BUSINESS.tagline, 14, 22)
  doc.text(`${BUSINESS.whatsapp}  ·  ${BUSINESS.email}  ·  ${BUSINESS.city}`, 14, 27.5)

  doc.setFontSize(10)
  doc.setTextColor(255, 220, 150)
  doc.text('SOLAR SYSTEM PROPOSAL', pageW - 14, 15, { align: 'right' })
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.text(new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }), pageW - 14, 22, { align: 'right' })

  let y = 42

  // ── CLIENT & SITE INFO ─────────────────────────────────────────────────
  y = sectionHeading(doc, 'Client & Site', y)
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1 },
    body: [
      ['Client Name',    client.name    || '—', 'Location',     loc],
      ['Phone',          client.phone   || '—', 'Peak Sun Hrs', `${siteConfig.psh} PSH/day (${siteConfig.pshSource || 'NASA POWER'})`],
      ['Email',          client.email   || '—', 'Wire Run',     `${siteConfig.wireDistM} m`],
      ['Site Address',   client.address || '—', 'Site Distance', `${siteConfig.siteKm} km round-trip`],
    ],
    columnStyles: { 0: { fontStyle: 'bold', textColor: GRAY, cellWidth: 32 }, 2: { fontStyle: 'bold', textColor: GRAY, cellWidth: 32 } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── SYSTEM DESIGN SUMMARY ──────────────────────────────────────────────
  y = sectionHeading(doc, `System Design — ${tierName(tier)} · ${backupDays}-Day Backup`, y)
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['Component', 'Capacity', 'Quantity']],
    body: [
      ['Solar Array',     `${results.truePVkW.toFixed(2)} kWp`,       `${results.panelQty} panels`],
      ['Inverter',        `${results.totalInverterKW} kW`,            `${results.inverterQty} unit${results.inverterQty !== 1 ? 's' : ''}`],
      ['Battery Storage', `${results.trueBattKWh} kWh`,               `${results.batteryQty} pack${results.batteryQty !== 1 ? 's' : ''}`],
    ],
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 9 },
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── ENGINEERING BASIS (compact) ────────────────────────────────────────
  y = sectionHeading(doc, 'Engineering Basis', y)
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 1 },
    body: [
      ['Total running load',   `${(eng.totalRunningWatts / 1000).toFixed(2)} kW`],
      ['Peak surge demand',    `${(eng.maxSurgeWatts / 1000).toFixed(2)} kW`],
      ['Nightly energy need',  `${(eng.overnightEnergyWhPerDay / 1000).toFixed(2)} kWh/night × ${backupDays} day(s)`],
      ['Cable specification',  eng.cableSpec],
    ],
    columnStyles: { 0: { fontStyle: 'bold', textColor: GRAY, cellWidth: 55 } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── BILL OF MATERIALS ──────────────────────────────────────────────────
  if (y > 220) { doc.addPage(); y = 20 }
  y = sectionHeading(doc, 'Bill of Materials', y)

  const bomRows = (items) => items.map(i => [String(i.qty), i.label, i.sku || '—'])
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    head: [['Qty', 'Zone A — Solar Array & Combiner Box', 'SKU']],
    body: bomRows(results.zoneA),
    headStyles: { fillColor: GOLD, textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 16 }, 2: { cellWidth: 40 } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 4

  if (y > 250) { doc.addPage(); y = 20 }
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    head: [['Qty', 'Zone B — Battery Bank & Power Plant', 'SKU']],
    body: bomRows(results.zoneB),
    headStyles: { fillColor: [124, 58, 237], textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 16 }, 2: { cellWidth: 40 } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 4

  if (y > 250) { doc.addPage(); y = 20 }
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    head: [['Qty', 'Zone C — AC Distribution & Load Control', 'SKU']],
    body: bomRows(results.zoneC),
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 8.5 },
    styles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 16 }, 2: { cellWidth: 40 } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── COST ESTIMATE ───────────────────────────────────────────────────────
  if (y > 230) { doc.addPage(); y = 20 }
  y = sectionHeading(doc, 'Full Project Cost Estimate', y)
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    body: [
      ['Hardware (materials + 35% margin)', money(results.materialsAtSellPrice)],
      ['Engineering & installation labor',  money(results.totalLabor)],
      [`Logistics & per-diem (${siteConfig.siteKm} km)`, money(results.totalLogistics)],
    ],
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 2

  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.5)
  doc.line(14, y, pageW - 14, y)
  y += 8
  doc.setFontSize(14)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...NAVY)
  doc.text('TOTAL PROJECT COST', 14, y)
  doc.setTextColor(...GREEN)
  doc.setFontSize(16)
  doc.text(money(results.grandTotal), pageW - 14, y, { align: 'right' })
  doc.setFont(undefined, 'normal')
  y += 8

  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text(`Prices inclusive of 16% VAT · Subject to site survey · ${backupDays}-day backup · ${tierName(tier)}`, 14, y)
  y += 4.5
  doc.text('Warranty: 25-year panels · 10-year inverter · 10-year battery · 2-year installation workmanship', 14, y)
  y += 8

  // ── COMPLIANCE NOTE ─────────────────────────────────────────────────────
  if (y > 260) { doc.addPage(); y = 20 }
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  const compliance = 'Compliance: Core components meet IEC 61215 (panels), IEC 62109 (inverter), IEC 62619 (LiFePO4 batteries), ' +
    'IEC 60947 (switchgear). Installation wiring per Kenya National Electrical Code KS 638 / IEC 60364. Installer should be KEBS-registered. ' +
    'This proposal is an estimate based on client-supplied appliance data and is subject to confirmation at site survey.'
  const wrapped = doc.splitTextToSize(compliance, pageW - 28)
  doc.text(wrapped, 14, y)

  // ── FOOTER on every page ────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    addFooter(doc, p, pageCount)
  }

  const safeLoc = String(loc).replace(/[^a-z0-9]+/gi, '-')
  doc.save(`RhiPower-Proposal-${safeLoc}-${Date.now()}.pdf`)
}
