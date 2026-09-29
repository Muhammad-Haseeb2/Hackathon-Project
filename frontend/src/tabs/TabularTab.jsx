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
  const [exportingFormat, setExportingFormat] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
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

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFileUpload(file)
    },
    [handleFileUpload]
  )

  // ── Privacy Helper Functions ──
  const isPrivacyActive = useCallback(
    (type) => {
      if (!schema.length) return false
      if (type === 'mask_email') {
        const emailCols = schema.filter(
          (c) => c.type === 'email' || c.name.toLowerCase().includes('email') || c.name.toLowerCase().includes('mail')
        )
        return emailCols.length > 0 && emailCols.every((c) => privacyRules[c.name] === 'mask')
      }
      if (type === 'mask_phone') {
        const phoneCols = schema.filter(
          (c) => c.type === 'phone' || c.name.toLowerCase().includes('phone') || c.name.toLowerCase().includes('tel') || c.name.toLowerCase().includes('mobile')
        )
        return phoneCols.length > 0 && phoneCols.every((c) => privacyRules[c.name] === 'mask')
      }
      if (type === 'pseudonymize_name') {
        const nameCols = schema.filter(
          (c) =>
            c.type === 'name' ||
            c.name.toLowerCase().includes('name') ||
            c.name.toLowerCase().includes('customer') ||
            c.name.toLowerCase().includes('patient') ||
            c.name.toLowerCase().includes('employee') ||
            c.name.toLowerCase().includes('holder')
        )
        return nameCols.length > 0 && nameCols.every((c) => privacyRules[c.name] === 'pseudonymize')
      }
      if (type === 'laplace_noise') {
        const numCols = schema.filter(
          (c) => c.type === 'integer' || c.type === 'float' || c.type === 'currency'
        )
        return numCols.length > 0 && numCols.some((c) => privacyRules[c.name] === 'noise')
      }
      return false
    },
    [schema, privacyRules]
  )

  const togglePrivacyOption = useCallback(
    async (type) => {
      if (!schema.length) return
      const updated = { ...privacyRules }

      if (type === 'mask_email') {
        const currentlyActive = isPrivacyActive('mask_email')
        schema.forEach((col) => {
          if (col.type === 'email' || col.name.toLowerCase().includes('email') || col.name.toLowerCase().includes('mail')) {
            updated[col.name] = currentlyActive ? 'none' : 'mask'
          }
        })
      } else if (type === 'mask_phone') {
        const currentlyActive = isPrivacyActive('mask_phone')
        schema.forEach((col) => {
          if (col.type === 'phone' || col.name.toLowerCase().includes('phone') || col.name.toLowerCase().includes('tel') || col.name.toLowerCase().includes('mobile')) {
            updated[col.name] = currentlyActive ? 'none' : 'mask'
          }
        })
      } else if (type === 'pseudonymize_name') {
        const currentlyActive = isPrivacyActive('pseudonymize_name')
        schema.forEach((col) => {
          if (
            col.type === 'name' ||
            col.name.toLowerCase().includes('name') ||
            col.name.toLowerCase().includes('customer') ||
            col.name.toLowerCase().includes('patient') ||
            col.name.toLowerCase().includes('employee') ||
            col.name.toLowerCase().includes('holder')
          ) {
            updated[col.name] = currentlyActive ? 'none' : 'pseudonymize'
          }
        })
      } else if (type === 'laplace_noise') {
        const currentlyActive = isPrivacyActive('laplace_noise')
        schema.forEach((col) => {
          if (col.type === 'integer' || col.type === 'float' || col.type === 'currency') {
            updated[col.name] = currentlyActive ? 'none' : 'noise'
          }
        })
      }

      setPrivacyRules(updated)
      await runGeneration(schema, updated, rowCount, seed, locale, datasetId)
    },
    [schema, privacyRules, isPrivacyActive, runGeneration, rowCount, seed, locale, datasetId]
  )

  const setColumnPrivacy = useCallback(
    async (colName, method) => {
      const updated = { ...privacyRules, [colName]: method }
      setPrivacyRules(updated)
      await runGeneration(schema, updated, rowCount, seed, locale, datasetId)
    },
    [privacyRules, runGeneration, schema, rowCount, seed, locale, datasetId]
  )

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
      setExportingFormat(format)
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
        setExportingFormat(null)
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

  const [showConfig, setShowConfig] = useState(true)

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* Error toast */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm flex items-center justify-between animate-fade-in shadow-xs">
          <span className="font-medium">{error}</span>
          <button
            onClick={() => setError('')}
            className="text-red-400 hover:text-red-600 ml-4 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── 1. HEADER & TOP-RIGHT DRAG-AND-DROP CSV DROPZONE ── */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        {/* Left: Engine Identity & Quick Dataset Controls */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-white flex items-center justify-center text-xl shadow-sm font-bold">
              🧬
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-extrabold text-slate-900 tracking-tight">
                  Synthetia Tabular Studio
                </h1>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200/80">
                  {datasetId ? 'Gaussian Copula Engine' : 'Marginal Copula Engine'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Preserve statistical dependencies, correlation matrices, and enforce privacy masking.
              </p>
            </div>
          </div>

          {/* Quick Dataset Selector & Controls */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <select
              value={datasetName ? samplesList.find((s) => s.title === datasetName || s.name === datasetName)?.name || '' : ''}
              onChange={(e) => handleLoadSample(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-800 focus:ring-2 focus:ring-teal-500 outline-none shadow-2xs"
            >
              <option value="">⚡ Load Sample Dataset...</option>
              {samplesList.map((sample) => (
                <option key={sample.name} value={sample.name}>
                  {sample.title}
                </option>
              ))}
            </select>

            {datasetName && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200">
                <span>✓ Active: {datasetName}</span>
                <button
                  onClick={() => {
                    setDatasetId('')
                    setDatasetName('')
                    setSessionKey('')
                    setFidelityReport(null)
                  }}
                  className="hover:text-red-500 ml-1 font-bold"
                  title="Clear active dataset"
                >
                  ✕
                </button>
              </span>
            )}

            <button
              onClick={handleGenerateAndCompare}
              disabled={fidelityLoading || (!datasetId && !schema.length)}
              className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-gradient-to-r from-teal-700 to-teal-800 text-white hover:from-teal-800 hover:to-teal-900 disabled:opacity-50 transition shadow-sm flex items-center gap-1.5"
            >
              {fidelityLoading ? (
                <>
                  <span className="animate-spin text-xs">⏳</span> Computing...
                </>
              ) : (
                <>
                  <span>⚡</span> Generate &amp; Compare
                </>
              )}
            </button>

            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition flex items-center gap-1.5 ${
                showConfig
                  ? 'bg-slate-100 text-slate-800 border-slate-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              title="Toggle Configuration Drawer"
            >
              <span>⚙️</span>
              <span>{showConfig ? 'Hide Config' : 'Config'}</span>
            </button>
          </div>
        </div>

        {/* Top-Right: Prominent Drag & Drop CSV Dropzone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl p-4 transition-all duration-200 cursor-pointer flex items-center gap-3.5 select-none w-full lg:w-[360px] shrink-0 ${
            isDragging
              ? 'border-teal-600 bg-teal-50/90 scale-[1.02] shadow-md ring-4 ring-teal-100'
              : 'border-slate-300 hover:border-teal-500 bg-slate-50/70 hover:bg-teal-50/30'
          } ${uploading ? 'opacity-70 pointer-events-none' : ''}`}
          title="Drag & drop your CSV or click to browse"
        >
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-600 to-teal-700 text-white flex items-center justify-center text-xl shadow-sm shrink-0">
            {uploading ? (
              <span className="animate-spin text-sm">⏳</span>
            ) : isDragging ? (
              '📥'
            ) : (
              '☁️'
            )}
          </div>
          <div className="text-left flex-1 min-w-0">
            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <span className="truncate">
                {uploading
                  ? 'Fitting Copula & Generating...'
                  : isDragging
                  ? 'Drop CSV File Here'
                  : 'Upload CSV (Drag & Drop)'}
              </span>
              <span className="text-[10px] text-teal-700 bg-teal-100/80 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                CSV
              </span>
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {uploading
                ? 'Synthesizing correlated dataset...'
                : 'Drop file here or click to browse'}
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. "HOW THE MODEL LEARNS" COLLAPSIBLE PANEL ── */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <button
          onClick={() => setIsHowItWorksOpen(!isHowItWorksOpen)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50/70 transition"
        >
          <div className="flex items-center gap-3">
            <span className="text-base">🧠</span>
            <div>
              <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                <span>How the model learns: Statistical Joint Architecture (Copula)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 font-bold uppercase">
                  Not a random generator
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Transforms marginals to normal scores, projects the correlation matrix to PSD, and samples joint records with zero memorization.
              </div>
            </div>
          </div>
          <span className="text-xs text-slate-400 font-bold shrink-0">
            {isHowItWorksOpen ? '▲ Collapse' : '▼ Learn how it works'}
          </span>
        </button>

        {isHowItWorksOpen && (
          <div className="px-6 pb-6 pt-2 border-t border-slate-100 bg-slate-50/40 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
              <div className="p-4 bg-white rounded-2xl border border-slate-200/80 space-y-1.5 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-[10px]">
                    1
                  </span>
                  <span>Learn Marginals</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Stores 200 empirical quantiles per numeric/datetime column to preserve skewed, bimodal, or long-tailed real shapes without loss.
                </p>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-slate-200/80 space-y-1.5 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-[10px]">
                    2
                  </span>
                  <span>Learn Dependencies</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Transforms values to Gaussian scores and computes pairwise Spearman, Cramér's V, and eta correlations with eigenvalue PSD projection.
                </p>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-slate-200/80 space-y-1.5 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-[10px]">
                    3
                  </span>
                  <span>Joint Vector Sampling</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Samples correlated normal vectors from the covariance matrix, maps through Gaussian CDF, and inverts through empirical quantiles deterministically.
                </p>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-slate-200/80 space-y-1.5 shadow-2xs">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-[10px]">
                    4
                  </span>
                  <span>Fidelity &amp; Privacy Proof</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Evaluates composite score (Shape + Relationship + Validity) against Faker baseline and verifies zero exact row matches via KDTree DCR.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 3. WORKSPACE: MAIN CONTENT + OPTIONAL CONFIG DRAWER ── */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col gap-6 min-w-0 w-full">
          {/* Data Preview Table */}
          <PreviewTable
            columns={preview.columns}
            rows={preview.rows}
            title={
              datasetName
                ? `${datasetName} (Copula Learned Synthesis)`
                : activePreset
                ? `${activePreset} (Live Preview)`
                : 'Synthetic Dataset Preview'
            }
            emptyMessage="Pick a demo dataset above or upload a CSV to generate correlated synthetic data"
          />

          {/* Fidelity Report Section (Wide & Spacious) */}
          <FidelityReport
            report={fidelityReport}
            loading={fidelityLoading}
            onRerun={handleGenerateAndCompare}
          />
        </div>

        {/* Configuration Panel (Docked on Right, Toggleable) */}
        {showConfig && (
          <ConfigPanel
            title="Tabular Parameters"
            className="w-full lg:w-[320px] shrink-0"
            badge={datasetId ? 'Modelled' : 'Standard'}
          >
            <div className="space-y-4">
              {/* 🛡️ DATA PRIVACY & MASKING OPTIONS */}
              <div className="bg-slate-50/90 p-3.5 rounded-2xl border border-slate-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span>🛡️</span> Data Privacy &amp; Masking
                  </label>
                  {Object.values(privacyRules).filter((m) => m !== 'none').length > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                      {Object.values(privacyRules).filter((m) => m !== 'none').length} active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 leading-tight">
                  Protect sensitive PII in real-time before export:
                </p>

                <div className="space-y-2">
                  {/* Mask Emails */}
                  <label className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 hover:border-teal-300 transition cursor-pointer text-xs">
                    <div className="flex items-center gap-2">
                      <span>✉️</span>
                      <div>
                        <div className="font-semibold text-slate-800">Mask Emails</div>
                        <div className="text-[10px] text-slate-500">e.g. j***@domain.com</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={isPrivacyActive('mask_email')}
                      onChange={() => togglePrivacyOption('mask_email')}
                      className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 accent-teal-600 cursor-pointer"
                    />
                  </label>

                  {/* Mask Phone Numbers */}
                  <label className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 hover:border-teal-300 transition cursor-pointer text-xs">
                    <div className="flex items-center gap-2">
                      <span>📞</span>
                      <div>
                        <div className="font-semibold text-slate-800">Mask Phone Numbers</div>
                        <div className="text-[10px] text-slate-500">e.g. ***-***-1234</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={isPrivacyActive('mask_phone')}
                      onChange={() => togglePrivacyOption('mask_phone')}
                      className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 accent-teal-600 cursor-pointer"
                    />
                  </label>

                  {/* Pseudonymize Names */}
                  <label className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 hover:border-teal-300 transition cursor-pointer text-xs">
                    <div className="flex items-center gap-2">
                      <span>👤</span>
                      <div>
                        <div className="font-semibold text-slate-800">Pseudonymize Names</div>
                        <div className="text-[10px] text-slate-500">Salted SHA-256 tokens</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={isPrivacyActive('pseudonymize_name')}
                      onChange={() => togglePrivacyOption('pseudonymize_name')}
                      className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 accent-teal-600 cursor-pointer"
                    />
                  </label>

                  {/* Differential Privacy Noise */}
                  <label className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 hover:border-teal-300 transition cursor-pointer text-xs">
                    <div className="flex items-center gap-2">
                      <span>🔒</span>
                      <div>
                        <div className="font-semibold text-slate-800">Laplace DP Noise</div>
                        <div className="text-[10px] text-slate-500">ε = 1.0 numeric perturbation</div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={isPrivacyActive('laplace_noise')}
                      onChange={() => togglePrivacyOption('laplace_noise')}
                      className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 accent-teal-600 cursor-pointer"
                    />
                  </label>
                </div>

                {/* Per-column fine-tuning if schema exists */}
                {schema.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="text-[11px] font-bold text-teal-700 hover:text-teal-900 cursor-pointer">
                      ⚙️ Fine-tune per column ({schema.length})
                    </summary>
                    <div className="mt-2 space-y-1.5 max-h-44 overflow-y-auto pr-1">
                      {schema.map((col) => (
                        <div key={col.name} className="flex items-center justify-between py-1 px-1.5 bg-white rounded-lg border border-slate-200 text-[11px]">
                          <span className="font-mono font-medium text-slate-700 truncate max-w-[130px]" title={col.name}>
                            {col.name}
                          </span>
                          <select
                            value={privacyRules[col.name] || 'none'}
                            onChange={(e) => setColumnPrivacy(col.name, e.target.value)}
                            className="text-[10px] py-0.5 px-1 bg-slate-50 border border-slate-300 rounded font-semibold text-slate-800 outline-none"
                          >
                            <option value="none">None</option>
                            <option value="mask">Mask</option>
                            <option value="pseudonymize">Pseudo</option>
                            <option value="noise">DP Noise</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              <hr className="border-slate-100" />

              {/* Quick Presets */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Quick Presets
                </label>
                <div className="space-y-1.5">
                  {DEMO_PRESETS.map((preset, i) => {
                    const isSelected = activePreset === preset.label
                    return (
                      <button
                        key={i}
                        onClick={() => loadPreset(preset)}
                        className={`w-full text-left px-3 py-2 text-xs rounded-xl border transition flex items-center justify-between ${
                          isSelected
                            ? 'border-teal-600 bg-teal-50/60 font-semibold text-teal-900 shadow-2xs'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <span>{preset.label}</span>
                        {isSelected && (
                          <span className="text-[10px] bg-teal-700 text-white px-1.5 py-0.5 rounded-full font-bold">
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
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  🤖 Prompt to Schema
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. 500 IoT cold-storage temperature readings with device_id, location, temp_celsius"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-200 focus:border-teal-600 outline-none transition resize-none h-16"
                />
                <button
                  onClick={handleAiInfer}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="mt-1.5 w-full px-3 py-2 text-xs font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition shadow-2xs"
                >
                  {aiLoading ? 'Inferring...' : 'Generate from Prompt'}
                </button>
              </div>

              <hr className="border-slate-100" />

              {/* Row count */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Row Count</label>
                  <span className="text-xs font-mono font-bold text-teal-700">
                    {rowCount.toLocaleString()}
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
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl font-mono focus:ring-2 focus:ring-teal-200 focus:border-teal-600 outline-none"
                />
              </div>

              {/* Random seed */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Seed</label>
                  <button
                    type="button"
                    onClick={handleRandomizeSeed}
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

              {/* Locale & Currency */}
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

              {/* Null rate */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Null Rate</label>
                  <span className="text-xs font-mono font-semibold text-teal-700">{nullRate}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={nullRate}
                  onChange={(e) => setNullRate(parseInt(e.target.value))}
                  className="w-full accent-teal-700"
                />
              </div>

              {/* Outlier rate */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Outlier Rate</label>
                  <span className="text-xs font-mono font-semibold text-teal-700">{outlierRate}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={outlierRate}
                  onChange={(e) => setOutlierRate(parseInt(e.target.value))}
                  className="w-full accent-teal-700"
                />
              </div>

              <hr className="border-slate-100" />

              {/* Hidden file input for header upload */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => handleFileUpload(e.target.files[0])}
                className="hidden"
              />

              {/* Export Full Dataset */}
              <div>
                <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Export Dataset ({rowCount.toLocaleString()} rows)
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    id="export-csv-btn"
                    onClick={() => handleExport('csv')}
                    disabled={exportingFormat !== null || (!schema.length && !datasetId)}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-teal-500 hover:shadow-xs disabled:opacity-50 transition text-slate-800 text-xs font-semibold"
                  >
                    <span className="text-base mb-1">📄</span>
                    <span>{exportingFormat === 'csv' ? 'Saving...' : 'CSV'}</span>
                  </button>

                  <button
                    id="export-excel-btn"
                    onClick={() => handleExport('excel')}
                    disabled={exportingFormat !== null || (!schema.length && !datasetId)}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-teal-500 hover:shadow-xs disabled:opacity-50 transition text-slate-800 text-xs font-semibold"
                  >
                    <span className="text-base mb-1">📊</span>
                    <span>{exportingFormat === 'excel' ? 'Saving...' : 'Excel (.xlsx)'}</span>
                  </button>

                  <button
                    id="export-json-btn"
                    onClick={() => handleExport('json')}
                    disabled={exportingFormat !== null || (!schema.length && !datasetId)}
                    className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-teal-500 hover:shadow-xs disabled:opacity-50 transition text-slate-800 text-xs font-semibold"
                  >
                    <span className="text-base mb-1">📦</span>
                    <span>{exportingFormat === 'json' ? 'Saving...' : 'JSON'}</span>
                  </button>
                </div>
              </div>
            </div>
          </ConfigPanel>
        )}
      </div>
    </div>
  )
}
