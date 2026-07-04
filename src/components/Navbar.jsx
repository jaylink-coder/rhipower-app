export default function Navbar({ onAdmin, onAccount, customerUser }) {
  return (
    <nav className="bg-gradient-to-r from-blue-800 to-indigo-900 text-white px-6 py-4 shadow-lg">
      <div className="max-w-5xl mx-auto flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">⚡ RhiPower</h1>
          <p className="text-xs text-blue-200 mt-0.5">Smart Solar &amp; Energy Storage Engineering Platform</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="bg-blue-700 text-xs font-bold px-3 py-1.5 rounded-full border border-blue-500">
            v1.0
          </span>
          {onAccount && (
            <button onClick={onAccount}
              title={customerUser ? 'My Quotes' : 'Sign In / Save Your Designs'}
              className="text-blue-300 hover:text-white transition text-xs font-bold flex items-center gap-1.5">
              <span className="text-lg leading-none">👤</span>
              <span className="hidden sm:inline">{customerUser ? 'My Quotes' : 'Sign In'}</span>
            </button>
          )}
          {onAdmin && (
            <button onClick={onAdmin} title="Admin — Inventory Management"
              className="text-blue-300 hover:text-white transition text-lg leading-none">
              🔒
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}
