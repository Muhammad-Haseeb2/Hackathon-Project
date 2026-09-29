"""
Quality and Fidelity reporting module — real vs synthetic statistical evaluation.

Provides:
  - compare_datasets(): Original column-level statistical comparison (legacy/backward compat)
  - generate_fidelity_report(): Full fidelity report comparing real data against both
    Copula-synthesized and independent-baseline data, including:
      - 3-part score: 40% shape, 40% relationship fidelity, 20% validity
      - per_column metrics (KS or TVD)
      - chart-ready distributions (20-bin histogram for numeric, category share for categorical)
      - association matrices (real, synthetic, difference, independent, difference_independent)
      - scatter data for top 3 numeric pairs (up to 500 points)
      - network graphs (nodes and edges with association > 0.3)
      - privacy metrics via run_privacy_check()
      - top 5 relationships summary
"""

import numpy as np
import pandas as pd
from scipy.stats import ks_2samp
from typing import Optional

from association import (
    association_matrix,
    _classify_column,
    _IDENTITY_TYPES,
    _build_column_types_from_schema,
)
from privacy_check import run_privacy_check


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ORIGINAL / LEGACY FUNCTIONS (PRESERVED FOR BACKWARD COMPATIBILITY)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _ks_statistic(real: np.ndarray, synthetic: np.ndarray) -> float:
    """
    Two-sample Kolmogorov-Smirnov statistic (manual implementation).
    Returns a value in [0, 1] — lower is better.
    """
    real_sorted = np.sort(real)
    synth_sorted = np.sort(synthetic)
    all_vals = np.sort(np.concatenate([real_sorted, synth_sorted]))
    real_cdf = np.searchsorted(real_sorted, all_vals, side='right') / len(real_sorted)
    synth_cdf = np.searchsorted(synth_sorted, all_vals, side='right') / len(synth_sorted)
    return float(np.max(np.abs(real_cdf - synth_cdf)))


def _wasserstein_1d(real: np.ndarray, synthetic: np.ndarray) -> float:
    """
    1D Wasserstein (Earth Mover's) distance — manual implementation.
    Normalized by the range of real data for interpretability.
    """
    real_sorted = np.sort(real)
    synth_sorted = np.sort(synthetic)
    n = max(len(real_sorted), len(synth_sorted))
    real_interp = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(real_sorted)), real_sorted)
    synth_interp = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(synth_sorted)), synth_sorted)
    distance = float(np.mean(np.abs(real_interp - synth_interp)))
    data_range = float(np.ptp(real_sorted))
    if data_range > 0:
        distance /= data_range
    return distance


def _compare_numeric(real: pd.Series, synthetic: pd.Series) -> dict:
    """Compare numeric columns (legacy)."""
    r = pd.to_numeric(real.dropna(), errors='coerce').dropna().values
    s = pd.to_numeric(synthetic.dropna(), errors='coerce').dropna().values
    if len(r) == 0 or len(s) == 0:
        return {'score': 0, 'error': 'Insufficient data'}
    mean_diff = abs(float(np.mean(r)) - float(np.mean(s)))
    std_diff = abs(float(np.std(r)) - float(np.std(s)))
    r_range = float(np.ptp(r)) or 1.0
    mean_score = max(0, 1 - mean_diff / r_range) * 100
    std_score = max(0, 1 - std_diff / r_range) * 100
    ks_stat = _ks_statistic(r, s)
    ks_score = (1 - ks_stat) * 100
    w_dist = _wasserstein_1d(r, s)
    w_score = max(0, (1 - w_dist)) * 100
    overall = (mean_score + std_score + ks_score + w_score) / 4
    return {
        'type': 'numeric',
        'real_mean': round(float(np.mean(r)), 4),
        'synth_mean': round(float(np.mean(s)), 4),
        'real_std': round(float(np.std(r)), 4),
        'synth_std': round(float(np.std(s)), 4),
        'real_min': round(float(np.min(r)), 4),
        'synth_min': round(float(np.min(s)), 4),
        'real_max': round(float(np.max(r)), 4),
        'synth_max': round(float(np.max(s)), 4),
        'ks_statistic': round(ks_stat, 4),
        'wasserstein': round(w_dist, 4),
        'score': round(overall, 1),
    }


def _compare_categorical(real: pd.Series, synthetic: pd.Series) -> dict:
    """Compare categorical columns using frequency distribution overlap (legacy)."""
    r = real.dropna().astype(str)
    s = synthetic.dropna().astype(str)
    if len(r) == 0 or len(s) == 0:
        return {'score': 0, 'error': 'Insufficient data'}
    r_freq = r.value_counts(normalize=True)
    s_freq = s.value_counts(normalize=True)
    all_cats = set(r_freq.index) | set(s_freq.index)
    total_diff = 0
    category_diffs = {}
    for cat in all_cats:
        r_pct = float(r_freq.get(cat, 0))
        s_pct = float(s_freq.get(cat, 0))
        diff = abs(r_pct - s_pct)
        total_diff += diff
        category_diffs[cat] = {
            'real_pct': round(r_pct * 100, 1),
            'synth_pct': round(s_pct * 100, 1),
            'diff': round(diff * 100, 1),
        }
    score = max(0, (1 - total_diff / 2)) * 100
    r_cats = set(r_freq.index)
    s_cats = set(s_freq.index)
    coverage = len(r_cats & s_cats) / max(len(r_cats), 1) * 100
    return {
        'type': 'categorical',
        'real_unique': len(r_cats),
        'synth_unique': len(s_cats),
        'coverage_pct': round(coverage, 1),
        'top_categories': dict(list(category_diffs.items())[:10]),
        'score': round(score, 1),
    }


def compare_datasets(
    real_df: pd.DataFrame,
    synthetic_df: pd.DataFrame,
    schema: list[dict],
) -> dict:
    """Compare real vs synthetic datasets and produce legacy quality report."""
    column_reports = []
    scores = []
    for col_def in schema:
        col = col_def['name']
        col_type = col_def.get('type', 'text')
        if col not in real_df.columns or col not in synthetic_df.columns:
            continue
        if col_type in ('integer', 'float'):
            report = _compare_numeric(real_df[col], synthetic_df[col])
        elif col_type == 'categorical':
            report = _compare_categorical(real_df[col], synthetic_df[col])
        else:
            r_null = real_df[col].isna().mean()
            s_null = synthetic_df[col].isna().mean()
            null_diff = abs(r_null - s_null)
            score = max(0, (1 - null_diff)) * 100
            report = {
                'type': col_type,
                'real_null_rate': round(r_null * 100, 1),
                'synth_null_rate': round(s_null * 100, 1),
                'score': round(score, 1),
            }
        report['column'] = col
        column_reports.append(report)
        scores.append(report.get('score', 0))
    overall_score = round(float(np.mean(scores)), 1) if scores else 0
    return {
        'overall_score': overall_score,
        'column_count': len(column_reports),
        'columns': column_reports,
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  FIDELITY REPORT (STEP 4)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _evaluate_column_shapes_and_validity(
    real_df: pd.DataFrame,
    synth_df: pd.DataFrame,
    col_types: dict[str, str],
) -> tuple[dict[str, dict], float, float]:
    """
    Evaluate per-column shape (KS for numeric, TVD for categorical)
    and validity (in-bounds for numeric, category coverage for categorical).

    Returns:
      (per_column_dict, mean_shape_score, mean_validity_score)
    """
    per_col = {}
    shape_scores = []
    validity_scores = []

    for col in real_df.columns:
        if col not in synth_df.columns:
            continue

        raw_ct = col_types.get(col, "text")
        if raw_ct in _IDENTITY_TYPES:
            # Identity column: name, email, address, etc.
            r_null = float(real_df[col].isna().mean())
            s_null = float(synth_df[col].isna().mean())
            null_match = max(0.0, 1.0 - abs(r_null - s_null))
            per_col[col] = {
                "name": col,
                "type": raw_ct,
                "real_stats": {"null_rate": round(r_null, 4), "count": int(len(real_df))},
                "synth_stats": {"null_rate": round(s_null, 4), "count": int(len(synth_df))},
                "stat_name": "null_fidelity",
                "stat_value": round(1.0 - null_match, 4),
                "score": round(null_match * 100, 1),
                "validity": 1.0,
            }
            continue

        classified_type = _classify_column(real_df[col], raw_ct)

        if classified_type == "numeric":
            r_vals = pd.to_numeric(real_df[col], errors="coerce").dropna().values.astype(float)
            s_vals = pd.to_numeric(synth_df[col], errors="coerce").dropna().values.astype(float)

            if len(r_vals) == 0 or len(s_vals) == 0:
                ks = 1.0
                in_bounds = 0.0
            else:
                ks = float(ks_2samp(r_vals, s_vals).statistic)
                r_min = float(r_vals.min())
                r_max = float(r_vals.max())
                in_bounds = float(np.mean((s_vals >= r_min) & (s_vals <= r_max))) if len(s_vals) > 0 else 0.0

            shape_score = max(0.0, 1.0 - ks)
            shape_scores.append(shape_score)
            validity_scores.append(in_bounds)

            r_stats = {
                "mean": round(float(np.mean(r_vals)), 2) if len(r_vals) else 0.0,
                "std": round(float(np.std(r_vals)), 2) if len(r_vals) else 0.0,
                "min": round(float(np.min(r_vals)), 2) if len(r_vals) else 0.0,
                "max": round(float(np.max(r_vals)), 2) if len(r_vals) else 0.0,
                "median": round(float(np.median(r_vals)), 2) if len(r_vals) else 0.0,
            }
            s_stats = {
                "mean": round(float(np.mean(s_vals)), 2) if len(s_vals) else 0.0,
                "std": round(float(np.std(s_vals)), 2) if len(s_vals) else 0.0,
                "min": round(float(np.min(s_vals)), 2) if len(s_vals) else 0.0,
                "max": round(float(np.max(s_vals)), 2) if len(s_vals) else 0.0,
                "median": round(float(np.median(s_vals)), 2) if len(s_vals) else 0.0,
            }

            per_col[col] = {
                "name": col,
                "type": raw_ct,
                "real_stats": r_stats,
                "synth_stats": s_stats,
                "stat_name": "ks",
                "stat_value": round(ks, 4),
                "score": round(shape_score * 100, 1),
                "validity": round(in_bounds, 4),
            }

        else:
            # Categorical
            r_s = real_df[col].dropna().astype(str)
            s_s = synth_df[col].dropna().astype(str)

            r_freq = r_s.value_counts(normalize=True)
            s_freq = s_s.value_counts(normalize=True)
            all_cats = set(r_freq.index) | set(s_freq.index)

            tvd = float(0.5 * sum(abs(r_freq.get(c, 0.0) - s_freq.get(c, 0.0)) for c in all_cats))
            coverage = float(len(set(r_freq.index) & set(s_freq.index)) / max(len(r_freq), 1))

            shape_score = max(0.0, 1.0 - tvd)
            shape_scores.append(shape_score)
            validity_scores.append(coverage)

            r_stats = {
                "unique_count": int(len(r_freq)),
                "top_category": str(r_freq.index[0]) if len(r_freq) else "",
                "top_category_pct": round(float(r_freq.iloc[0]) * 100, 1) if len(r_freq) else 0.0,
            }
            s_stats = {
                "unique_count": int(len(s_freq)),
                "top_category": str(s_freq.index[0]) if len(s_freq) else "",
                "top_category_pct": round(float(s_freq.iloc[0]) * 100, 1) if len(s_freq) else 0.0,
            }

            per_col[col] = {
                "name": col,
                "type": raw_ct,
                "real_stats": r_stats,
                "synth_stats": s_stats,
                "stat_name": "tvd",
                "stat_value": round(tvd, 4),
                "score": round(shape_score * 100, 1),
                "validity": round(coverage, 4),
            }

    mean_shape = float(np.mean(shape_scores)) if shape_scores else 1.0
    mean_val = float(np.mean(validity_scores)) if validity_scores else 1.0
    return per_col, mean_shape, mean_val


def _compute_relationship_fidelity(
    real_mat: np.ndarray,
    synth_mat: np.ndarray,
) -> tuple[float, np.ndarray]:
    """
    Compute relationship fidelity: 1 minus mean absolute difference,
    normalized by mean real association to reflect relative preservation.

    Returns:
      (fidelity_score_between_0_and_1, difference_matrix)
    """
    n = real_mat.shape[0]
    diff = np.abs(synth_mat - real_mat)
    np.fill_diagonal(diff, 0.0)

    if n < 2:
        return 1.0, diff

    # Extract off-diagonal pairs
    off_diag_real = [real_mat[i, j] for i in range(n) for j in range(i + 1, n)]
    off_diag_diff = [diff[i, j] for i in range(n) for j in range(i + 1, n)]

    mean_real = float(np.mean(off_diag_real))
    mean_diff = float(np.mean(off_diag_diff))

    if mean_real > 0.01:
        # Relative fidelity: 1 - (error / real_strength)
        rel_fidelity = max(0.0, 1.0 - (mean_diff / mean_real))
    else:
        rel_fidelity = max(0.0, 1.0 - mean_diff)

    return float(rel_fidelity), diff


def _build_distributions(
    real_df: pd.DataFrame,
    synth_df: pd.DataFrame,
    col_types: dict[str, str],
) -> dict[str, list[dict]]:
    """
    Build chart-ready distribution arrays for each column.
    Numeric: 20 shared histogram bins with real and synthetic percentage densities.
    Categorical: category share percentage for top categories.
    """
    distributions = {}

    for col in real_df.columns:
        if col not in synth_df.columns:
            continue

        raw_ct = col_types.get(col, "text")
        if raw_ct in _IDENTITY_TYPES:
            continue

        classified_type = _classify_column(real_df[col], raw_ct)

        if classified_type == "numeric":
            r_vals = pd.to_numeric(real_df[col], errors="coerce").dropna().values.astype(float)
            s_vals = pd.to_numeric(synth_df[col], errors="coerce").dropna().values.astype(float)

            if len(r_vals) == 0 or len(s_vals) == 0:
                continue

            low = float(min(r_vals.min(), s_vals.min()))
            high = float(max(r_vals.max(), s_vals.max()))

            if low == high:
                low -= 1.0
                high += 1.0

            bins = np.linspace(low, high, 21)
            r_counts, _ = np.histogram(r_vals, bins=bins)
            s_counts, _ = np.histogram(s_vals, bins=bins)

            r_pcts = (r_counts / len(r_vals) * 100).round(2)
            s_pcts = (s_counts / len(s_vals) * 100).round(2)

            chart_data = []
            for k in range(20):
                chart_data.append({
                    "bin": f"{bins[k]:.1f} - {bins[k+1]:.1f}",
                    "bin_start": round(float(bins[k]), 2),
                    "bin_end": round(float(bins[k+1]), 2),
                    "real": float(r_pcts[k]),
                    "synthetic": float(s_pcts[k]),
                })
            distributions[col] = chart_data

        else:
            r_s = real_df[col].dropna().astype(str)
            s_s = synth_df[col].dropna().astype(str)

            r_freq = r_s.value_counts(normalize=True)
            s_freq = s_s.value_counts(normalize=True)

            # Show top categories from real (up to 15)
            top_cats = list(r_freq.head(15).index)

            chart_data = []
            for cat in top_cats:
                chart_data.append({
                    "category": str(cat),
                    "real": round(float(r_freq.get(cat, 0.0) * 100), 2),
                    "synthetic": round(float(s_freq.get(cat, 0.0) * 100), 2),
                })
            distributions[col] = chart_data

    return distributions


def _build_scatter(
    real_df: pd.DataFrame,
    synth_df: pd.DataFrame,
    col_types: dict[str, str],
    association_info: dict,
    max_points: int = 500,
) -> list[dict]:
    """
    Extract up to 500 sampled points for the 3 most strongly associated numeric pairs.
    """
    cols = association_info["columns"]
    mat = np.array(association_info["real"])
    n = len(cols)

    # Find numeric-numeric pairs
    numeric_pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            c1, c2 = cols[i], cols[j]
            t1 = _classify_column(real_df[c1], col_types.get(c1))
            t2 = _classify_column(real_df[c2], col_types.get(c2))
            if t1 == "numeric" and t2 == "numeric":
                strength = float(mat[i, j])
                numeric_pairs.append((strength, c1, c2, i, j))

    numeric_pairs.sort(key=lambda x: x[0], reverse=True)
    top_3 = numeric_pairs[:3]

    synth_mat = np.array(association_info["synthetic"])

    scatter_list = []
    for strength, c1, c2, i, j in top_3:
        # Sample points
        r_sub = real_df[[c1, c2]].dropna()
        if len(r_sub) > max_points:
            r_sub = r_sub.sample(n=max_points, random_state=42)

        s_sub = synth_df[[c1, c2]].dropna()
        if len(s_sub) > max_points:
            s_sub = s_sub.sample(n=max_points, random_state=42)

        real_pts = [
            {"x": round(float(x), 2), "y": round(float(y), 2)}
            for x, y in zip(r_sub[c1], r_sub[c2])
        ]
        synth_pts = [
            {"x": round(float(x), 2), "y": round(float(y), 2)}
            for x, y in zip(s_sub[c1], s_sub[c2])
        ]

        scatter_list.append({
            "x_col": c1,
            "y_col": c2,
            "real_association": round(strength, 3),
            "synth_association": round(float(synth_mat[i, j]), 3),
            "real_points": real_pts,
            "synth_points": synth_pts,
        })

    return scatter_list


def _build_network(
    columns: list[str],
    real_mat: np.ndarray,
    synth_mat: np.ndarray,
    col_types: dict[str, str],
    threshold: float = 0.3,
) -> dict:
    """
    Build nodes and edges (pairs with association > threshold) for real and synthetic.
    """
    nodes = [
        {"id": c, "name": c, "type": col_types.get(c, "numeric")}
        for c in columns
    ]

    n = len(columns)
    edges_real = []
    edges_synth = []

    for i in range(n):
        for j in range(i + 1, n):
            c1, c2 = columns[i], columns[j]
            r_val = float(real_mat[i, j])
            s_val = float(synth_mat[i, j])

            if r_val >= threshold:
                edges_real.append({
                    "source": c1,
                    "target": c2,
                    "weight": round(r_val, 3),
                })
            if s_val >= threshold:
                edges_synth.append({
                    "source": c1,
                    "target": c2,
                    "weight": round(s_val, 3),
                })

    return {
        "nodes": nodes,
        "edges_real": edges_real,
        "edges_synthetic": edges_synth,
        "real": {"nodes": nodes, "edges": edges_real},
        "synthetic": {"nodes": nodes, "edges": edges_synth},
        "threshold": threshold,
    }


def _build_top_relationships(
    columns: list[str],
    real_mat: np.ndarray,
    synth_mat: np.ndarray,
    indep_mat: np.ndarray,
) -> list[dict]:
    """
    Identify the 5 strongest real relationships with their real, synthetic,
    and baseline strengths for summary text.
    """
    n = len(columns)
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            pairs.append((
                float(real_mat[i, j]),
                float(synth_mat[i, j]),
                float(indep_mat[i, j]),
                columns[i],
                columns[j],
            ))

    pairs.sort(key=lambda x: x[0], reverse=True)
    top_5 = pairs[:5]

    result = []
    for r_str, s_str, i_str, c1, c2 in top_5:
        result.append({
            "col1": c1,
            "col2": c2,
            "real_strength": round(r_str, 3),
            "synth_strength": round(s_str, 3),
            "indep_strength": round(i_str, 3),
            "difference_copula": round(abs(s_str - r_str), 3),
            "difference_indep": round(abs(i_str - r_str), 3),
            "description": f"{c1} ↔ {c2}",
        })

    return result


def generate_fidelity_report(
    real_df: pd.DataFrame,
    synth_copula: pd.DataFrame,
    synth_independent: pd.DataFrame,
    schema: list[dict],
    privacy_settings: Optional[dict] = None,
) -> dict:
    """
    Produce the full Fidelity Report comparing real data against both
    the Copula synthetic data and the independent baseline.

    Args:
        real_df: Original uploaded DataFrame.
        synth_copula: Generated data using Copula method.
        synth_independent: Generated data using Independent (baseline) method.
        schema: Schema list with column types and statistics.
        privacy_settings: Optional privacy configuration dict.

    Returns:
        JSON-serializable dict matching the Section E & F specifications.
    """
    col_types = _build_column_types_from_schema(schema)

    # 1. Privacy check (on the copula synthetic data)
    privacy_result = run_privacy_check(real_df, synth_copula, col_types)

    # 2. Association matrices
    assoc_real = association_matrix(real_df, col_types)
    assoc_copula = association_matrix(synth_copula, col_types)
    assoc_indep = association_matrix(synth_independent, col_types)

    assoc_cols = assoc_real["columns"]
    mat_real = np.array(assoc_real["matrix"])
    mat_copula = np.array(assoc_copula["matrix"])
    mat_indep = np.array(assoc_indep["matrix"])

    # 3. Relationship fidelity
    rel_fidelity_copula, diff_copula = _compute_relationship_fidelity(mat_real, mat_copula)
    rel_fidelity_indep, diff_indep = _compute_relationship_fidelity(mat_real, mat_indep)

    # 4. Column shape & validity evaluation
    per_col_copula, shape_copula, validity_copula = _evaluate_column_shapes_and_validity(
        real_df, synth_copula, col_types
    )
    _, shape_indep, validity_indep = _evaluate_column_shapes_and_validity(
        real_df, synth_independent, col_types
    )

    # 5. Composite scores (40% shape, 40% relationship, 20% validity)
    score_copula = round(
        (0.40 * shape_copula + 0.40 * rel_fidelity_copula + 0.20 * validity_copula) * 100, 1
    )
    score_indep = round(
        (0.40 * shape_indep + 0.40 * rel_fidelity_indep + 0.20 * validity_indep) * 100, 1
    )

    # Ensure in range [0, 100]
    score_copula = max(0.0, min(100.0, score_copula))
    score_indep = max(0.0, min(100.0, score_indep))

    # 6. Chart-ready distributions
    distributions = _build_distributions(real_df, synth_copula, col_types)

    # 7. Association dictionary
    association_data = {
        "columns": assoc_cols,
        "real": mat_real.tolist(),
        "synthetic": mat_copula.tolist(),
        "difference": diff_copula.tolist(),
        "independent": mat_indep.tolist(),
        "difference_independent": diff_indep.tolist(),
    }

    # 8. Scatter points for top 3 numeric pairs
    scatter_data = _build_scatter(real_df, synth_copula, col_types, association_data)

    # 9. Network graph data
    network_data = _build_network(assoc_cols, mat_real, mat_copula, col_types, threshold=0.3)

    # 10. Top 5 relationships
    top_rel = _build_top_relationships(assoc_cols, mat_real, mat_copula, mat_indep)

    return {
        "score": score_copula,
        "score_independent": score_indep,
        "score_breakdown": {
            "copula": {
                "shape": round(shape_copula * 100, 1),
                "relationship": round(rel_fidelity_copula * 100, 1),
                "validity": round(validity_copula * 100, 1),
                "total": score_copula,
            },
            "independent": {
                "shape": round(shape_indep * 100, 1),
                "relationship": round(rel_fidelity_indep * 100, 1),
                "validity": round(validity_indep * 100, 1),
                "total": score_indep,
            },
            "improvement": round(score_copula - score_indep, 1),
        },
        "per_column": list(per_col_copula.values()),
        "distributions": distributions,
        "association": association_data,
        "scatter": scatter_data,
        "network": network_data,
        "privacy": privacy_result,
        "top_relationships": top_rel,
    }
