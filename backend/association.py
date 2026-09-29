"""
Association module — computes a unified association matrix for mixed-type DataFrames.
Returns values in [0, 1] for every column pair:
  - numeric vs numeric:      absolute Spearman correlation
  - categorical vs categorical: Cramér's V
  - numeric vs categorical:  correlation ratio (eta)
"""

import numpy as np
import pandas as pd
from scipy import stats as sp_stats


# ── Identity / text column types that should be excluded from association ──
_IDENTITY_TYPES = {"name", "email", "phone", "address", "text", "uuid", "id"}


def _classify_column(series: pd.Series, col_type: str | None = None) -> str:
    """
    Classify a column as 'numeric' or 'categorical' for association purposes.
    """
    if col_type in ("integer", "float", "datetime"):
        return "numeric"
    if col_type in ("categorical", "boolean"):
        return "categorical"
    # Fallback: try pandas dtype
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    return "categorical"


def _spearman_abs(x: np.ndarray, y: np.ndarray) -> float:
    """Absolute Spearman rank correlation between two numeric arrays."""
    if len(x) < 3:
        return 0.0
    corr, _ = sp_stats.spearmanr(x, y, nan_policy="omit")
    if np.isnan(corr):
        return 0.0
    return float(abs(corr))


def _cramers_v(x: pd.Series, y: pd.Series) -> float:
    """Cramér's V for two categorical series."""
    confusion = pd.crosstab(x, y)
    n = confusion.values.sum()
    if n == 0:
        return 0.0
    chi2 = sp_stats.chi2_contingency(confusion, correction=False)[0]
    r, k = confusion.shape
    # Bias-corrected Cramér's V
    phi2 = chi2 / n
    phi2_corr = max(0, phi2 - ((k - 1) * (r - 1)) / (n - 1)) if n > 1 else phi2
    r_corr = r - ((r - 1) ** 2) / (n - 1) if n > 1 else r
    k_corr = k - ((k - 1) ** 2) / (n - 1) if n > 1 else k
    denom = min(k_corr - 1, r_corr - 1)
    if denom <= 0:
        return 0.0
    return float(np.sqrt(phi2_corr / denom))


def _correlation_ratio(categories: pd.Series, values: np.ndarray) -> float:
    """
    Correlation ratio (eta) — numeric vs categorical.
    Returns a value in [0, 1].
    """
    groups = {}
    for cat, val in zip(categories, values):
        if pd.isna(cat) or np.isnan(val):
            continue
        groups.setdefault(cat, []).append(val)

    if len(groups) < 2:
        return 0.0

    grand_mean = np.mean(values[~np.isnan(values)])
    ss_between = 0.0
    ss_total = 0.0
    for _, vals in groups.items():
        arr = np.array(vals)
        ss_between += len(arr) * (np.mean(arr) - grand_mean) ** 2
    for val in values:
        if not np.isnan(val):
            ss_total += (val - grand_mean) ** 2

    if ss_total == 0:
        return 0.0
    return float(np.sqrt(ss_between / ss_total))


def association_matrix(
    df: pd.DataFrame,
    column_types: dict[str, str] | None = None,
) -> dict:
    """
    Compute a square association matrix for the DataFrame.

    Args:
        df: Input DataFrame.
        column_types: Optional mapping of column name -> profiled type
                      (e.g. {"age": "integer", "dept": "categorical"}).
                      If not provided, types are inferred from pandas dtypes.

    Returns:
        dict with:
          - columns: list of column names included
          - matrix: 2D list (rows × cols) of association values [0, 1]
    """
    if column_types is None:
        column_types = {}

    # Filter to modellable columns only
    usable_cols = []
    col_classes = {}  # col_name -> "numeric" | "categorical"
    for col in df.columns:
        ct = column_types.get(col)
        if ct in _IDENTITY_TYPES:
            continue
        cls = _classify_column(df[col], ct)
        usable_cols.append(col)
        col_classes[col] = cls

    n = len(usable_cols)
    mat = np.eye(n, dtype=float)  # diagonal = 1.0

    # Prepare numeric arrays and categorical series once
    prepared = {}
    for col in usable_cols:
        if col_classes[col] == "numeric":
            prepared[col] = pd.to_numeric(df[col], errors="coerce").values.astype(float)
        else:
            prepared[col] = df[col].fillna("__NULL__").astype(str)

    for i in range(n):
        for j in range(i + 1, n):
            ci, cj = usable_cols[i], usable_cols[j]
            ti, tj = col_classes[ci], col_classes[cj]

            if ti == "numeric" and tj == "numeric":
                val = _spearman_abs(prepared[ci], prepared[cj])
            elif ti == "categorical" and tj == "categorical":
                val = _cramers_v(prepared[ci], prepared[cj])
            else:
                # one numeric, one categorical
                if ti == "numeric":
                    val = _correlation_ratio(prepared[cj], prepared[ci])
                else:
                    val = _correlation_ratio(prepared[ci], prepared[cj])

            mat[i, j] = val
            mat[j, i] = val

    return {
        "columns": usable_cols,
        "matrix": mat.tolist(),
    }


def _build_column_types_from_schema(schema: list[dict]) -> dict[str, str]:
    """
    Helper to convert profiler schema list to a {name: type} dict.
    """
    return {col["name"]: col.get("type", "text") for col in schema}
