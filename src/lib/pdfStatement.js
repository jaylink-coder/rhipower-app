// RhiPower — Customer Statement PDF Generator
// Mirrors the header/footer structure of pdfInvoice.js/pdfProposal.js so
// every generated document in this app reads as one family.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { FALLBACK as BUSINESS_FALLBACK } from './orgSettings.js'

const NAVY  = [17, 24, 39]     // gray-900
const GREEN = [4, 120, 87]     // emerald-700
const GRAY  = [107, 114, 128]  // gray-500
const RED   = [185, 28, 28]    // red-700

function money(n) {
  return 'Ksh ' + Math.round(n).toLocaleString('en-KE')
}

function addFooter(doc, business, pageNum, pageCount) {
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  doc.setDrawColor(...GRAY)
  doc.setLineWidth(0.1)
  doc.line(14, h - 16, w - 14, h - 16)
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text(`${business.businessName} · ${business.whatsapp} · ${business.email}`, 14, h - 10)
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

// entries: [{ date, description, debit, credit, balance }], oldest first.
export function generateStatementPDF({ customer, entries, openingBalance, closingBalance, rangeLabel, business = BUSINESS_FALLBACK }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  doc.setFillColor(...NAVY)
  doc.rect(0, 0, pageW, 32, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(20)
  doc.setFont(undefined, 'bold')
  doc.text(business.businessName, 14, 15)
  doc.setFontSize(9)
  doc.setFont(undefined, 'normal')
  doc.text(business.tagline, 14, 22)
  doc.text(`${business.whatsapp}  ·  ${business.email}  ·  ${business.city}`, 14, 27.5)

  doc.setFontSize(10)
  doc.setTextColor(255, 220, 150)
  doc.text('CUSTOMER STATEMENT', pageW - 14, 15, { align: 'right' })
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.text(rangeLabel, pageW - 14, 22, { align: 'right' })
  doc.text(new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }), pageW - 14, 27.5, { align: 'right' })

  let y = 42
  y = sectionHeading(doc, 'Customer', y)
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1 },
    body: [
      ['Name', customer.name || '—', 'Opening Balance', money(openingBalance)],
      ['Phone', customer.phone || '—', 'Closing Balance', money(closingBalance)],
    ],
    columnStyles: { 0: { fontStyle: 'bold', textColor: GRAY, cellWidth: 32 }, 2: { fontStyle: 'bold', textColor: GRAY, cellWidth: 34 } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 8

  y = sectionHeading(doc, 'Transactions', y)
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    head: [['Date', 'Description', 'Debit', 'Credit', 'Balance']],
    body: entries.map(e => [
      new Date(e.date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }),
      e.description,
      e.debit  ? money(e.debit)  : '—',
      e.credit ? money(e.credit) : '—',
      money(e.balance),
    ]),
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 4

  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.5)
  doc.line(14, y, pageW - 14, y)
  y += 8
  doc.setFontSize(13)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...NAVY)
  doc.text('CLOSING BALANCE', 14, y)
  doc.setTextColor(closingBalance > 0 ? RED[0] : GREEN[0], closingBalance > 0 ? RED[1] : GREEN[1], closingBalance > 0 ? RED[2] : GREEN[2])
  doc.setFontSize(15)
  doc.text(money(closingBalance), pageW - 14, y, { align: 'right' })
  doc.setFont(undefined, 'normal')

  const pageCount = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    addFooter(doc, business, p, pageCount)
  }

  const safeName = String(customer.name || 'customer').replace(/[^a-z0-9]+/gi, '-')
  doc.save(`RhiPower-Statement-${safeName}-${Date.now()}.pdf`)
}
