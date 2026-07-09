// RhiPower — Branded Invoice PDF Generator
// Client-side (jsPDF), mirroring the header/table/footer structure of
// lib/pdfProposal.js so proposals and invoices read as the same document
// family. See pdfProposal.js for why jsPDF (already a project dependency,
// no server round-trip needed for this backend-less app).
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { FALLBACK as BUSINESS_FALLBACK } from './orgSettings.js'
import { formatDocNumber } from './docNumbers.js'

const NAVY  = [17, 24, 39]     // gray-900
const GREEN = [4, 120, 87]     // emerald-700
const GRAY  = [107, 114, 128]  // gray-500
const RED   = [185, 28, 28]    // red-700

function money(n) {
  return 'Ksh ' + Math.round(n).toLocaleString('en-KE')
}

function invoiceNumber(invoice, prefix) {
  const year = new Date(invoice.issue_date || invoice.created_at).getFullYear()
  return formatDocNumber(prefix, invoice.invoice_number, { year })
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

export function generateInvoicePDF({ invoice, lines, payments, business = BUSINESS_FALLBACK }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const invNo = invoiceNumber(invoice, business.invoicePrefix)

  // ── HEADER ─────────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, pageW, 32, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(20)
  doc.setFont(undefined, 'bold')
  doc.text(business.businessName, 14, 15)
  doc.setFontSize(9)
  doc.setFont(undefined, 'normal')
  doc.text(business.tagline, 14, 22)
  let contactLine = `${business.whatsapp}  ·  ${business.email}  ·  ${business.city}`
  if (business.kraPin) contactLine += `  ·  KRA PIN: ${business.kraPin}`
  doc.text(contactLine, 14, 27.5)

  doc.setFontSize(10)
  doc.setTextColor(255, 220, 150)
  doc.text('TAX INVOICE', pageW - 14, 15, { align: 'right' })
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.text(invNo, pageW - 14, 22, { align: 'right' })
  doc.text(new Date(invoice.issue_date).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }), pageW - 14, 27.5, { align: 'right' })

  let y = 42

  // ── BILL TO / DATES ────────────────────────────────────────────────────
  y = sectionHeading(doc, 'Bill To', y)
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1 },
    body: [
      ['Client Name',  invoice.client_name  || '—', 'Issue Date', invoice.issue_date  ? new Date(invoice.issue_date).toLocaleDateString('en-KE') : '—'],
      ['Phone',        invoice.client_phone || '—', 'Due Date',   invoice.due_date    ? new Date(invoice.due_date).toLocaleDateString('en-KE')   : '—'],
      ['Email',        invoice.client_email || '—', 'Status',     (invoice.status || '').replace(/_/g, ' ')],
      ['Site Address', invoice.site_address || '—', '', ''],
    ],
    columnStyles: { 0: { fontStyle: 'bold', textColor: GRAY, cellWidth: 32 }, 2: { fontStyle: 'bold', textColor: GRAY, cellWidth: 32 } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── LINE ITEMS ──────────────────────────────────────────────────────────
  y = sectionHeading(doc, 'Invoice Items', y)
  autoTable(doc, {
    startY: y,
    theme: 'striped',
    head: [['Description', 'Qty', 'Unit Price', 'Amount']],
    body: (lines || []).map(l => [l.description, String(l.qty), money(l.unit_price_kes), money(l.line_total_kes)]),
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 9 },
    styles: { fontSize: 9 },
    columnStyles: { 1: { cellWidth: 16, halign: 'center' }, 2: { cellWidth: 32, halign: 'right' }, 3: { cellWidth: 32, halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  y = doc.lastAutoTable.finalY + 4

  // ── TOTALS ──────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 1.5 },
    body: [
      ['Subtotal',                          money(invoice.subtotal_kes)],
      [`VAT (${invoice.vat_rate_pct}%)`,    money(invoice.vat_kes)],
      ['Total',                             money(invoice.total_kes)],
      ['Amount Paid',                       money(invoice.amount_paid_kes)],
      ['Balance Due',                       money(invoice.balance_due_kes)],
    ],
    columnStyles: { 0: { cellWidth: 130 }, 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: pageW - 14 - 160, right: 14 },
    didParseCell: data => {
      if (data.row.index === 2) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fontSize = 12 }
      if (data.row.index === 4) { data.cell.styles.textColor = Number(invoice.balance_due_kes) > 0 ? RED : GREEN; data.cell.styles.fontStyle = 'bold' }
    },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── PAYMENT HISTORY ─────────────────────────────────────────────────────
  if (payments?.length) {
    if (y > 230) { doc.addPage(); y = 20 }
    y = sectionHeading(doc, 'Payment History', y)
    autoTable(doc, {
      startY: y,
      theme: 'plain',
      head: [['Date', 'Method', 'Reference', 'Amount']],
      body: payments.map(p => [
        new Date(p.paid_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }),
        (p.method || '').replace(/_/g, ' '),
        p.reference || '—',
        money(p.amount_kes),
      ]),
      headStyles: { fillColor: GRAY, textColor: 255, fontSize: 8.5 },
      styles: { fontSize: 8.5 },
      columnStyles: { 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // ── NOTE ────────────────────────────────────────────────────────────────
  if (y > 260) { doc.addPage(); y = 20 }
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text('Payment due within the terms stated above. Please quote the invoice number on all payment references.', 14, y)

  const pageCount = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    addFooter(doc, business, p, pageCount)
  }

  doc.save(`RhiPower-${invNo}.pdf`)
}
