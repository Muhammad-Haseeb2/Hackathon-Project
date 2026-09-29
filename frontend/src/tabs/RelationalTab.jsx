export default function RelationalTab() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center animate-fade-in">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-navy/5 flex items-center justify-center">
          <span className="text-3xl">🔗</span>
        </div>
        <h2 className="text-xl font-semibold text-navy mb-2">Relational Engine</h2>
        <p className="text-sm text-gray-400 max-w-md">
          Generate linked datasets with guaranteed referential integrity.
          Customers → Orders → Line Items with zero orphan keys.
        </p>
        <span className="inline-block mt-4 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
          Coming in Step 4
        </span>
      </div>
    </div>
  )
}
