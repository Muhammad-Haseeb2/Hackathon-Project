import { useState, useCallback, useRef } from 'react'
import ConfigPanel from '../components/ConfigPanel'
import PreviewTable from '../components/PreviewTable'
import ExportButton from '../components/ExportButton'
import { uploadFile, generateTabular, exportTabular, getQualityReport, inferSchema } from '../api'

const COLUMN_TYPES = [
  'id', 'name', 'email', 'phone', 'address', 'integer', 'float',
  'categorical', 'datetime', 'text', 'uuid',
]

const DEMO_PRESETS = [
  {
    label: '🛒 E-commerce Customers',
    schema: [
      { name: 'customer_id', type: 'id' },
      { name: 'full_name', type: 'name' },
      { name: 'email', type: 'email' },
      { name: 'phone', type: 'phone' },
      { name: 'city', type: 'address' },
      { name: 'total_orders', type: 'integer', stats: { min: 0, max: 200, mean: 15, std: 20 } },
      { name: 'total_spent', type: 'float', stats: { min: 0, max: 10000, mean: 500, std: 800 } },
      { name: 'membership', type: 'categorical', stats: { categories: { Gold: 0.15, Silver: 0.35, Bronze: 0.50 } } },
      { name: 'signup_date', type: 'datetime', stats: { min: '2020-01-01', max: '2024-12-31' } },
    ],
  },
  {
    label: '🏥 HIPAA Masked Dataset',
    schema: [
      { name: 'patient_id', type: 'id' },
      { name: 'patient_name', type: 'name' },
      { name: 'email', type: 'email' },
      { name: 'phone', type: 'phone' },
      { name: 'age', type: 'integer', stats: { min: 18, max: 95, mean: 45, std: 18 } },
      { name: 'diagnosis', type: 'categorical', stats: { categories: { Diabetes: 0.25, Hypertension: 0.3, Asthma: 0.15, Arthritis: 0.2, Other: 0.1 } } },
      { name: 'blood_pressure', type: 'float', stats: { min: 80, max: 200, mean: 120, std: 20 } },
      { name: 'visit_date', type: 'datetime', stats: { min: '2023-01-01', max: '2024-12-31' } },
    ],
  },
  {
    label: '💰 FinTech Transactions',
    schema: [
      { name: 'transaction_id', type: 'uuid' },
      { name: 'account_holder', type: 'name' },
      { name: 'email', type: 'email' },
      { name: 'amount', type: 'float', stats: { min: 1, max: 50000, mean: 250, std: 1500 } },
      { name: 'currency', type: 'categorical', stats: { categories: { USD: 0.5, EUR: 0.25, GBP: 0.15, PKR: 0.1 } } },
      { name: 'type', type: 'categorical', stats: { categories: { debit: 0.6, credit: 0.3, transfer: 0.1 } } },
      { name: 'status', type: 'categorical', stats: { categories: { completed: 0.8, pending: 0.12, failed: 0.05, reversed: 0.03 } } },
      { name: 'timestamp', type: 'datetime', stats: { min: '2024-01-01', max: '2024-12-31' } },
    ],
  },
]

const PRIVACY_METHODS = ['none', 'mask', 'pseudonymize', 'noise']

export default function TabularTab() {
  // Config state
  const [rowCount, setRowCount] = useState(100)
  const [seed, setSeed] = useState(42)
  const [locale, setLocale] = useState('en_US')
  const [nullRate, setNullRate] = useState(0)
  const [outlierRate, setOutlierRate] = useState(0)

  // Schema state
  const [schema, setSchema] = useState([])
  const [sessionKey, setSessionKey] = useState('')

  // Privacy rules
  const [privacyRules, setPrivacyRules] = useState({})

  // Preview state
  const [preview, setPreview] = useState({ columns: [], rows: [] })
  const [qualityReport, setQualityReport] = useState(null)

  // Loading states
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [aiSource, setAiSource] = useState('')

  // AI prompt state
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const fileInputRef = useRef(null)

  // ── File upload ──
  const handleFileUpload = useCallback(async (file) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('File too large. Max 5 MB.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const result = await uploadFile(file)
      setSchema(result.schema)
      setSessionKey(result.session_key)
      // Reset privacy rules
      const rules = {}
      result.schema.forEach(col => { rules[col.name] = 'none' })
      setPrivacyRules(rules)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }, [handleFileUpload])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // ── Generate ──
  const handleGenerate = useCallback(async () => {
    if (!schema.length) {
      setError('Define a schema first.')
      return
    }
    setGenerating(true)
    setError('')
    try {
      const rules = Object.entries(privacyRules)
        .filter(([, method]) => method !== 'none')
        .map(([col, method]) => {
          const colDef = schema.find(s => s.name === col)
          return {
            column: col,
            method,
            col_type: colDef?.type || 'text',
            epsilon: 1.0,
          }
        })

      const result = await generateTabular({
        schema,
        row_count: rowCount,
        seed,
        locale,
        null_rate: nullRate / 100,
        outlier_rate: outlierRate / 100,
        privacy_rules: rules,
      })

      setPreview({ columns: result.columns, rows: result.preview })
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }, [schema, rowCount, seed, locale, nullRate, outlierRate, privacyRules])

  // ── Export ──
  const handleExport = useCallback(async (format) => {
    if (!schema.length) return
    setExporting(true)
    setError('')
    try {
      const rules = Object.entries(privacyRules)
        .filter(([, method]) => method !== 'none')
        .map(([col, method]) => {
          const colDef = schema.find(s => s.name === col)
          return { column: col, method, col_type: colDef?.type || 'text', epsilon: 1.0 }
        })

      await exportTabular({
        schema,
        row_count: rowCount,
        seed,
        locale,
        null_rate: nullRate / 100,
        outlier_rate: outlierRate / 100,
        privacy_rules: rules,
        format,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }, [schema, rowCount, seed, locale, nullRate, outlierRate, privacyRules])

  // ── Quality Report ──
  const handleQuality = useCallback(async () => {
    if (!schema.length) return
    try {
      const report = await getQualityReport({
        schema,
        row_count: rowCount,
        seed,
        locale,
        session_key: sessionKey,
      })
      setQualityReport(report)
    } catch (e) {
      setError(e.message)
    }
  }, [schema, rowCount, seed, locale, sessionKey])

  // ── Preset ──
  const loadPreset = (preset) => {
    setSchema(preset.schema)
    const rules = {}
    preset.schema.forEach(col => { rules[col.name] = 'none' })
    setPrivacyRules(rules)
    setSessionKey('')
    setPreview({ columns: [], rows: [] })
    setQualityReport(null)
  }

  // ── AI schema inference ──
  const handleAiInfer = useCallback(async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setError('')
    try {
      const result = await inferSchema(aiPrompt)
      const cols = result.data?.columns || result.columns || []
      if (cols.length > 0) {
        setSchema(cols)
        const rules = {}
        cols.forEach(col => { rules[col.name] = 'none' })
        setPrivacyRules(rules)
        setAiSource(result.source || 'ai')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setAiLoading(false)
    }
  }, [aiPrompt])

  // ── Manual column add ──
  const addColumn = () => {
    const name = `column_${schema.length + 1}`
    setSchema([...schema, { name, type: 'text', stats: {} }])
    setPrivacyRules({ ...privacyRules, [name]: 'none' })
  }

  const removeColumn = (idx) => {
    const removed = schema[idx]
    const newSchema = schema.filter((_, i) => i !== idx)
    setSchema(newSchema)
    const newRules = { ...privacyRules }
    delete newRules[removed.name]
    setPrivacyRules(newRules)
  }

  const updateColumn = (idx, key, value) => {
    const newSchema = [...schema]
    newSchema[idx] = { ...newSchema[idx], [key]: value }
    setSchema(newSchema)
  }

  return (
    <div className="flex gap-6 h-full">
      {/* Main content area */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {/* Error toast */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between animate-fade-in">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
          </div>
        )}

        {/* Quality Report */}
        {qualityReport && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-navy">📊 Quality Report</h3>
              <div className={`text-2xl font-bold ${qualityReport.overall_score >= 80 ? 'text-emerald-600' : qualityReport.overall_score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                {qualityReport.overall_score}/100
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {qualityReport.columns?.slice(0, 8).map((col, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500 truncate">{col.column}</div>
                  <div className="text-sm font-semibold mt-1">{col.score}/100</div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                    <div className="bg-teal rounded-full h-1.5 transition-all" style={{ width: `${col.score}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setQualityReport(null)} className="mt-3 text-xs text-gray-400 hover:text-gray-600">
              Dismiss
            </button>
          </div>
        )}

        {/* Preview table */}
        <PreviewTable
          columns={preview.columns}
          rows={preview.rows}
          title="Tabular Preview"
          emptyMessage="Upload a CSV, use a preset, or build a schema to get started"
        />
      </div>

      {/* Config panel */}
      <ConfigPanel title="Tabular Config">
        <div className="space-y-4">
          {/* Demo Presets */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Quick Presets</label>
            <div className="space-y-1.5">
              {DEMO_PRESETS.map((preset, i) => (
                <button
                  key={i}
                  onClick={() => loadPreset(preset)}
                  className="w-full text-left px-3 py-2 text-xs rounded-lg border border-gray-100 hover:border-teal/40 hover:bg-teal/5 transition-all"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* AI Schema Inference */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              🤖 AI Schema Inference
              {aiSource && (
                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${aiSource === 'ai' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
                  {aiSource === 'ai' ? 'AI' : 'Offline Fallback'}
                </span>
              )}
            </label>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. 500 IoT sensor readings, flag anything above 80°C"
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all resize-none h-16"
            />
            <button
              onClick={handleAiInfer}
              disabled={aiLoading || !aiPrompt.trim()}
              className="mt-1.5 w-full px-3 py-2 text-xs rounded-lg bg-navy text-white hover:bg-navy-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {aiLoading ? 'Inferring...' : 'Infer Schema'}
            </button>
          </div>

          <hr className="border-gray-100" />

          {/* Row count */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Row Count</label>
            <input
              type="number"
              value={rowCount}
              onChange={(e) => setRowCount(Math.max(1, Math.min(50000, parseInt(e.target.value) || 1)))}
              min={1}
              max={50000}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all"
            />
          </div>

          {/* Random seed */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Random Seed</label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all"
            />
          </div>

          {/* Locale */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Locale</label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all bg-white"
            >
              <option value="en_US">English (US) — $</option>
              <option value="en_GB">English (UK) — £</option>
              <option value="ur_PK">Pakistan — PKR</option>
              <option value="de_DE">German — €</option>
              <option value="fr_FR">French — €</option>
            </select>
          </div>

          {/* Null rate */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Null Rate: <span className="text-teal font-semibold">{nullRate}%</span>
            </label>
            <input type="range" min={0} max={50} value={nullRate} onChange={(e) => setNullRate(parseInt(e.target.value))} className="w-full accent-teal" />
          </div>

          {/* Outlier rate */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Outlier Rate: <span className="text-teal font-semibold">{outlierRate}%</span>
            </label>
            <input type="range" min={0} max={20} value={outlierRate} onChange={(e) => setOutlierRate(parseInt(e.target.value))} className="w-full accent-teal" />
          </div>

          <hr className="border-gray-100" />

          {/* Upload area */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors cursor-pointer ${uploading ? 'border-teal bg-teal/5' : 'border-gray-200 hover:border-teal/40'}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => handleFileUpload(e.target.files[0])}
              className="hidden"
            />
            {uploading ? (
              <div className="text-teal text-xs font-medium animate-pulse">Analyzing file...</div>
            ) : (
              <>
                <svg className="mx-auto mb-2" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A3AFC3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p className="text-xs text-gray-400">Drop CSV/Excel here or click</p>
                <p className="text-[10px] text-gray-300 mt-1">Max 5 MB</p>
              </>
            )}
          </div>

          {/* Schema editor */}
          {schema.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-600">Schema ({schema.length} cols)</label>
                <button onClick={addColumn} className="text-[10px] text-teal hover:text-teal-700 font-semibold">+ Add Column</button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {schema.map((col, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <input
                      value={col.name}
                      onChange={(e) => updateColumn(i, 'name', e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1.5 text-[11px] border border-gray-200 rounded focus:border-teal outline-none"
                      placeholder="Column name"
                    />
                    <select
                      value={col.type}
                      onChange={(e) => updateColumn(i, 'type', e.target.value)}
                      className="w-20 px-1 py-1.5 text-[11px] border border-gray-200 rounded bg-white focus:border-teal outline-none"
                    >
                      {COLUMN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select
                      value={privacyRules[col.name] || 'none'}
                      onChange={(e) => setPrivacyRules({ ...privacyRules, [col.name]: e.target.value })}
                      className="w-16 px-1 py-1.5 text-[11px] border border-gray-200 rounded bg-white focus:border-teal outline-none"
                      title="Privacy"
                    >
                      {PRIVACY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button
                      onClick={() => removeColumn(i)}
                      className="text-gray-300 hover:text-red-500 text-xs px-1 flex-shrink-0"
                      title="Remove"
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!schema.length && (
            <button onClick={addColumn} className="w-full px-3 py-2 text-xs border border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-teal hover:text-teal transition-all">
              + Build Schema Manually
            </button>
          )}

          <hr className="border-gray-100" />

          {/* Generate */}
          <button
            onClick={handleGenerate}
            disabled={generating || !schema.length}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              generating || !schema.length
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-navy text-white hover:bg-navy-600'
            }`}
          >
            {generating ? '⏳ Generating...' : '▶ Generate Preview'}
          </button>

          {/* Quality report button */}
          {schema.length > 0 && (
            <button
              onClick={handleQuality}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg text-gray-500 hover:border-teal hover:text-teal transition-all"
            >
              📊 Run Quality Report
            </button>
          )}

          {/* Export buttons */}
          <div className="grid grid-cols-3 gap-2">
            <ExportButton onClick={() => handleExport('csv')} disabled={exporting || !schema.length} label="CSV" loading={exporting} />
            <ExportButton onClick={() => handleExport('json')} disabled={exporting || !schema.length} label="JSON" loading={false} />
            <ExportButton onClick={() => handleExport('excel')} disabled={exporting || !schema.length} label="Excel" loading={false} />
          </div>
        </div>
      </ConfigPanel>
    </div>
  )
}
