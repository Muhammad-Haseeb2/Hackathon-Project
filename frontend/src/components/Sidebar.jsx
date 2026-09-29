export default function Sidebar({ tabs, activeTab, onTabChange, backendStatus }) {
  return (
    <aside className="w-64 bg-navy h-screen flex flex-col flex-shrink-0">
      {/* Logo area */}
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-600 via-teal-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/20 ring-1 ring-white/20">
            {/* Developer code / terminal logo */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
              <line x1="13.5" y1="4" x2="10.5" y2="20" stroke="rgba(255,255,255,0.7)" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-black tracking-tight text-white font-sans bg-gradient-to-r from-white via-slate-100 to-teal-200 bg-clip-text text-transparent">
              Synthetia
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider px-3 mb-2">
          Workspace
        </p>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`nav-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
              activeTab === tab.id
                ? 'bg-teal text-white shadow-lg shadow-teal/25'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="text-base">{tab.icon}</span>
            <span>{tab.label}</span>
            {activeTab === tab.id && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/80" />
            )}
          </button>
        ))}
      </nav>

      {/* Bottom status */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${
            backendStatus === 'connected'
              ? 'bg-emerald-400'
              : backendStatus === 'connecting'
              ? 'bg-amber-400 animate-pulse'
              : 'bg-red-400'
          }`} />
          <span className="text-white/50">
            {backendStatus === 'connected'
              ? 'System Online'
              : backendStatus === 'connecting'
              ? 'Connecting...'
              : 'System Offline'}
          </span>
        </div>
        <p className="text-white/30 text-[10px] mt-2">
          No real data stored • Privacy-first
        </p>
      </div>
    </aside>
  )
}
