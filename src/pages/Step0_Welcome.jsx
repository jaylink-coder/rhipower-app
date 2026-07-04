// Welcome / experience-level screen — shown before the 3-step wizard

const PROFILES = [
  {
    id:    'homeowner',
    icon:  '🏠',
    title: 'Homeowner or Business Owner',
    desc:  'I know what I need but I am not technical. Guide me step by step.',
    color: 'border-blue-300 hover:border-blue-400 hover:bg-blue-50',
    badge: 'bg-blue-100 text-blue-700',
  },
  {
    id:    'diy',
    icon:  '🔌',
    title: 'DIY / Hands-On Enthusiast',
    desc:  'I have done electrical work before and want to be involved in my installation.',
    color: 'border-emerald-300 hover:border-emerald-400 hover:bg-emerald-50',
    badge: 'bg-emerald-100 text-emerald-700',
  },
  {
    id:    'professional',
    icon:  '⚡',
    title: 'Electrical Engineer or Solar Installer',
    desc:  'I work with systems like this. Show me the full technical data.',
    color: 'border-amber-300 hover:border-amber-400 hover:bg-amber-50',
    badge: 'bg-amber-100 text-amber-800',
  },
  {
    id:    'business',
    icon:  '🏢',
    title: 'Procuring for a Company or Project',
    desc:  'I am sourcing on behalf of an organisation, farm, school, or commercial site.',
    color: 'border-purple-300 hover:border-purple-400 hover:bg-purple-50',
    badge: 'bg-purple-100 text-purple-700',
  },
]

export default function Step0_Welcome({ onSelect, onBack }) {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 py-12">

      {/* Brand mark */}
      <div className="text-center mb-8">
        {onBack && (
          <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 font-semibold mb-4 transition">
            ← Back to Homepage
          </button>
        )}
        <div className="text-5xl mb-3">⚡</div>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Welcome to RhiPower</h1>
        <p className="text-gray-500 mt-2 max-w-sm">
          Smart Solar & Energy Storage Design Platform
        </p>
      </div>

      {/* The one question */}
      <div className="w-full max-w-2xl">
        <p className="text-center font-bold text-gray-700 text-lg mb-1">
          Before we start — what best describes you?
        </p>
        <p className="text-center text-sm text-gray-400 mb-6">
          Your answer helps us give you the right level of guidance and language.
        </p>

        <div className="space-y-3">
          {PROFILES.map(p => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`w-full flex items-center gap-5 p-5 rounded-2xl border-2 bg-white text-left transition shadow-sm hover:shadow-md ${p.color}`}>
              <span className="text-4xl shrink-0">{p.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-black text-gray-800 text-base">{p.title}</div>
                <div className="text-sm text-gray-500 mt-0.5">{p.desc}</div>
              </div>
              <div className={`text-xs font-bold px-3 py-1 rounded-full shrink-0 hidden sm:block ${p.badge}`}>
                {p.id === 'homeowner'    ? 'Guided mode'     :
                 p.id === 'diy'         ? 'Hands-on mode'   :
                 p.id === 'professional'? 'Technical mode'  : 'Business mode'}
              </div>
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">
          You can always access all details regardless of which option you choose.
        </p>
      </div>
    </div>
  )
}

// Export the profile metadata so other components can read labels/badges
export { PROFILES }
