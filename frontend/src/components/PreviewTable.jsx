export default function PreviewTable({ columns = [], rows = [], title = 'Preview', emptyMessage = 'No data to preview yet' }) {
  if (!columns.length || !rows.length) {
    return (
      <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-50 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#A3AFC3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </div>
          <p className="text-sm text-gray-400 font-medium">{emptyMessage}</p>
          <p className="text-xs text-gray-300 mt-1">Configure and generate to see a preview</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy">{title}</h3>
        <span className="text-xs text-gray-400">
          {rows.length} rows × {columns.length} columns
        </span>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-16rem)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {columns.map((col, i) => (
                <th
                  key={i}
                  className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50/80 whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-gray-50 hover:bg-teal/[0.03] transition-colors"
              >
                {columns.map((col, ci) => (
                  <td
                    key={ci}
                    className="px-4 py-2 text-sm text-navy/80 whitespace-nowrap max-w-[200px] truncate"
                  >
                    {row[col] !== undefined && row[col] !== null ? String(row[col]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
