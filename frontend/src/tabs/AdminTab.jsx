import { useState, useEffect, useCallback } from 'react'
import {
  adminAuth,
  getAdminHealth,
  getAuditLog,
  generateApiKey,
  listApiKeys,
  revokeApiKey,
} from '../api'

export default function AdminTab() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  // Metrics & logs
  const [health, setHealth] = useState(null)
  const [auditEntries, setAuditEntries] = useState([])
  const [auditStats, setAuditStats] = useState(null)
  const [apiKeys, setApiKeys] = useState([])
  const [keyLabel, setKeyLabel] = useState('')
  const [generatedKey, setGeneratedKey] = useState(null)
  const [copiedKey, setCopiedKey] = useState('')

  // UI state
  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [activeSubTab, setActiveSubTab] = useState('overview') // 'overview' | 'apikeys' | 'audit'

  // Fetch all admin data
  const fetchData = useCallback(async () => {
    setLoadingMetrics(true)
    try {
      const [healthData, auditData, keysData] = await Promise.all([
        getAdminHealth().catch(() => null),
        getAuditLog().catch(() => ({ entries: [], stats: {} })),
        listApiKeys().catch(() => ({ keys: [] })),
      ])
      if (healthData) setHealth(healthData)
      if (auditData) {
        setAuditEntries(auditData.entries || [])
        setAuditStats(auditData.stats || null)
      }
      if (keysData) setApiKeys(keysData.keys || [])
    } catch (err) {
      console.error('Error fetching admin data:', err)
    } finally {
      setLoadingMetrics(false)
    }
  }, [])

  // Auto-refresh interval when authenticated
  useEffect(() => {
    if (!isAuthenticated) return
    fetchData()

    if (!autoRefresh) return
    const timer = setInterval(fetchData, 8000)
    return () => clearInterval(timer)
  }, [isAuthenticated, autoRefresh, fetchData])

  const handleLogin = async (e) => {
    e.preventDefault()
    setAuthLoading(true)
    setAuthError('')
    try {
      const res = await adminAuth(passcode)
      if (res.authenticated) {
        setIsAuthenticated(true)
      } else {
        setAuthError('Authentication failed. Check your secret key.')
      }
    } catch (err) {
      setAuthError(err.message || 'Invalid secret key')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleGenerateKey = async (e) => {
    e.preventDefault()
    try {
      const newKey = await generateApiKey(keyLabel || 'Developer Key')
      setGeneratedKey(newKey.key)
      setKeyLabel('')
      fetchData()
    } catch (err) {
      alert('Failed to generate key: ' + err.message)
    }
  }

  const handleRevokeKey = async (key) => {
    if (!confirm('Are you sure you want to revoke this API key?')) return
    try {
      await revokeApiKey(key)
      fetchData()
    } catch (err) {
      alert('Failed to revoke key: ' + err.message)
    }
  }

  const copyToClipboard = (text, keyId) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(keyId)
    setTimeout(() => setCopiedKey(''), 2500)
  }

  // ── Login Gate ──
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full animate-fade-in">
          <div className="text-center mb-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-navy/5 flex items-center justify-center text-2xl border border-navy/10">
              🛡️
            </div>
            <h2 className="text-xl font-bold text-navy">Security & Governance</h2>
            <p className="text-sm text-gray-500 mt-1">
              Authenticate with your Admin Secret to manage API keys, inspect zero-PII audit logs, and monitor host telemetry.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Admin Secret Key
              </label>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter secret key..."
                className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition-all font-mono"
                required
              />
              <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                <span>💡</span> Default development fallback is <code className="bg-gray-100 px-1 py-0.5 rounded text-navy font-semibold">admin123</code>
              </p>
            </div>

            {authError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2.5 px-4 rounded-lg bg-navy text-white text-sm font-semibold hover:bg-navy-600 transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {authLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verifying...
                </>
              ) : (
                'Unlock Panel'
              )}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── Authenticated Admin Panel ──
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header / Subtabs */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('overview')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeSubTab === 'overview'
                ? 'bg-navy text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            📊 System Health
          </button>
          <button
            onClick={() => setActiveSubTab('apikeys')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeSubTab === 'apikeys'
                ? 'bg-navy text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            🔑 Developer API Keys
          </button>
          <button
            onClick={() => setActiveSubTab('audit')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeSubTab === 'audit'
                ? 'bg-navy text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            📋 Ephemeral Audit Log
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-teal focus:ring-teal h-3.5 w-3.5"
            />
            Auto-refresh (8s)
          </label>
          <button
            onClick={fetchData}
            disabled={loadingMetrics}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs transition-colors"
            title="Refresh now"
          >
            <span className={`inline-block ${loadingMetrics ? 'animate-spin' : ''}`}>🔄</span>
          </button>
          <button
            onClick={() => setIsAuthenticated(false)}
            className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium transition-colors"
          >
            Lock Panel
          </button>
        </div>
      </div>

      {/* ── Subtab: System Health Overview ── */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
                <span>Process Memory</span>
                <span>🧠</span>
              </div>
              <div className="text-2xl font-bold text-navy">
                {health?.memory_mb ?? '—'} <span className="text-xs font-normal text-gray-400">MB RSS</span>
              </div>
              <div className="text-xs text-gray-500 mt-2 flex items-center justify-between">
                <span>Host Memory %</span>
                <span className="font-semibold text-navy">{health?.memory_pct ?? 0}%</span>
              </div>
              <div className="w-full bg-gray-100 h-1.5 rounded-full mt-1.5 overflow-hidden">
                <div
                  className="bg-teal h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (health?.memory_pct || 0) * 2)}%` }}
                />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
                <span>Rate Limiter</span>
                <span>⏱️</span>
              </div>
              <div className="text-2xl font-bold text-teal">
                {health?.rate_limiter?.max_requests_per_window ?? 60} <span className="text-xs font-normal text-gray-400">req/min</span>
              </div>
              <div className="text-xs text-gray-500 mt-2 flex items-center justify-between">
                <span>Active Tracked IPs</span>
                <span className="font-semibold text-navy">{health?.rate_limiter?.active_ips ?? 0}</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">Sliding window (in-memory)</div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
                <span>LLM Cache Hit Ratio</span>
                <span>⚡</span>
              </div>
              <div className="text-2xl font-bold text-navy">
                {health?.cache_stats?.hit_ratio_pct ?? 0}%
              </div>
              <div className="text-xs text-gray-500 mt-2 flex items-center justify-between">
                <span>Cached Queries</span>
                <span className="font-semibold text-navy">{health?.cache_stats?.total_cached_items ?? 0}</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Hits: {health?.cache_stats?.hits ?? 0} | Misses: {health?.cache_stats?.misses ?? 0}
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center justify-between text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
                <span>Data Volume</span>
                <span>📈</span>
              </div>
              <div className="text-2xl font-bold text-navy">
                {auditStats?.total_rows_generated?.toLocaleString() ?? 0}
              </div>
              <div className="text-xs text-gray-500 mt-2 flex items-center justify-between">
                <span>Total Generation Events</span>
                <span className="font-semibold text-navy">{auditStats?.total_events ?? 0}</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Avg Latency: {auditStats?.avg_execution_time_ms ?? 0} ms
              </div>
            </div>
          </div>

          {/* Privacy & Governance Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <h3 className="text-sm font-bold text-navy flex items-center gap-2 mb-3">
                <span>🛡️</span> Zero-PII Ephemeral Policy
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                The Synthetic Data Platform executes strict in-memory streaming. Generated records are transferred as byte streams directly to the browser (CSV, JSON, SQL, PDF, ZIP) and immediately reclaimed by garbage collection.
              </p>
              <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-gray-50">
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">PII Storage</span>
                  <span className="text-emerald-700 font-semibold">0 Bytes Persisted</span>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-50">
                  <span className="text-gray-400 block text-[10px] uppercase font-bold">Audit IP Hash</span>
                  <span className="text-navy font-semibold">Salted SHA-256 (12 chars)</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <h3 className="text-sm font-bold text-navy flex items-center gap-2 mb-3">
                <span>🔒</span> Active Security Controls
              </h3>
              <ul className="text-xs text-gray-600 space-y-2">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Rate Limiting:</strong> In-memory sliding-window (60 req/min per IP)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Secure Headers:</strong> HSTS, X-Content-Type-Options, CSP, X-Frame-Options</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-600 font-bold">✓</span>
                  <span><strong>Input Sanitization:</strong> Max 50,000 rows cap, 5 MB file size limit</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Subtab: Developer API Keys ── */}
      {activeSubTab === 'apikeys' && (
        <div className="space-y-6">
          {/* Key Generator Card */}
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="text-sm font-bold text-navy mb-1 flex items-center gap-2">
              <span>🔑</span> Generate Programmatic API Key
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Issue ephemeral developer keys (<code>sk_test_...</code>) for CI/CD pipelines and external integrations.
            </p>

            <form onSubmit={handleGenerateKey} className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                placeholder="Key label (e.g. CI/CD Pipeline, QA Service)..."
                className="flex-1 px-3.5 py-2 rounded-lg border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal"
              />
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-teal text-white text-xs font-semibold hover:bg-teal-600 transition-colors shadow-sm"
              >
                + Generate Key
              </button>
            </form>

            {generatedKey && (
              <div className="mt-4 p-4 rounded-xl bg-teal-50 border border-teal-200 animate-fade-in">
                <div className="text-xs font-bold text-teal-900 mb-1">New API Key Created!</div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    readOnly
                    value={generatedKey}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-white border border-teal-300 font-mono text-xs text-navy"
                  />
                  <button
                    onClick={() => copyToClipboard(generatedKey, 'new')}
                    className="px-3 py-1.5 rounded-lg bg-teal text-white text-xs font-medium hover:bg-teal-600 transition-colors"
                  >
                    {copiedKey === 'new' ? 'Copied! ✓' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Active Keys Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h4 className="text-xs font-bold text-navy uppercase tracking-wider">Active Keys ({apiKeys.length})</h4>
            </div>
            {apiKeys.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400">
                No developer keys generated yet. Use the form above to create one.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Key</th>
                      <th className="py-2.5 px-4 font-semibold">Label</th>
                      <th className="py-2.5 px-4 font-semibold">Created</th>
                      <th className="py-2.5 px-4 font-semibold">Requests</th>
                      <th className="py-2.5 px-4 font-semibold">Status</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-mono">
                    {apiKeys.map((k) => (
                      <tr key={k.key_full} className="hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4 font-medium text-navy">
                          {k.key_preview}
                        </td>
                        <td className="py-3 px-4 font-sans text-gray-600">{k.label}</td>
                        <td className="py-3 px-4 font-sans text-gray-400">
                          {new Date(k.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 font-sans text-gray-600">{k.requests_made}</td>
                        <td className="py-3 px-4 font-sans">
                          {k.active ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200">
                              Active
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-semibold border border-gray-200">
                              Revoked
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-sans">
                          {k.active && (
                            <button
                              onClick={() => handleRevokeKey(k.key_full)}
                              className="text-red-600 hover:text-red-700 text-xs font-medium"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Subtab: Ephemeral Audit Log ── */}
      {activeSubTab === 'audit' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-navy uppercase tracking-wider">
                Ephemeral Generation Audit ({auditEntries.length} entries)
              </h4>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Sliding window in memory • Zero PII retention • Automatic garbage collection
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200 self-start sm:self-auto">
              Zero PII Enforced
            </span>
          </div>

          {auditEntries.length === 0 ? (
            <div className="p-12 text-center text-xs text-gray-400">
              No generation activities recorded yet. Run a tabular, relational, or document generation to see live logs!
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 sticky top-0 border-b border-gray-200 text-gray-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Timestamp (UTC)</th>
                    <th className="py-2.5 px-4 font-semibold">Endpoint</th>
                    <th className="py-2.5 px-4 font-semibold">Rows</th>
                    <th className="py-2.5 px-4 font-semibold">Privacy Noise</th>
                    <th className="py-2.5 px-4 font-semibold">Latency</th>
                    <th className="py-2.5 px-4 font-semibold">IP Hash</th>
                    <th className="py-2.5 px-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono text-[11px]">
                  {[...auditEntries].reverse().map((entry, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                      <td className="py-2 px-4 text-gray-500">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '—'}
                      </td>
                      <td className="py-2 px-4 font-semibold text-navy font-mono">
                        {entry.endpoint}
                      </td>
                      <td className="py-2 px-4 font-sans text-gray-700">
                        {entry.row_count ?? 0}
                      </td>
                      <td className="py-2 px-4 font-sans">
                        {entry.privacy_noise_enabled ? (
                          <span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-[10px] font-semibold border border-teal-200">
                            Laplace Active
                          </span>
                        ) : (
                          <span className="text-gray-400 text-[10px]">None</span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-gray-600 font-sans">
                        {entry.execution_time_ms ? `${entry.execution_time_ms} ms` : '—'}
                      </td>
                      <td className="py-2 px-4 text-gray-400 font-mono text-[10px]">
                        {entry.ip_hash || 'anon'}
                      </td>
                      <td className="py-2 px-4 font-sans">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200">
                          {entry.status || 'success'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
