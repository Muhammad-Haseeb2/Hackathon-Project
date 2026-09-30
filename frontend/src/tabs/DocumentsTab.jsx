import { useState, useCallback, useRef } from 'react'
import ConfigPanel from '../components/ConfigPanel'
import ExportButton from '../components/ExportButton'
import { generateInvoice, exportInvoice, generateStatement, exportStatement, cloneDocument } from '../api'
import { LOCALES } from '../locales'

export default function DocumentsTab() {
  const [docType, setDocType] = useState('invoice') // 'invoice' | 'statement' | 'clone'
  const [seed, setSeed] = useState(42)
  const [locale, setLocale] = useState('en_US')

  // Invoice config
  const [nItems, setNItems] = useState(5)
  const [discountPct, setDiscountPct] = useState(10)
  const [bulkCount, setBulkCount] = useState(1)

  // Statement config
  const [nTransactions, setNTransactions] = useState(30)
  const [openingBalance, setOpeningBalance] = useState(5000)
  const [days, setDays] = useState(90)
  const [allowOverdraft, setAllowOverdraft] = useState(false)
  const [salaryOn1st, setSalaryOn1st] = useState(false)

  // Clone config
  const [pdfFile, setPdfFile] = useState(null)
  const [clonedPdfBase64, setClonedPdfBase64] = useState('')
  const [clonedMeta, setClonedMeta] = useState(null)
  const fileInputRef = useRef(null)

  // State
  const [htmlPreview, setHtmlPreview] = useState('')
  const [balanceValidation, setBalanceValidation] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  // ── Download Generated Base64 PDF ──
  const downloadClonedPdf = useCallback(() => {
    if (!clonedPdfBase64) return
    try {
      const byteCharacters = atob(clonedPdfBase64)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const invNum = clonedMeta?.invoice?.invoice_number || 'synthetic_clone'
      a.download = `${invNum}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setError('Failed to download PDF: ' + e.message)
    }
  }, [clonedPdfBase64, clonedMeta])

  // ── Clone / Generate from PDF ──
  const handleClonePdf = useCallback(async (fileToUse) => {
    const file = fileToUse || pdfFile
    if (!file) {
      setError('Please select or upload a PDF file first.')
      return
    }
    setGenerating(true)
    setError('')
    setBalanceValidation(null)
    try {
      const result = await cloneDocument(file, seed)
      setHtmlPreview(result.html_preview)
      setClonedPdfBase64(result.pdf_base64)
      setClonedMeta(result)
    } catch (e) {
      setError(e.message || 'Failed to clone document from PDF')
    } finally {
      setGenerating(false)
    }
  }, [pdfFile, seed])

  // ── Drag & Drop Handlers ──
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDragging) setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      const file = files[0]
      setPdfFile(file)
      setDocType('clone')
      handleClonePdf(file)
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setPdfFile(file)
      handleClonePdf(file)
    }
  }

  // ── Generate Invoice ──
  const handleGenerateInvoice = useCallback(async () => {
    setGenerating(true)
    setError('')
    setBalanceValidation(null)
    try {
      const result = await generateInvoice({
        seed,
        locale,
        n_items: nItems,
        discount_pct: discountPct,
      })
      setHtmlPreview(result.html_preview)
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }, [seed, locale, nItems, discountPct])

  // ── Generate Statement ──
  const handleGenerateStatement = useCallback(async () => {
    setGenerating(true)
    setError('')
    try {
      const result = await generateStatement({
        seed,
        locale,
        n_transactions: nTransactions,
        opening_balance: openingBalance,
        days,
        allow_overdraft: allowOverdraft,
        salary_on_1st: salaryOn1st,
      })
      setHtmlPreview(result.html_preview)
      setBalanceValidation(result.balance_validation)
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }, [seed, locale, nTransactions, openingBalance, days, allowOverdraft, salaryOn1st])

  // ── Export ──
  const handleExport = useCallback(async (format) => {
    setExporting(true)
    setError('')
    try {
      if (docType === 'clone') {
        if (format === 'pdf' && clonedPdfBase64) {
          downloadClonedPdf()
        } else if (pdfFile) {
          await handleClonePdf(pdfFile)
          if (clonedPdfBase64) downloadClonedPdf()
        }
      } else if (docType === 'invoice') {
        await exportInvoice({ seed, locale, count: bulkCount, format })
      } else {
        await exportStatement({
          seed, locale, n_transactions: nTransactions,
          opening_balance: openingBalance, days, format,
          allow_overdraft: allowOverdraft, salary_on_1st: salaryOn1st,
        })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }, [docType, seed, locale, bulkCount, nTransactions, openingBalance, days, allowOverdraft, salaryOn1st, clonedPdfBase64, pdfFile, handleClonePdf, downloadClonedPdf])

  // ── Presets ──
  const loadPreset = (preset) => {
    if (preset === 'pakistan_invoice') {
      setDocType('invoice')
      setLocale('ur_PK')
      setNItems(6)
      setDiscountPct(5)
    } else if (preset === 'uk_invoice') {
      setDocType('invoice')
      setLocale('en_GB')
      setNItems(4)
      setDiscountPct(0)
    } else if (preset === 'monthly_statement') {
      setDocType('statement')
      setLocale('en_US')
      setNTransactions(40)
      setOpeningBalance(8000)
      setDays(30)
      setSalaryOn1st(true)
    } else if (preset === 'eu_invoice') {
      setDocType('invoice')
      setLocale('de_DE')
      setNItems(5)
      setDiscountPct(15)
    }
  }

  return (
    <div className="flex gap-6 h-full">
      {/* Main content with drag and drop support */}
      <div
        className="flex-1 flex flex-col gap-4 min-w-0 relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Dragging Overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-teal/15 border-2 border-dashed border-teal rounded-xl flex flex-col items-center justify-center z-50 backdrop-blur-xs pointer-events-none transition-all">
            <div className="text-5xl animate-bounce">📑</div>
            <div className="text-base font-bold text-navy mt-3">Drop your PDF here to Clone & Generate</div>
            <div className="text-xs text-teal font-medium mt-1">Extracts layout and generates synthetic PDF immediately</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between animate-fade-in">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
          </div>
        )}

        {/* Balance Validation */}
        {balanceValidation && (
          <div className={`px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-3 animate-fade-in ${
            balanceValidation.valid
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            <span className="text-lg">{balanceValidation.valid ? '✅' : '❌'}</span>
            <div>
              <div className="font-semibold">
                {balanceValidation.valid ? 'Balance Verified' : 'Balance Issues'}
              </div>
              <div className="text-xs mt-0.5 opacity-75">
                {balanceValidation.transactions_checked} transactions checked
                {' • '}
                {balanceValidation.balance_mismatches === 0 ? '✓ All balances reconcile' : `✗ ${balanceValidation.balance_mismatches} mismatches`}
                {!allowOverdraft && balanceValidation.overdraft_violations > 0 && ` • ✗ ${balanceValidation.overdraft_violations} overdrafts`}
              </div>
            </div>
          </div>
        )}

        {/* HTML Preview */}
        {htmlPreview ? (
          <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-auto">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-navy">
                {docType === 'invoice'
                  ? '📄 Invoice Preview'
                  : docType === 'statement'
                  ? '🏦 Bank Statement Preview'
                  : `⚡ Generated Synthetic PDF (Cloned from ${clonedMeta?.cloned_from || 'Uploaded Document'})`}
              </h3>
              {clonedPdfBase64 && (
                <button
                  onClick={downloadClonedPdf}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-1.5"
                >
                  <span>⬇️</span> Download Generated PDF
                </button>
              )}
            </div>
            <div className="p-4" dangerouslySetInnerHTML={{ __html: htmlPreview }} />
          </div>
        ) : (
          <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center min-h-[300px]">
            <div className="text-center p-6 max-w-sm">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-50 flex items-center justify-center">
                <span className="text-2xl">{docType === 'invoice' ? '📄' : docType === 'statement' ? '🏦' : '⚡'}</span>
              </div>
              <p className="text-sm text-gray-600 font-semibold">
                {docType === 'clone' ? 'Drag & drop a PDF here' : 'No document generated yet'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {docType === 'clone'
                  ? 'Drop any PDF invoice or document right here to immediately view its structure and generate a synthetic PDF clone'
                  : 'Configure and generate to see a live preview or drag & drop a PDF'}
              </p>
              <button
                onClick={() => {
                  setDocType('clone')
                  fileInputRef.current?.click()
                }}
                className="mt-4 px-4 py-2 bg-teal hover:bg-teal-600 text-white text-xs font-semibold rounded-lg transition-all shadow-sm"
              >
                Choose or Drop PDF
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Config panel */}
      <ConfigPanel title="Document Config">
        <div className="space-y-4">
          {/* Doc type toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => { setDocType('invoice'); setHtmlPreview(''); setBalanceValidation(null) }}
              className={`flex-1 px-2 py-2 text-xs font-semibold transition-all ${
                docType === 'invoice' ? 'bg-teal text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >📄 Invoice</button>
            <button
              onClick={() => { setDocType('statement'); setHtmlPreview(''); setBalanceValidation(null) }}
              className={`flex-1 px-2 py-2 text-xs font-semibold transition-all ${
                docType === 'statement' ? 'bg-teal text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >🏦 Statement</button>
            <button
              onClick={() => { setDocType('clone'); setHtmlPreview(''); setBalanceValidation(null) }}
              className={`flex-1 px-2 py-2 text-xs font-semibold transition-all ${
                docType === 'clone' ? 'bg-teal text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >⚡ Clone PDF</button>
          </div>

          {/* Clone PDF Specific Controls */}
          {docType === 'clone' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Input Document (PDF)</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                    isDragging ? 'border-teal bg-teal/20 scale-[1.02]' : 'border-teal/40 hover:border-teal bg-teal/5 hover:bg-teal/10'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <div className="text-2xl mb-1">📑</div>
                  <div className="text-xs font-bold text-navy truncate">
                    {pdfFile ? pdfFile.name : 'Click to Upload or Drag & Drop PDF'}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {pdfFile ? `${(pdfFile.size / 1024).toFixed(1)} KB • Ready to generate` : 'Drop file here to generate immediately'}
                  </div>
                </div>
              </div>

              {clonedMeta && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs space-y-1 animate-fade-in">
                  <div className="font-semibold text-emerald-800 flex items-center justify-between">
                    <span>✅ Cloned Successfully</span>
                    <span className="text-[10px] bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded font-mono">
                      {clonedMeta.detected_locale}
                    </span>
                  </div>
                  <div className="text-emerald-700 text-[11px]">
                    Generated {clonedMeta.item_count} items mathematically balanced
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Presets (for invoice / statement) */}
          {docType !== 'clone' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Quick Presets</label>
              <div className="space-y-1.5">
                <button onClick={() => loadPreset('pakistan_invoice')} className="w-full text-left px-3 py-2 text-xs rounded-lg border border-gray-100 hover:border-teal/40 hover:bg-teal/5 transition-all">
                  🇵🇰 Pakistan Invoice (PKR, GST)
                </button>
                <button onClick={() => loadPreset('uk_invoice')} className="w-full text-left px-3 py-2 text-xs rounded-lg border border-gray-100 hover:border-teal/40 hover:bg-teal/5 transition-all">
                  🇬🇧 UK Invoice (GBP, VAT)
                </button>
                <button onClick={() => loadPreset('eu_invoice')} className="w-full text-left px-3 py-2 text-xs rounded-lg border border-gray-100 hover:border-teal/40 hover:bg-teal/5 transition-all">
                  🇪🇺 EU Invoice (EUR, MwSt)
                </button>
                <button onClick={() => loadPreset('monthly_statement')} className="w-full text-left px-3 py-2 text-xs rounded-lg border border-gray-100 hover:border-teal/40 hover:bg-teal/5 transition-all">
                  💰 Monthly Bank Statement
                </button>
              </div>
            </div>
          )}

          <hr className="border-gray-100" />

          {/* Common: Seed */}
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

          {/* Locale & Currency (for invoice / statement) */}
          {docType !== 'clone' && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Locale & Currency</label>
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
          )}

          {docType !== 'clone' && <hr className="border-gray-100" />}

          {/* Invoice-specific */}
          {docType === 'invoice' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Line Items</label>
                <input type="number" value={nItems} onChange={(e) => setNItems(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  min={1} max={20}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Discount: <span className="text-teal font-semibold">{discountPct}%</span>
                </label>
                <input type="range" min={0} max={50} value={discountPct}
                  onChange={(e) => setDiscountPct(parseInt(e.target.value))} className="w-full accent-teal" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Bulk Export Count</label>
                <input type="number" value={bulkCount} onChange={(e) => setBulkCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  min={1} max={50}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all" />
                <p className="text-[10px] text-gray-400 mt-1">{bulkCount > 1 ? `Will generate ${bulkCount} PDFs as ZIP` : 'Single PDF'}</p>
              </div>
            </>
          )}

          {/* Statement-specific */}
          {docType === 'statement' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Transactions</label>
                <input type="number" value={nTransactions} onChange={(e) => setNTransactions(Math.max(5, Math.min(200, parseInt(e.target.value) || 5)))}
                  min={5} max={200}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Opening Balance</label>
                <input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal/20 focus:border-teal outline-none transition-all" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Period: <span className="text-teal font-semibold">{days} days</span>
                </label>
                <input type="range" min={7} max={365} value={days}
                  onChange={(e) => setDays(parseInt(e.target.value))} className="w-full accent-teal" />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={salaryOn1st} onChange={(e) => setSalaryOn1st(e.target.checked)}
                    className="rounded border-gray-300 text-teal focus:ring-teal" />
                  Salary deposit on the 1st
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={allowOverdraft} onChange={(e) => setAllowOverdraft(e.target.checked)}
                    className="rounded border-gray-300 text-teal focus:ring-teal" />
                  Allow overdraft
                </label>
              </div>
            </>
          )}

          <hr className="border-gray-100" />

          {/* Action Buttons */}
          {docType === 'clone' ? (
            <div className="space-y-2">
              <button
                onClick={() => handleClonePdf()}
                disabled={generating || !pdfFile}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  generating || !pdfFile ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-navy text-white hover:bg-navy-600 shadow-sm'
                }`}
              >
                {generating ? '⏳ Generating PDF...' : '⚡ Generate Cloned PDF'}
              </button>
              {clonedPdfBase64 && (
                <button
                  onClick={downloadClonedPdf}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all"
                >
                  ⬇️ Download Generated PDF
                </button>
              )}
            </div>
          ) : (
            <>
              <button
                onClick={docType === 'invoice' ? handleGenerateInvoice : handleGenerateStatement}
                disabled={generating}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  generating ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-navy text-white hover:bg-navy-600'
                }`}
              >
                {generating ? '⏳ Generating...' : '▶ Generate Preview'}
              </button>

              <div className="grid grid-cols-3 gap-2">
                <ExportButton onClick={() => handleExport('pdf')} disabled={exporting} label="PDF" loading={exporting} />
                <ExportButton onClick={() => handleExport('csv')} disabled={exporting} label="CSV" loading={false} />
                <ExportButton onClick={() => handleExport('json')} disabled={exporting} label="JSON" loading={false} />
              </div>
            </>
          )}
        </div>
      </ConfigPanel>
    </div>
  )
}

