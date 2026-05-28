import { useNavigate } from 'react-router-dom'

export default function Layout({ children, title, showBack = false, backTo, showHome = false, roomCode }) {
  const navigate = useNavigate()
  const iconBtn =
    'w-9 h-9 flex items-center justify-center rounded-full bg-white/[0.06] border border-white/10 ' +
    'text-white/70 hover:text-white hover:bg-white/[0.1] active:scale-95 transition-all leading-none'
  return (
    <div className="min-h-screen text-white">
      <div className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-12 min-h-screen flex flex-col">
        {(title || showBack || backTo || showHome || roomCode) && (
          <div className="flex items-center gap-2.5 mb-7">
            {(showBack || backTo) && (
              <button onClick={() => (backTo ? navigate(backTo) : navigate(-1))} className={iconBtn} title="Back">
                <span className="-mt-0.5 text-lg">‹</span>
              </button>
            )}
            {showHome && (
              <button onClick={() => navigate('/')} className={iconBtn} title="Home">
                <span className="text-sm">⌂</span>
              </button>
            )}
            {title && (
              <h1 className="text-[26px] font-bold flex-1 tracking-tightest">{title}</h1>
            )}
            {roomCode && (
              <span className="font-mono text-[11px] text-white/45 bg-white/[0.06] border border-white/10 px-2.5 py-1 rounded-full tracking-[0.2em]">
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
