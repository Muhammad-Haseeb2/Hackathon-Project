"""
LLM wrapper — call_llm(), in-memory cache, retry, pydantic validation, fallback.
Provider: Google Gemini API (free tier). Swappable by changing this file.
Never calls the LLM per row. Asks once for a pool, caches it.
"""

import os
import json
import hashlib
import time
from typing import Optional, Any

import httpx
from pydantic import BaseModel, ValidationError

from fallbacks import (
    MERCHANT_NAMES, COMPANY_NAMES, PRODUCT_NAMES,
    TRANSACTION_DESCRIPTIONS, DEPARTMENTS, JOB_TITLES, CATEGORIES,
)


# ── In-memory cache ─────────────────────────────────────────────────────────

_llm_cache: dict[str, Any] = {}


def _cache_key(prompt: str) -> str:
    """Generate a cache key from the prompt."""
    return hashlib.md5(prompt.encode()).hexdigest()


# ── Gemini API call ──────────────────────────────────────────────────────────

def _call_gemini(prompt: str, timeout: float = 10.0) -> str:
    """Call Google Gemini API (free tier from AI Studio)."""
    api_key = os.environ.get('GEMINI_API_KEY', '')
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"

    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        }
    }

    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, json=payload)
        resp.raise_for_status()

    data = resp.json()

    # Extract text from Gemini response
    try:
        text = data['candidates'][0]['content']['parts'][0]['text']
        return text.strip()
    except (KeyError, IndexError):
        raise ValueError(f"Unexpected Gemini response structure: {json.dumps(data)[:200]}")


# ── Core call_llm function ───────────────────────────────────────────────────

def call_llm(
    prompt: str,
    schema: Optional[type[BaseModel]] = None,
    use_cache: bool = True,
    max_retries: int = 1,
    timeout: float = 10.0,
) -> dict:
    """
    Call the LLM with caching, retry, pydantic validation, and fallback.
    
    Args:
        prompt: The prompt to send.
        schema: Optional pydantic model for validation.
        use_cache: Whether to use in-memory cache.
        max_retries: Max retry attempts on invalid JSON.
        timeout: Request timeout in seconds.
    
    Returns:
        Dict with keys:
            - 'data': The parsed response data
            - 'source': 'ai' or 'fallback'
            - 'cached': bool
    """
    key = _cache_key(prompt)

    # Check cache first
    if use_cache and key in _llm_cache:
        return {
            'data': _llm_cache[key],
            'source': 'ai',
            'cached': True,
        }

    # Try calling the LLM
    for attempt in range(max_retries + 1):
        try:
            raw_text = _call_gemini(prompt, timeout)

            # Parse JSON
            parsed = json.loads(raw_text)

            # Validate with pydantic if schema provided
            if schema is not None:
                validated = schema.model_validate(parsed)
                parsed = validated.model_dump()

            # Cache the result
            if use_cache:
                _llm_cache[key] = parsed

            return {
                'data': parsed,
                'source': 'ai',
                'cached': False,
            }

        except (json.JSONDecodeError, ValidationError) as e:
            if attempt < max_retries:
                continue  # Retry once
            # Fall through to fallback
            break
        except Exception:
            # Network error, timeout, API error — fall through to fallback
            break

    # ── Fallback ──
    fallback_data = _get_fallback(prompt)
    return {
        'data': fallback_data,
        'source': 'fallback',
        'cached': False,
    }


# ── Fallback logic ───────────────────────────────────────────────────────────

def _get_fallback(prompt: str) -> Any:
    """Return fallback data based on prompt keywords."""
    prompt_lower = prompt.lower()

    # Check for schema inference FIRST to prevent keyword collisions (e.g. 'categor' in prompt)
    if 'schema' in prompt_lower or 'columns' in prompt_lower:
        desc = prompt
        if 'Description: "' in prompt:
            try:
                desc = prompt.split('Description: "')[1].split('"\n')[0]
            except Exception:
                desc = prompt
        elif 'description: "' in prompt_lower:
            try:
                idx = prompt_lower.index('description: "') + len('description: "')
                desc = prompt[idx:].split('"')[0]
            except Exception:
                desc = prompt
        return _infer_schema_offline(desc)
    elif 'merchant' in prompt_lower:
        return {'items': MERCHANT_NAMES}
    elif 'company' in prompt_lower or 'business' in prompt_lower:
        return {'items': COMPANY_NAMES}
    elif 'product' in prompt_lower:
        return {'items': PRODUCT_NAMES}
    elif 'transaction' in prompt_lower:
        return {'items': TRANSACTION_DESCRIPTIONS}
    elif 'department' in prompt_lower:
        return {'items': DEPARTMENTS}
    elif 'job' in prompt_lower or 'title' in prompt_lower:
        return {'items': JOB_TITLES}
    elif 'categor' in prompt_lower:
        return {'items': CATEGORIES}
    elif 'edge' in prompt_lower or 'outlier' in prompt_lower or 'boundary' in prompt_lower:
        return {
            'suggestions': [
                {'type': 'null_injection', 'description': 'Add 5% null values to test missing data handling'},
                {'type': 'extreme_value', 'description': 'Add values at min/max boundaries'},
                {'type': 'empty_string', 'description': 'Include empty strings in text columns'},
                {'type': 'special_chars', 'description': 'Add special characters (é, ñ, ü) in text fields'},
                {'type': 'duplicate', 'description': 'Include duplicate rows to test dedup logic'},
            ]
        }
    else:
        return {'items': ['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5']}


def _infer_schema_offline(text: str) -> dict:
    """
    Intelligent offline schema inference based on description keywords.
    Produces high-fidelity, typed schemas without requiring an external LLM.
    """
    text_lower = text.lower()

    if any(k in text_lower for k in ['sensor', 'iot', 'temperature', 'device', 'reading']):
        return {
            'columns': [
                {'name': 'device_id', 'type': 'id'},
                {'name': 'warehouse_location', 'type': 'address'},
                {'name': 'temp_celsius', 'type': 'float', 'stats': {'min': -15, 'max': 95, 'mean': 22, 'std': 12}},
                {'name': 'humidity_pct', 'type': 'float', 'stats': {'min': 20, 'max': 99, 'mean': 55, 'std': 18}},
                {'name': 'warning_alert', 'type': 'categorical', 'stats': {'categories': {'normal': 0.82, 'warning': 0.12, 'critical': 0.06}}},
                {'name': 'recorded_at', 'type': 'datetime', 'stats': {'min': '2024-01-01', 'max': '2024-12-31'}},
            ]
        }
    elif any(k in text_lower for k in ['patient', 'hospital', 'health', 'medical', 'clinical', 'doctor']):
        return {
            'columns': [
                {'name': 'patient_id', 'type': 'id'},
                {'name': 'patient_name', 'type': 'name'},
                {'name': 'age', 'type': 'integer', 'stats': {'min': 18, 'max': 95, 'mean': 48, 'std': 16}},
                {'name': 'blood_pressure', 'type': 'float', 'stats': {'min': 80, 'max': 190, 'mean': 122, 'std': 16}},
                {'name': 'heart_rate', 'type': 'integer', 'stats': {'min': 50, 'max': 140, 'mean': 74, 'std': 12}},
                {'name': 'diagnosis', 'type': 'categorical', 'stats': {'categories': {'Hypertension': 0.3, 'Diabetes': 0.25, 'Asthma': 0.15, 'None': 0.3}}},
                {'name': 'visit_date', 'type': 'datetime', 'stats': {'min': '2023-01-01', 'max': '2024-12-31'}},
            ]
        }
    elif any(k in text_lower for k in ['transaction', 'payment', 'fintech', 'bank', 'fraud', 'crypto']):
        return {
            'columns': [
                {'name': 'transaction_id', 'type': 'uuid'},
                {'name': 'account_holder', 'type': 'name'},
                {'name': 'email', 'type': 'email'},
                {'name': 'amount', 'type': 'float', 'stats': {'min': 5, 'max': 50000, 'mean': 320, 'std': 950}},
                {'name': 'currency', 'type': 'categorical', 'stats': {'categories': {'USD': 0.5, 'EUR': 0.25, 'GBP': 0.15, 'PKR': 0.1}}},
                {'name': 'type', 'type': 'categorical', 'stats': {'categories': {'debit': 0.65, 'credit': 0.25, 'transfer': 0.1}}},
                {'name': 'status', 'type': 'categorical', 'stats': {'categories': {'completed': 0.88, 'pending': 0.08, 'failed': 0.04}}},
                {'name': 'timestamp', 'type': 'datetime', 'stats': {'min': '2024-01-01', 'max': '2024-12-31'}},
            ]
        }
    elif any(k in text_lower for k in ['employee', 'hr', 'staff', 'worker', 'payroll', 'salary']):
        return {
            'columns': [
                {'name': 'employee_id', 'type': 'id'},
                {'name': 'full_name', 'type': 'name'},
                {'name': 'email', 'type': 'email'},
                {'name': 'department', 'type': 'categorical', 'stats': {'categories': {'Engineering': 0.35, 'Sales': 0.25, 'Marketing': 0.2, 'HR': 0.1, 'Finance': 0.1}}},
                {'name': 'salary', 'type': 'float', 'stats': {'min': 35000, 'max': 210000, 'mean': 88000, 'std': 28000}},
                {'name': 'performance_score', 'type': 'float', 'stats': {'min': 1, 'max': 5, 'mean': 3.9, 'std': 0.7}},
                {'name': 'hire_date', 'type': 'datetime', 'stats': {'min': '2020-01-01', 'max': '2024-12-31'}},
            ]
        }
    elif any(k in text_lower for k in ['student', 'school', 'university', 'college', 'course', 'grade']):
        return {
            'columns': [
                {'name': 'student_id', 'type': 'id'},
                {'name': 'student_name', 'type': 'name'},
                {'name': 'email', 'type': 'email'},
                {'name': 'major', 'type': 'categorical', 'stats': {'categories': {'Computer Science': 0.35, 'Business': 0.25, 'Biology': 0.2, 'Economics': 0.2}}},
                {'name': 'gpa', 'type': 'float', 'stats': {'min': 2.0, 'max': 4.0, 'mean': 3.25, 'std': 0.45}},
                {'name': 'enrollment_year', 'type': 'integer', 'stats': {'min': 2021, 'max': 2025, 'mean': 2023, 'std': 1}},
            ]
        }
    elif any(k in text_lower for k in ['customer', 'e-commerce', 'ecommerce', 'order', 'shop', 'retail', 'sales']):
        return {
            'columns': [
                {'name': 'customer_id', 'type': 'id'},
                {'name': 'full_name', 'type': 'name'},
                {'name': 'email', 'type': 'email'},
                {'name': 'phone', 'type': 'phone'},
                {'name': 'city', 'type': 'address'},
                {'name': 'total_orders', 'type': 'integer', 'stats': {'min': 1, 'max': 250, 'mean': 18, 'std': 22}},
                {'name': 'total_spent', 'type': 'float', 'stats': {'min': 15, 'max': 12000, 'mean': 520, 'std': 850}},
                {'name': 'currency', 'type': 'categorical', 'stats': {'categories': {'USD': 0.5, 'EUR': 0.25, 'GBP': 0.15, 'PKR': 0.1}}},
                {'name': 'signup_date', 'type': 'datetime', 'stats': {'min': '2021-01-01', 'max': '2024-12-31'}},
            ]
        }
    else:
        # Generic intelligent schema
        return {
            'columns': [
                {'name': 'record_id', 'type': 'id'},
                {'name': 'name', 'type': 'name'},
                {'name': 'email', 'type': 'email'},
                {'name': 'category', 'type': 'categorical', 'stats': {'categories': {'Type A': 0.45, 'Type B': 0.35, 'Type C': 0.20}}},
                {'name': 'value', 'type': 'float', 'stats': {'min': 10, 'max': 1000, 'mean': 250, 'std': 120}},
                {'name': 'status', 'type': 'categorical', 'stats': {'categories': {'active': 0.8, 'inactive': 0.15, 'pending': 0.05}}},
                {'name': 'created_at', 'type': 'datetime', 'stats': {'min': '2023-01-01', 'max': '2024-12-31'}},
            ]
        }


# ── Schema inference ─────────────────────────────────────────────────────────

def infer_schema(description: str) -> dict:
    """
    Use the LLM to infer a table schema from a natural language description.
    Falls back to intelligent deterministic schema if LLM fails or API key is absent.
    """
    prompt = f"""Based on this description, generate a JSON schema for a synthetic data table.
Description: "{description}"

Return a JSON object with a "columns" array. Each column should have:
- "name": column name (snake_case)
- "type": one of "id", "name", "email", "phone", "address", "integer", "float", "categorical", "datetime", "text", "uuid"
- "stats": optional object with "min", "max", "mean", "std" for numeric, or "categories" dict for categorical, or "min"/"max" date strings for datetime

Example response:
{{"columns": [{{"name": "sensor_id", "type": "id"}}, {{"name": "temperature", "type": "float", "stats": {{"min": -20, "max": 120, "mean": 25, "std": 15}}}}, {{"name": "status", "type": "categorical", "stats": {{"categories": {{"normal": 0.8, "warning": 0.15, "critical": 0.05}}}}}}]}}
"""

    result = call_llm(prompt)

    # Validate output structure
    data = result.get('data', {})
    if not isinstance(data, dict) or 'columns' not in data or not data['columns']:
        # Fall back to offline inference with user's description
        offline_schema = _infer_schema_offline(description)
        return {
            'data': offline_schema,
            'source': 'fallback',
            'cached': False,
        }

    return result


# ── Content pool generation ──────────────────────────────────────────────────

def get_content_pool(pool_type: str, count: int = 100) -> dict:
    """
    Get a pool of realistic content items.
    Asks the LLM once, caches, and returns for sampling.
    """
    prompt = f"""Generate a JSON object with an "items" array containing {count} realistic {pool_type} names/values.
Make them diverse and realistic. Return only the JSON.
Example: {{"items": ["Item 1", "Item 2", ...]}}"""

    return call_llm(prompt)


# ── Edge case suggestions ────────────────────────────────────────────────────

def suggest_edge_cases(schema: list[dict]) -> dict:
    """
    Ask the LLM to suggest edge cases and boundary conditions for the given schema.
    """
    col_summary = ', '.join([f"{c['name']} ({c['type']})" for c in schema[:10]])
    prompt = f"""Given this data schema with columns: {col_summary}

Suggest edge cases and boundary conditions for testing. Return a JSON object with a "suggestions" array.
Each suggestion should have:
- "type": one of "null_injection", "extreme_value", "empty_string", "special_chars", "duplicate", "format_variation"
- "column": which column it applies to (or "all")
- "description": brief description of the edge case
- "apply": boolean, default true

Return 5-8 suggestions."""

    return call_llm(prompt)


def get_cache_stats() -> dict:
    """Get LLM cache statistics."""
    return {
        'cached_prompts': len(_llm_cache),
        'cache_keys': list(_llm_cache.keys())[:10],
    }
