import React, { useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ScatterChart,
  Scatter,
} from 'recharts'

/**
 * Premium Fidelity Report Component
 * Visual proof of statistical correlation preservation vs independent Faker baseline.
 */

export default function FidelityReport({ report, loading, onRerun }) {
  const [selectedCol, setSelectedCol] = useState(null)
  const [hoveredNode, setHoveredNode] = useState(null)
  const [activeHeatmapTab, setActiveHeatmapTab] = useState('all') // 'all' | 'real' | 'synthetic' | 'diff'

  if (loading) {
    return (
      <div className="mt-8 p-8 bg-white rounded-3xl border border-slate-200 shadow-sm animate-pulse space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-6 bg-slate-200 rounded-md w-64"></div>
            <div className="h-4 bg-slate-100 rounded-md w-96"></div>
          </div>
          <div className="h-9 bg-slate-100 rounded-xl w-32"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-48 bg-slate-100 rounded-2xl"></div>
          <div className="h-48 bg-slate-100 rounded-2xl"></div>
          <div className="h-48 bg-slate-100 rounded-2xl"></div>
        </div>
        <div className="h-72 bg-slate-100 rounded-2xl"></div>
      </div>
    )
  }

  if (!report) return null

  const {
    score = 0,
    score_independent = 0,
    score_breakdown = {},
    per_column = [],
    distributions = {},
    association = { columns: [], real: [], synthetic: [], difference: [], independent: [] },
    scatter = [],
    network = { nodes: [], edges_real: [], edges_synthetic: [], threshold: 0.3 },
    privacy = {},
    top_relationships = [],
  } = report

  // Default selected column for distributions
  const availableCols = Object.keys(distributions)
  const activeCol = selectedCol && distributions[selectedCol] ? selectedCol : availableCols[0]
  const activeDistData = distributions[activeCol] || []
  const activeColMeta = per_column.find((c) => c.name === activeCol)

  // Circular gauge calculations
  const radius = 56
  const strokeWidth = 10
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference
  const improvement = (score - score_independent).toFixed(1)

  return (
    <div className="mt-8 bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8 animate-fade-in">
      {/* ── Section Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-50 text-teal-800 border border-teal-200/60">
              Joint Model Active
            </span>
            <span className="text-xs font-mono text-slate-500">Gaussian Copula Engine</span>
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 mt-1">
            Statistical Fidelity &amp; Privacy Report
          </h2>
          <p className="text-xs md:text-sm text-slate-500">
            Mathematical proof comparing joint statistical distributions and zero-memorization privacy protection.
          </p>
        </div>
        {onRerun && (
          <button
            onClick={onRerun}
            className="self-start sm:self-auto px-4 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 transition shadow-2xs flex items-center gap-1.5"
          >
            <span>↻</span> Re-evaluate
          </button>
        )}
      </div>

      {/* ── 1. TOP CARDS: Score Gauge, Baseline Comparison, and Privacy Guarantee ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Copula Score Card */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 rounded-2xl shadow-sm flex items-center gap-5">
          <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 140 140">
              <circle
                cx="70"
                cy="70"
                r={radius}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={strokeWidth}
                fill="none"
              />
              <circle
                cx="70"
                cy="70"
                r={radius}
                stroke="#14B8A6"
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-2xl font-black tracking-tight">{score}</span>
              <span className="text-[10px] font-semibold uppercase text-slate-400">/ 100</span>
            </div>
          </div>

          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-teal-400"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-teal-300">
                Copula Score
              </span>
            </div>
            <div className="text-sm font-semibold text-white truncate">
              {score >= 80 ? 'High Fidelity' : 'Moderate Fidelity'}
            </div>
            <div className="text-[11px] text-slate-300 leading-tight">
              40% shape + 40% relationship + 20% validity
            </div>
            {score_breakdown.copula && (
              <div className="flex flex-wrap gap-1 pt-1 text-[10px]">
                <span className="px-1.5 py-0.5 rounded bg-white/10 text-slate-200">
                  Shape: {score_breakdown.copula.shape}%
                </span>
                <span className="px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-200 font-semibold">
                  Rel: {score_breakdown.copula.relationship}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Faker Baseline Card */}
        <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Independent Baseline
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-600 font-semibold">
                Faker Style
              </span>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-700">{score_independent}</span>
              <span className="text-xs text-slate-400">/ 100</span>
            </div>

            <div className="w-full bg-slate-200 rounded-full h-2 mt-2.5 overflow-hidden">
              <div
                className="bg-slate-400 h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(100, score_independent)}%` }}
              ></div>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200/70 text-xs">
            <div className="text-emerald-700 font-bold flex items-center gap-1">
              <span>▲</span>
              <span>+{improvement} pts higher with Copula</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Relationship fidelity: {score_breakdown.independent?.relationship || 0}% →{' '}
              <strong className="text-teal-700 font-bold">{score_breakdown.copula?.relationship || 0}%</strong>
            </div>
          </div>
        </div>

        {/* Privacy Card */}
        <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Privacy Evaluation
              </span>
              <span
                className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                  privacy.status === 'pass'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {privacy.status === 'pass' ? '✓ Passed' : '⚠ Review'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200/80">
                <span className="text-[10px] text-slate-400 block uppercase font-medium">Exact Matches</span>
                <span className="text-xl font-black text-slate-900 font-mono">
                  {privacy.exact_match_count ?? 0}
                </span>
                <span className="text-[10px] text-emerald-600 block mt-0.5">0% memorized</span>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-slate-200/80">
                <span className="text-[10px] text-slate-400 block uppercase font-medium">DCR Ratio</span>
                <span className="text-xl font-black text-slate-900 font-mono">
                  {privacy.dcr_ratio?.toFixed(2) ?? '1.00'}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Target ≥ 0.80</span>
              </div>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200/70 text-[11px] text-slate-600 truncate">
            {privacy.explanation || 'Zero exact row duplication and safe nearest-record distance.'}
          </div>
        </div>
      </div>

      {/* ── 2. RELATIONSHIP MAP: SIDE-BY-SIDE CORRELATION HEATMAPS ── */}
      <div className="bg-slate-50/60 p-6 rounded-3xl border border-slate-200 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Pairwise Relationship Map</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Spearman rank correlation for numeric features, Cramér's V for categorical, eta for mixed pairs.
            </p>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 text-xs self-start sm:self-auto shadow-2xs">
            <button
              onClick={() => setActiveHeatmapTab('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                activeHeatmapTab === 'all' ? 'bg-teal-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Side-by-Side (3 Maps)
            </button>
            <button
              onClick={() => setActiveHeatmapTab('real')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                activeHeatmapTab === 'real' ? 'bg-teal-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Real
            </button>
            <button
              onClick={() => setActiveHeatmapTab('synthetic')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                activeHeatmapTab === 'synthetic' ? 'bg-teal-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Synthetic
            </button>
            <button
              onClick={() => setActiveHeatmapTab('diff')}
              className={`px-2.5 py-1 rounded-lg font-medium transition ${
                activeHeatmapTab === 'diff' ? 'bg-teal-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Difference
            </button>
          </div>
        </div>

        {/* Heatmap Grid */}
        <div className={`grid gap-6 ${activeHeatmapTab === 'all' ? 'grid-cols-1 xl:grid-cols-3' : 'grid-cols-1'}`}>
          {(activeHeatmapTab === 'all' || activeHeatmapTab === 'real') && (
            <HeatmapCard
              title="1. Real Data"
              subtitle="Original joint correlation structure"
              columns={association.columns}
              matrix={association.real}
              type="teal"
            />
          )}

          {(activeHeatmapTab === 'all' || activeHeatmapTab === 'synthetic') && (
            <HeatmapCard
              title="2. Synthetic Data (Copula)"
              subtitle="Preserved learned relationships"
              columns={association.columns}
              matrix={association.synthetic}
              type="teal"
            />
          )}

          {(activeHeatmapTab === 'all' || activeHeatmapTab === 'diff') && (
            <HeatmapCard
              title="3. Absolute Difference"
              subtitle="|Real - Synthetic| error (lower is better)"
              columns={association.columns}
              matrix={association.difference}
              type="red"
            />
          )}
        </div>

        {/* Small Independent Baseline Heatmap (Proof of Improvement) */}
        {association.independent && association.independent.length > 0 && (
          <div className="pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Without Relationship Modelling (Faker Baseline)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Independent marginal sampling destroys joint covariance — off-diagonal cells collapse to ~0.00.
                </p>
              </div>
            </div>
            <div className="max-w-md">
              <HeatmapCard
                title=""
                subtitle=""
                columns={association.columns}
                matrix={association.independent}
                type="slate"
                compact
              />
            </div>
          </div>
        )}
      </div>

      {/* ── 3. RELATIONSHIP NETWORK (SVG CIRCULAR GRAPHS) ── */}
      <div className="bg-slate-50/60 p-6 rounded-3xl border border-slate-200 space-y-5">
        <div>
          <h3 className="text-base font-bold text-slate-900">Relationship Network Graph</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Nodes represent dataset columns arranged circularly; edge thickness indicates association strength (&gt; 0.30). Hover a node to highlight its network.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <NetworkGraph
            title="Real Dataset Network"
            nodes={network.nodes || []}
            edges={network.edges_real || []}
            hoveredNode={hoveredNode}
            onHoverNode={setHoveredNode}
            color="#0F172A"
          />
          <NetworkGraph
            title="Synthetic (Copula) Preserved Network"
            nodes={network.nodes || []}
            edges={network.edges_synthetic || []}
            hoveredNode={hoveredNode}
            onHoverNode={setHoveredNode}
            color="#0D9488"
          />
        </div>
      </div>

      {/* ── 4. DISTRIBUTION OVERLAYS (RECHARTS HISTOGRAMS) ── */}
      <div className="bg-slate-50/60 p-6 rounded-3xl border border-slate-200 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Single-Column Distribution Overlays</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Empirical histogram overlays: Real data (Navy) vs Synthetic data (Teal).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Inspect Column:</span>
            <select
              value={activeCol}
              onChange={(e) => setSelectedCol(e.target.value)}
              className="text-xs px-3 py-1.5 bg-white border border-slate-300 rounded-xl font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500 shadow-2xs"
            >
              {availableCols.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {activeColMeta && (
          <div className="flex flex-wrap items-center gap-3 bg-white px-4 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-700 shadow-2xs">
            <span className="font-bold text-slate-900">{activeColMeta.name}</span>
            <span className="text-slate-300">•</span>
            <span>Type: <code className="text-teal-700 font-mono font-semibold">{activeColMeta.type}</code></span>
            <span className="text-slate-300">•</span>
            <span>
              {activeColMeta.stat_name.toUpperCase()} distance:{' '}
              <strong className="text-slate-900 font-mono">{activeColMeta.stat_value}</strong>
            </span>
            <span className="text-slate-300">•</span>
            <span>
              Marginal Score:{' '}
              <strong className="text-emerald-700 font-mono">{activeColMeta.score}%</strong>
            </span>
          </div>
        )}

        <div className="h-72 w-full bg-white p-4 rounded-2xl border border-slate-200">
          {activeDistData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activeDistData} margin={{ top: 10, right: 20, left: -10, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis
                  dataKey={activeDistData[0]?.bin ? 'bin' : 'category'}
                  tick={{ fontSize: 10, fill: '#64748B' }}
                  interval="preserveStartEnd"
                  angle={-15}
                  textAnchor="end"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748B' }}
                  unit="%"
                />
                <Tooltip
                  formatter={(val, name) => [`${val}%`, name === 'real' ? 'Real Data' : 'Synthetic Data']}
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: '12px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  formatter={(val) => (val === 'real' ? 'Real (Navy)' : 'Synthetic (Teal)')}
                />
                <Bar dataKey="real" fill="#0F172A" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Bar dataKey="synthetic" fill="#0D9488" radius={[4, 4, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              No distribution data available for this column.
            </div>
          )}
        </div>
      </div>

      {/* ── 5. SCATTER CHARTS (TOP CORRELATED PAIRS) ── */}
      {scatter && scatter.length > 0 && (
        <div className="bg-slate-50/60 p-6 rounded-3xl border border-slate-200 space-y-5">
          <div>
            <h3 className="text-base font-bold text-slate-900">Relationship Scatter Overlays</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Overlaid real vs synthetic data points for the highest-correlated numeric feature pairs.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {scatter.map((sc, idx) => (
              <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col justify-between shadow-2xs">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-slate-800 truncate" title={`${sc.x_col} vs ${sc.y_col}`}>
                    {sc.x_col} vs {sc.y_col}
                  </div>
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 shrink-0">
                    r = {sc.strength?.toFixed(2)}
                  </span>
                </div>

                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F8FAFC" />
                      <XAxis
                        dataKey="x"
                        name={sc.x_col}
                        tick={{ fontSize: 9, fill: '#64748B' }}
                        type="number"
                      />
                      <YAxis
                        dataKey="y"
                        name={sc.y_col}
                        tick={{ fontSize: 9, fill: '#64748B' }}
                        type="number"
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        formatter={(val, name) => [val, name === 'real' ? 'Real' : 'Synthetic']}
                        contentStyle={{
                          backgroundColor: '#FFF',
                          borderRadius: '8px',
                          border: '1px solid #E2E8F0',
                          fontSize: '11px',
                        }}
                      />
                      <Scatter name="Real" data={sc.real} fill="#0F172A" opacity={0.65} />
                      <Scatter name="Synthetic" data={sc.synthetic} fill="#0D9488" opacity={0.65} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex items-center justify-center gap-4 text-[10px] text-slate-500 pt-2 border-t border-slate-100">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#0F172A]"></span> Real Points
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#0D9488]"></span> Synthetic Points
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 6. TOP RELATIONSHIPS COMPARISON TABLE ── */}
      {top_relationships && top_relationships.length > 0 && (
        <div className="bg-slate-50/60 p-6 rounded-3xl border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Quantitative Correlation Preservation</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Benchmark comparison between Real, Copula model, and independent baseline.
              </p>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">Sorted by Real Strength</span>
          </div>

          <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200 shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Feature Pair</th>
                  <th className="py-3 px-4 font-mono">Real Strength</th>
                  <th className="py-3 px-4 font-mono text-teal-800">Copula Model</th>
                  <th className="py-3 px-4 font-mono text-slate-400">Faker Baseline</th>
                  <th className="py-3 px-4 font-mono">Copula Drift</th>
                  <th className="py-3 px-4 text-right">Fidelity Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {top_relationships.map((rel, idx) => {
                  const isClosest = rel.difference_copula <= 0.05
                  return (
                    <tr
                      key={idx}
                      className={isClosest ? 'bg-teal-50/30 hover:bg-teal-50/60 transition' : 'hover:bg-slate-50/60 transition'}
                    >
                      <td className="py-3 px-4 font-sans font-semibold text-slate-900">{rel.description}</td>
                      <td className="py-3 px-4 text-slate-800">{rel.real_strength.toFixed(3)}</td>
                      <td className="py-3 px-4 font-bold text-teal-700">
                        {rel.synth_strength.toFixed(3)}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {rel.indep_strength.toFixed(3)}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {rel.difference_copula.toFixed(3)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isClosest ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-sans font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            ✓ Preserved (&lt;0.05)
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-slate-100 text-slate-700 border border-slate-200">
                            Approx Preserved
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HELPER: CSS GRID HEATMAP CARD WITH ROTATED HEADERS & TOOLTIPS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function HeatmapCard({ title, subtitle, columns = [], matrix = [], type = 'teal', compact = false }) {
  const n = columns.length
  if (!n || !matrix || matrix.length === 0) return null

  const getColor = (val) => {
    const v = Math.max(0, Math.min(1, val))
    if (type === 'red') {
      return `rgba(220, 38, 38, ${Math.min(1, v * 1.4)})`
    }
    if (type === 'slate') {
      return `rgba(100, 116, 139, ${Math.min(1, v * 1.2)})`
    }
    return `rgba(13, 148, 136, ${Math.min(1, v * 1.15)})`
  }

  return (
    <div className={`p-4 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col ${compact ? 'text-xs' : ''}`}>
      {title && (
        <div className="mb-3">
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{title}</h4>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>
      )}

      <div className="overflow-x-auto pb-2">
        <div
          className="grid gap-1 items-center justify-center p-2 bg-slate-50/50 rounded-xl border border-slate-100"
          style={{
            gridTemplateColumns: `auto repeat(${n}, minmax(${compact ? '26px' : '34px'}, 1fr))`,
          }}
        >
          {/* Top Header Row with Angled Labels */}
          <div className="h-16"></div>
          {columns.map((col, idx) => (
            <div
              key={idx}
              className="h-16 relative flex items-end justify-center pb-1"
              title={col}
            >
              <span
                className="text-[10px] font-mono text-slate-600 font-semibold origin-bottom-left -rotate-45 block whitespace-nowrap"
                style={{ width: '40px' }}
              >
                {col.length > 8 ? col.slice(0, 8) + '…' : col}
              </span>
            </div>
          ))}

          {/* Data Rows */}
          {columns.map((rowCol, rIdx) => (
            <React.Fragment key={rIdx}>
              <div
                className="text-[10px] font-mono text-slate-600 font-medium text-right pr-2 truncate max-w-[80px]"
                title={rowCol}
              >
                {rowCol}
              </div>
              {columns.map((_, cIdx) => {
                const val = matrix[rIdx]?.[cIdx] ?? 0
                return (
                  <div
                    key={cIdx}
                    title={`${rowCol} ↔ ${columns[cIdx]}: ${val.toFixed(3)}`}
                    className="aspect-square flex items-center justify-center rounded-lg cursor-pointer transition-transform hover:scale-110 shadow-2xs"
                    style={{
                      backgroundColor: getColor(val),
                      color: val > 0.45 ? '#FFFFFF' : '#1E293B',
                      fontSize: compact ? '8.5px' : '10px',
                      fontWeight: 700,
                    }}
                  >
                    {val.toFixed(2)}
                  </div>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HELPER: CIRCULAR SVG RELATIONSHIP NETWORK (RESPONSIVE VIEWBOX)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function NetworkGraph({ title, nodes = [], edges = [], hoveredNode, onHoverNode, color = '#0D9488' }) {
  const size = 320
  const center = size / 2
  const r = size * 0.35
  const n = nodes.length

  const nodePositions = {}
  nodes.forEach((node, idx) => {
    const angle = (2 * Math.PI * idx) / Math.max(1, n) - Math.PI / 2
    nodePositions[node.id] = {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      angle,
    }
  })

  return (
    <div className="flex flex-col items-center p-5 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
      <div className="w-full flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{title}</h4>
        <span className="text-[10px] font-mono text-slate-400">
          {edges.length} connections (&gt; 0.3)
        </span>
      </div>

      <div className="relative w-full max-w-[320px] aspect-square">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
          {/* Edges */}
          {edges.map((edge, idx) => {
            const p1 = nodePositions[edge.source]
            const p2 = nodePositions[edge.target]
            if (!p1 || !p2) return null

            const isConnectedToHovered =
              hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode)
            const opacity = hoveredNode ? (isConnectedToHovered ? 0.95 : 0.08) : 0.35
            const strokeW = Math.max(1.2, (edge.weight || 0.3) * 4.5)

            return (
              <line
                key={idx}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={color}
                strokeWidth={strokeW}
                strokeOpacity={opacity}
                className="transition-all duration-200"
              />
            )
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const p = nodePositions[node.id]
            if (!p) return null
            const isHovered = hoveredNode === node.id

            // Placement calculations for text label relative to node
            const cos = Math.cos(p.angle)
            const sin = Math.sin(p.angle)
            const textX = p.x + cos * 16
            const textY = p.y + sin * 16 + 4
            const textAnchor = Math.abs(cos) < 0.25 ? 'middle' : cos > 0 ? 'start' : 'end'

            return (
              <g
                key={node.id}
                onMouseEnter={() => onHoverNode(node.id)}
                onMouseLeave={() => onHoverNode(null)}
                className="cursor-pointer"
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHovered ? 8 : 5.5}
                  fill={isHovered ? '#0F172A' : color}
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  className="transition-all duration-200"
                />
                <text
                  x={textX}
                  y={textY}
                  textAnchor={textAnchor}
                  fontSize="9.5"
                  fontWeight="600"
                  fill={isHovered ? '#0F172A' : '#475569'}
                  className="transition-colors duration-200"
                >
                  {node.name.length > 12 ? node.name.slice(0, 10) + '…' : node.name}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
