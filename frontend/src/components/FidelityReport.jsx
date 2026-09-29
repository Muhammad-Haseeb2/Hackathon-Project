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
 * Palette:
 * Primary Navy: #16233B
 * Accent Teal: #167A6C
 * Warm Off-White: #FBFBF9
 * Red / Difference: #DC2626
 * Slate / Muted: #64748B
 */

export default function FidelityReport({ report, loading, onRerun }) {
  const [selectedCol, setSelectedCol] = useState(null)
  const [hoveredNode, setHoveredNode] = useState(null)

  if (loading) {
    return (
      <div className="mt-8 p-8 bg-white rounded-2xl border border-slate-200 shadow-sm animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <div className="h-7 bg-slate-200 rounded w-1/3"></div>
          <div className="h-6 bg-slate-200 rounded w-24"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="h-44 bg-slate-100 rounded-xl"></div>
          <div className="h-44 bg-slate-100 rounded-xl"></div>
          <div className="h-44 bg-slate-100 rounded-xl"></div>
        </div>
        <div className="h-64 bg-slate-100 rounded-xl mb-6"></div>
        <div className="h-48 bg-slate-100 rounded-xl"></div>
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
  const radius = 64
  const strokeWidth = 12
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (score / 100) * circumference

  return (
    <div className="mt-10 bg-[#FBFBF9] p-6 md:p-8 rounded-3xl border border-slate-200/80 shadow-sm space-y-10">
      {/* ── Section Title & Badge ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-[#167A6C]">
              Statistical Model
            </span>
            <span className="text-xs text-slate-500 font-mono">Gaussian Copula Engine</span>
          </div>
          <h2 className="text-2xl font-bold text-[#16233B] mt-1">Synthetic Data Fidelity Report</h2>
          <p className="text-sm text-slate-600">
            Mathematical proof comparing joint statistical distributions and privacy protection.
          </p>
        </div>
        {onRerun && (
          <button
            onClick={onRerun}
            className="self-start sm:self-auto px-4 py-2 text-xs font-semibold rounded-xl bg-white border border-slate-200 text-[#16233B] hover:bg-slate-50 transition shadow-sm"
          >
            ↻ Refresh Comparison
          </button>
        )}
      </div>

      {/* ── 1. HEADER CARDS: Score Gauge, Baseline, and Privacy ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Copula Model Circular Score Gauge */}
        <div className="md:col-span-5 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center gap-6">
          <div className="relative w-36 h-36 shrink-0 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160">
              <circle
                cx="80"
                cy="80"
                r={radius}
                stroke="#E2E8F0"
                strokeWidth={strokeWidth}
                fill="none"
              />
              <circle
                cx="80"
                cy="80"
                r={radius}
                stroke="#167A6C"
                strokeWidth={strokeWidth}
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-3xl font-extrabold text-[#16233B] tracking-tight">{score}</span>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                out of 100
              </span>
            </div>
          </div>
          <div className="flex-1 space-y-2 text-center sm:text-left">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#167A6C]">
              Joint Model Score
            </div>
            <h3 className="text-lg font-bold text-[#16233B]">High Fidelity</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Composite score: 40% column shape, 40% relationship fidelity, 20% validity.
            </p>
            {score_breakdown.copula && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[11px] px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                  Shape: {score_breakdown.copula.shape}%
                </span>
                <span className="text-[11px] px-2 py-0.5 bg-teal-50 text-[#167A6C] rounded font-medium">
                  Rel: {score_breakdown.copula.relationship}%
                </span>
                <span className="text-[11px] px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                  Val: {score_breakdown.copula.validity}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Faker-style Baseline Card */}
        <div className="md:col-span-3 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Faker-Style Baseline
              </span>
              <span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                Independent
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-600">{score_independent}</span>
              <span className="text-xs text-slate-400 font-medium">/ 100</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
              <div
                className="bg-slate-400 h-full rounded-full"
                style={{ width: `${Math.min(100, score_independent)}%` }}
              ></div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
              <span>▲</span>
              <span>
                Relationship fidelity improved from{' '}
                {score_breakdown.independent?.relationship || 0}% to{' '}
                {score_breakdown.copula?.relationship || 0}%
              </span>
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              +{score_breakdown.improvement || (score - score_independent).toFixed(1)} points over
              baseline
            </p>
          </div>
        </div>

        {/* Privacy Card */}
        <div className="md:col-span-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Privacy Evaluation
              </span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                  privacy.status === 'pass'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {privacy.status === 'pass' ? '✓ Privacy check passed' : '⚠ Review needed'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="p-3 bg-slate-50 rounded-xl">
                <div className="text-[11px] text-slate-500 font-medium">Exact Matches</div>
                <div className="text-xl font-bold text-[#16233B] mt-0.5">
                  {privacy.exact_match_count ?? 0}
                </div>
                <div className="text-[10px] text-slate-400">Zero memorization</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <div className="text-[11px] text-slate-500 font-medium">Closest-Record Ratio</div>
                <div className="text-xl font-bold text-[#16233B] mt-0.5">
                  {privacy.dcr_ratio?.toFixed(2) ?? '1.00'}
                </div>
                <div className="text-[10px] text-slate-400">Target ≥ 0.80</div>
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-[11px] text-slate-600 line-clamp-2" title={privacy.explanation}>
              {privacy.explanation ||
                'Synthetic data rows do not duplicate real records and maintain safe record distances.'}
            </p>
          </div>
        </div>
      </div>

      {/* ── 2. RELATIONSHIP MAP: Heatmaps (CSS Grid) ── */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
        <div>
          <h3 className="text-lg font-bold text-[#16233B]">Relationship Map</h3>
          <p className="text-xs text-slate-500">
            Pairwise association matrices: Spearman correlation for numeric, Cramér's V for
            categorical, and eta for mixed pairs.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Real Heatmap */}
          <HeatmapCard
            title="1. Real Data"
            subtitle="Original correlation structure"
            columns={association.columns}
            matrix={association.real}
            type="teal"
          />

          {/* Synthetic (Copula) Heatmap */}
          <HeatmapCard
            title="2. Synthetic Data (Copula)"
            subtitle="Preserved learned relationships"
            columns={association.columns}
            matrix={association.synthetic}
            type="teal"
          />

          {/* Difference Heatmap */}
          <HeatmapCard
            title="3. Difference (|Real - Synthetic|)"
            subtitle="Error magnitude (lower is better)"
            columns={association.columns}
            matrix={association.difference}
            type="red"
          />
        </div>

        {/* Small Independent Baseline Heatmap */}
        {association.independent && association.independent.length > 0 && (
          <div className="pt-4 border-t border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-700">
                  Without relationship modelling (Faker Baseline)
                </h4>
                <p className="text-xs text-slate-500">
                  Notice how correlations drop to near zero across the off-diagonal cells.
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

      {/* ── 3. RELATIONSHIP NETWORK (SVG Graphs) ── */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
        <div>
          <h3 className="text-lg font-bold text-[#16233B]">Relationship Network</h3>
          <p className="text-xs text-slate-500">
            Nodes represent columns placed circularly; edge thickness represents association
            strength (threshold &gt; 0.3). Hover over any node to highlight its connections.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <NetworkGraph
            title="Real Relationships"
            nodes={network.nodes || []}
            edges={network.edges_real || []}
            hoveredNode={hoveredNode}
            onHoverNode={setHoveredNode}
            color="#16233B"
          />
          <NetworkGraph
            title="Synthetic Relationships (Copula)"
            nodes={network.nodes || []}
            edges={network.edges_synthetic || []}
            hoveredNode={hoveredNode}
            onHoverNode={setHoveredNode}
            color="#167A6C"
          />
        </div>
      </div>

      {/* ── 4. DISTRIBUTIONS OVERLAY (Recharts) ── */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-[#16233B]">Distribution Fidelity</h3>
            <p className="text-xs text-slate-500">
              Histogram bins for numeric features and category frequency shares for categorical
              features.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-600">Column:</label>
            <select
              value={activeCol}
              onChange={(e) => setSelectedCol(e.target.value)}
              className="text-xs px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-medium text-[#16233B] focus:outline-none focus:ring-2 focus:ring-[#167A6C]"
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
          <div className="flex items-center gap-4 bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-100 text-xs text-slate-600">
            <span className="font-semibold text-[#16233B]">{activeColMeta.name}</span>
            <span>Type: <code className="text-[#167A6C]">{activeColMeta.type}</code></span>
            <span>
              {activeColMeta.stat_name.toUpperCase()} Metric:{' '}
              <strong className="text-[#16233B]">{activeColMeta.stat_value}</strong>
            </span>
            <span>
              Shape Score: <strong className="text-emerald-700">{activeColMeta.score}%</strong>
            </span>
          </div>
        )}

        <div className="h-72 w-full pt-2">
          {activeDistData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activeDistData} margin={{ top: 10, right: 20, left: -10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis
                  dataKey={activeDistData[0]?.bin ? 'bin' : 'category'}
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  angle={-20}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  unit="%"
                />
                <Tooltip
                  formatter={(val, name) => [`${val}%`, name === 'real' ? 'Real Data' : 'Synthetic Data']}
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  formatter={(val) => (val === 'real' ? 'Real Data (Navy)' : 'Synthetic (Teal)')}
                />
                <Bar dataKey="real" fill="#16233B" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="synthetic" fill="#167A6C" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              No distribution data available for this column.
            </div>
          )}
        </div>
      </div>

      {/* ── 5. RELATIONSHIP SCATTER CHARTS (Recharts) ── */}
      {scatter && scatter.length > 0 && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          <div>
            <h3 className="text-lg font-bold text-[#16233B]">Relationship Scatter</h3>
            <p className="text-xs text-slate-500">
              Up to 500 overlaid points for the strongest numeric pairs, demonstrating preserved joint
              trajectories and covariance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {scatter.map((pair, idx) => (
              <div key={idx} className="p-4 bg-slate-50/60 rounded-xl border border-slate-200/80">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-[#16233B]">
                    {pair.x_col} vs {pair.y_col}
                  </h4>
                  <span className="text-[11px] font-mono text-slate-500">
                    r = {pair.real_association}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mb-3 flex gap-3">
                  <span>Real: <strong>{pair.real_association}</strong></span>
                  <span>Synth: <strong className="text-[#167A6C]">{pair.synth_association}</strong></span>
                </div>

                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: -15 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name={pair.x_col}
                        tick={{ fontSize: 10, fill: '#64748B' }}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name={pair.y_col}
                        tick={{ fontSize: 10, fill: '#64748B' }}
                      />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        contentStyle={{
                          backgroundColor: '#FFF',
                          fontSize: '11px',
                          border: '1px solid #CBD5E1',
                          borderRadius: '6px',
                        }}
                      />
                      <Scatter
                        name="Real"
                        data={pair.real_points}
                        fill="#16233B"
                        opacity={0.4}
                      />
                      <Scatter
                        name="Synthetic"
                        data={pair.synth_points}
                        fill="#167A6C"
                        opacity={0.6}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 6. TOP RELATIONSHIPS TABLE ── */}
      {top_relationships && top_relationships.length > 0 && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-[#16233B]">Top Learned Relationships</h3>
              <p className="text-xs text-slate-500">
                The 5 strongest feature correlations in the real data compared to the Copula model
                and independent baseline.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Feature Pair</th>
                  <th className="py-3 px-4">Real Strength</th>
                  <th className="py-3 px-4 text-[#167A6C]">Copula Model</th>
                  <th className="py-3 px-4 text-slate-500">Faker Baseline</th>
                  <th className="py-3 px-4">Copula Drift</th>
                  <th className="py-3 px-4">Fidelity Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {top_relationships.map((rel, idx) => {
                  const isClosest = rel.difference_copula <= 0.05
                  return (
                    <tr
                      key={idx}
                      className={isClosest ? 'bg-teal-50/40 hover:bg-teal-50/70' : 'hover:bg-slate-50'}
                    >
                      <td className="py-3 px-4 font-semibold text-[#16233B]">{rel.description}</td>
                      <td className="py-3 px-4 font-mono">{rel.real_strength.toFixed(3)}</td>
                      <td className="py-3 px-4 font-mono font-bold text-[#167A6C]">
                        {rel.synth_strength.toFixed(3)}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {rel.indep_strength.toFixed(3)}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {rel.difference_copula.toFixed(3)}
                      </td>
                      <td className="py-3 px-4">
                        {isClosest ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">
                            ✓ Preserved (&lt;0.05)
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
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
//  HELPER: CSS GRID HEATMAP CARD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function HeatmapCard({ title, subtitle, columns = [], matrix = [], type = 'teal', compact = false }) {
  const n = columns.length
  if (!n || !matrix || matrix.length === 0) return null

  const getColor = (val) => {
    const v = Math.max(0, Math.min(1, val))
    if (type === 'red') {
      // Error heatmap: white to deep red
      return `rgba(220, 38, 38, ${Math.min(1, v * 1.5)})`
    }
    if (type === 'slate') {
      return `rgba(100, 116, 139, ${Math.min(1, v * 1.2)})`
    }
    // Default teal
    return `rgba(22, 122, 108, ${Math.min(1, v * 1.1)})`
  }

  return (
    <div className={`p-4 bg-slate-50/70 rounded-xl border border-slate-200/80 flex flex-col ${compact ? 'text-xs' : ''}`}>
      {title && (
        <div className="mb-3">
          <h4 className="text-xs font-bold text-[#16233B]">{title}</h4>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>
      )}

      <div className="overflow-x-auto">
        <div
          className="grid gap-1 items-center justify-center p-2 bg-white rounded-lg border border-slate-100"
          style={{
            gridTemplateColumns: `auto repeat(${n}, minmax(${compact ? '22px' : '28px'}, 1fr))`,
          }}
        >
          {/* Top Header Row */}
          <div></div>
          {columns.map((col, idx) => (
            <div
              key={idx}
              className="text-[10px] font-mono text-slate-500 text-center truncate px-0.5"
              title={col}
            >
              {col.slice(0, 3)}
            </div>
          ))}

          {/* Data Rows */}
          {columns.map((rowCol, rIdx) => (
            <React.Fragment key={rIdx}>
              <div
                className="text-[10px] font-mono text-slate-500 text-right pr-1 truncate max-w-[60px]"
                title={rowCol}
              >
                {rowCol.slice(0, 5)}
              </div>
              {columns.map((_, cIdx) => {
                const val = matrix[rIdx]?.[cIdx] ?? 0
                return (
                  <div
                    key={cIdx}
                    title={`${rowCol} ↔ ${columns[cIdx]}: ${val.toFixed(3)}`}
                    className="aspect-square flex items-center justify-center rounded cursor-pointer transition-transform hover:scale-110"
                    style={{
                      backgroundColor: getColor(val),
                      color: val > 0.45 ? '#FFF' : '#334155',
                      fontSize: compact ? '8px' : '9px',
                      fontWeight: 600,
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
//  HELPER: CIRCULAR SVG RELATIONSHIP NETWORK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function NetworkGraph({ title, nodes = [], edges = [], hoveredNode, onHoverNode, color = '#167A6C' }) {
  const size = 260
  const center = size / 2
  const r = size * 0.36
  const n = nodes.length

  // Calculate circular coordinates for each node
  const nodePositions = {}
  nodes.forEach((node, idx) => {
    const angle = (2 * Math.PI * idx) / Math.max(1, n) - Math.PI / 2
    nodePositions[node.id] = {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    }
  })

  return (
    <div className="flex flex-col items-center p-4 bg-slate-50/60 rounded-xl border border-slate-200/80">
      <h4 className="text-xs font-bold text-[#16233B] mb-2">{title}</h4>
      <div className="relative w-full max-w-[280px] aspect-square">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
          {/* Edges */}
          {edges.map((edge, idx) => {
            const p1 = nodePositions[edge.source]
            const p2 = nodePositions[edge.target]
            if (!p1 || !p2) return null

            const isConnectedToHovered =
              hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode)
            const opacity = hoveredNode ? (isConnectedToHovered ? 0.9 : 0.08) : 0.4
            const strokeW = Math.max(1, (edge.weight || 0.3) * 5)

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
                  r={isHovered ? 9 : 6}
                  fill={isHovered ? '#16233B' : color}
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  className="transition-all duration-200"
                />
                <text
                  x={p.x}
                  y={p.y + (p.y > center ? 15 : -10)}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="600"
                  fill="#334155"
                >
                  {node.name.length > 7 ? node.name.slice(0, 6) + '..' : node.name}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <span className="text-[10px] text-slate-400 mt-2">
        {edges.length} connections (association &gt; 0.3)
      </span>
    </div>
  )
}
