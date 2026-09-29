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
    <div className="flex flex-col lg:flex-row gap-6 h-full">
      {/* Main content */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between animate-fade-in">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
          </div>
        )}

        {/* Validation Badge */}
        {validation && (
          <div className={`px-4 py-3 rounded-lg text-sm font-medium flex items-center justify-between gap-3 animate-fade-in ${
            validation.all_valid
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            <div className="flex items-center gap-3">
              <span className="text-xl">{validation.all_valid ? '✅' : '❌'}</span>
              <div>
                <div className="font-bold flex items-center gap-2">
                  <span>{validation.all_valid ? 'Mathematical Referential Integrity Guaranteed' : 'Integrity Issues Detected'}</span>
                  {useLearned && (
                    <span className="text-[10px] bg-teal/15 text-teal px-2 py-0.5 rounded font-mono font-semibold">
                      Learned Mode
                    </span>
                  )}
                </div>
                <div className="text-xs mt-0.5 opacity-80">
                  {validation.checks?.orphan_keys?.all_valid ? '✓ Zero orphan foreign keys' : '✗ Orphan foreign keys detected'}
                  {' • '}
                  {validation.checks?.order_totals?.valid ? '✓ Sum(qty × price) − discount + tax = total (100% reconciled)' : '✗ Total math mismatches'}
                </div>
              </div>
            </div>
            <div className="text-right text-xs opacity-75 hidden sm:block">
              Seed: <span className="font-mono font-bold">{seed}</span>
            </div>
          </div>
        )}

        {/* Comparison Table / Cards (Real vs Synthetic Distributions) */}
        {comparison && (
          <RelationalComparison comparison={comparison} isLearned={useLearned} />
        )}

        {/* Table sub-tabs */}
        {Object.keys(tables).length > 0 && (
          <div className="flex gap-2 border-b border-gray-200 pb-2">
            {Object.entries(tables).map(([name, table]) => (
              <button
                key={name}
                onClick={() => setActiveTable(name)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                  activeTable === name
                    ? 'bg-navy text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-teal/40'
                }`}
              >
                <span>{name}</span>
                <span className={`text-xs px-1.5 py-0.2 rounded font-mono ${
                  activeTable === name ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
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
          title={activeTable ? `${activeTable} Preview` : 'Relational Linked Tables'}
          emptyMessage="Generate linked datasets to preview Customers → Orders → Order Items with referential integrity"
        />
      </div>

      {/* Config panel */}
      <ConfigPanel title="Relational Generator">
        <div className="space-y-4">
          {/* Mode Selector */}
          <div>
            <label className="block text-xs font-bold text-navy uppercase tracking-wider mb-2">
              Generation Engine
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => setUseLearned(true)}
                className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-all ${
                  useLearned
                    ? 'bg-white text-teal shadow-xs'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                🧠 Learned Mode
              </button>
              <button
                type="button"
                onClick={() => setUseLearned(false)}
                className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-all ${
                  !useLearned
                    ? 'bg-white text-navy shadow-xs'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                📋 Fixed Template
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1 leading-normal">
              {useLearned
                ? 'Learns joint orders-per-customer, basket sizes, and category price distributions from real data.'
                : 'Uses fixed uniform distributions with standard e-commerce defaults.'}
            </p>
          </div>

          {/* Relational Learning Source (when learned mode is active) */}
          {useLearned && (
            <div className="bg-teal/5 border border-teal/20 rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-teal-800">Training Dataset</span>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-teal/10 text-teal-700">
                  {sampleMeta ? `${sampleMeta.tables?.customers || 500} customers` : 'Ready'}
                </span>
              </div>

              {/* Source Toggle: Sample vs Custom */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setUploadMode('sample'); handleLoadSample(); }}
                  disabled={learningLoading}
                  className={`flex-1 py-1 px-2 text-xs font-medium rounded border transition-all ${
                    uploadMode === 'sample'
                      ? 'bg-teal text-white border-teal shadow-2xs'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-teal/30'
                  }`}
                >
                  ⚡ Bundled Sample
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('custom')}
                  className={`flex-1 py-1 px-2 text-xs font-medium rounded border transition-all ${
                    uploadMode === 'custom'
                      ? 'bg-teal text-white border-teal shadow-2xs'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-teal/30'
                  }`}
                >
                  📁 Custom CSVs
                </button>
              </div>

              {uploadMode === 'sample' ? (
                <div className="text-[10px] text-gray-600 bg-white/70 rounded p-2 border border-teal/15 space-y-1">
                  <div className="font-semibold text-teal-900">Bundled E-Commerce Sample:</div>
                  <div>• 500 Customers, 1,171 Orders, 2,443 Order Items</div>
                  <div>• Real order frequencies (~2.3 orders/cust) & basket sizes</div>
                  <div>• 8 realistic category price quantiles</div>
                </div>
              ) : (
                <div className="space-y-2 bg-white/80 p-2.5 rounded border border-teal/20">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-600">Customers CSV</label>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => setCustFile(e.target.files?.[0] || null)}
                      className="text-[10px] w-full text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-600">Orders CSV</label>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => setOrdsFile(e.target.files?.[0] || null)}
                      className="text-[10px] w-full text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-600">Order Items CSV</label>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => setItemsFile(e.target.files?.[0] || null)}
                      className="text-[10px] w-full text-gray-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleLearnCustom}
                    disabled={learningLoading || !custFile || !ordsFile || !itemsFile}
                    className="w-full py-1 text-xs font-semibold bg-teal text-white rounded hover:bg-teal-600 transition-colors disabled:opacity-40"
                  >
                    {learningLoading ? 'Learning Distributions...' : 'Extract & Learn Distributions'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Customer count */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Customer Count</label>
            <input
              type="number"
              value={customerCount}
              onChange={(e) => setCustomerCount(Math.max(1, Math.min(5000, parseInt(e.target.value) || 1)))}
              min={1}
              max={5000}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Orders and items scale automatically according to {useLearned ? 'learned real frequencies' : 'template ranges'}
            </p>
          </div>

          {/* Seed */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-700">Random Seed</label>
              <button
                type="button"
                onClick={() => setSeed(Math.floor(Math.random() * 900000) + 10000)}
                className="text-[10px] text-teal hover:underline font-bold"
              >
                🎲 Randomize
              </button>
            </div>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all font-mono"
            />
          </div>

          {/* Locale */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Locale</label>
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

          <hr className="border-gray-100" />

          {/* Math guarantee */}
          <div className="bg-teal/5 border border-teal/20 rounded-lg p-3">
            <p className="text-[11px] text-teal-800 font-semibold mb-1">🔐 Mathematical Guarantees</p>
            <ul className="text-[10px] text-teal-700 space-y-0.5">
              <li>• Zero orphan foreign keys (100% referential integrity)</li>
              <li>• Σ(qty × price) − discount + tax = total</li>
              <li>• Strict Python evaluation, zero LLM hallucination</li>
            </ul>
          </div>

          <hr className="border-gray-100" />

          {/* Generate */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              generating ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-navy text-white hover:bg-navy-600 shadow-sm'
            }`}
          >
            {generating ? '⏳ Learning & Generating...' : '▶ Generate Linked Tables'}
          </button>

          {/* Export */}
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
      </ConfigPanel>
    </div>
  )
}
