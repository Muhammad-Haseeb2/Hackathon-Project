export default function Sidebar({ tabs, activeTab, onTabChange, backendStatus }) {
  return (
    <aside className="w-64 bg-navy h-screen flex flex-col flex-shrink-0">
      {/* Logo area */}
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-semibold text-sm leading-tight">Synthetic Data</h2>
            <p className="text-white/50 text-xs">Platform v0.1</p>
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
