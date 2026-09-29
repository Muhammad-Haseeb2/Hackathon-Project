import { useState, useCallback } from 'react'
import ConfigPanel from '../components/ConfigPanel'
import PreviewTable from '../components/PreviewTable'
import ExportButton from '../components/ExportButton'
import { generateRelational, exportRelational } from '../api'
import { LOCALES } from '../locales'

export default function RelationalTab() {
  const [customerCount, setCustomerCount] = useState(50)
  const [seed, setSeed] = useState(42)
  const [locale, setLocale] = useState('en_US')

  const [tables, setTables] = useState({})
  const [activeTable, setActiveTable] = useState('')
  const [validation, setValidation] = useState(null)

  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  // ── Generate ──
  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setError('')
    try {
      const result = await generateRelational({
        customer_count: customerCount,
        seed,
        locale,
      })
      setTables(result.tables)
      setValidation(result.validation)
      // Set first table as active
      const firstTable = Object.keys(result.tables)[0]
      setActiveTable(firstTable || '')
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }, [customerCount, seed, locale])

  // ── Export ──
  const handleExport = useCallback(async (format) => {
    setExporting(true)
    setError('')
    try {
      await exportRelational({
        customer_count: customerCount,
        seed,
        locale,
        format,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }, [customerCount, seed, locale])

  const currentTable = tables[activeTable]

  return (
    <div className="flex gap-6 h-full">
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
          <div className={`px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-3 animate-fade-in ${
            validation.all_valid
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            <span className="text-lg">{validation.all_valid ? '✅' : '❌'}</span>
            <div>
              <div className="font-semibold">
                {validation.all_valid ? 'Integrity Verified' : 'Integrity Issues Found'}
              </div>
              <div className="text-xs mt-0.5 opacity-75">
                {validation.checks?.orphan_keys?.all_valid ? '✓ Zero orphan keys' : '✗ Orphan keys found'}
                {' • '}
                {validation.checks?.order_totals?.valid ? '✓ All totals reconcile' : validation.checks?.order_totals ? '✗ Total mismatches' : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Table sub-tabs */}
        {Object.keys(tables).length > 0 && (
          <div className="flex gap-2">
            {Object.entries(tables).map(([name, table]) => (
              <button
                key={name}
                onClick={() => setActiveTable(name)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTable === name
                    ? 'bg-teal text-white shadow-md'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-teal/40'
                }`}
              >
                {name}
                <span className="ml-2 text-xs opacity-75">({table.total_rows})</span>
              </button>
            ))}
          </div>
        )}

        {/* Preview */}
        <PreviewTable
          columns={currentTable?.columns || []}
          rows={currentTable?.rows || []}
          title={activeTable ? `${activeTable} Preview` : 'Relational Preview'}
          emptyMessage="Generate linked datasets to see Customers → Orders → Order Items"
        />
      </div>

      {/* Config panel */}
      <ConfigPanel title="Relational Config">
        <div className="space-y-4">
          {/* Info */}
          <div className="bg-navy/5 rounded-lg p-3">
            <p className="text-[11px] text-navy/70 leading-relaxed">
              <strong>Default template:</strong> Customers → Orders → Order Items with referential integrity and computed totals.
            </p>
          </div>

          {/* Customer count */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Customer Count</label>
            <input
              type="number"
              value={customerCount}
              onChange={(e) => setCustomerCount(Math.max(1, Math.min(5000, parseInt(e.target.value) || 1)))}
              min={1}
              max={5000}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all"
            />
            <p className="text-[10px] text-gray-400 mt-1">Orders and items scale automatically (1-5 orders/customer, 1-4 items/order)</p>
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
            <p className="text-[11px] text-teal-700 font-semibold mb-1">🔐 Mathematical Guarantees</p>
            <ul className="text-[10px] text-teal-600 space-y-0.5">
              <li>• Zero orphan foreign keys</li>
              <li>• Σ(qty × price) − discount + tax = total</li>
              <li>• All computed in Python, never by LLM</li>
            </ul>
          </div>

          <hr className="border-gray-100" />

          {/* Generate */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              generating ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-navy text-white hover:bg-navy-600'
            }`}
          >
            {generating ? '⏳ Generating...' : '▶ Generate Tables'}
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
