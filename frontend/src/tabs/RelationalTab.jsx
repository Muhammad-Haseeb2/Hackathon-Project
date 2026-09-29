import { useState, useCallback, useEffect } from 'react'
import ConfigPanel from '../components/ConfigPanel'
import PreviewTable from '../components/PreviewTable'
import ExportButton from '../components/ExportButton'
import RelationalComparison from '../components/RelationalComparison'
import { generateRelational, exportRelational, getRelationalSampleInfo, learnRelational } from '../api'
import { LOCALES } from '../locales'

export default function RelationalTab() {
  const [customerCount, setCustomerCount] = useState(50)
  const [seed, setSeed] = useState(42)
  const [locale, setLocale] = useState('en_US')

  // Relational Learning Mode state
  const [useLearned, setUseLearned] = useState(true)
  const [modelId, setModelId] = useState('')
  const [sampleMeta, setSampleMeta] = useState(null)
  const [learnedSummary, setLearnedSummary] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [learningLoading, setLearningLoading] = useState(false)
  const [showConfig, setShowConfig] = useState(true)

  // Custom upload state
  const [uploadMode, setUploadMode] = useState('sample') // 'sample' | 'custom'
  const [custFile, setCustFile] = useState(null)
  const [ordsFile, setOrdsFile] = useState(null)
  const [itemsFile, setItemsFile] = useState(null)

  const [tables, setTables] = useState({})
  const [activeTable, setActiveTable] = useState('')
  const [validation, setValidation] = useState(null)

  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  // ── Load Sample Metadata on Mount ──
  useEffect(() => {
    getRelationalSampleInfo()
      .then((data) => {
        setSampleMeta(data)
        if (data.summary) {
          setLearnedSummary(data.summary)
        }
      })
      .catch((e) => {
        console.warn('Could not fetch relational sample metadata:', e)
      })
  }, [])

  // ── Handle Learn from Custom Files ──
  const handleLearnCustom = async () => {
    if (!custFile || !ordsFile || !itemsFile) {
      setError('Please provide all 3 CSV files: Customers, Orders, and Order Items.')
      return
    }
    setLearningLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('customers_file', custFile)
      formData.append('orders_file', ordsFile)
      formData.append('order_items_file', itemsFile)

      const result = await learnRelational(formData)
      setModelId(result.model_id)
      setLearnedSummary(result.learned_summary)
      setUseLearned(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLearningLoading(false)
    }
  }

  // ── Handle Load Built-in Sample ──
  const handleLoadSample = async () => {
    setLearningLoading(true)
    setError('')
    try {
      const result = await learnRelational({ use_sample: true })
      setModelId(result.model_id)
      setLearnedSummary(result.learned_summary)
      setUseLearned(true)
      setUploadMode('sample')
    } catch (e) {
      setError(e.message)
    } finally {
      setLearningLoading(false)
    }
  }

  // ── Generate ──
  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setError('')
    try {
      const result = await generateRelational({
        customer_count: customerCount,
        seed,
        locale,
        use_learned: useLearned,
        model_id: modelId || undefined,
      })
      setTables(result.tables)
      setValidation(result.validation)
      setComparison(result.comparison)

      // Set first table as active if none selected
      const tableNames = Object.keys(result.tables)
      if (tableNames.length > 0 && (!activeTable || !result.tables[activeTable])) {
        setActiveTable(tableNames[0])
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }, [customerCount, seed, locale, useLearned, modelId, activeTable])

  // ── Export ──
  const handleExport = useCallback(async (format) => {
    setExporting(true)
    setError('')
    try {
      await exportRelational({
        customer_count: customerCount,
        seed,
        locale,
        use_learned: useLearned,
        model_id: modelId || undefined,
        format,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }, [customerCount, seed, locale, useLearned, modelId])

  const currentTable = tables[activeTable]

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm flex items-center justify-between animate-fade-in shadow-xs">
          <span className="font-medium">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-4 font-bold">✕</button>
        </div>
      )}

      {/* ── 1. UNIFIED RELATIONAL COMMAND BAR ── */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Mode Toggle & Training Source */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setUseLearned(true)}
              className={`py-1.5 px-3 text-xs font-bold rounded-lg transition ${
                useLearned ? 'bg-white text-teal-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🧠 Learned Mode
            </button>
            <button
              type="button"
              onClick={() => setUseLearned(false)}
              className={`py-1.5 px-3 text-xs font-bold rounded-lg transition ${
                !useLearned ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📋 Fixed Template
            </button>
          </div>

          {useLearned && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setUploadMode('sample'); handleLoadSample(); }}
                disabled={learningLoading}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition ${
                  uploadMode === 'sample'
                    ? 'bg-teal-50 border-teal-300 text-teal-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                ⚡ Bundled E-Commerce Sample
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('custom')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition ${
                  uploadMode === 'custom'
                    ? 'bg-teal-50 border-teal-300 text-teal-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                📁 Custom CSVs
              </button>
            </div>
          )}
        </div>

        {/* Right: Generate Action & Config Toggle */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-teal-700 to-teal-800 text-white hover:from-teal-800 hover:to-teal-900 disabled:opacity-50 transition shadow-sm flex items-center gap-2"
          >
            {generating ? (
              <>
                <span className="animate-spin text-sm">⏳</span> Generating Tables...
              </>
            ) : (
              <>
                <span>▶</span> Generate Linked Tables
              </>
            )}
          </button>

          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`px-3 py-2 text-xs font-semibold rounded-xl border transition flex items-center gap-1.5 ${
              showConfig
                ? 'bg-slate-100 text-slate-800 border-slate-300'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span>⚙️</span>
            <span>{showConfig ? 'Hide Config' : 'Config'}</span>
          </button>
        </div>
      </div>

      {/* Custom Upload Drawer if active */}
      {useLearned && uploadMode === 'custom' && (
        <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Upload Relational Tables (Customers, Orders, Order Items)
            </h4>
            <span className="text-[11px] text-slate-400">CSV format</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
              <label className="block text-xs font-semibold text-slate-700 mb-1">1. Customers CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setCustFile(e.target.files?.[0] || null)}
                className="text-xs w-full text-slate-600"
              />
            </div>
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
              <label className="block text-xs font-semibold text-slate-700 mb-1">2. Orders CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setOrdsFile(e.target.files?.[0] || null)}
                className="text-xs w-full text-slate-600"
              />
            </div>
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
              <label className="block text-xs font-semibold text-slate-700 mb-1">3. Order Items CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setItemsFile(e.target.files?.[0] || null)}
                className="text-xs w-full text-slate-600"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleLearnCustom}
            disabled={learningLoading || !custFile || !ordsFile || !itemsFile}
            className="px-4 py-2 text-xs font-bold bg-teal-700 text-white rounded-xl hover:bg-teal-800 transition disabled:opacity-40"
          >
            {learningLoading ? 'Extracting Distributions...' : 'Extract & Fit Learned Distributions'}
          </button>
        </div>
      )}

      {/* ── 2. MATHEMATICAL INTEGRITY BANNER ── */}
      {validation && (
        <div className={`px-5 py-4 rounded-3xl text-sm font-medium flex items-center justify-between gap-4 shadow-2xs ${
          validation.all_valid
            ? 'bg-emerald-50/80 border border-emerald-200 text-emerald-900'
            : 'bg-red-50 border border-red-200 text-red-900'
        }`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{validation.all_valid ? '✅' : '❌'}</span>
            <div>
              <div className="font-bold flex items-center gap-2">
                <span>{validation.all_valid ? 'Mathematical Referential Integrity Verified' : 'Integrity Issues Detected'}</span>
                {useLearned && (
                  <span className="text-[10px] bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full font-mono font-bold">
                    Learned Distributions
                  </span>
                )}
              </div>
              <div className="text-xs mt-0.5 opacity-85">
                {validation.checks?.orphan_keys?.all_valid ? '✓ Zero orphan foreign keys' : '✗ Orphan foreign keys found'}
                {' • '}
                {validation.checks?.order_totals?.valid ? '✓ Strict reconciliation: Σ(qty × price) − discount + tax = total' : '✗ Totals mismatch'}
              </div>
            </div>
          </div>
          <div className="text-right text-xs opacity-75 hidden sm:block font-mono">
            Seed: <strong>{seed}</strong>
          </div>
        </div>
      )}

      {/* ── 3. WORKSPACE: TABLES & COMPARISON REPORT + OPTIONAL CONFIG DRAWER ── */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col gap-6 min-w-0 w-full">
          {/* Comparison Table / Cards (Real vs Synthetic Distributions) */}
          {comparison && (
            <RelationalComparison comparison={comparison} isLearned={useLearned} />
          )}

          {/* Table Sub-Tabs */}
          {Object.keys(tables).length > 0 && (
            <div className="flex gap-2 border-b border-slate-200 pb-2">
              {Object.entries(tables).map(([name, table]) => (
                <button
                  key={name}
                  onClick={() => setActiveTable(name)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                    activeTable === name
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="capitalize">{name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    activeTable === name ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {table.total_rows}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Preview */}
          <PreviewTable
            columns={currentTable?.columns || []}
            rows={currentTable?.rows || []}
            title={activeTable ? `${activeTable} Table Preview` : 'Linked Relational Tables'}
            emptyMessage="Generate linked datasets to preview Customers → Orders → Order Items with referential integrity"
          />
        </div>

        {/* Configuration Panel */}
        {showConfig && (
          <ConfigPanel
            title="Relational Settings"
            className="w-full lg:w-[320px] shrink-0"
            badge={useLearned ? 'Learned' : 'Template'}
          >
            <div className="space-y-4">
              {/* Customer count */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Customer Count</label>
                  <span className="text-xs font-mono font-bold text-teal-700">{customerCount}</span>
                </div>
                <input
                  type="number"
                  value={customerCount}
                  onChange={(e) => setCustomerCount(Math.max(1, Math.min(5000, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={5000}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:ring-2 focus:ring-teal-200 focus:border-teal-600 outline-none"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Orders &amp; items scale automatically using {useLearned ? 'learned frequencies' : 'template bounds'}
                </p>
              </div>

              {/* Seed */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Seed</label>
                  <button
                    type="button"
                    onClick={() => setSeed(Math.floor(Math.random() * 900000) + 10000)}
                    className="text-[10px] text-teal-700 font-bold hover:underline"
                  >
                    🎲 Randomize
                  </button>
                </div>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:ring-2 focus:ring-teal-200 focus:border-teal-600 outline-none"
                />
              </div>

              {/* Locale */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Locale</label>
                <select
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-200 focus:border-teal-600 outline-none bg-white"
                >
                  {LOCALES.map((loc) => (
                    <option key={loc.code} value={loc.code}>
                      {loc.flag} {loc.label}
                    </option>
                  ))}
                </select>
              </div>

              <hr className="border-slate-100" />

              {/* Mathematical Guarantees */}
              <div className="bg-teal-50/70 border border-teal-200/80 rounded-2xl p-3.5 space-y-1">
                <span className="text-[11px] font-bold text-teal-900 block uppercase tracking-wider">
                  🔐 Mathematical Guarantees
                </span>
                <ul className="text-[10px] text-teal-800 space-y-0.5">
                  <li>• Zero orphan foreign keys</li>
                  <li>• Σ(qty × price) − discount + tax = total</li>
                  <li>• Strict Python evaluation, zero hallucinations</li>
                </ul>
              </div>

              <hr className="border-slate-100" />

              {/* Export Buttons */}
              <div>
                <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Export Linked Tables
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ExportButton
                    onClick={() => handleExport('zip')}
                    disabled={exporting || !Object.keys(tables).length}
                    label="ZIP (CSVs)"
                    loading={exporting}
                  />
                  <ExportButton
                    onClick={() => handleExport('sql')}
                    disabled={exporting || !Object.keys(tables).length}
                    label="SQL Dump"
                    loading={false}
                  />
                </div>
              </div>
            </div>
          </ConfigPanel>
        )}
      </div>
    </div>
  )
}
