"""
Privacy module — masking, pseudonymization, differential privacy (Laplace noise).
All transformations are computed in Python. No LLM calls.
"""

import hashlib
import re
import numpy as np
import pandas as pd
from typing import Optional


# ── Masking ──────────────────────────────────────────────────────────────────

def mask_email(value: str) -> str:
    """Mask email preserving pattern: j****n@example.com"""
    if not isinstance(value, str) or '@' not in value:
        return value
    local, domain = value.rsplit('@', 1)
    if len(local) <= 2:
        masked = local[0] + '*' * max(1, len(local) - 1)
    else:
        masked = local[0] + '*' * (len(local) - 2) + local[-1]
    return f"{masked}@{domain}"


def mask_phone(value: str) -> str:
    """Mask phone preserving last 4 digits: ****-****-1234"""
    if not isinstance(value, str):
        return value
    digits = re.sub(r'\D', '', value)
    if len(digits) < 4:
        return '*' * len(value)
    last4 = digits[-4:]
    return '*' * (len(digits) - 4) + '-' + last4


def mask_credit_card(value: str) -> str:
    """Mask credit card: ****-****-****-1234"""
    if not isinstance(value, str):
        return value
    digits = re.sub(r'\D', '', value)
    if len(digits) < 4:
        return '*' * len(value)
    last4 = digits[-4:]
    return '****-****-****-' + last4


def mask_name(value: str) -> str:
    """Mask name preserving first letter: J**** D**"""
    if not isinstance(value, str):
        return value
    parts = value.split()
    masked_parts = []
    for part in parts:
        if len(part) <= 1:
            masked_parts.append(part)
        else:
            masked_parts.append(part[0] + '*' * (len(part) - 1))
    return ' '.join(masked_parts)


def mask_generic(value: str) -> str:
    """Generic masking: show first and last char, mask middle."""
    if not isinstance(value, str) or len(value) <= 2:
        return value
    return value[0] + '*' * (len(value) - 2) + value[-1]


MASK_FUNCTIONS = {
    'email': mask_email,
    'phone': mask_phone,
    'credit_card': mask_credit_card,
    'name': mask_name,
    'text': mask_generic,
    'address': mask_generic,
}


def apply_masking(series: pd.Series, col_type: str) -> pd.Series:
    """Apply masking to a column based on its type."""
    mask_fn = MASK_FUNCTIONS.get(col_type, mask_generic)
    return series.apply(lambda x: mask_fn(str(x)) if pd.notna(x) else x)


# ── Pseudonymization ────────────────────────────────────────────────────────

def pseudonymize(value: str, salt: str = "synth_platform_salt_2024") -> str:
    """Deterministic salted SHA-256 hashing for pseudonymization."""
    if not isinstance(value, str) or not value:
        return value
    salted = f"{salt}:{value}"
    return hashlib.sha256(salted.encode('utf-8')).hexdigest()[:16]


def apply_pseudonymization(series: pd.Series, salt: str = "synth_platform_salt_2024") -> pd.Series:
    """Apply pseudonymization to a column."""
    return series.apply(lambda x: pseudonymize(str(x), salt) if pd.notna(x) else x)


# ── Differential Privacy (Laplace Noise) ─────────────────────────────────────

def add_laplace_noise(
    series: pd.Series,
    epsilon: float = 1.0,
    sensitivity: Optional[float] = None,
    seed: Optional[int] = None,
) -> pd.Series:
    """
    Add Laplace noise to numeric column for differential privacy.
    
    x' = x + Laplace(0, b) where b = sensitivity / epsilon
    
    Args:
        series: Numeric pandas Series.
        epsilon: Privacy budget (smaller = more private, more noise).
        sensitivity: Column sensitivity (max - min). Auto-detected if None.
        seed: Random seed for reproducibility.
    """
    numeric = pd.to_numeric(series, errors='coerce')
    non_null_mask = numeric.notna()

    if non_null_mask.sum() == 0:
        return series

    if sensitivity is None:
        vals = numeric[non_null_mask]
        sensitivity = float(vals.max() - vals.min())
        if sensitivity == 0:
            sensitivity = 1.0

    epsilon = max(epsilon, 0.01)  # Prevent division by zero
    scale = sensitivity / epsilon

    rng = np.random.default_rng(seed)
    noise = rng.laplace(0, scale, size=len(numeric))

    result = numeric.copy()
    result[non_null_mask] = numeric[non_null_mask] + noise[non_null_mask]

    return result


# ── Apply privacy rules to DataFrame ─────────────────────────────────────────

def apply_privacy(
    df: pd.DataFrame,
    privacy_rules: list[dict],
    seed: Optional[int] = None,
) -> pd.DataFrame:
    """
    Apply privacy transformations to a DataFrame.
    
    Args:
        df: Input DataFrame.
        privacy_rules: List of dicts with keys:
            - column: column name
            - method: 'mask' | 'pseudonymize' | 'noise'
            - col_type: (for masking) email, phone, name, etc.
            - epsilon: (for noise) privacy budget
            - sensitivity: (for noise) optional sensitivity override
        seed: Random seed.
    
    Returns:
        Transformed DataFrame (copy).
    """
    df = df.copy()

    for rule in privacy_rules:
        col = rule.get('column', '')
        method = rule.get('method', 'mask')

        if col not in df.columns:
            continue

        if method == 'mask':
            col_type = rule.get('col_type', 'text')
            df[col] = apply_masking(df[col], col_type)

        elif method == 'pseudonymize':
            salt = rule.get('salt', 'synth_platform_salt_2024')
            df[col] = apply_pseudonymization(df[col], salt)

        elif method == 'noise':
            epsilon = rule.get('epsilon', 1.0)
            sensitivity = rule.get('sensitivity')
            df[col] = add_laplace_noise(df[col], epsilon, sensitivity, seed)

    return df
