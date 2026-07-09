// One shared document-number formatter, replacing the half-dozen
// independently-duplicated padStart(4,'0') implementations that used to be
// scattered across AdminInvoices.jsx, AdminSalesOrders.jsx,
// AdminPurchaseOrders.jsx, AdminLeads.jsx, and pdfInvoice.js.
export function formatDocNumber(prefix, number, { year } = {}) {
  const padded = String(number).padStart(4, '0')
  return year ? `${prefix}-${year}-${padded}` : `${prefix}-${padded}`
}
