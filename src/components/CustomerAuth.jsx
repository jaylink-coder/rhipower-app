// Customer sign-in / sign-up — lets a client create a free account so their
// designs are saved and can be reopened later from "My Quotes".
import { useState } from 'react'
import { supabase, isSupabaseReady } from '../lib/supabase.js'

export default function CustomerAuth({ onBack, onSignedIn }) {
  const [mode,     setMode]     = useState('signin')   // 'signin' | 'signup'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [name,     setName]     = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [sent,     setSent]     = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isSupabaseReady) { setError('Accounts are not configured yet.'); return }
    setLoading(true); setError('')

    if (mode === 'signup') {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() } },
      })
      setLoading(false)
      if (signUpError) { setError(signUpError.message); return }
      if (data.session) { onSignedIn(data.session.user); return }
      setSent(true)   // email confirmation required before a session exists
      return
    }

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(), password,
    })
    if (signInError) { setLoading(false); setError(signInError.message); return }

    const { data: profile } = await supabase.from('customer_profiles')
      .select('status').eq('id', data.session.user.id).single()
    setLoading(false)

    if (profile?.status === 'suspended') {
      await supabase.auth.signOut()
      setError('This account has been suspended. Contact RhiPower support if you believe this is a mistake.')
      return
    }
    onSignedIn(data.session.user)
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-5xl mb-3">📬</div>
          <h2 className="text-lg font-black text-gray-800 mb-2">Check your email</h2>
          <p className="text-sm text-gray-500">
            We sent a confirmation link to <strong>{email}</strong>. Click it, then come back and sign in.
          </p>
          <button onClick={onBack} className="w-full mt-5 text-xs text-gray-400 hover:text-gray-600 transition">
            ← Back to RhiPower
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">👤</div>
          <h2 className="text-xl font-black text-gray-800">
            {mode === 'signup' ? 'Create Your Free Account' : 'Welcome Back'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'signup'
              ? 'Save your system design and reopen it anytime.'
              : 'Sign in to see your saved designs.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Full Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required
                className="w-full border border-gray-200 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-gray-200 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              minLength={6} placeholder="••••••••"
              className="w-full border border-gray-200 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          {error && <p className="text-red-600 text-xs font-semibold bg-red-50 p-2 rounded-lg">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-bold p-3 rounded-xl transition disabled:opacity-50">
            {loading ? 'Please wait…' : mode === 'signup' ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <button onClick={() => { setMode(m => m === 'signup' ? 'signin' : 'signup'); setError('') }}
          className="w-full mt-4 text-xs text-blue-600 hover:text-blue-800 font-semibold transition">
          {mode === 'signup' ? 'Already have an account? Sign in' : "New here? Create a free account"}
        </button>
        <button onClick={onBack} className="w-full mt-3 text-xs text-gray-400 hover:text-gray-600 transition">
          ← Back to RhiPower
        </button>
      </div>
    </div>
  )
}
