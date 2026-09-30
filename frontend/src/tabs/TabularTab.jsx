import { useState, useCallback, useRef, useEffect } from 'react'
import PreviewTable from '../components/PreviewTable'
import FidelityReport from '../components/FidelityReport'
import {
  uploadFile,
  generateTabular,
  exportTabular,
  getFidelityReport,
  inferSchema,
  loadSample,
} from '../api'
import { LOCALES } from '../locales'

const COLUMN_TYPES = [
  'id', 'name', 'email', 'phone', 'address', 'integer', 'float',
  'categorical', 'currency', 'datetime', 'text', 'uuid',
]

const DEMO_PRESETS = [
  {
    label: '🛒 E-commerce Customers',
    icon: '🛒',
    desc: 'Customer profiles with order stats, spent amounts, and loyalty tiers',
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
    label: '🏥 Healthcare Patients',
    icon: '🏥',
    desc: 'HIPAA compliant patient registry with diagnoses and vitals',
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
    icon: '💰',
    desc: 'Banking transactions with payment amounts and status indicators',
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

const SAMPLE_DATASETS = [
  { name: 'customer_profiles', title: 'Customer Profiles', desc: 'Email, Phone, Name, City, Spent' },
  { name: 'hr_employees', title: 'HR Employees', desc: 'Age, Experience, Salary, Department' },
  { name: 'retail_sales', title: 'Retail Sales', desc: 'Price, Quantity, Revenue, Category' },
  { name: 'patient_vitals', title: 'Patient Vitals', desc: 'Age, BMI, Blood Pressure, Cholesterol' },
]

export default function TabularTab() {
  // Navigation sub-tab inside right panel
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('preview') // 'preview' | 'schema' | 'fidelity' | 'export'
  const [sourceMode, setSourceMode] = useState('presets') // 'presets' | 'samples' | 'upload' | 'ai'

  // Generation parameters
  const [rowCount, setRowCount] = useState(500)
  const [seed, setSeed] = useState(42)
  const [locale, setLocale] = useState('en_US')
  const [method, setMethod] = useState('auto')
  const [nullRate, setNullRate] = useState(0)
  const [outlierRate, setOutlierRate] = useState(0)

  // Schema & State
  const [schema, setSchema] = useState(DEMO_PRESETS[0].schema)
  const [datasetId, setDatasetId] = useState('')
  const [datasetName, setDatasetName] = useState(DEMO_PRESETS[0].label)
  const [activePreset, setActivePreset] = useState(DEMO_PRESETS[0].label)

  // Privacy rules
  const [privacyToggles, setPrivacyToggles] = useState({
    mask_email: false,
    mask_phone: false,
    pseudonymize_name: false,
    laplace_noise: false,
  })
  const [privacyRules, setPrivacyRules] = useState({})

  // Preview & Results
  const [preview, setPreview] = useState({ columns: [], rows: [] })
  const [methodUsed, setMethodUsed] = useState('copula')
  const [fidelityReport, setFidelityReport] = useState(null)
  const [fidelityLoading, setFidelityLoading] = useState(false)

  // Status & Loaders
  const [generating, setGenerating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [exportingFormat, setExportingFormat] = useState(null)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef(null)

  // ── Core Generation Function ──
  const runGeneration = useCallback(
    async (
      customSchema = schema,
      customRules = privacyRules,
      customRowCount = rowCount,
      customSeed = seed,
      customLocale = locale,
      customDatasetId = datasetId,
      customMethod = method
    ) => {
      setGenerating(true)
      setError('')
      try {
        const rules = Object.entries(customRules)
          .filter(([, m]) => m !== 'none')
          .map(([col, m]) => {
            const colDef = customSchema.find((s) => s.name === col)
            return {
              column: col,
              method: m,
              col_type: colDef?.type || 'text',
              epsilon: 1.0,
            }
          })

        const result = await generateTabular({
          schema: customSchema,
          row_count: customRowCount,
          seed: customSeed,
          locale: customLocale,
          null_rate: nullRate / 100,
          outlier_rate: outlierRate / 100,
          privacy_rules: rules,
          dataset_id: customDatasetId || undefined,
          method: customMethod,
        })

        const rows = Array.isArray(result.preview) ? result.preview : (result.preview?.rows || [])
        const cols = result.columns || (rows.length > 0 ? Object.keys(rows[0]) : customSchema.map((s) => s.name))
        setPreview({ columns: cols, rows: rows })
        setMethodUsed(result.method || result.method_used || (customDatasetId ? 'copula' : 'rules'))
      } catch (err) {
        setError(err.message || 'Generation failed.')
      } finally {
        setGenerating(false)
      }
    },
    [schema, privacyRules, rowCount, seed, locale, datasetId, method, nullRate, outlierRate]
  )

  // Initial load
  useEffect(() => {
    runGeneration(DEMO_PRESETS[0].schema, {}, 500, 42, 'en_US', '')
  }, [])

  // ── Load Preset ──
  const handleSelectPreset = async (preset) => {
    setActivePreset(preset.label)
    setDatasetId('')
    setDatasetName(preset.label)
    setFidelityReport(null)
    setSchema(preset.schema)
    const rules = {}
    preset.schema.forEach((c) => (rules[c.name] = 'none'))
    setPrivacyRules(rules)
    setPrivacyToggles({
      mask_email: false,
      mask_phone: false,
      pseudonymize_name: false,
      laplace_noise: false,
    })
    await runGeneration(preset.schema, rules, rowCount, seed, locale, '')
    setActiveWorkspaceTab('preview')
  }

  // ── Load Built-in Sample Dataset ──
  const handleSelectSample = async (sampleName) => {
    setUploading(true)
    setError('')
    try {
      const result = await loadSample(sampleName)
      setSchema(result.schema)
      setDatasetId(result.dataset_id)
      setDatasetName(result.sample_info?.title || sampleName)
      setActivePreset(null)
      setFidelityReport(null)

      const rules = {}
      result.schema.forEach((col) => (rules[col.name] = 'none'))
      setPrivacyRules(rules)

      // Fast initial preview generation
      await runGeneration(result.schema, rules, 100, seed, locale, result.dataset_id, 'copula')
      setActiveWorkspaceTab('preview')
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  // ── Fast File Upload ──
  const handleFileUpload = async (file) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const result = await uploadFile(file)
      setSchema(result.schema)
      if (result.dataset_id) {
        setDatasetId(result.dataset_id)
        setDatasetName(file.name)
      }
      setActivePreset(null)
      setFidelityReport(null)
      const rules = {}
      result.schema.forEach((col) => (rules[col.name] = 'none'))
      setPrivacyRules(rules)

      // Generate preview data immediately
      await runGeneration(result.schema, rules, 100, seed, locale, result.dataset_id, 'copula')
      setActiveWorkspaceTab('preview')
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  // ── AI Schema Inference ──
  const handleAiInfer = async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setError('')
    try {
      const result = await inferSchema(aiPrompt)
      const cols = result.data?.columns || result.columns || []
      if (cols.length > 0) {
        setActivePreset(null)
        setDatasetId('')
        setDatasetName(`AI: ${aiPrompt.slice(0, 30)}...`)
        setFidelityReport(null)
        setSchema(cols)
        const rules = {}
        cols.forEach((col) => (rules[col.name] = 'none'))
        setPrivacyRules(rules)
        await runGeneration(cols, rules, rowCount, seed, locale, '')
        setActiveWorkspaceTab('preview')
      } else {
        setError('No schema generated. Please try a more specific prompt.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setAiLoading(false)
    }
  }

  // ── Privacy Toggles ──
  const handleTogglePrivacy = async (type) => {
    const nextState = !privacyToggles[type]
    const nextToggles = { ...privacyToggles, [type]: nextState }
    setPrivacyToggles(nextToggles)

    const updated = { ...privacyRules }
    if (type === 'mask_email') {
      schema.forEach((col) => {
        if (col.type === 'email' || col.name.toLowerCase().includes('email')) {
          updated[col.name] = nextState ? 'mask' : 'none'
        }
      })
    } else if (type === 'mask_phone') {
      schema.forEach((col) => {
        if (col.type === 'phone' || col.name.toLowerCase().includes('phone')) {
          updated[col.name] = nextState ? 'mask' : 'none'
        }
      })
    } else if (type === 'pseudonymize_name') {
      schema.forEach((col) => {
        if (col.type === 'name' || col.name.toLowerCase().includes('name')) {
          updated[col.name] = nextState ? 'pseudonymize' : 'none'
        }
      })
    } else if (type === 'laplace_noise') {
      schema.forEach((col) => {
        if (col.type === 'integer' || col.type === 'float' || col.type === 'currency') {
          updated[col.name] = nextState ? 'noise' : 'none'
        }
      })
    }

    setPrivacyRules(updated)
    await runGeneration(schema, updated, rowCount, seed, locale, datasetId)
  }

  // ── Fidelity Report Trigger ──
  const handleLoadFidelityReport = async () => {
    if (!datasetId) {
      setError('Upload a dataset or load a sample dataset first to compute statistical fidelity metrics.')
      return
    }
    setFidelityLoading(true)
    setError('')
    setActiveWorkspaceTab('fidelity')
    try {
      const rep = await getFidelityReport({
        dataset_id: datasetId,
        row_count: rowCount,
        seed: seed,
      })
      setFidelityReport(rep)
    } catch (err) {
      setError(err.message)
    } finally {
      setFidelityLoading(false)
    }
  }

  // ── Export Handler ──
  const handleExport = async (format) => {
    setExportingFormat(format)
    setError('')
    try {
      const rules = Object.entries(privacyRules)
        .filter(([, m]) => m !== 'none')
        .map(([col, m]) => ({
          column: col,
          method: m,
          col_type: schema.find((s) => s.name === col)?.type || 'text',
          epsilon: 1.0,
        }))

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
        method: datasetId ? 'copula' : method,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setExportingFormat(null)
    }
  }

  // ── Column Editing ──
  const addColumn = () => {
    const name = `column_${schema.length + 1}`
    setSchema([...schema, { name, type: 'text', stats: {} }])
    setPrivacyRules({ ...privacyRules, [name]: 'none' })
  }

  const removeColumn = (index) => {
    const colName = schema[index]?.name
    const updated = schema.filter((_, i) => i !== index)
    setSchema(updated)
    const nextRules = { ...privacyRules }
    delete nextRules[colName]
    setPrivacyRules(nextRules)
  }

  const updateColumn = (index, field, value) => {
    const updated = [...schema]
    updated[index] = { ...updated[index], [field]: value }
    setSchema(updated)
  }

  return (
    <div className="space-y-6 pb-12 w-full max-w-7xl mx-auto animate-fade-in">
      {/* ── Error Notification ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-medium">{error}</span>
          </div>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* ── 1. Top Source Bar (Drag & drop anywhere on card) ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          const file = e.dataTransfer.files?.[0]
          if (file) handleFileUpload(file)
        }}
        className={`bg-white rounded-2xl border transition-all p-5 shadow-xs ${
          isDragging ? 'border-teal ring-4 ring-teal-100 bg-teal-50/40' : 'border-gray-200'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-navy">Tabular Data Generator</h2>
              <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                datasetId ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}>
                {datasetId ? '✨ Statistical Copula (High Fidelity)' : '⚡ Rule & Distribution Engine'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Active Source: <strong className="text-slate-800">{datasetName || 'Custom Schema'}</strong>
            </p>
          </div>

          {/* Source Tabs */}
          <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl">
            {[
              { id: 'presets', label: 'Presets', icon: '📦' },
              { id: 'samples', label: 'Sample Datasets', icon: '⚡' },
              { id: 'upload', label: 'Upload File', icon: '📁' },
              { id: 'ai', label: 'AI Prompt', icon: '🤖' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSourceMode(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                  sourceMode === tab.id
                    ? 'bg-white text-navy shadow-xs'
                    : 'text-gray-500 hover:text-navy hover:bg-white/50'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Source Body based on selected source tab */}
        {sourceMode === 'presets' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {DEMO_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => handleSelectPreset(p)}
                className={`text-left p-3.5 rounded-xl border transition-all ${
                  activePreset === p.label
                    ? 'border-teal bg-teal-50/50 ring-2 ring-teal/20'
                    : 'border-gray-200 bg-gray-50/50 hover:bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-sm text-navy mb-1">
                  <span>{p.icon}</span>
                  <span>{p.label.split(' ').slice(1).join(' ')}</span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{p.desc}</p>
              </button>
            ))}
          </div>
        )}

        {sourceMode === 'samples' && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {SAMPLE_DATASETS.map((s) => (
              <button
                key={s.name}
                onClick={() => handleSelectSample(s.name)}
                disabled={uploading}
                className="text-left p-3 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-teal-50/50 hover:border-teal/50 transition-all group"
              >
                <div className="font-bold text-xs text-navy group-hover:text-teal mb-0.5">
                  ⚡ {s.title}
                </div>
                <p className="text-[11px] text-gray-400 truncate">{s.desc}</p>
              </button>
            ))}
          </div>
        )}

        {sourceMode === 'upload' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) handleFileUpload(file)
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-teal bg-teal-50'
                : 'border-gray-200 hover:border-teal bg-gray-50/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.json,.parquet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFileUpload(file)
              }}
            />
            <div className="text-2xl mb-2">{uploading ? '⏳' : '📁'}</div>
            <p className="text-sm font-semibold text-navy">
              {uploading ? 'Profiling & Fitting Copula Model...' : 'Click to browse or drag & drop CSV, Excel, or JSON'}
            </p>
            <p className="text-xs text-gray-400 mt-1">Automatic schema inference, correlation matrix fitting, & differential privacy.</p>
          </div>
        )}

        {sourceMode === 'ai' && (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAiInfer()}
              placeholder="e.g. Healthcare dataset with patient age, blood pressure, diagnosis, treatment cost, and insurance type"
              className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-teal bg-gray-50/50 focus:bg-white transition-all"
            />
            <button
              onClick={handleAiInfer}
              disabled={aiLoading || !aiPrompt.trim()}
              className="px-5 py-2.5 bg-teal text-white rounded-xl text-xs font-bold hover:bg-teal-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {aiLoading ? <span className="animate-spin">⏳</span> : '✨ Generate Schema'}
            </button>
          </div>
        )}
      </div>

      {/* ── 2. Main Two-Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Controls & Privacy (4 cols) */}
        <div className="lg:col-span-4 space-y-5">
          {/* Generation Settings Card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
              Generation Parameters
            </h3>

            {/* Row Count */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-navy mb-2">
                <span>Row Count</span>
                <span className="text-teal font-mono font-bold">{rowCount.toLocaleString()} rows</span>
              </div>
              <input
                type="range"
                min="100"
                max="10000"
                step="100"
                value={rowCount}
                onChange={(e) => setRowCount(Number(e.target.value))}
                className="w-full accent-teal h-1.5 bg-gray-200 rounded-lg cursor-pointer"
              />
              <div className="flex gap-1.5 mt-2">
                {[500, 1000, 2500, 5000].map((count) => (
                  <button
                    key={count}
                    onClick={() => setRowCount(count)}
                    className={`flex-1 py-1 text-[11px] font-semibold rounded-md border transition-all ${
                      rowCount === count
                        ? 'bg-teal text-white border-teal'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {count.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            {/* Locale */}
            <div>
              <label className="block text-xs font-semibold text-navy mb-1.5">
                Locale & Currency
              </label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="w-full text-xs font-medium px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-teal"
              >
                {LOCALES.map((loc) => (
                  <option key={loc.code} value={loc.code}>
                    {loc.flag} {loc.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Seed */}
            <div>
              <div className="flex justify-between items-center text-xs font-semibold text-navy mb-1.5">
                <span>Random Seed</span>
                <button
                  onClick={() => setSeed(Math.floor(Math.random() * 900000) + 10000)}
                  className="text-[11px] text-teal hover:underline font-semibold"
                >
                  🎲 Randomize
                </button>
              </div>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="w-full text-xs font-mono px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-teal"
              />
            </div>

            {/* Synthesis Method */}
            <div>
              <label className="block text-xs font-semibold text-navy mb-1.5">
                Synthesis Method
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full text-xs font-medium px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-teal"
              >
                <option value="auto">Auto (Best match for schema)</option>
                <option value="copula">Statistical Gaussian Copula</option>
                <option value="faker">Rule-based Faker</option>
              </select>
            </div>
          </div>

          {/* Privacy & Masking Card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Privacy & Anonymization
              </h3>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold border border-emerald-200">
                Zero PII
              </span>
            </div>

            <div className="space-y-2 pt-1">
              {[
                { id: 'mask_email', title: 'Mask Emails', desc: 'j***@example.com' },
                { id: 'mask_phone', title: 'Mask Phone Numbers', desc: '***-***-1234' },
                { id: 'pseudonymize_name', title: 'Salted Pseudonymize', desc: 'SHA-256 tokens' },
                { id: 'laplace_noise', title: 'Laplacian DP Noise', desc: 'ε = 1.0 numeric privacy' },
              ].map((item) => (
                <label
                  key={item.id}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-gray-100 hover:bg-gray-50/80 cursor-pointer transition-all"
                >
                  <div className="text-left">
                    <div className="text-xs font-bold text-navy">{item.title}</div>
                    <div className="text-[10px] text-gray-400">{item.desc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={privacyToggles[item.id]}
                    onChange={() => handleTogglePrivacy(item.id)}
                    className="w-4 h-4 accent-teal rounded cursor-pointer"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2">
            <button
              onClick={() => runGeneration()}
              disabled={generating}
              className="w-full py-3.5 bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800 text-white rounded-xl text-sm font-bold shadow-md shadow-teal-500/20 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Synthesizing {rowCount.toLocaleString()} Rows...</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>Generate Synthetic Data</span>
                </>
              )}
            </button>

            {datasetId && (
              <button
                onClick={handleLoadFidelityReport}
                disabled={fidelityLoading}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-navy rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
              >
                {fidelityLoading ? <span className="animate-spin">⏳</span> : '📊'}
                <span>View Statistical Fidelity Report</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Workspace Tabs & Content (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Tab Navigation Header */}
          <div className="bg-white rounded-2xl border border-gray-200 p-2 shadow-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {[
                { id: 'preview', label: 'Data Preview', icon: '👁️', count: preview.rows?.length },
                { id: 'schema', label: 'Schema Editor', icon: '📋', count: schema.length },
                { id: 'fidelity', label: 'Fidelity & Quality', icon: '📊' },
                { id: 'export', label: 'Export & Download', icon: '💾' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                    activeWorkspaceTab === tab.id
                      ? 'bg-navy text-white shadow-xs'
                      : 'text-gray-500 hover:text-navy hover:bg-gray-100'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span className={`px-1.5 py-0.2 rounded-md text-[10px] ${
                      activeWorkspaceTab === tab.id ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {methodUsed && (
              <span className="text-[11px] font-semibold text-gray-400 px-3 py-1">
                Method: <strong className="text-teal-700">{methodUsed}</strong>
              </span>
            )}
          </div>

          {/* Sub-view: 1. Data Preview */}
          {activeWorkspaceTab === 'preview' && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
              <PreviewTable
                columns={preview.columns}
                rows={preview.rows}
                title="Generated Preview"
                emptyMessage="Click 'Generate Synthetic Data' to produce realistic dataset rows"
              />
            </div>
          )}

          {/* Sub-view: 2. Schema Editor */}
          {activeWorkspaceTab === 'schema' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-navy">Columns & Types Definition</h3>
                  <p className="text-xs text-gray-400">Configure columns, distributions, and data types</p>
                </div>
                <button
                  onClick={addColumn}
                  className="px-3 py-1.5 bg-teal text-white rounded-xl text-xs font-bold hover:bg-teal-700 transition-all flex items-center gap-1.5"
                >
                  <span>+</span> Add Column
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-gray-50 text-gray-400 uppercase font-bold text-[10px] border-y border-gray-200">
                    <tr>
                      <th className="py-2.5 px-3">Column Name</th>
                      <th className="py-2.5 px-3">Data Type</th>
                      <th className="py-2.5 px-3">Privacy Rule</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {schema.map((col, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50">
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={col.name}
                            onChange={(e) => updateColumn(idx, 'name', e.target.value)}
                            className="font-mono text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-teal w-full max-w-[200px]"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            value={col.type}
                            onChange={(e) => updateColumn(idx, 'type', e.target.value)}
                            className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-teal bg-white"
                          >
                            {COLUMN_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            value={privacyRules[col.name] || 'none'}
                            onChange={(e) => setPrivacyRules({ ...privacyRules, [col.name]: e.target.value })}
                            className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-teal bg-white"
                          >
                            <option value="none">None (Raw)</option>
                            <option value="mask">Pattern Mask</option>
                            <option value="pseudonymize">SHA-256 Pseudonym</option>
                            <option value="noise">Laplacian Noise</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => removeColumn(idx)}
                            className="text-gray-400 hover:text-red-500 font-bold px-2 py-1"
                            title="Remove Column"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sub-view: 3. Fidelity & Quality Report */}
          {activeWorkspaceTab === 'fidelity' && (
            <div className="space-y-4">
              {fidelityReport ? (
                <FidelityReport
                  report={fidelityReport}
                  loading={fidelityLoading}
                  onRerun={handleLoadFidelityReport}
                />
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-xs">
                  <div className="text-3xl mb-3">📊</div>
                  <h3 className="text-sm font-bold text-navy mb-1">No Fidelity Report Computed Yet</h3>
                  <p className="text-xs text-gray-500 max-w-md mx-auto mb-4">
                    Upload a real dataset or load a sample dataset to compute correlation matrices, KS-divergence, and distribution fidelity scores.
                  </p>
                  <button
                    onClick={() => handleSelectSample('customer_profiles')}
                    className="px-4 py-2 bg-teal text-white rounded-xl text-xs font-bold hover:bg-teal-700 transition-all"
                  >
                    ⚡ Load Sample & Compute Fidelity
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Sub-view: 4. Export & Download */}
          {activeWorkspaceTab === 'export' && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4">
              <div>
                <h3 className="text-sm font-bold text-navy">Export Dataset</h3>
                <p className="text-xs text-gray-500">Download the generated synthetic dataset in your preferred format</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                {[
                  { fmt: 'csv', title: 'CSV File (.csv)', desc: 'Standard comma-separated format compatible with Excel & Python', icon: '📄' },
                  { fmt: 'json', title: 'JSON Array (.json)', desc: 'Structured JSON objects for REST APIs and web applications', icon: '📦' },
                  { fmt: 'excel', title: 'Microsoft Excel (.xlsx)', desc: 'Formatted spreadsheet with headers and typed cells', icon: '📊' },
                  { fmt: 'sql', title: 'SQL Inserts (.sql)', desc: 'Database ready INSERT statements for PostgreSQL / MySQL', icon: '🗄️' },
                ].map((item) => (
                  <div key={item.fmt} className="p-4 rounded-xl border border-gray-200 hover:border-teal bg-gray-50/50 flex flex-col justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{item.icon}</span>
                      <div>
                        <h4 className="text-xs font-bold text-navy">{item.title}</h4>
                        <p className="text-[11px] text-gray-500 mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleExport(item.fmt)}
                      disabled={exportingFormat === item.fmt}
                      className="w-full py-2 bg-white hover:bg-teal hover:text-white text-navy font-bold text-xs rounded-lg border border-gray-200 hover:border-teal transition-all flex items-center justify-center gap-1.5 shadow-2xs"
                    >
                      {exportingFormat === item.fmt ? <span className="animate-spin">⏳</span> : '⬇️'}
                      <span>Download {item.fmt.toUpperCase()}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
