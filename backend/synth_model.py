"""
Copula-based synthesizer — learns the joint distribution of an uploaded dataset
and generates synthetic data that preserves column relationships.

Uses:
  - 200-point empirical quantile tables for marginals (preserves skew/shape)
  - Gaussian copula for dependence structure
  - Faker for identity columns (name, email, phone, etc.)

Constraints:
  - No LLM per row, no persistent disk
  - Deterministic for a given seed
  - Stays under 512 MB RAM
"""

import numpy as np
import pandas as pd
from scipy import stats as sp_stats
from faker import Faker
from typing import Optional
import uuid

from association import _IDENTITY_TYPES


# Number of quantile points for the empirical marginal
N_QUANTILES = 200

# Minimum rows / modelled columns for copula to work
MIN_ROWS_FOR_COPULA = 30
MIN_MODELLED_COLS = 2

# Max categories to model (rest grouped as "Other")
MAX_CATEGORIES = 50


class ColumnModel:
    """Stores the learned marginal for a single column."""
    __slots__ = (
        "name", "col_type", "model_type", "null_rate",
        # numeric
        "quantile_values", "quantile_probs", "real_min", "real_max", "is_integer",
        # categorical
        "categories", "cum_intervals",
        # datetime
        "dt_min_ts", "dt_max_ts",
    )

    def __init__(self, name: str, col_type: str):
        self.name = name
        self.col_type = col_type
        self.model_type: str = ""  # "numeric", "categorical", "datetime"
        self.null_rate: float = 0.0
        # numeric fields
        self.quantile_values: Optional[np.ndarray] = None
        self.quantile_probs: Optional[np.ndarray] = None
        self.real_min: float = 0.0
        self.real_max: float = 0.0
        self.is_integer: bool = False
        # categorical fields
        self.categories: list[str] = []
        self.cum_intervals: list[tuple[float, float]] = []
        # datetime fields
        self.dt_min_ts: float = 0.0
        self.dt_max_ts: float = 0.0


class CopulaSynthesizer:
    """
    Gaussian copula synthesizer that learns column marginals and
    inter-column dependencies from real data.
    """

    def __init__(self):
        self._column_models: list[ColumnModel] = []
        self._modelled_indices: list[int] = []  # indices into _column_models
        self._identity_indices: list[int] = []
        self._correlation_matrix: Optional[np.ndarray] = None
        self._is_fitted: bool = False
        self._warnings: list[str] = []
        self._fallback_independent: bool = False

    @property
    def is_fitted(self) -> bool:
        return self._is_fitted

    @property
    def warnings(self) -> list[str]:
        return list(self._warnings)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  FIT
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def fit(self, df: pd.DataFrame, column_types: dict[str, str]) -> "CopulaSynthesizer":
        """
        Learn marginals and dependence structure from the real data.

        Args:
            df: Real DataFrame.
            column_types: Mapping of column name -> profiled type
                          (e.g. {"age": "integer", "dept": "categorical"}).
        """
        self._warnings = []
        self._column_models = []
        self._modelled_indices = []
        self._identity_indices = []

        n_rows = len(df)

        # Build per-column models
        for col in df.columns:
            ct = column_types.get(col, "text")

            # Auto-reclassify: if the profiler said "categorical" but every
            # non-null value is numeric, treat it as integer/float so the
            # copula can learn its real distribution (e.g. age with 40 uniques).
            if ct == "categorical" and pd.api.types.is_numeric_dtype(df[col]):
                non_null = df[col].dropna()
                if len(non_null) > 0:
                    as_num = pd.to_numeric(non_null, errors="coerce")
                    if as_num.notna().all():
                        # Check if all values are integers
                        if (as_num == as_num.astype(int)).all():
                            ct = "integer"
                        else:
                            ct = "float"
            elif ct == "categorical":
                non_null = df[col].dropna()
                if len(non_null) > 0:
                    as_num = pd.to_numeric(non_null, errors="coerce")
                    if as_num.notna().all():
                        if (as_num == as_num.astype(int)).all():
                            ct = "integer"
                        else:
                            ct = "float"

            cm = ColumnModel(col, ct)
            idx = len(self._column_models)
            self._column_models.append(cm)

            # Null rate
            cm.null_rate = float(df[col].isna().mean())

            if ct in _IDENTITY_TYPES:
                self._identity_indices.append(idx)
                continue

            if ct in ("integer", "float"):
                self._fit_numeric(cm, df[col])
                self._modelled_indices.append(idx)
            elif ct == "datetime":
                self._fit_datetime(cm, df[col])
                self._modelled_indices.append(idx)
            elif ct in ("categorical", "boolean"):
                self._fit_categorical(cm, df[col], df=df)
                self._modelled_indices.append(idx)
            else:
                # Unknown type → treat as identity / skip
                self._identity_indices.append(idx)

        # Fallback check
        if n_rows < MIN_ROWS_FOR_COPULA or len(self._modelled_indices) < MIN_MODELLED_COLS:
            self._fallback_independent = True
            self._warnings.append(
                "Too little data to learn relationships "
                f"({n_rows} rows, {len(self._modelled_indices)} modelled columns). "
                "Using independent sampling."
            )
            self._correlation_matrix = np.eye(len(self._modelled_indices))
            self._is_fitted = True
            return self

        # Convert every real row to normal scores and compute correlation
        normal_scores = self._to_normal_scores(df)
        corr = np.corrcoef(normal_scores, rowvar=False)
        corr = self._make_psd(corr)
        self._correlation_matrix = corr
        self._fallback_independent = False
        self._is_fitted = True
        return self

    # ── marginal fitters ────────────────────────────────────────────────

    def _fit_numeric(self, cm: ColumnModel, series: pd.Series):
        """Fit a numeric marginal using a 200-point quantile table."""
        numeric = pd.to_numeric(series, errors="coerce").dropna().values.astype(float)
        if len(numeric) == 0:
            numeric = np.array([0.0])

        cm.model_type = "numeric"
        cm.is_integer = cm.col_type == "integer"
        cm.real_min = float(np.min(numeric))
        cm.real_max = float(np.max(numeric))

        probs = np.linspace(0, 1, N_QUANTILES)
        cm.quantile_probs = probs
        cm.quantile_values = np.quantile(numeric, probs)

    def _fit_datetime(self, cm: ColumnModel, series: pd.Series):
        """Fit a datetime marginal by converting to timestamps first."""
        try:
            dt = pd.to_datetime(series, errors="coerce", format="mixed").dropna()
        except Exception:
            dt = pd.to_datetime(series, errors="coerce").dropna()

        if len(dt) == 0:
            cm.model_type = "numeric"
            cm.is_integer = False
            cm.real_min = 0.0
            cm.real_max = 1.0
            cm.quantile_probs = np.linspace(0, 1, N_QUANTILES)
            cm.quantile_values = np.linspace(0, 1, N_QUANTILES)
            return

        timestamps = dt.astype(np.int64).values.astype(float) / 1e9  # seconds
        cm.model_type = "datetime"
        cm.dt_min_ts = float(np.min(timestamps))
        cm.dt_max_ts = float(np.max(timestamps))
        cm.real_min = cm.dt_min_ts
        cm.real_max = cm.dt_max_ts

        probs = np.linspace(0, 1, N_QUANTILES)
        cm.quantile_probs = probs
        cm.quantile_values = np.quantile(timestamps, probs)

    def _fit_categorical(self, cm: ColumnModel, series: pd.Series, df: pd.DataFrame = None):
        """
        Fit a categorical marginal with cumulative intervals.
        When the full DataFrame is provided, categories are sorted by their
        average co-occurring numeric value so the interval mapping preserves
        relationships (e.g., 'Low' → low interval, 'High' → high interval).
        """
        non_null = series.dropna().astype(str)
        if len(non_null) == 0:
            non_null = pd.Series(["Unknown"])

        freq = non_null.value_counts(normalize=True).head(MAX_CATEGORIES)

        # Group the rest as "Other"
        total_modelled = freq.sum()
        if total_modelled < 1.0 - 1e-9:
            other_share = 1.0 - total_modelled
            freq["__Other__"] = other_share

        cm.model_type = "categorical"

        # Sort categories by average co-occurring numeric value
        # so the copula interval ordering reflects real relationships.
        cat_order = list(freq.index)
        if df is not None:
            numeric_cols = [
                c for c in df.columns
                if c != cm.name and pd.api.types.is_numeric_dtype(df[c])
            ]
            if numeric_cols:
                # Compute average numeric value per category across all numeric cols
                cat_scores = {}
                for cat in cat_order:
                    if cat == "__Other__":
                        continue
                    mask = series.astype(str) == cat
                    if mask.sum() > 0:
                        vals = []
                        for nc in numeric_cols:
                            col_vals = pd.to_numeric(df.loc[mask, nc], errors="coerce").dropna()
                            if len(col_vals) > 0:
                                # Normalize to [0,1] range for comparability
                                col_all = pd.to_numeric(df[nc], errors="coerce").dropna()
                                if col_all.std() > 0:
                                    vals.append((col_vals.mean() - col_all.mean()) / col_all.std())
                        cat_scores[cat] = np.mean(vals) if vals else 0.0
                    else:
                        cat_scores[cat] = 0.0

                # Sort by score (ascending: lowest numeric → lowest interval)
                sorted_cats = sorted(
                    [c for c in cat_order if c != "__Other__"],
                    key=lambda c: cat_scores.get(c, 0.0)
                )
                # Put __Other__ at the end if present
                if "__Other__" in cat_order:
                    sorted_cats.append("__Other__")
                cat_order = sorted_cats

        cm.categories = cat_order

        # Build cumulative intervals
        intervals = []
        cum = 0.0
        for cat in cm.categories:
            share = float(freq[cat])
            intervals.append((cum, cum + share))
            cum += share
        # Fix last upper bound to exactly 1.0
        if intervals:
            lo, _ = intervals[-1]
            intervals[-1] = (lo, 1.0)
        cm.cum_intervals = intervals

    # ── normal score transform ──────────────────────────────────────────

    def _to_normal_scores(self, df: pd.DataFrame) -> np.ndarray:
        """
        Convert every modelled column in the real data to normal scores
        using their fitted marginals.
        """
        n = len(df)
        k = len(self._modelled_indices)
        scores = np.zeros((n, k), dtype=float)

        for j, idx in enumerate(self._modelled_indices):
            cm = self._column_models[idx]
            series = df[cm.name]

            if cm.model_type == "numeric" or cm.model_type == "datetime":
                scores[:, j] = self._numeric_to_normal(cm, series)
            elif cm.model_type == "categorical":
                scores[:, j] = self._categorical_to_normal(cm, series)

        return scores

    def _numeric_to_normal(self, cm: ColumnModel, series: pd.Series) -> np.ndarray:
        """Rank -> uniform -> norm.ppf for numeric data."""
        if cm.model_type == "datetime":
            try:
                vals = pd.to_datetime(series, errors="coerce", format="mixed").astype(np.int64).values.astype(float) / 1e9
            except Exception:
                vals = pd.to_numeric(series, errors="coerce").fillna(0).values.astype(float)
        else:
            vals = pd.to_numeric(series, errors="coerce").fillna(cm.real_min).values.astype(float)

        n = len(vals)
        # Rank-based uniform: rank / (n+1) avoids 0 and 1
        ranks = np.argsort(np.argsort(vals)).astype(float)
        uniform = (ranks + 1) / (n + 1)

        # Clip away from extremes for numerical stability
        uniform = np.clip(uniform, 1e-6, 1 - 1e-6)
        return sp_stats.norm.ppf(uniform)

    def _categorical_to_normal(self, cm: ColumnModel, series: pd.Series) -> np.ndarray:
        """Map categories to the midpoint of their uniform intervals, then norm.ppf."""
        vals = series.fillna("__NULL__").astype(str).values
        n = len(vals)

        # Pre-compute midpoints for determinism and correct ordering
        cat_to_mid = {}
        for cat, (lo, hi) in zip(cm.categories, cm.cum_intervals):
            cat_to_mid[cat] = (lo + hi) / 2.0

        uniform = np.zeros(n, dtype=float)
        for i, v in enumerate(vals):
            if v in cat_to_mid:
                uniform[i] = cat_to_mid[v]
            elif "__Other__" in cat_to_mid:
                uniform[i] = cat_to_mid["__Other__"]
            else:
                uniform[i] = 0.5

        # Add tiny jitter to break ties (same category → same midpoint)
        # Using rank-based tie-breaking within each category group
        rng_jitter = np.random.default_rng(42)
        for cat, (lo, hi) in zip(cm.categories, cm.cum_intervals):
            mask = vals == cat
            count = mask.sum()
            if count > 1:
                # Spread within interval using rank
                spread = np.linspace(lo + 1e-6, hi - 1e-6, count)
                rng_jitter.shuffle(spread)
                uniform[mask] = spread

        uniform = np.clip(uniform, 1e-6, 1 - 1e-6)
        return sp_stats.norm.ppf(uniform)

    # ── positive semi-definite fix ──────────────────────────────────────

    @staticmethod
    def _make_psd(corr: np.ndarray) -> np.ndarray:
        """
        Make a correlation matrix positive semi-definite by clipping
        eigenvalues at 1e-6 and renormalising the diagonal.
        """
        # Fix any NaN from constant columns
        corr = np.nan_to_num(corr, nan=0.0, posinf=1.0, neginf=-1.0)

        eigvals, eigvecs = np.linalg.eigh(corr)
        eigvals = np.maximum(eigvals, 1e-6)
        fixed = eigvecs @ np.diag(eigvals) @ eigvecs.T

        # Renormalize diagonal to 1
        d = np.sqrt(np.diag(fixed))
        d[d == 0] = 1.0
        fixed = fixed / np.outer(d, d)

        # Ensure perfect symmetry
        fixed = (fixed + fixed.T) / 2
        np.fill_diagonal(fixed, 1.0)
        return fixed

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  SAMPLE
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def sample(self, n: int, seed: int = 42) -> pd.DataFrame:
        """
        Generate n synthetic rows preserving the learned distribution.

        Args:
            n: Number of rows to generate.
            seed: Random seed (same seed → identical output).

        Returns:
            DataFrame with synthetic data.
        """
        if not self._is_fitted:
            raise RuntimeError("CopulaSynthesizer has not been fitted. Call fit() first.")

        rng = np.random.default_rng(seed)
        k = len(self._modelled_indices)

        # 1. Draw from multivariate normal
        if k > 0 and not self._fallback_independent:
            z = rng.multivariate_normal(
                mean=np.zeros(k),
                cov=self._correlation_matrix,
                size=n,
            )
            # 2. Convert to uniform via CDF
            uniform = sp_stats.norm.cdf(z)
        elif k > 0:
            # Independent fallback: each column is independent uniform
            uniform = rng.random((n, k))
        else:
            uniform = np.empty((n, 0))

        # 3. Invert marginals
        data = {}
        for j, idx in enumerate(self._modelled_indices):
            cm = self._column_models[idx]
            u = uniform[:, j]

            if cm.model_type == "numeric":
                vals = self._invert_numeric(cm, u)
                data[cm.name] = vals
            elif cm.model_type == "datetime":
                vals = self._invert_datetime(cm, u)
                data[cm.name] = vals
            elif cm.model_type == "categorical":
                vals = self._invert_categorical(cm, u)
                data[cm.name] = vals

        # 4. Generate identity columns via Faker
        fake = Faker()
        Faker.seed(seed)
        fake.seed_instance(seed)
        identity_rng = np.random.default_rng(seed)

        generated_names = []
        for idx in self._identity_indices:
            cm = self._column_models[idx]
            if cm.col_type == "name":
                names = [fake.name() for _ in range(n)]
                generated_names = names
                data[cm.name] = names
            elif cm.col_type == "email":
                if generated_names:
                    # Derive email from name for coherence
                    emails = []
                    domains = ["gmail.com", "yahoo.com", "outlook.com", "company.com", "mail.com"]
                    for name in generated_names:
                        parts = name.lower().replace(" ", ".").replace("'", "")
                        dom = domains[identity_rng.integers(0, len(domains))]
                        suffix = identity_rng.integers(10, 999)
                        emails.append(f"{parts}{suffix}@{dom}")
                    data[cm.name] = emails
                else:
                    data[cm.name] = [fake.email() for _ in range(n)]
            elif cm.col_type == "phone":
                data[cm.name] = [fake.phone_number() for _ in range(n)]
            elif cm.col_type == "address":
                data[cm.name] = [fake.address().replace("\n", ", ") for _ in range(n)]
            elif cm.col_type in ("uuid", "id"):
                if cm.col_type == "uuid":
                    data[cm.name] = [str(uuid.UUID(bytes=identity_rng.bytes(16))) for _ in range(n)]
                else:
                    data[cm.name] = list(range(1, n + 1))
            elif cm.col_type == "text":
                data[cm.name] = [fake.sentence() for _ in range(n)]
            else:
                data[cm.name] = [fake.word() for _ in range(n)]

        # 5. Apply null rates
        for idx in self._modelled_indices + self._identity_indices:
            cm = self._column_models[idx]
            if cm.null_rate > 0 and cm.name in data:
                null_mask = rng.random(n) < cm.null_rate
                vals = data[cm.name]
                if isinstance(vals, np.ndarray):
                    vals = vals.copy()
                    vals = vals.astype(object)
                    vals[null_mask] = None
                    data[cm.name] = vals
                elif isinstance(vals, list):
                    for i in range(n):
                        if null_mask[i]:
                            vals[i] = None

        # Construct DataFrame preserving original column order
        ordered_cols = [cm.name for cm in self._column_models if cm.name in data]
        df = pd.DataFrame({col: data[col] for col in ordered_cols})
        return df

    # ── marginal inverters ──────────────────────────────────────────────

    def _invert_numeric(self, cm: ColumnModel, u: np.ndarray) -> np.ndarray:
        """Invert uniform values through the stored quantile table."""
        vals = np.interp(u, cm.quantile_probs, cm.quantile_values)
        vals = np.clip(vals, cm.real_min, cm.real_max)
        if cm.is_integer:
            vals = np.round(vals).astype(int)
        else:
            vals = np.round(vals, 4)
        return vals

    def _invert_datetime(self, cm: ColumnModel, u: np.ndarray) -> list[str]:
        """Invert uniform values to datetime strings."""
        timestamps = np.interp(u, cm.quantile_probs, cm.quantile_values)
        timestamps = np.clip(timestamps, cm.dt_min_ts, cm.dt_max_ts)
        result = []
        for ts in timestamps:
            try:
                dt = pd.Timestamp(ts, unit="s")
                result.append(dt.strftime("%Y-%m-%d %H:%M:%S"))
            except Exception:
                result.append("2020-01-01 00:00:00")
        return result

    def _invert_categorical(self, cm: ColumnModel, u: np.ndarray) -> list[str]:
        """Map uniform values back through cumulative intervals to categories."""
        result = []
        for val in u:
            found = False
            for cat, (lo, hi) in zip(cm.categories, cm.cum_intervals):
                if lo <= val < hi or (val >= hi and cat == cm.categories[-1]):
                    result.append(cat if cat != "__Other__" else cm.categories[0])
                    found = True
                    break
            if not found:
                result.append(cm.categories[-1] if cm.categories else "Unknown")
        return result

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    #  CONVENIENCE
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @property
    def modelled_columns(self) -> list[str]:
        return [self._column_models[i].name for i in self._modelled_indices]

    @property
    def identity_columns(self) -> list[str]:
        return [self._column_models[i].name for i in self._identity_indices]

    @property
    def column_count(self) -> int:
        return len(self._column_models)

    @property
    def is_fallback(self) -> bool:
        return self._fallback_independent
