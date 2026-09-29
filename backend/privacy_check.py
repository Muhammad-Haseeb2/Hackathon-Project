"""
Privacy check — verifies that synthetic data does not memorise real rows.

Metrics:
  1. Exact match count/rate: synthetic rows identical to any real row
     across all modelled columns (hash-based).
  2. Distance to closest record (DCR): on standardised numeric +
     one-hot categorical columns, median nearest-real distance for
     synthetic vs median nearest-neighbour among real (leave-one-out).
     Ratio ≥ 0.8 ⇒ pass.
  3. Status: "pass" when exact_match_count == 0 AND ratio ≥ 0.8.
"""

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from typing import Optional

from association import _IDENTITY_TYPES


# Caps for performance
MAX_SYNTH_ROWS_FOR_DCR = 2000
MAX_ONEHOT_COLS = 40


def _select_modelled_columns(
    df: pd.DataFrame,
    column_types: dict[str, str],
) -> list[str]:
    """Return column names that are modelled (not identity/text)."""
    return [
        col for col in df.columns
        if column_types.get(col, "text") not in _IDENTITY_TYPES
        and col in df.columns
    ]


def check_exact_matches(
    real_df: pd.DataFrame,
    synth_df: pd.DataFrame,
    modelled_cols: list[str],
) -> dict:
    """
    Count synthetic rows that exactly match any real row
    across all modelled columns.
    """
    if not modelled_cols:
        return {"exact_match_count": 0, "exact_match_rate": 0.0}

    cols = [c for c in modelled_cols if c in real_df.columns and c in synth_df.columns]
    if not cols:
        return {"exact_match_count": 0, "exact_match_rate": 0.0}

    # Hash each row as a tuple
    real_hashes = set()
    for _, row in real_df[cols].iterrows():
        real_hashes.add(tuple(str(v) for v in row.values))

    match_count = 0
    for _, row in synth_df[cols].iterrows():
        row_hash = tuple(str(v) for v in row.values)
        if row_hash in real_hashes:
            match_count += 1

    return {
        "exact_match_count": int(match_count),
        "exact_match_rate": round(match_count / max(len(synth_df), 1), 4),
    }


def _prepare_distance_features(
    df: pd.DataFrame,
    modelled_cols: list[str],
    column_types: dict[str, str],
    fit_stats: Optional[dict] = None,
) -> tuple[np.ndarray, dict]:
    """
    Prepare a numeric feature matrix for distance computation.
    - Numeric columns are standardised (z-score).
    - Categorical columns are one-hot encoded (limited to MAX_ONEHOT_COLS total).

    Returns (feature_matrix, fit_stats_dict) where fit_stats_dict
    contains means/stds/categories needed to transform the other dataset
    consistently.
    """
    numeric_cols = []
    cat_cols = []
    for col in modelled_cols:
        if col not in df.columns:
            continue
        ct = column_types.get(col, "text")
        if ct in ("integer", "float", "datetime"):
            numeric_cols.append(col)
        elif ct in ("categorical", "boolean"):
            cat_cols.append(col)

    parts = []
    stats = fit_stats or {}

    # Numeric: z-score
    for col in numeric_cols:
        vals = pd.to_numeric(df[col], errors="coerce").fillna(0).values.astype(float)
        if fit_stats is None:
            mu = float(np.mean(vals))
            sd = float(np.std(vals))
            if sd == 0:
                sd = 1.0
            stats[f"num_{col}_mean"] = mu
            stats[f"num_{col}_std"] = sd
        else:
            mu = stats.get(f"num_{col}_mean", 0.0)
            sd = stats.get(f"num_{col}_std", 1.0)
        parts.append(((vals - mu) / sd).reshape(-1, 1))

    # Categorical: one-hot (limited)
    onehot_budget = MAX_ONEHOT_COLS - len(numeric_cols)
    for col in cat_cols:
        if onehot_budget <= 0:
            break
        cat_vals = df[col].fillna("__NULL__").astype(str)
        if fit_stats is None:
            cats = list(cat_vals.value_counts().head(min(10, onehot_budget)).index)
            stats[f"cat_{col}_cats"] = cats
        else:
            cats = stats.get(f"cat_{col}_cats", [])

        for cat in cats:
            parts.append((cat_vals == cat).values.astype(float).reshape(-1, 1))
            onehot_budget -= 1
            if onehot_budget <= 0:
                break

    if not parts:
        return np.zeros((len(df), 1)), stats

    return np.hstack(parts), stats


def check_distance_to_closest(
    real_df: pd.DataFrame,
    synth_df: pd.DataFrame,
    modelled_cols: list[str],
    column_types: dict[str, str],
) -> dict:
    """
    Compute the distance-to-closest-record (DCR) ratio.

    - Median nearest-real distance for synthetic rows.
    - Median nearest-neighbour distance among real rows (leave-one-out).
    - Ratio = synth_median / real_median. Higher is better (more private).
    """
    if len(modelled_cols) < 1:
        return {"dcr_ratio": 1.0, "synth_median_dist": 0.0, "real_median_dist": 0.0}

    # Sample synthetic rows for performance
    if len(synth_df) > MAX_SYNTH_ROWS_FOR_DCR:
        synth_sample = synth_df.sample(
            n=MAX_SYNTH_ROWS_FOR_DCR, random_state=42
        ).reset_index(drop=True)
    else:
        synth_sample = synth_df

    # Prepare features with consistent standardisation
    real_features, fit_stats = _prepare_distance_features(
        real_df, modelled_cols, column_types
    )
    synth_features, _ = _prepare_distance_features(
        synth_sample, modelled_cols, column_types, fit_stats=fit_stats
    )

    # Build KD-tree on real data
    tree = cKDTree(real_features)

    # Synthetic → nearest real
    synth_dists, _ = tree.query(synth_features, k=1)
    synth_median = float(np.median(synth_dists))

    # Real → nearest real (leave-one-out: k=2, take second)
    real_dists, _ = tree.query(real_features, k=2)
    real_loo_dists = real_dists[:, 1]  # second nearest = nearest non-self
    real_median = float(np.median(real_loo_dists))

    if real_median == 0:
        ratio = 1.0 if synth_median > 0 else 0.0
    else:
        ratio = synth_median / real_median

    return {
        "dcr_ratio": round(ratio, 4),
        "synth_median_dist": round(synth_median, 4),
        "real_median_dist": round(real_median, 4),
    }


def run_privacy_check(
    real_df: pd.DataFrame,
    synth_df: pd.DataFrame,
    column_types: dict[str, str],
) -> dict:
    """
    Full privacy check: exact matches + DCR ratio.

    Returns dict with:
      - exact_match_count, exact_match_rate
      - dcr_ratio, synth_median_dist, real_median_dist
      - status: "pass" or "review"
      - explanation: plain-English summary
    """
    modelled_cols = _select_modelled_columns(real_df, column_types)

    exact = check_exact_matches(real_df, synth_df, modelled_cols)
    dcr = check_distance_to_closest(real_df, synth_df, modelled_cols, column_types)

    passed = exact["exact_match_count"] == 0 and dcr["dcr_ratio"] >= 0.8
    status = "pass" if passed else "review"

    # Build explanation
    parts = []
    if exact["exact_match_count"] == 0:
        parts.append("No synthetic row exactly matches any real row.")
    else:
        parts.append(
            f"{exact['exact_match_count']} synthetic row(s) exactly match real data "
            f"({exact['exact_match_rate']:.1%} of synthetic rows)."
        )

    if dcr["dcr_ratio"] >= 0.8:
        parts.append(
            f"Synthetic rows are sufficiently distant from real data "
            f"(distance ratio {dcr['dcr_ratio']:.2f} >= 0.80)."
        )
    else:
        parts.append(
            f"Some synthetic rows may be too close to real data "
            f"(distance ratio {dcr['dcr_ratio']:.2f} < 0.80). "
            f"Consider adding more noise or differential privacy."
        )

    explanation = " ".join(parts)

    return {
        **exact,
        **dcr,
        "status": status,
        "explanation": explanation,
    }
