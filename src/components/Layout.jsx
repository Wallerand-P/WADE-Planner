import { useNavigate } from 'react-router-dom'

export default function Layout({ children, title, showBack = false, showHome = false, roomCode }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-md mx-auto px-4 pt-6 pb-10 min-h-screen flex flex-col">
        {(title || showBack || showHome || roomCode) && (
          <div className="flex items-center gap-3 mb-6">
            {showBack && (
              <button
                onClick={() => navigate(-1)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                ←
              </button>
            )}
            {showHome && (
              <button
                onClick={() => navigate('/')}
                className="text-slate-400 hover:text-white text-xl leading-none"
                title="Home"
              >
                ⌂
              </button>
            )}
            {title && <h1 className="text-xl font-bold flex-1 tracking-tight">{title}</h1>}
            {roomCode && (
              <span className="font-mono text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">
                {roomCode}
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
