import { useState } from 'react'

export default function ConfigPanel({
  children,
  title = 'Configuration',
  className = 'w-80 lg:w-[330px]',
  defaultCollapsed = false,
  badge = null,
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  if (collapsed) {
    return (
      <div className="flex-shrink-0 transition-all">
        <button
          onClick={() => setCollapsed(false)}
          className="bg-white hover:bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-xs flex flex-col items-center gap-2 text-slate-600 hover:text-teal-700 transition"
          title={`Expand ${title}`}
        >
          <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center text-teal-700 font-bold">
            ⚙️
          </div>
          <span className="text-[11px] font-bold writing-mode-vertical uppercase tracking-wider py-2">
            {title}
          </span>
          <span className="text-xs text-teal-600">◀</span>
        </button>
      </div>
    )
  }

  return (
    <div className={`${className} bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden flex-shrink-0 transition-all flex flex-col`}>
      <div className="px-4 py-3.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">⚙️</span>
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider truncate">
            {title}
          </h3>
          {badge && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-teal-50 text-teal-700 border border-teal-200 shrink-0">
              {badge}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition text-xs"
          title="Collapse panel"
        >
          ✕
        </button>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-10rem)]">
        {children}
      </div>
    </div>
  )
}
