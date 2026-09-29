import { useState, useEffect } from 'react'
import { checkHealth } from './api'
import Sidebar from './components/Sidebar'
import TabularTab from './tabs/TabularTab'
import RelationalTab from './tabs/RelationalTab'
import DocumentsTab from './tabs/DocumentsTab'
import AdminTab from './tabs/AdminTab'

const TABS = [
  { id: 'tabular', label: 'Tabular', icon: '🧬' },
  { id: 'relational', label: 'Relational', icon: '🔗' },
  { id: 'documents', label: 'Documents', icon: '📄' },
  { id: 'admin', label: 'Admin & Security', icon: '🛡️' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('tabular')
  const [backendStatus, setBackendStatus] = useState('connecting') // 'connecting' | 'connected' | 'error'
  const [backendInfo, setBackendInfo] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function ping() {
      try {
        const data = await checkHealth()
        if (!cancelled) {
          setBackendStatus('connected')
          setBackendInfo(data)
        }
      } catch (err) {
        if (!cancelled) {
          setBackendStatus('error')
          console.error('Backend health check failed:', err)
        }
      }
    }

    ping()
    // Re-check every 30s
    const interval = setInterval(ping, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const renderTab = () => {
    switch (activeTab) {
      case 'tabular':
        return <TabularTab />
      case 'relational':
        return <RelationalTab />
      case 'documents':
        return <DocumentsTab />
      case 'admin':
        return <AdminTab />
      default:
        return <TabularTab />
    }
  }

  return (
    <div className="flex h-screen bg-offwhite overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        backendStatus={backendStatus}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-gray-200 bg-white/80 backdrop-blur-sm flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-navy">
              {TABS.find(t => t.id === activeTab)?.icon}{' '}
              {TABS.find(t => t.id === activeTab)?.label}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Connection status badge */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              backendStatus === 'connected'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : backendStatus === 'connecting'
                ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse-glow'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                backendStatus === 'connected'
                  ? 'bg-emerald-500'
                  : backendStatus === 'connecting'
                  ? 'bg-amber-500'
                  : 'bg-red-500'
              }`} />
              {backendStatus === 'connected'
                ? 'Backend Connected'
                : backendStatus === 'connecting'
                ? 'Connecting...'
                : 'Backend Offline'}
            </div>
          </div>
        </header>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-6 animate-fade-in" key={activeTab}>
          {renderTab()}
        </div>
      </main>
    </div>
  )
}
