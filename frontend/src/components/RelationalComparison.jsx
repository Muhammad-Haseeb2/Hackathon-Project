import React from 'react';

export default function RelationalComparison({ comparison, isLearned }) {
  if (!comparison) return null;

  const { orders_per_customer, items_per_order, quantity, price_by_category } = comparison;

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-slate-900">📊 Relational Learning Proof &amp; Distribution Fidelity</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-teal-50 text-teal-800 border border-teal-200">
              {isLearned ? 'Learned Joint Distributions' : 'Template Distribution'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Statistical comparison between real training tables and generated synthetic tables.
          </p>
        </div>
      </div>

      {/* Grid of Structural Relationship Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Orders per customer */}
        {orders_per_customer && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Orders per Customer
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white p-3 rounded-xl border border-slate-200/80">
                <span className="text-[10px] text-slate-400 block font-medium uppercase">Real Mean</span>
                <span className="text-base font-black text-slate-900 font-mono">{orders_per_customer.real_mean}</span>
                <span className="text-[10px] text-slate-500 block mt-1">median: {orders_per_customer.real_median}</span>
                <span className="text-[10px] text-slate-400 block">range {orders_per_customer.real_min} - {orders_per_customer.real_max}</span>
              </div>
              <div className="bg-teal-50/50 p-3 rounded-xl border border-teal-200/80">
                <span className="text-[10px] text-teal-700 block font-medium uppercase">Synthetic Mean</span>
                <span className="text-base font-black text-teal-700 font-mono">{orders_per_customer.synth_mean}</span>
                <span className="text-[10px] text-teal-700 block mt-1">median: {orders_per_customer.synth_median}</span>
                <span className="text-[10px] text-teal-600 block">range {orders_per_customer.synth_min} - {orders_per_customer.synth_max}</span>
              </div>
            </div>
          </div>
        )}

        {/* Items per order */}
        {items_per_order && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Items per Order (Basket Size)
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white p-3 rounded-xl border border-slate-200/80">
                <span className="text-[10px] text-slate-400 block font-medium uppercase">Real Mean</span>
                <span className="text-base font-black text-slate-900 font-mono">{items_per_order.real_mean}</span>
                <span className="text-[10px] text-slate-500 block mt-1">median: {items_per_order.real_median}</span>
                <span className="text-[10px] text-slate-400 block">range {items_per_order.real_min} - {items_per_order.real_max}</span>
              </div>
              <div className="bg-teal-50/50 p-3 rounded-xl border border-teal-200/80">
                <span className="text-[10px] text-teal-700 block font-medium uppercase">Synthetic Mean</span>
                <span className="text-base font-black text-teal-700 font-mono">{items_per_order.synth_mean}</span>
                <span className="text-[10px] text-teal-700 block mt-1">median: {items_per_order.synth_median}</span>
                <span className="text-[10px] text-teal-600 block">range {items_per_order.synth_min} - {items_per_order.synth_max}</span>
              </div>
            </div>
          </div>
        )}

        {/* Quantity per item */}
        {quantity && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Quantity per Item
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white p-3 rounded-xl border border-slate-200/80">
                <span className="text-[10px] text-slate-400 block font-medium uppercase">Real Mean</span>
                <span className="text-base font-black text-slate-900 font-mono">{quantity.real_mean}</span>
                <span className="text-[10px] text-slate-500 block mt-1">median: {quantity.real_median}</span>
                <span className="text-[10px] text-slate-400 block">range {quantity.real_min} - {quantity.real_max}</span>
              </div>
              <div className="bg-teal-50/50 p-3 rounded-xl border border-teal-200/80">
                <span className="text-[10px] text-teal-700 block font-medium uppercase">Synthetic Mean</span>
                <span className="text-base font-black text-teal-700 font-mono">{quantity.synth_mean}</span>
                <span className="text-[10px] text-teal-700 block mt-1">median: {quantity.synth_median}</span>
                <span className="text-[10px] text-teal-600 block">range {quantity.synth_min} - {quantity.synth_max}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Category Price Distributions Table */}
      {price_by_category && price_by_category.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Category Unit Price Distributions (Conditional Quantiles)
            </h4>
            <span className="text-[11px] text-slate-400">
              Preserved per-category pricing models
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-white shadow-2xs">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50/80 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Real Mean</th>
                  <th className="px-4 py-3">Synthetic Mean</th>
                  <th className="px-4 py-3">Real Median</th>
                  <th className="px-4 py-3">Synth Median</th>
                  <th className="px-4 py-3">Real Range</th>
                  <th className="px-4 py-3">Synth Range</th>
                  <th className="px-4 py-3 text-right">Alignment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {price_by_category.map((row) => {
                  const diff = row.diff_mean || Math.abs(row.synth_mean - row.real_mean);
                  const isHighAlignment = diff < 12 || (row.real_mean > 0 && diff / row.real_mean < 0.15);

                  return (
                    <tr key={row.category} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3 font-sans font-semibold text-slate-900">{row.category}</td>
                      <td className="px-4 py-3 text-slate-700">${row.real_mean.toFixed(2)}</td>
                      <td className="px-4 py-3 font-bold text-teal-700">${row.synth_mean.toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-600">${row.real_median.toFixed(2)}</td>
                      <td className="px-4 py-3 text-teal-700">${row.synth_median.toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-500 text-[11px]">${row.real_min.toFixed(0)} - ${row.real_max.toFixed(0)}</td>
                      <td className="px-4 py-3 text-slate-500 text-[11px]">${row.synth_min.toFixed(0)} - ${row.synth_max.toFixed(0)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-sans font-bold ${
                          isHighAlignment
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}>
                          {isHighAlignment ? '✓ Preserved' : `±$${diff.toFixed(1)}`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
