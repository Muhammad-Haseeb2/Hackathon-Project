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

    if 'merchant' in prompt_lower:
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
    elif 'schema' in prompt_lower or 'column' in prompt_lower:
        # Default schema fallback
        return {
            'columns': [
                {'name': 'id', 'type': 'id'},
                {'name': 'name', 'type': 'name'},
                {'name': 'email', 'type': 'email'},
                {'name': 'value', 'type': 'float', 'stats': {'min': 0, 'max': 100, 'mean': 50, 'std': 25}},
                {'name': 'category', 'type': 'categorical', 'stats': {'categories': {'A': 0.4, 'B': 0.35, 'C': 0.25}}},
                {'name': 'created_at', 'type': 'datetime', 'stats': {'min': '2023-01-01', 'max': '2024-12-31'}},
            ]
        }
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


# ── Schema inference ─────────────────────────────────────────────────────────

def infer_schema(description: str) -> dict:
    """
    Use the LLM to infer a table schema from a natural language description.
    Falls back to a generic schema if LLM fails.
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
