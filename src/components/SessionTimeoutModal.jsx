export default function SessionTimeoutModal({ minutesLeft, onStay, onSignOutNow }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 p-6 text-center">
        <div className="text-4xl mb-3">⏳</div>
        <h3 className="text-lg font-black text-gray-800 mb-1">Still there?</h3>
        <p className="text-sm text-gray-500 mb-5">
          For security, you'll be signed out in about {minutesLeft} minute{minutesLeft !== 1 ? 's' : ''} of inactivity.
        </p>
        <div className="flex gap-3">
          <button onClick={onSignOutNow}
            className="flex-1 border-2 border-gray-200 text-gray-600 hover:bg-gray-50 font-bold py-2.5 rounded-xl transition text-sm">
            Sign Out
          </button>
          <button onClick={onStay}
            className="flex-1 bg-blue-700 hover:bg-blue-800 text-white font-bold py-2.5 rounded-xl transition text-sm">
            Stay Signed In
          </button>
        </div>
      </div>
    </div>
  )
}
