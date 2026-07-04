// M-Pesa STK Push deposit widget — lets a client pay a booking deposit
// to secure their quote. Polls mpesa-status until the mpesa-callback
// Edge Function resolves the transaction (see supabase/functions/mpesa-*).
import { useState, useRef, useEffect } from 'react'
import { supabase, isSupabaseReady } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS  = 90_000

export default function MpesaDeposit({ quotationId, defaultPhone, suggestedAmount }) {
  const [phone,   setPhone]   = useState(defaultPhone || '')
  const [amount,  setAmount]  = useState(suggestedAmount)
  const [status,  setStatus]  = useState('idle')  // idle | sending | pending | completed | failed | needs_review | timeout | error
  const [error,   setError]   = useState('')
  const pollRef = useRef(null)

  useEffect(() => setPhone(defaultPhone || ''), [defaultPhone])
  useEffect(() => () => clearInterval(pollRef.current), [])

  function pollStatus(checkoutRequestId) {
    const startedAt = Date.now()
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(pollRef.current)
        setStatus('timeout')
        return
      }
      const { data } = await supabase.functions.invoke('mpesa-status', {
        body: { checkoutRequestId },
      })
      if (data?.status && data.status !== 'pending') {
        clearInterval(pollRef.current)
        setStatus(data.status)
      }
    }, POLL_INTERVAL_MS)
  }

  async function handlePay() {
    if (!isSupabaseReady) { setError('Payments are not configured yet.'); return }
    if (!phone.trim())    { setError('Enter the M-Pesa phone number.'); return }
    if (!amount || amount < 500) { setError('Minimum deposit is Ksh 500.'); return }

    setError('')
    setStatus('sending')
    const { data, error: fnError } = await supabase.functions.invoke('mpesa-stk-push', {
      body: { quotationId, phone: phone.trim(), amount: Number(amount) },
    })

    if (fnError || data?.error) {
      setStatus('error')
      setError(data?.error || 'Could not start the M-Pesa request. Please try again.')
      return
    }

    setStatus('pending')
    pollStatus(data.checkoutRequestId)
  }

  if (status === 'completed') {
    return (
      <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 text-center">
        <div className="text-3xl mb-1">✅</div>
        <p className="font-black text-green-800">Deposit received — your slot is secured!</p>
        <p className="text-xs text-green-700 mt-1">A RhiPower engineer will confirm your installation date shortly.</p>
      </div>
    )
  }

  return (
    <div className="bg-white border-2 border-emerald-100 rounded-2xl p-5">
      <h4 className="font-black text-gray-800 mb-1">📲 Secure Your Slot — Pay Deposit via M-Pesa</h4>
      <p className="text-xs text-gray-500 mb-4">
        A refundable booking deposit reserves your installation slot and hardware allocation.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">M-Pesa Phone Number</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="07XX XXX XXX" disabled={status === 'sending' || status === 'pending'}
            className="w-full border border-gray-200 p-3 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 outline-none text-sm disabled:opacity-60" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-600 mb-1">Deposit Amount (Ksh)</label>
          <input type="number" min={500} value={amount} onChange={e => setAmount(e.target.value)}
            disabled={status === 'sending' || status === 'pending'}
            className="w-full border border-gray-200 p-3 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 outline-none text-sm disabled:opacity-60" />
        </div>
      </div>

      {error && <p className="text-xs text-red-600 font-semibold mb-3">{error}</p>}

      {status === 'pending' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 font-semibold mb-3">
          📱 Check your phone — enter your M-Pesa PIN to complete the {formatKsh(amount)} deposit.
        </div>
      )}
      {status === 'timeout' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 font-semibold mb-3">
          Still waiting on confirmation. If you already paid, it will reflect shortly — otherwise try again.
        </div>
      )}
      {status === 'failed' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 font-semibold mb-3">
          Payment was not completed. You can try again.
        </div>
      )}
      {status === 'needs_review' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 font-semibold mb-3">
          We received a response but couldn't fully confirm it — our team will verify and reach out shortly.
        </div>
      )}

      <button onClick={handlePay} disabled={status === 'sending' || status === 'pending'}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black p-3.5 rounded-xl shadow transition disabled:opacity-50">
        {status === 'sending' ? 'Sending request…'
          : status === 'pending' ? 'Waiting for M-Pesa confirmation…'
          : `Pay ${formatKsh(amount)} Deposit`}
      </button>
    </div>
  )
}
