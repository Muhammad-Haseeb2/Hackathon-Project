"""
Schema profiler — detect column types, stats, and distributions from CSV/Excel.
Supports: int, float, categorical, datetime, text, email, name, phone, address, uuid.
"""

import re
import io
import pandas as pd
import numpy as np
from typing import Optional


# ── Regex patterns for type detection ──
EMAIL_RE = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
PHONE_RE = re.compile(r'^[\+]?[\d\s\-\(\)\.]{7,20}$')

# Column name hints for identity columns
NAME_HINTS = {'name', 'first_name', 'last_name', 'full_name', 'firstname', 'lastname',
              'fullname', 'customer_name', 'employee_name', 'user_name', 'username',
              'first', 'last', 'given_name', 'surname'}
EMAIL_HINTS = {'email', 'e_mail', 'email_address', 'mail', 'user_email'}
PHONE_HINTS = {'phone', 'telephone', 'tel', 'mobile', 'cell', 'phone_number',
               'contact_number', 'fax'}
ADDRESS_HINTS = {'address', 'street', 'street_address', 'city', 'state', 'zip',
                 'zipcode', 'zip_code', 'postal_code', 'country'}
ID_HINTS = {'id', 'uuid', 'guid', 'identifier', 'record_id', 'transaction_id'}

# Max unique ratio to consider a column categorical
CATEGORICAL_THRESHOLD = 0.05  # If unique/total < 5%, treat as categorical
CATEGORICAL_MAX_UNIQUE = 50   # Or if unique count <= 50


import json

def read_uploaded_file(file_bytes: bytes, filename: str) -> pd.DataFrame:
    """Read CSV, JSON, Excel (.xlsx, .xls), or TSV file bytes into a DataFrame."""
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    
    if ext in ('xlsx', 'xls'):
        try:
            return pd.read_excel(io.BytesIO(file_bytes), engine='openpyxl')
        except Exception:
            return pd.read_excel(io.BytesIO(file_bytes))
            
    elif ext == 'json':
        try:
            # Try reading as JSON table / records
            return pd.read_json(io.BytesIO(file_bytes))
        except Exception:
            # Parse raw JSON and normalize records or list
            raw_text = file_bytes.decode('utf-8', errors='replace')
            data = json.loads(raw_text)
            if isinstance(data, list):
                return pd.json_normalize(data)
            elif isinstance(data, dict):
                for key in ('data', 'records', 'items', 'rows', 'results'):
                    if key in data and isinstance(data[key], list):
                        return pd.json_normalize(data[key])
                return pd.DataFrame([data])
            else:
                raise ValueError("JSON file does not contain a list or table of records.")
                
    elif ext in ('tsv', 'tab'):
        for encoding in ['utf-8', 'latin-1', 'cp1252']:
            try:
                return pd.read_csv(io.BytesIO(file_bytes), sep='\t', encoding=encoding)
            except Exception:
                continue
                
    # Default: Try CSV with multiple encodings and auto-delimiter
    for encoding in ['utf-8', 'latin-1', 'cp1252']:
        try:
            return pd.read_csv(io.BytesIO(file_bytes), encoding=encoding)
        except (UnicodeDecodeError, Exception):
            continue
            
    # Try comma / semicolon / tab separated fallback
    for sep in [',', ';', '\t', '|']:
        try:
            return pd.read_csv(io.BytesIO(file_bytes), sep=sep, encoding='latin-1')
        except Exception:
            continue
            
    raise ValueError("Could not read file. Ensure it's a valid CSV, JSON, or Excel file.")


def _detect_column_type(series: pd.Series, col_name: str) -> str:
    """Detect the semantic type of a column."""
    col_lower = col_name.lower().strip().replace(' ', '_')
    non_null = series.dropna()

    if len(non_null) == 0:
        return 'text'

    # Sample for efficiency (max 500 values)
    sample = non_null.head(500).astype(str)

    # ── Check column name hints first ──
    if col_lower in EMAIL_HINTS:
        return 'email'
    if col_lower in NAME_HINTS:
        return 'name'
    if col_lower in PHONE_HINTS:
        return 'phone'
    if col_lower in ADDRESS_HINTS:
        return 'address'
    if col_lower in ID_HINTS:
        # Check if values look like UUIDs
        uuid_match = sample.apply(lambda x: bool(UUID_RE.match(str(x)))).mean()
        if uuid_match > 0.8:
            return 'uuid'
        return 'id'

    # ── Check value patterns ──
    # UUID
    uuid_match = sample.apply(lambda x: bool(UUID_RE.match(str(x)))).mean()
    if uuid_match > 0.8:
        return 'uuid'

    # Email
    email_match = sample.apply(lambda x: bool(EMAIL_RE.match(str(x)))).mean()
    if email_match > 0.8:
        return 'email'

    # Phone
    if col_lower not in {'year', 'month', 'day', 'age', 'count', 'amount', 'price',
                         'quantity', 'qty', 'total', 'score', 'rating', 'weight', 'height'}:
        phone_match = sample.apply(lambda x: bool(PHONE_RE.match(str(x)))).mean()
        if phone_match > 0.8 and series.dtype == object:
            return 'phone'

    # ── Numeric types ──
    if pd.api.types.is_integer_dtype(series):
        n_unique = non_null.nunique()
        if n_unique <= CATEGORICAL_MAX_UNIQUE or (len(non_null) > 0 and n_unique / len(non_null) < CATEGORICAL_THRESHOLD):
            return 'categorical'
        return 'integer'

    if pd.api.types.is_float_dtype(series):
        # Check if it's actually integer-like (all .0)
        return 'float'

    # ── Datetime ──
    if pd.api.types.is_datetime64_any_dtype(series):
        return 'datetime'

    # Try parsing as datetime
    if series.dtype == object:
        try:
            parsed = pd.to_datetime(non_null.head(100), format='mixed', errors='coerce')
            if parsed.notna().mean() > 0.8:
                return 'datetime'
        except (ValueError, TypeError):
            pass

    # ── Categorical vs text ──
    if series.dtype == object:
        n_unique = non_null.nunique()
        total = len(non_null)
        if n_unique <= CATEGORICAL_MAX_UNIQUE or (total > 20 and n_unique / total < CATEGORICAL_THRESHOLD):
            return 'categorical'

        # Check average string length — short strings are more likely names
        avg_len = sample.str.len().mean()
        if avg_len < 25 and col_lower not in ADDRESS_HINTS:
            # Could be name-like
            words_per_val = sample.str.split().str.len().mean()
            if 1.5 <= words_per_val <= 3.5:
                return 'name'

        return 'text'

    return 'text'


def _compute_column_stats(series: pd.Series, col_type: str) -> dict:
    """Compute statistics for a column based on its detected type."""
    non_null = series.dropna()
    total = len(series)
    null_count = series.isna().sum()

    stats = {
        'null_count': int(null_count),
        'null_rate': round(null_count / total, 4) if total > 0 else 0,
        'total_count': total,
        'unique_count': int(non_null.nunique()),
    }

    if col_type in ('integer', 'float'):
        numeric = pd.to_numeric(non_null, errors='coerce').dropna()
        if len(numeric) > 0:
            stats.update({
                'min': float(numeric.min()),
                'max': float(numeric.max()),
                'mean': round(float(numeric.mean()), 4),
                'std': round(float(numeric.std()), 4) if len(numeric) > 1 else 0.0,
            })

    elif col_type == 'categorical':
        freq = non_null.value_counts(normalize=True).head(50)
        stats['categories'] = {str(k): round(float(v), 4) for k, v in freq.items()}

    elif col_type == 'datetime':
        try:
            dt = pd.to_datetime(non_null, format='mixed', errors='coerce').dropna()
            if len(dt) > 0:
                stats['min'] = str(dt.min().isoformat())
                stats['max'] = str(dt.max().isoformat())
        except Exception:
            pass

    elif col_type == 'text':
        str_vals = non_null.astype(str)
        stats['avg_length'] = round(float(str_vals.str.len().mean()), 1)
        stats['min_length'] = int(str_vals.str.len().min())
        stats['max_length'] = int(str_vals.str.len().max())

    return stats


def profile_dataframe(df: pd.DataFrame) -> list[dict]:
    """
    Profile a DataFrame and return a list of column schemas.

    Returns:
        List of dicts, each with: name, type, stats, editable metadata.
    """
    schema = []
    for col in df.columns:
        col_type = _detect_column_type(df[col], col)
        stats = _compute_column_stats(df[col], col_type)

        schema.append({
            'name': col,
            'type': col_type,
            'stats': stats,
        })

    return schema
