import { useState, useCallback, useRef } from 'react'
import ConfigPanel from '../components/ConfigPanel'
import PreviewTable from '../components/PreviewTable'
import ExportButton from '../components/ExportButton'
import { uploadFile, generateTabular, exportTabular, getQualityReport, inferSchema } from '../api'
import { LOCALES } from '../locales'

const COLUMN_TYPES = [
  'id', 'name', 'email', 'phone', 'address', 'integer', 'float',
  'categorical', 'currency', 'datetime', 'text', 'uuid',
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
      { name: 'currency', type: 'categorical', stats: { categories: { USD: 0.45, EUR: 0.20, GBP: 0.15, PKR: 0.20 } } },
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
  const [activePreset, setActivePreset] = useState(null)

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

  // ── Helper to execute generation with specific overrides ──
  const runGeneration = useCallback(async (
    targetSchema = schema,
    targetRules = privacyRules,
    targetRowCount = rowCount,
    targetSeed = seed,
    targetLocale = locale
  ) => {
    if (!targetSchema.length) return
    setGenerating(true)
    setError('')
    try {
      const rules = Object.entries(targetRules)
        .filter(([, method]) => method !== 'none')
        .map(([col, method]) => {
          const colDef = targetSchema.find(s => s.name === col)
          return {
            column: col,
            method,
            col_type: colDef?.type || 'text',
            epsilon: 1.0,
          }
        })

      const result = await generateTabular({
        schema: targetSchema,
        row_count: targetRowCount,
        seed: targetSeed,
        locale: targetLocale,
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
  }, [schema, privacyRules, rowCount, seed, locale, nullRate, outlierRate])

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
      setActivePreset(null)
      // Reset privacy rules
      const rules = {}
      result.schema.forEach(col => { rules[col.name] = 'none' })
      setPrivacyRules(rules)
      // Auto generate preview
      await runGeneration(result.schema, rules)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }, [runGeneration])

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

  // ── Manual Generate ──
  const handleGenerate = useCallback(async () => {
    if (!schema.length) {
      setError('Define or select a schema first.')
      return
    }
    await runGeneration()
  }, [schema, runGeneration])

  // ── Randomize Seed ──
  const handleRandomizeSeed = useCallback(async () => {
    const newSeed = Math.floor(Math.random() * 900000) + 10000
    setSeed(newSeed)
    if (schema.length > 0) {
      await runGeneration(schema, privacyRules, rowCount, newSeed, locale)
    }
  }, [schema, privacyRules, rowCount, locale, runGeneration])

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

  // ── Preset (Instantly sets schema AND generates preview data!) ──
  const loadPreset = useCallback(async (preset) => {
    setActivePreset(preset.label)
    setSchema(preset.schema)
    const rules = {}
    preset.schema.forEach(col => { rules[col.name] = 'none' })
    setPrivacyRules(rules)
    setSessionKey('')
    setQualityReport(null)
    setError('')
    // Automatically generate preview table with data!
    await runGeneration(preset.schema, rules, rowCount, seed, locale)
  }, [rowCount, seed, locale, runGeneration])

  // ── AI schema inference (Instantly infers schema AND generates preview data!) ──
  const handleAiInfer = useCallback(async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setError('')
    try {
      const result = await inferSchema(aiPrompt)
      const cols = result.data?.columns || result.columns || []
      if (cols.length > 0) {
        setActivePreset(null)
        setSchema(cols)
        const rules = {}
        cols.forEach(col => { rules[col.name] = 'none' })
        setPrivacyRules(rules)
        setAiSource(result.source || 'ai')
        // Automatically generate preview data from inferred schema!
        await runGeneration(cols, rules, rowCount, seed, locale)
      } else {
        setError('No schema columns detected from the prompt. Try rephrasing.')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setAiLoading(false)
    }
  }, [aiPrompt, rowCount, seed, locale, runGeneration])

  // ── Manual column add ──
  const addColumn = () => {
    setActivePreset(null)
    const name = `column_${schema.length + 1}`
    setSchema([...schema, { name, type: 'text', stats: {} }])
    setPrivacyRules({ ...privacyRules, [name]: 'none' })
  }

  const removeColumn = (idx) => {
    setActivePreset(null)
    const removed = schema[idx]
    const newSchema = schema.filter((_, i) => i !== idx)
    setSchema(newSchema)
    const newRules = { ...privacyRules }
    delete newRules[removed.name]
    setPrivacyRules(newRules)
  }

  const updateColumn = (idx, key, value) => {
    setActivePreset(null)
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
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between animate-fade-in shadow-sm">
            <span className="font-medium">{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-4 font-bold">✕</button>
          </div>
        )}

        {/* Quality Report */}
        {qualityReport && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-navy">📊 Statistical Quality & Fidelity Report</h3>
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
            <button onClick={() => setQualityReport(null)} className="mt-3 text-xs text-gray-400 hover:text-gray-600 font-medium">
              Dismiss Report
            </button>
          </div>
        )}

        {/* Preview table */}
        <PreviewTable
          columns={preview.columns}
          rows={preview.rows}
          title={activePreset ? `${activePreset} (Live Preview)` : 'Tabular Preview'}
          emptyMessage="Upload a CSV, click a Quick Preset, or infer a schema to generate synthetic data"
        />
      </div>

      {/* Config panel */}
      <ConfigPanel title="Tabular Config" className="w-[440px] xl:w-[490px]">
        <div className="space-y-4">
          {/* Demo Presets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-700">Quick Presets</label>
              <span className="text-[10px] text-teal font-medium">Auto-generates preview</span>
            </div>
            <div className="space-y-2">
              {DEMO_PRESETS.map((preset, i) => {
                const isSelected = activePreset === preset.label
                return (
                  <button
                    key={i}
                    onClick={() => loadPreset(preset)}
                    className={`w-full text-left px-3 py-2.5 text-xs rounded-lg border transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-teal bg-teal/10 font-semibold text-teal-900 shadow-sm'
                        : 'border-gray-200 hover:border-teal/50 hover:bg-teal/5 text-gray-700'
                    }`}
                  >
                    <span>{preset.label}</span>
                    {isSelected && (
                      <span className="text-[10px] bg-teal text-white px-1.5 py-0.5 rounded-full font-bold">
                        Active
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* AI Schema Inference */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-700">
                🤖 AI Schema Inference
              </label>
              {aiSource && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${aiSource === 'ai' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {aiSource === 'ai' ? 'Gemini AI' : 'Smart Offline'}
                </span>
              )}
            </div>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. 500 IoT cold-storage temperature readings with device_id, warehouse_location, temp_celsius, and warning_alert"
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all resize-none h-16"
            />
            <button
              onClick={handleAiInfer}
              disabled={aiLoading || !aiPrompt.trim()}
              className="mt-1.5 w-full px-3 py-2 text-xs font-semibold rounded-lg bg-navy text-white hover:bg-navy-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-1.5"
            >
              {aiLoading ? (
                <>
                  <span className="animate-spin text-sm">⏳</span> Inferring & Generating...
                </>
              ) : (
                '⚡ Infer Schema & Generate'
              )}
            </button>
          </div>

          <hr className="border-gray-100" />

          {/* Row count */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-700">Row Count</label>
              <span className="text-[11px] font-mono text-teal font-semibold">{rowCount.toLocaleString()} rows</span>
            </div>
            <input
              type="number"
              value={rowCount}
              onChange={(e) => setRowCount(Math.max(1, Math.min(50000, parseInt(e.target.value) || 1)))}
              min={1}
              max={50000}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all font-mono"
            />
          </div>

          {/* Random seed */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-700">Random Seed</label>
              <span className="text-[10px] text-gray-400">Deterministic reproducibility</span>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all font-mono"
              />
              <button
                type="button"
                onClick={handleRandomizeSeed}
                title="Generate new random seed"
                className="px-3 py-2 bg-gray-100 hover:bg-teal hover:text-white rounded-lg text-xs font-bold transition-all border border-gray-200 flex items-center gap-1"
              >
                <span>🎲</span> Randomize
              </button>
            </div>
          </div>

          {/* Locale & Currency */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-700">Locale & Currency</label>
              <span className="text-[10px] text-teal font-semibold">
                {LOCALES.find(l => l.code === locale)?.currency || 'USD'}
              </span>
            </div>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all bg-white"
            >
              {LOCALES.map((loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.flag} {loc.label}
                </option>
              ))}
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
            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${uploading ? 'border-teal bg-teal/5' : 'border-gray-200 hover:border-teal/40'}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => handleFileUpload(e.target.files[0])}
              className="hidden"
            />
            {uploading ? (
              <div className="text-teal text-xs font-semibold animate-pulse">Profiling & Analyzing file...</div>
            ) : (
              <>
                <svg className="mx-auto mb-1.5" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A3AFC3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p className="text-xs text-gray-500 font-medium">Drop CSV/Excel here or click to profile</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Max 5 MB • Preserves statistical distributions</p>
              </>
            )}
          </div>

          {/* Schema editor */}
          {schema.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-700">Schema ({schema.length} cols)</label>
                <button onClick={addColumn} className="text-[10px] text-teal hover:text-teal-700 font-bold">+ Add Column</button>
              </div>
              {/* Mini column header */}
              <div className="flex gap-2 text-[10px] font-semibold text-gray-400 px-1 mb-1">
                <span className="flex-1">NAME</span>
                <span className="w-28">TYPE</span>
                <span className="w-24">PRIVACY</span>
                <span className="w-4"></span>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {schema.map((col, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      value={col.name}
                      onChange={(e) => updateColumn(i, 'name', e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:border-teal focus:ring-1 focus:ring-teal/30 outline-none font-mono"
                      placeholder="Column name"
                    />
                    <select
                      value={col.type}
                      onChange={(e) => updateColumn(i, 'type', e.target.value)}
                      className="w-28 px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:border-teal outline-none font-medium text-navy"
                    >
                      {COLUMN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select
                      value={privacyRules[col.name] || 'none'}
                      onChange={(e) => setPrivacyRules({ ...privacyRules, [col.name]: e.target.value })}
                      className="w-24 px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:border-teal outline-none text-gray-700"
                      title="Privacy Rule"
                    >
                      {PRIVACY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button
                      onClick={() => removeColumn(i)}
                      className="text-gray-300 hover:text-red-500 text-sm px-1 flex-shrink-0 transition-colors"
                      title="Remove column"
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!schema.length && (
            <button onClick={addColumn} className="w-full px-3 py-2 text-xs border border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-teal hover:text-teal transition-all font-medium">
              + Build Schema Manually
            </button>
          )}

          <hr className="border-gray-100" />

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !schema.length}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm ${
              generating || !schema.length
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-navy text-white hover:bg-navy-600'
            }`}
          >
            {generating ? '⏳ Generating Rows...' : '▶ Generate Preview'}
          </button>

          {/* Quality report button */}
          {schema.length > 0 && (
            <button
              onClick={handleQuality}
              className="w-full px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg text-gray-600 hover:border-teal hover:text-teal transition-all bg-white"
            >
              📊 Run Quality & Statistical Fidelity Report
            </button>
          )}

          {/* Export buttons */}
          <div>
            <div className="text-[11px] font-medium text-gray-500 mb-1.5">Export Full Dataset ({rowCount.toLocaleString()} rows)</div>
            <div className="grid grid-cols-3 gap-2">
              <ExportButton onClick={() => handleExport('csv')} disabled={exporting || !schema.length} label="CSV" loading={exporting} />
              <ExportButton onClick={() => handleExport('json')} disabled={exporting || !schema.length} label="JSON" loading={false} />
              <ExportButton onClick={() => handleExport('excel')} disabled={exporting || !schema.length} label="Excel" loading={false} />
            </div>
          </div>
        </div>
      </ConfigPanel>
    </div>
  )
}
