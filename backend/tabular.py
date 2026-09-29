"""
Tabular data generator — produces synthetic data from a schema definition.
Uses Faker for identity columns, numpy for distributions, and supports
seeded reproducibility, null injection, outlier injection, and rich locale support.
"""

import uuid
import numpy as np
import pandas as pd
from faker import Faker
from typing import Optional

from locales import get_safe_faker, PakistanDataProvider


def generate_tabular(
    schema: list[dict],
    row_count: int = 100,
    seed: Optional[int] = 42,
    locale: str = 'en_US',
    null_rate: float = 0.0,
    outlier_rate: float = 0.0,
) -> pd.DataFrame:
    """
    Generate synthetic tabular data from a schema definition.

    Args:
        schema: List of column definitions, each with 'name', 'type', and optional 'stats'.
        row_count: Number of rows to generate (1-50000).
        seed: Random seed for reproducibility. Same seed = same output.
        locale: Locale string (e.g. 'en_US', 'ur_PK', 'de_DE', etc.).
        null_rate: Global null injection rate (0.0-0.5).
        outlier_rate: Outlier injection rate for numeric columns (0.0-0.2).

    Returns:
        pandas DataFrame with generated data.
    """
    row_count = max(1, min(row_count, 50000))
    null_rate = max(0.0, min(null_rate, 0.5))
    outlier_rate = max(0.0, min(outlier_rate, 0.2))

    # Initialize RNG and Safe Faker with seed
    rng = np.random.default_rng(seed)
    fake, locale_cfg, pk_provider = get_safe_faker(locale, seed)

    data = {}

    for col_def in schema:
        col_name = col_def['name']
        col_type = col_def.get('type', 'text')
        stats = col_def.get('stats', {})

        values = _generate_column(
            col_name=col_name,
            col_type=col_type,
            stats=stats,
            n=row_count,
            rng=rng,
            fake=fake,
            locale_cfg=locale_cfg,
            pk_provider=pk_provider,
        )
        data[col_name] = values

    df = pd.DataFrame(data)

    # ── Inject nulls ──
    if null_rate > 0:
        df = _inject_nulls(df, null_rate, rng, schema)

    # ── Inject outliers ──
    if outlier_rate > 0:
        df = _inject_outliers(df, outlier_rate, rng, schema)

    return df


def _generate_column(
    col_name: str,
    col_type: str,
    stats: dict,
    n: int,
    rng: np.random.Generator,
    fake: Faker,
    locale_cfg: dict,
    pk_provider: Optional[PakistanDataProvider] = None,
) -> list:
    """Generate values for a single column based on type, name, and stats."""
    col_lower = col_name.lower()

    if col_type == 'integer':
        return _gen_integer(stats, n, rng)
    elif col_type == 'float':
        return _gen_float(stats, n, rng)
    elif col_type == 'categorical':
        return _gen_categorical(stats, n, rng, col_lower, locale_cfg)
    elif col_type == 'currency':
        curr = locale_cfg.get('currency_code', 'USD')
        # 80% primary currency, 20% major international currencies
        currencies = [curr, 'USD', 'EUR', 'GBP']
        probs = [0.85, 0.05, 0.05, 0.05]
        return list(rng.choice(currencies, size=n, p=probs))
    elif col_type == 'datetime':
        return _gen_datetime(stats, n, rng, fake)
    elif col_type == 'name':
        if pk_provider:
            return [pk_provider.name() for _ in range(n)]
        return [fake.name() for _ in range(n)]
    elif col_type == 'email':
        if pk_provider:
            domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'live.com']
            emails = []
            for _ in range(n):
                name = pk_provider.name().lower().replace(' ', '.')
                dom = rng.choice(domains)
                emails.append(f"{name}{rng.integers(10, 999)}@{dom}")
            return emails
        return [fake.email() for _ in range(n)]
    elif col_type == 'phone':
        if pk_provider:
            return [pk_provider.phone_number() for _ in range(n)]
        return [fake.phone_number() for _ in range(n)]
    elif col_type == 'address':
        if pk_provider:
            return [pk_provider.address() for _ in range(n)]
        return [fake.address().replace('\n', ', ') for _ in range(n)]
    elif col_type == 'uuid':
        return [str(uuid.UUID(bytes=rng.bytes(16))) for _ in range(n)]
    elif col_type == 'id':
        return list(range(1, n + 1))
    elif col_type == 'text':
        avg_len = stats.get('avg_length', 50)
        if avg_len < 30:
            return [fake.sentence(nb_words=rng.integers(3, 8)) for _ in range(n)]
        else:
            return [fake.paragraph(nb_sentences=rng.integers(1, 4)) for _ in range(n)]
    else:
        return [fake.word() for _ in range(n)]


def _gen_integer(stats: dict, n: int, rng: np.random.Generator) -> list:
    """Generate integer column from profiled distribution."""
    mean = stats.get('mean', 50)
    std = stats.get('std', 25)
    lo = stats.get('min', 0)
    hi = stats.get('max', 100)

    if std == 0 or std is None:
        std = max(1, abs(hi - lo) / 6)

    values = rng.normal(loc=mean, scale=std, size=n)
    values = np.clip(values, lo, hi)
    return [int(round(v)) for v in values]


def _gen_float(stats: dict, n: int, rng: np.random.Generator) -> list:
    """Generate float column from profiled distribution."""
    mean = stats.get('mean', 50.0)
    std = stats.get('std', 25.0)
    lo = stats.get('min', 0.0)
    hi = stats.get('max', 100.0)

    if std == 0 or std is None:
        std = max(0.01, abs(hi - lo) / 6)

    values = rng.normal(loc=mean, scale=std, size=n)
    values = np.clip(values, lo, hi)
    return [round(float(v), 2) for v in values]


def _gen_categorical(
    stats: dict,
    n: int,
    rng: np.random.Generator,
    col_lower: str = '',
    locale_cfg: Optional[dict] = None,
) -> list:
    """Generate categorical column by sampling from frequency distribution."""
    categories = stats.get('categories', {})

    # If this is a currency column and categories contains PKR or locale currency
    if 'currency' in col_lower and locale_cfg:
        loc_curr = locale_cfg.get('currency_code', 'USD')
        # If no categories defined, or categories include currencies, ensure loc_curr is present
        if not categories:
            categories = {loc_curr: 0.7, 'USD': 0.15, 'EUR': 0.1, 'GBP': 0.05}
        elif loc_curr not in categories:
            # Add loc_curr as prominent option
            categories = {loc_curr: 0.6, **{k: v * 0.4 for k, v in categories.items()}}

    if not categories:
        # Fallback: generate simple categories
        cats = [f'Category_{i}' for i in range(1, 6)]
        return list(rng.choice(cats, size=n))

    labels = list(categories.keys())
    probs = np.array(list(categories.values()), dtype=float)

    # Normalize probabilities
    total = probs.sum()
    if total > 0:
        probs = probs / total
    else:
        probs = np.ones(len(labels)) / len(labels)

    return list(rng.choice(labels, size=n, p=probs))


def _gen_datetime(stats: dict, n: int, rng: np.random.Generator, fake: Faker) -> list:
    """Generate datetime column within a range."""
    try:
        start = pd.Timestamp(stats.get('min', '2020-01-01'))
        end = pd.Timestamp(stats.get('max', '2024-12-31'))
    except Exception:
        start = pd.Timestamp('2020-01-01')
        end = pd.Timestamp('2024-12-31')

    if start >= end:
        end = start + pd.Timedelta(days=365)

    start_ts = start.value // 10**9  # Convert to seconds
    end_ts = end.value // 10**9
    random_ts = rng.integers(start_ts, end_ts, size=n)
    return [pd.Timestamp(ts, unit='s').strftime('%Y-%m-%d %H:%M:%S') for ts in random_ts]


def _inject_nulls(df: pd.DataFrame, null_rate: float, rng: np.random.Generator, schema: list) -> pd.DataFrame:
    """Randomly inject nulls into the DataFrame."""
    df = df.copy()
    n = len(df)

    for col_def in schema:
        col = col_def['name']
        if col not in df.columns:
            continue
        # Don't null out ID columns
        if col_def.get('type') == 'id':
            continue

        mask = rng.random(n) < null_rate
        df.loc[mask, col] = None

    return df


def _inject_outliers(df: pd.DataFrame, outlier_rate: float, rng: np.random.Generator, schema: list) -> pd.DataFrame:
    """Inject outlier values into numeric columns."""
    df = df.copy()
    n = len(df)

    for col_def in schema:
        col = col_def['name']
        col_type = col_def.get('type', '')

        if col_type not in ('integer', 'float') or col not in df.columns:
            continue

        stats = col_def.get('stats', {})
        mean = stats.get('mean', 50)
        std = stats.get('std', 25)

        mask = rng.random(n) < outlier_rate
        n_outliers = mask.sum()

        if n_outliers > 0 and std > 0:
            # Generate values 3-5 standard deviations from mean
            direction = rng.choice([-1, 1], size=n_outliers)
            magnitude = rng.uniform(3, 5, size=n_outliers)
            outlier_vals = mean + direction * magnitude * std

            if col_type == 'integer':
                outlier_vals = [int(round(v)) for v in outlier_vals]
            else:
                outlier_vals = [round(float(v), 2) for v in outlier_vals]

            df.loc[mask, col] = outlier_vals

    return df
