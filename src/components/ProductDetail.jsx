// Full customer-facing product detail page for one panel/inverter/battery
// option — reached from the Step3 comparison picker's "View Details" link.
// Scoped to what actually fits RhiPower's business (no reviews/FAQ/payment
// methods — those are e-commerce concepts for independently-purchasable
// items; these components are only ever sold as part of an engineered
// system, never standalone).
import { formatKsh } from '../lib/calculator.js'
import { productSpecRows, CATEGORY_ICON, CATEGORY_LABEL } from '../lib/productSpecs.js'
import { FALLBACK as BUSINESS_FALLBACK } from '../lib/orgSettings.js'

export default function ProductDetail({ category, product, isSelected, onSelect, onBack, business = BUSINESS_FALLBACK }) {
  const specs = productSpecRows(category, product)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 font-semibold mb-4 transition">
        ← Back to comparison
      </button>

      <div className="bg-white border-2 border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        {/* Image — honest placeholder until real product photos exist */}
        <div className="bg-gray-50 h-56 flex items-center justify-center border-b border-gray-100">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.description} className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="text-center text-gray-300">
              <div className="text-6xl mb-2">{CATEGORY_ICON[category]}</div>
              <div className="text-xs font-semibold uppercase tracking-wider">Photo coming soon</div>
            </div>
          )}
        </div>

        <div className="p-6">
          <div className="text-xs font-bold uppercase text-gray-400 tracking-widest mb-1">{CATEGORY_LABEL[category]}</div>
          <h1 className="text-2xl font-black text-gray-900 mb-1">{product.description}</h1>
          {product.sku && <div className="text-xs font-mono text-gray-400 mb-4">SKU: {product.sku}</div>}

          <div className="text-3xl font-black font-mono text-gray-900 mb-5">{formatKsh(product.cost)}</div>

          {product.datasheetUrl && (
            <a href={product.datasheetUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600 hover:text-blue-800 mb-5">
              📄 Download Datasheet (PDF)
            </a>
          )}

          {specs.length > 0 && (
            <div className="border-2 border-gray-100 rounded-xl overflow-hidden mb-5">
              <div className="bg-gray-50 px-4 py-2 text-xs font-bold uppercase text-gray-500 tracking-wider">Specifications</div>
              <div className="divide-y divide-gray-50">
                {specs.map(([k, v]) => (
                  <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
                    <span className="text-gray-500">{k}</span>
                    <span className="font-bold text-gray-800">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-900 mb-5">
            <p className="font-black mb-1">🛡️ Why this is safer than sourcing it yourself</p>
            <ul className="text-xs space-y-1 text-emerald-800">
              <li>✅ Genuine stock, traceable to the manufacturer — not a grey-market or relabeled unit</li>
              <li>✅ Sized as part of one matched system, not picked in isolation</li>
              <li>✅ Full manufacturer warranty{product.warrantyYears ? ` (${product.warrantyYears} years)` : ''} — void on gear bought piecemeal with no invoice trail</li>
            </ul>
          </div>

          <div className="flex gap-3">
            <button onClick={() => onSelect(product)} disabled={isSelected}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-black py-3.5 rounded-xl transition">
              {isSelected ? '✓ Already Selected' : 'Select This Option'}
            </button>
            <a href={`https://wa.me/${business.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Question about ${product.description}`)}`}
              target="_blank" rel="noreferrer"
              className="px-4 border-2 border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 font-bold transition flex items-center">
              💬
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
