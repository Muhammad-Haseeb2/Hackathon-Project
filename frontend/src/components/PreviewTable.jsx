import { useState, useMemo } from 'react'

export default function PreviewTable({
  columns = [],
  rows = [],
  title = 'Preview',
  emptyMessage = 'No data to preview yet'
}) {
  const [pageSize, setPageSize] = useState(25)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')

  // Filter rows based on search query
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows
    const q = searchQuery.toLowerCase().trim()
    return rows.filter(row =>
      columns.some(col => {
        const val = row[col]
        return val !== undefined && val !== null && String(val).toLowerCase().includes(q)
      })
    )
  }, [rows, columns, searchQuery])

  // Pagination calculations
  const effectivePageSize = pageSize === 'all' ? filteredRows.length : Number(pageSize)
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / (effectivePageSize || 1)))
  const page = Math.min(currentPage, totalPages)

  const paginatedRows = useMemo(() => {
    if (pageSize === 'all') return filteredRows
    const start = (page - 1) * effectivePageSize
    return filteredRows.slice(start, start + effectivePageSize)
  }, [filteredRows, page, effectivePageSize, pageSize])

  if (!columns.length || !rows.length) {
    return (
      <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center min-h-[300px]">
        <div className="text-center p-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-50 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#A3AFC3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 font-medium">{emptyMessage}</p>
          <p className="text-xs text-gray-400 mt-1">Select a preset or click Generate Preview to produce data</p>
        </div>
      </div>
    )
  }

  const startIdx = pageSize === 'all' ? 1 : (page - 1) * effectivePageSize + 1
  const endIdx = pageSize === 'all' ? filteredRows.length : Math.min(page * effectivePageSize, filteredRows.length)

  return (
    <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-w-0">
      {/* Table Header Bar */}
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-navy">{title}</h3>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-teal/10 text-teal-700 border border-teal/20">
            {rows.length} rows total
          </span>
          <span className="text-xs text-gray-400">
            {columns.length} columns
          </span>
        </div>

        {/* Search & Page Size */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setCurrentPage(1)
              }}
              placeholder="Search in preview..."
              className="text-xs px-2.5 py-1.5 pl-7 border border-gray-200 rounded-lg outline-none focus:border-teal w-44"
            />
            <span className="absolute left-2.5 top-1.5 text-gray-400 text-xs">🔍</span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span>Show:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))
                setCurrentPage(1)
              }}
              className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white outline-none focus:border-teal"
            >
              <option value={20}>20</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value="all">All ({rows.length})</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-auto max-h-[calc(100vh-18rem)] flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 sticky top-0 z-10">
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider w-12 border-r border-gray-100 bg-gray-50">
                #
              </th>
              {columns.map((col, i) => (
                <th
                  key={i}
                  className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap bg-gray-50"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="text-center py-8 text-xs text-gray-400">
                  No matching records found
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, ri) => {
                const globalIndex = pageSize === 'all' ? ri + 1 : (page - 1) * effectivePageSize + ri + 1
                return (
                  <tr
                    key={ri}
                    className="border-b border-gray-50 hover:bg-teal/[0.04] transition-colors"
                  >
                    <td className="px-3 py-2 text-xs text-center text-gray-400 font-mono border-r border-gray-50 select-none bg-gray-50/30">
                      {globalIndex}
                    </td>
                    {columns.map((col, ci) => (
                      <td
                        key={ci}
                        className="px-4 py-2 text-sm text-navy/80 whitespace-nowrap max-w-[240px] truncate"
                      >
                        {row[col] !== undefined && row[col] !== null ? String(row[col]) : '—'}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between text-xs text-gray-500">
        <div>
          Showing <span className="font-semibold text-gray-700">{filteredRows.length > 0 ? startIdx : 0}</span> to{' '}
          <span className="font-semibold text-gray-700">{endIdx}</span> of{' '}
          <span className="font-semibold text-gray-700">{filteredRows.length}</span> rows
          {searchQuery && ` (filtered from ${rows.length})`}
        </div>

        {pageSize !== 'all' && totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Previous
            </button>
            <span className="px-2 text-gray-600 font-medium">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2.5 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
