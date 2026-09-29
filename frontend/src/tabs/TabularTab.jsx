import { useState, useCallback, useRef, useEffect } from 'react'
import ConfigPanel from '../components/ConfigPanel'
import PreviewTable from '../components/PreviewTable'
import ExportButton from '../components/ExportButton'
import FidelityReport from '../components/FidelityReport'
import {
  uploadFile,
  generateTabular,
  exportTabular,
  getQualityReport,
  getFidelityReport,
  listSamples,
  loadSample,
  inferSchema,
} from '../api'
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
  const [rowCount, setRowCount] = useState(1000)
  const [seed, setSeed] = useState(42)
  const [locale, setLocale] = useState('en_US')
  const [nullRate, setNullRate] = useState(0)
  const [outlierRate, setOutlierRate] = useState(0)

  // Schema & Session store state
  const [schema, setSchema] = useState([])
  const [sessionKey, setSessionKey] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [datasetName, setDatasetName] = useState('')
  const [activePreset, setActivePreset] = useState(null)

  // Bundled sample datasets list
  const [samplesList, setSamplesList] = useState([
    { name: 'hr_employees', title: 'HR Employees (Age, Exp, Salary, Dept, City)' },
    { name: 'retail_sales', title: 'Retail Sales (Price, Quantity, Revenue, Category)' },
    { name: 'patient_vitals', title: 'Patient Vitals (Age, BMI, BP, Cholesterol, Smoking)' },
  ])

  // Privacy rules
  const [privacyRules, setPrivacyRules] = useState({})

  // Preview state
  const [preview, setPreview] = useState({ columns: [], rows: [] })
  const [methodUsed, setMethodUsed] = useState('copula')
  const [qualityReport, setQualityReport] = useState(null)

  // Fidelity report state (Step 4 & 5)
  const [fidelityReport, setFidelityReport] = useState(null)
  const [fidelityLoading, setFidelityLoading] = useState(false)

  // UI state
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [aiSource, setAiSource] = useState('')

  // AI prompt state
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const fileInputRef = useRef(null)

  // Load available sample datasets on mount
  useEffect(() => {
    listSamples()
      .then((res) => {
        if (res?.samples?.length) {
          setSamplesList(res.samples)
        }
      })
      .catch(() => {})
  }, [])

  // ── Helper to execute generation with specific overrides ──
  const runGeneration = useCallback(
    async (
      targetSchema = schema,
      targetRules = privacyRules,
      targetRowCount = rowCount,
      targetSeed = seed,
      targetLocale = locale,
      targetDatasetId = datasetId
    ) => {
      if (!targetSchema.length && !targetDatasetId) return
      setGenerating(true)
      setError('')
      try {
        const rules = Object.entries(targetRules)
          .filter(([, method]) => method !== 'none')
          .map(([col, method]) => {
            const colDef = targetSchema.find((s) => s.name === col)
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
          dataset_id: targetDatasetId || undefined,
          method: targetDatasetId ? 'copula' : 'auto',
        })

        setPreview({ columns: result.columns, rows: result.preview })
        if (result.method) setMethodUsed(result.method)
      } catch (e) {
        setError(e.message)
      } finally {
        setGenerating(false)
      }
    },
    [schema, privacyRules, rowCount, seed, locale, nullRate, outlierRate, datasetId]
  )

  // ── Load Bundled Demo Dataset ──
  const handleLoadSample = useCallback(
    async (sampleName) => {
      if (!sampleName) return
      setUploading(true)
      setError('')
      try {
        const result = await loadSample(sampleName)
        setSchema(result.schema)
        setDatasetId(result.dataset_id)
        setDatasetName(result.sample_info?.title || sampleName)
        setActivePreset(null)

        // Reset privacy rules
        const rules = {}
        result.schema.forEach((col) => {
          rules[col.name] = 'none'
        })
        setPrivacyRules(rules)

        // Automatically generate preview table using Copula
        await runGeneration(result.schema, rules, rowCount, seed, locale, result.dataset_id)

        // Automatically trigger Fidelity Report for instant demo WOW factor
        setFidelityLoading(true)
        try {
          const rep = await getFidelityReport({
            dataset_id: result.dataset_id,
            row_count: rowCount,
            seed: seed,
          })
          setFidelityReport(rep)
        } catch (err) {
          console.warn('Auto fidelity report error:', err)
        } finally {
          setFidelityLoading(false)
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setUploading(false)
      }
    },
    [rowCount, seed, locale, runGeneration]
  )

  // ── File upload ──
  const handleFileUpload = useCallback(
    async (file) => {
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
        setSessionKey(result.session_key || '')
        if (result.dataset_id) {
          setDatasetId(result.dataset_id)
          setDatasetName(file.name)
        }
        setActivePreset(null)
        // Reset privacy rules
        const rules = {}
        result.schema.forEach((col) => {
          rules[col.name] = 'none'
        })
        setPrivacyRules(rules)

        // Auto generate preview using copula
        await runGeneration(result.schema, rules, rowCount, seed, locale, result.dataset_id)

        // If dataset_id was created, run the fidelity report
        if (result.dataset_id) {
          setFidelityLoading(true)
          try {
            const rep = await getFidelityReport({
              dataset_id: result.dataset_id,
              row_count: rowCount,
              seed: seed,
            })
            setFidelityReport(rep)
          } catch (err) {
            console.warn('Auto fidelity report error:', err)
          } finally {
            setFidelityLoading(false)
          }
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setUploading(false)
      }
    },
    [rowCount, seed, locale, runGeneration]
  )

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      const file = e.dataTransfer.files[0]
      if (file) handleFileUpload(file)
    },
    [handleFileUpload]
  )

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // ── Manual Generate ──
  const handleGenerate = useCallback(async () => {
    if (!schema.length && !datasetId) {
      setError('Define or select a schema or load a dataset first.')
      return
    }
    await runGeneration()
  }, [schema, datasetId, runGeneration])

  // ── "Generate and Compare" (Fidelity Report) ──
  const handleGenerateAndCompare = useCallback(async () => {
    if (!datasetId) {
      setError('Please upload a CSV or select a bundled sample dataset to run the Fidelity Report.')
      return
    }
    setFidelityLoading(true)
    setError('')
    try {
      // 1. Refresh preview
      await runGeneration(schema, privacyRules, rowCount, seed, locale, datasetId)

      // 2. Fetch fidelity report
      const rep = await getFidelityReport({
        dataset_id: datasetId,
        row_count: rowCount,
        seed: seed,
      })
      setFidelityReport(rep)
    } catch (e) {
      setError(e.message)
    } finally {
      setFidelityLoading(false)
    }
  }, [datasetId, schema, privacyRules, rowCount, seed, locale, runGeneration])

  // ── Randomize Seed ──
  const handleRandomizeSeed = useCallback(async () => {
    const newSeed = Math.floor(Math.random() * 900000) + 10000
    setSeed(newSeed)
    if (schema.length > 0 || datasetId) {
      await runGeneration(schema, privacyRules, rowCount, newSeed, locale, datasetId)
      if (datasetId) {
        setFidelityLoading(true)
        try {
          const rep = await getFidelityReport({
            dataset_id: datasetId,
            row_count: rowCount,
            seed: newSeed,
          })
          setFidelityReport(rep)
        } catch {
          // silent fail on seed randomize report
        } finally {
          setFidelityLoading(false)
        }
      }
    }
  }, [schema, datasetId, privacyRules, rowCount, locale, runGeneration])

  // ── Export ──
  const handleExport = useCallback(
    async (format) => {
      if (!schema.length && !datasetId) return
      setExporting(true)
      setError('')
      try {
        const rules = Object.entries(privacyRules)
          .filter(([, method]) => method !== 'none')
          .map(([col, method]) => {
            const colDef = schema.find((s) => s.name === col)
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
          dataset_id: datasetId || undefined,
          method: datasetId ? 'copula' : 'auto',
        })
      } catch (e) {
        setError(e.message)
      } finally {
        setExporting(false)
      }
    },
    [schema, datasetId, rowCount, seed, locale, nullRate, outlierRate, privacyRules]
  )

  // ── Quality Report (Legacy) ──
  const handleQuality = useCallback(async () => {
    if (!schema.length) return
    try {
      const report = await getQualityReport({
        schema,
        row_count: rowCount,
        seed,
        locale,
        session_key: sessionKey,
        dataset_id: datasetId,
      })
      setQualityReport(report)
    } catch (e) {
      setError(e.message)
    }
  }, [schema, rowCount, seed, locale, sessionKey, datasetId])

  // ── Preset (Instantly sets schema AND generates preview data!) ──
  const loadPreset = useCallback(
    async (preset) => {
      setActivePreset(preset.label)
      setDatasetId('')
      setDatasetName('')
      setFidelityReport(null)
      setSchema(preset.schema)
      const rules = {}
      preset.schema.forEach((col) => {
        rules[col.name] = 'none'
      })
      setPrivacyRules(rules)
      setSessionKey('')
      setQualityReport(null)
      setError('')
      await runGeneration(preset.schema, rules, rowCount, seed, locale, '')
    },
    [rowCount, seed, locale, runGeneration]
  )

  // ── AI schema inference ──
  const handleAiInfer = useCallback(async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setError('')
    try {
      const result = await inferSchema(aiPrompt)
      const cols = result.data?.columns || result.columns || []
      if (cols.length > 0) {
        setActivePreset(null)
        setDatasetId('')
        setDatasetName('')
        setFidelityReport(null)
        setSchema(cols)
        const rules = {}
        cols.forEach((col) => {
          rules[col.name] = 'none'
        })
        setPrivacyRules(rules)
        setAiSource(result.source || 'ai')
        await runGeneration(cols, rules, rowCount, seed, locale, '')
      } else {
        setError('No schema columns detected from the prompt. Try rephrasing.')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setAiLoading(false)
    }
  }, [aiPrompt, rowCount, seed, locale, runGeneration])

  // ── Manual column add/remove ──
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
    <div className="flex flex-col lg:flex-row gap-6 h-full pb-12">
      {/* Main content area */}
      <div className="flex-1 flex flex-col gap-5 min-w-0">
        {/* Error toast */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between animate-fade-in shadow-xs">
            <span className="font-medium">{error}</span>
            <button
              onClick={() => setError('')}
              className="text-red-400 hover:text-red-600 ml-4 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── 7. SAMPLE DATASETS BAR & QUICK ACTIONS ── */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center text-[#167A6C] font-bold text-sm shrink-0">
              📊
            </div>
            <div>
              <div className="text-xs font-semibold text-[#16233B]">
                Bundled Demo Datasets (1-Click Load)
              </div>
              <div className="text-[11px] text-slate-500">
                Pre-loaded with strong statistical correlations (no upload needed).
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={datasetName ? samplesList.find((s) => s.title === datasetName || s.name === datasetName)?.name || '' : ''}
              onChange={(e) => handleLoadSample(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-xl font-medium text-[#16233B] focus:ring-2 focus:ring-[#167A6C] outline-none"
            >
              <option value="">Choose a Demo Dataset...</option>
              {samplesList.map((sample) => (
                <option key={sample.name} value={sample.name}>
                  {sample.title}
                </option>
              ))}
            </select>

            <button
              onClick={handleGenerateAndCompare}
              disabled={fidelityLoading || (!datasetId && !schema.length)}
              className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-[#167A6C] text-white hover:bg-teal-700 disabled:opacity-50 transition shadow-xs flex items-center gap-1.5 shrink-0"
              title="Generate synthetic data with Copula engine and compare against independent baseline"
            >
              {fidelityLoading ? (
                <>
                  <span className="animate-spin">⏳</span> Comparing...
                </>
              ) : (
                <>
                  <span>⚡</span> Generate &amp; Compare
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── 8. "HOW THE MODEL LEARNS" COLLAPSIBLE PANEL ── */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <button
            onClick={() => setIsHowItWorksOpen(!isHowItWorksOpen)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50/60 transition"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#16233B] flex items-center gap-1.5">
                <span>🧠</span> How the model learns: Statistical Joint Architecture (Copula)
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-[#167A6C] font-semibold">
                Not a Random Generator
              </span>
            </div>
            <span className="text-xs text-slate-400 font-bold">
              {isHowItWorksOpen ? '▲ Collapse' : '▼ Learn how it works'}
            </span>
          </button>

          {isHowItWorksOpen && (
            <div className="px-5 pb-5 pt-1 border-t border-slate-100 bg-[#FBFBF9]/40 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
                {/* Step 1 */}
                <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-[#16233B]">
                    <span className="w-5 h-5 rounded-full bg-teal-100 text-[#167A6C] flex items-center justify-center text-[10px]">
                      1
                    </span>
                    <span>Learn Column Shapes</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Stores empirical 200-point quantile tables for numeric/datetime marginals so
                    skewed, log-normal, and bimodal shapes are preserved exactly.
                  </p>
                </div>

                {/* Step 2 */}
                <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-[#16233B]">
                    <span className="w-5 h-5 rounded-full bg-teal-100 text-[#167A6C] flex items-center justify-center text-[10px]">
                      2
                    </span>
                    <span>Learn Dependencies</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Transforms marginals to normal scores (rank → uniform → Gaussian) and computes
                    the pairwise association matrix (Spearman, Cramér's V, eta) with PSD projection.
                  </p>
                </div>

                {/* Step 3 */}
                <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-[#16233B]">
                    <span className="w-5 h-5 rounded-full bg-teal-100 text-[#167A6C] flex items-center justify-center text-[10px]">
                      3
                    </span>
                    <span>Joint Sampling</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Draws correlated vectors from multivariate normal distribution, transforms
                    through Gaussian CDF, and inverts through quantile tables with seeded
                    determinism.
                  </p>
                </div>

                {/* Step 4 */}
                <div className="p-3.5 bg-white rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-[#16233B]">
                    <span className="w-5 h-5 rounded-full bg-teal-100 text-[#167A6C] flex items-center justify-center text-[10px]">
                      4
                    </span>
                    <span>Fidelity &amp; Privacy Proof</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Calculates Kolmogorov-Smirnov distance, TVD, association preservation vs
                    independent baseline, plus KDTree distance-to-closest-record (DCR) check.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── PREVIEW TABLE ── */}
        <PreviewTable
          columns={preview.columns}
          rows={preview.rows}
          title={
            datasetName
              ? `${datasetName} (Copula Learned Synthesis)`
              : activePreset
              ? `${activePreset} (Live Preview)`
              : 'Tabular Preview'
          }
          emptyMessage="Upload a CSV, pick a sample dataset above, or click a Quick Preset to generate synthetic data"
        />

        {/* ── STEP 5: FIDELITY REPORT SECTION ── */}
        <FidelityReport
          report={fidelityReport}
          loading={fidelityLoading}
          onRerun={handleGenerateAndCompare}
        />

        {/* Legacy Quality Report (if toggled) */}
        {qualityReport && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 animate-fade-in mt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#16233B]">
                📊 Quick Column Match Report
              </h3>
              <div
                className={`text-2xl font-bold ${
                  qualityReport.overall_score >= 80
                    ? 'text-emerald-600'
                    : qualityReport.overall_score >= 50
                    ? 'text-amber-600'
                    : 'text-red-600'
                }`}
              >
                {qualityReport.overall_score}/100
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {qualityReport.columns?.slice(0, 8).map((col, i) => (
                <div key={i} className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500 truncate">{col.column}</div>
                  <div className="text-sm font-semibold mt-1">{col.score}/100</div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1">
                    <div
                      className="bg-[#167A6C] rounded-full h-1.5 transition-all"
                      style={{ width: `${col.score}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setQualityReport(null)}
              className="mt-3 text-xs text-slate-400 hover:text-slate-600 font-medium"
            >
              Dismiss Quick Report
            </button>
          </div>
        )}
      </div>

      {/* ── RIGHT CONFIG PANEL ── */}
      <ConfigPanel title="Tabular Config" className="w-full lg:w-[420px] xl:w-[460px] shrink-0">
        <div className="space-y-4">
          {/* Active Model Indicator */}
          <div className="p-3 bg-teal-50/70 border border-teal-100 rounded-xl flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-[#167A6C]">SYNTHESIS ENGINE</div>
              <div className="text-xs font-bold text-[#16233B] capitalize">
                {datasetId ? 'Gaussian Copula (Joint Model)' : 'Independent Marginal Sampler'}
              </div>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                datasetId ? 'bg-teal-600 text-white' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {datasetId ? 'Modelled' : 'Standard'}
            </span>
          </div>

          {/* Quick Presets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700">Quick Presets</label>
              <span className="text-[10px] text-[#167A6C] font-medium">Auto-generates preview</span>
            </div>
            <div className="space-y-2">
              {DEMO_PRESETS.map((preset, i) => {
                const isSelected = activePreset === preset.label
                return (
                  <button
                    key={i}
                    onClick={() => loadPreset(preset)}
                    className={`w-full text-left px-3 py-2 text-xs rounded-xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-[#167A6C] bg-teal-50 font-semibold text-teal-900 shadow-xs'
                        : 'border-slate-200 hover:border-teal-300 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span>{preset.label}</span>
                    {isSelected && (
                      <span className="text-[10px] bg-[#167A6C] text-white px-1.5 py-0.5 rounded-full font-bold">
                        Active
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* AI Schema Inference */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">🤖 AI Schema Inference</label>
              {aiSource && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    aiSource === 'ai'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {aiSource === 'ai' ? 'Gemini AI' : 'Smart Offline'}
                </span>
              )}
            </div>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. 500 IoT cold-storage temperature readings with device_id, warehouse_location, temp_celsius, and warning_alert"
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-200 focus:border-[#167A6C] outline-none transition resize-none h-16"
            />
            <button
              onClick={handleAiInfer}
              disabled={aiLoading || !aiPrompt.trim()}
              className="mt-1.5 w-full px-3 py-2 text-xs font-semibold rounded-xl bg-[#16233B] text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-xs flex items-center justify-center gap-1.5"
            >
              {aiLoading ? (
                <>
                  <span className="animate-spin text-sm">⏳</span> Inferring &amp; Generating...
                </>
              ) : (
                '⚡ Infer Schema & Generate'
              )}
            </button>
          </div>

          <hr className="border-slate-100" />

          {/* Row count */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">Row Count</label>
              <span className="text-[11px] font-mono text-[#167A6C] font-semibold">
                {rowCount.toLocaleString()} rows
              </span>
            </div>
            <input
              type="number"
              value={rowCount}
              onChange={(e) =>
                setRowCount(Math.max(1, Math.min(50000, parseInt(e.target.value) || 1)))
              }
              min={1}
              max={50000}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-200 focus:border-[#167A6C] outline-none transition font-mono"
            />
          </div>

          {/* Random seed */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">Random Seed</label>
              <span className="text-[10px] text-slate-400">Deterministic reproducibility</span>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-200 focus:border-[#167A6C] outline-none transition font-mono"
              />
              <button
                type="button"
                onClick={handleRandomizeSeed}
                title="Generate new random seed"
                className="px-3 py-2 bg-slate-100 hover:bg-[#167A6C] hover:text-white rounded-xl text-xs font-bold transition border border-slate-200 flex items-center gap-1"
              >
                <span>🎲</span> Randomize
              </button>
            </div>
          </div>

          {/* Locale & Currency */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">Locale &amp; Currency</label>
              <span className="text-[10px] text-[#167A6C] font-semibold">
                {LOCALES.find((l) => l.code === locale)?.currency || 'USD'}
              </span>
            </div>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-200 focus:border-[#167A6C] outline-none transition bg-white"
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
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Null Rate: <span className="text-[#167A6C] font-semibold">{nullRate}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={50}
              value={nullRate}
              onChange={(e) => setNullRate(parseInt(e.target.value))}
              className="w-full accent-[#167A6C]"
            />
          </div>

          {/* Outlier rate */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Outlier Rate: <span className="text-[#167A6C] font-semibold">{outlierRate}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={20}
              value={outlierRate}
              onChange={(e) => setOutlierRate(parseInt(e.target.value))}
              className="w-full accent-[#167A6C]"
            />
          </div>

          <hr className="border-slate-100" />

          {/* Upload area */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-4 text-center transition cursor-pointer ${
              uploading
                ? 'border-[#167A6C] bg-teal-50/20'
                : 'border-slate-200 hover:border-teal-400 bg-white'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => handleFileUpload(e.target.files[0])}
              className="hidden"
            />
            {uploading ? (
              <div className="text-[#167A6C] text-xs font-semibold animate-pulse">
                Profiling &amp; Fitting Copula Model...
              </div>
            ) : (
              <>
                <svg
                  className="mx-auto mb-1.5"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#A3AFC3"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p className="text-xs text-slate-600 font-medium">
                  Drop CSV/Excel here to train Copula
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Max 5 MB • Learns joint relationships &amp; marginals
                </p>
              </>
            )}
          </div>

          {/* Schema editor */}
          {schema.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700">
                  Schema ({schema.length} cols)
                </label>
                <button
                  onClick={addColumn}
                  className="text-[10px] text-[#167A6C] hover:text-teal-800 font-bold"
                >
                  + Add Column
                </button>
              </div>
              <div className="flex gap-2 text-[10px] font-semibold text-slate-400 px-1 mb-1">
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
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-[#167A6C] focus:ring-1 focus:ring-teal-100 outline-none font-mono"
                      placeholder="Column name"
                    />
                    <select
                      value={col.type}
                      onChange={(e) => updateColumn(i, 'type', e.target.value)}
                      className="w-28 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:border-[#167A6C] outline-none font-medium text-[#16233B]"
                    >
                      {COLUMN_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <select
                      value={privacyRules[col.name] || 'none'}
                      onChange={(e) =>
                        setPrivacyRules({ ...privacyRules, [col.name]: e.target.value })
                      }
                      className="w-24 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:border-[#167A6C] outline-none text-slate-700"
                      title="Privacy Rule"
                    >
                      {PRIVACY_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeColumn(i)}
                      className="text-slate-300 hover:text-red-500 text-sm px-1 shrink-0 transition"
                      title="Remove column"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!schema.length && (
            <button
              onClick={addColumn}
              className="w-full px-3 py-2 text-xs border border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-teal-400 hover:text-[#167A6C] transition font-medium"
            >
              + Build Schema Manually
            </button>
          )}

          <hr className="border-slate-100" />

          {/* Generate & Compare Button (Prominent) */}
          <button
            onClick={handleGenerateAndCompare}
            disabled={fidelityLoading || (!datasetId && !schema.length)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition shadow-xs ${
              fidelityLoading || (!datasetId && !schema.length)
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-[#167A6C] text-white hover:bg-teal-700 shadow-teal-700/10'
            }`}
          >
            {fidelityLoading ? '⏳ Running Fidelity & Privacy Report...' : '⚡ Generate & Compare (Fidelity Report)'}
          </button>

          {/* Standard Generate Preview Button */}
          <button
            onClick={handleGenerate}
            disabled={generating || (!schema.length && !datasetId)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl transition ${
              generating || (!schema.length && !datasetId)
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-[#16233B] text-white hover:bg-slate-800'
            }`}
          >
            {generating ? '⏳ Generating Rows...' : '▶ Generate Preview Only'}
          </button>

          {/* Export buttons */}
          <div>
            <div className="text-[11px] font-medium text-slate-500 mb-1.5">
              Export Full Dataset ({rowCount.toLocaleString()} rows)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ExportButton
                onClick={() => handleExport('csv')}
                disabled={exporting || (!schema.length && !datasetId)}
                label="CSV"
                loading={exporting}
              />
              <ExportButton
                onClick={() => handleExport('json')}
                disabled={exporting || (!schema.length && !datasetId)}
                label="JSON"
                loading={false}
              />
              <ExportButton
                onClick={() => handleExport('excel')}
                disabled={exporting || (!schema.length && !datasetId)}
                label="Excel"
                loading={false}
              />
            </div>
          </div>
        </div>
      </ConfigPanel>
    </div>
  )
}
