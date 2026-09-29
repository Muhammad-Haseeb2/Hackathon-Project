"""
Quality comparison — real vs synthetic statistical report.
Compares distributions, frequencies, and overall similarity.
"""

import numpy as np
import pandas as pd
from typing import Optional


def _ks_statistic(real: np.ndarray, synthetic: np.ndarray) -> float:
    """
    Two-sample Kolmogorov-Smirnov statistic (manual implementation).
    Returns a value in [0, 1] — lower is better.
    """
    real_sorted = np.sort(real)
    synth_sorted = np.sort(synthetic)
    
    all_vals = np.sort(np.concatenate([real_sorted, synth_sorted]))
    
    # CDF for real
    real_cdf = np.searchsorted(real_sorted, all_vals, side='right') / len(real_sorted)
    # CDF for synthetic
    synth_cdf = np.searchsorted(synth_sorted, all_vals, side='right') / len(synth_sorted)
    
    return float(np.max(np.abs(real_cdf - synth_cdf)))


def _wasserstein_1d(real: np.ndarray, synthetic: np.ndarray) -> float:
    """
    1D Wasserstein (Earth Mover's) distance — manual implementation.
    Normalized by the range of real data for interpretability.
    """
    real_sorted = np.sort(real)
    synth_sorted = np.sort(synthetic)
    
    # Interpolate to same length for comparison
    n = max(len(real_sorted), len(synth_sorted))
    real_interp = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(real_sorted)), real_sorted)
    synth_interp = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(synth_sorted)), synth_sorted)
    
    distance = float(np.mean(np.abs(real_interp - synth_interp)))
    
    # Normalize
    data_range = float(np.ptp(real_sorted))
    if data_range > 0:
        distance /= data_range
    
    return distance


def _compare_numeric(real: pd.Series, synthetic: pd.Series) -> dict:
    """Compare numeric columns."""
    r = pd.to_numeric(real.dropna(), errors='coerce').dropna().values
    s = pd.to_numeric(synthetic.dropna(), errors='coerce').dropna().values
    
    if len(r) == 0 or len(s) == 0:
        return {'score': 0, 'error': 'Insufficient data'}
    
    # Basic stats comparison
    mean_diff = abs(float(np.mean(r)) - float(np.mean(s)))
    std_diff = abs(float(np.std(r)) - float(np.std(s)))
    
    # Normalize differences
    r_range = float(np.ptp(r)) or 1.0
    mean_score = max(0, 1 - mean_diff / r_range) * 100
    std_score = max(0, 1 - std_diff / r_range) * 100
    
    # KS statistic  
    ks_stat = _ks_statistic(r, s)
    ks_score = (1 - ks_stat) * 100
    
    # Wasserstein
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
    """Compare categorical columns using frequency distribution overlap."""
    r = real.dropna().astype(str)
    s = synthetic.dropna().astype(str)
    
    if len(r) == 0 or len(s) == 0:
        return {'score': 0, 'error': 'Insufficient data'}
    
    r_freq = r.value_counts(normalize=True)
    s_freq = s.value_counts(normalize=True)
    
    all_cats = set(r_freq.index) | set(s_freq.index)
    
    # Frequency overlap score
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
    
    # Score: 100 means perfect match, 0 means complete mismatch
    # Max total_diff is 2.0 (completely disjoint distributions)
    score = max(0, (1 - total_diff / 2)) * 100
    
    # Category coverage
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
    """
    Compare real vs synthetic datasets and produce a quality report.
    
    Args:
        real_df: Original uploaded DataFrame.
        synthetic_df: Generated synthetic DataFrame.
        schema: Column schema from profiler.
    
    Returns:
        Report dict with per-column stats and overall score.
    """
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
            # For text/identity columns, just compare null rates and basic stats
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
