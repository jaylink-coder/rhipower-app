export default function Navbar() {
  return (
    <nav className="bg-gradient-to-r from-blue-800 to-indigo-900 text-white px-6 py-4 shadow-lg">
      <div className="max-w-5xl mx-auto flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">⚡ RhiPower</h1>
          <p className="text-xs text-blue-200 mt-0.5">Smart Solar &amp; Energy Storage Engineering Platform</p>
        </div>
        <span className="bg-blue-700 text-xs font-bold px-3 py-1.5 rounded-full border border-blue-500">
          v1.0 Alpha
        </span>
      </div>
    </nav>
  )
}
