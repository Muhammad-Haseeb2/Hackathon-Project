import React from 'react';

export default function RelationalComparison({ comparison, isLearned }) {
  if (!comparison) return null;

  const { orders_per_customer, items_per_order, quantity, price_by_category } = comparison;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-navy">📊 Relational Learning Fidelity</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-teal/10 text-teal border border-teal/20">
              {isLearned ? 'Learned Real Distributions' : 'Template Distribution'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Statistical comparison between real uploaded/sample tables and generated synthetic tables.
          </p>
        </div>
      </div>

      {/* Grid of Structural Relationship Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Orders per customer */}
        {orders_per_customer && (
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              Orders per Customer
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div className="bg-white p-2 rounded border border-gray-200/60">
                <span className="text-[10px] text-gray-400 block">Real Mean</span>
                <span className="text-sm font-bold text-navy font-mono">{orders_per_customer.real_mean}</span>
                <span className="text-[10px] text-gray-500 block mt-0.5">med: {orders_per_customer.real_median} (range {orders_per_customer.real_min}-{orders_per_customer.real_max})</span>
              </div>
              <div className="bg-teal/5 p-2 rounded border border-teal/20">
                <span className="text-[10px] text-teal-700 block">Synthetic Mean</span>
                <span className="text-sm font-bold text-teal font-mono">{orders_per_customer.synth_mean}</span>
                <span className="text-[10px] text-teal-600 block mt-0.5">med: {orders_per_customer.synth_median} (range {orders_per_customer.synth_min}-{orders_per_customer.synth_max})</span>
              </div>
            </div>
          </div>
        )}

        {/* Items per order */}
        {items_per_order && (
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              Items per Order
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div className="bg-white p-2 rounded border border-gray-200/60">
                <span className="text-[10px] text-gray-400 block">Real Mean</span>
                <span className="text-sm font-bold text-navy font-mono">{items_per_order.real_mean}</span>
                <span className="text-[10px] text-gray-500 block mt-0.5">med: {items_per_order.real_median} (range {items_per_order.real_min}-{items_per_order.real_max})</span>
              </div>
              <div className="bg-teal/5 p-2 rounded border border-teal/20">
                <span className="text-[10px] text-teal-700 block">Synthetic Mean</span>
                <span className="text-sm font-bold text-teal font-mono">{items_per_order.synth_mean}</span>
                <span className="text-[10px] text-teal-600 block mt-0.5">med: {items_per_order.synth_median} (range {items_per_order.synth_min}-{items_per_order.synth_max})</span>
              </div>
            </div>
          </div>
        )}

        {/* Quantity per item */}
        {quantity && (
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              Quantity per Item
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div className="bg-white p-2 rounded border border-gray-200/60">
                <span className="text-[10px] text-gray-400 block">Real Mean</span>
                <span className="text-sm font-bold text-navy font-mono">{quantity.real_mean}</span>
                <span className="text-[10px] text-gray-500 block mt-0.5">med: {quantity.real_median} (range {quantity.real_min}-{quantity.real_max})</span>
              </div>
              <div className="bg-teal/5 p-2 rounded border border-teal/20">
                <span className="text-[10px] text-teal-700 block">Synthetic Mean</span>
                <span className="text-sm font-bold text-teal font-mono">{quantity.synth_mean}</span>
                <span className="text-[10px] text-teal-600 block mt-0.5">med: {quantity.synth_median} (range {quantity.synth_min}-{quantity.synth_max})</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Category Price Distributions Table */}
      {price_by_category && price_by_category.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
              Category Price Distributions (Real vs Synthetic)
            </h4>
            <span className="text-[11px] text-gray-400">
              Unit prices conditionally sampled by category
            </span>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs text-left">
              <thead className="bg-gray-50/80 text-gray-500 uppercase text-[10px] font-semibold border-b border-gray-200">
                <tr>
                  <th className="px-3.5 py-2">Category</th>
                  <th className="px-3.5 py-2">Real Mean</th>
                  <th className="px-3.5 py-2">Synthetic Mean</th>
                  <th className="px-3.5 py-2">Real Median</th>
                  <th className="px-3.5 py-2">Synth Median</th>
                  <th className="px-3.5 py-2">Real Range</th>
                  <th className="px-3.5 py-2">Synth Range</th>
                  <th className="px-3.5 py-2 text-right">Alignment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {price_by_category.map((row) => {
                  const diff = row.diff_mean || Math.abs(row.synth_mean - row.real_mean);
                  const isHighAlignment = diff < 10 || (row.real_mean > 0 && diff / row.real_mean < 0.15);

                  return (
                    <tr key={row.category} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-3.5 py-2 font-medium text-navy">{row.category}</td>
                      <td className="px-3.5 py-2 font-mono text-gray-700">${row.real_mean.toFixed(2)}</td>
                      <td className="px-3.5 py-2 font-mono font-semibold text-teal">${row.synth_mean.toFixed(2)}</td>
                      <td className="px-3.5 py-2 font-mono text-gray-600">${row.real_median.toFixed(2)}</td>
                      <td className="px-3.5 py-2 font-mono text-teal">${row.synth_median.toFixed(2)}</td>
                      <td className="px-3.5 py-2 font-mono text-gray-500 text-[11px]">${row.real_min.toFixed(0)} - ${row.real_max.toFixed(0)}</td>
                      <td className="px-3.5 py-2 font-mono text-gray-500 text-[11px]">${row.synth_min.toFixed(0)} - ${row.synth_max.toFixed(0)}</td>
                      <td className="px-3.5 py-2 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                          isHighAlignment
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
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
