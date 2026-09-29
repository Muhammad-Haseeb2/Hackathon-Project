"""
Dataset session store — in-memory storage for uploaded DataFrames.
Max 5 datasets, 30-minute expiry, evict oldest first. Never writes to disk.
Caps stored data at 50,000 rows (random sample with fixed seed) and 60 columns.
"""

import time
import uuid
from typing import Optional

import pandas as pd
import numpy as np

MAX_DATASETS = 5
EXPIRY_SECONDS = 30 * 60  # 30 minutes
MAX_ROWS = 50_000
MAX_COLS = 60
SAMPLE_SEED = 0  # Fixed seed for reproducible row sampling


class DatasetEntry:
    """A single stored dataset with metadata."""
    __slots__ = ("dataset_id", "df", "schema", "filename", "created_at")

    def __init__(self, dataset_id: str, df: pd.DataFrame, schema: list[dict], filename: str):
        self.dataset_id = dataset_id
        self.df = df
        self.schema = schema
        self.filename = filename
        self.created_at = time.time()

    @property
    def is_expired(self) -> bool:
        return (time.time() - self.created_at) > EXPIRY_SECONDS


class DatasetSessionStore:
    """
    In-memory store for uploaded datasets.
    Thread-safe enough for a single-process ASGI server (GIL protects dict ops).
    """

    def __init__(self):
        self._store: dict[str, DatasetEntry] = {}

    # ── public API ──────────────────────────────────────────────────────

    def store(self, df: pd.DataFrame, schema: list[dict], filename: str = "upload") -> str:
        """
        Store a DataFrame and its profiled schema.
        Returns a dataset_id for later retrieval.
        """
        self._evict_expired()

        # Cap columns
        if len(df.columns) > MAX_COLS:
            df = df.iloc[:, :MAX_COLS]

        # Cap rows with deterministic sampling
        if len(df) > MAX_ROWS:
            df = df.sample(n=MAX_ROWS, random_state=SAMPLE_SEED).reset_index(drop=True)

        # Evict oldest if at capacity
        while len(self._store) >= MAX_DATASETS:
            oldest_id = min(self._store, key=lambda k: self._store[k].created_at)
            del self._store[oldest_id]

        dataset_id = uuid.uuid4().hex[:12]
        self._store[dataset_id] = DatasetEntry(
            dataset_id=dataset_id,
            df=df.copy(),
            schema=schema,
            filename=filename,
        )
        return dataset_id

    def get(self, dataset_id: str) -> Optional[DatasetEntry]:
        """Retrieve a dataset by ID. Returns None if not found or expired."""
        self._evict_expired()
        entry = self._store.get(dataset_id)
        if entry is None:
            return None
        if entry.is_expired:
            del self._store[dataset_id]
            return None
        return entry

    def list_datasets(self) -> list[dict]:
        """List all active (non-expired) datasets."""
        self._evict_expired()
        result = []
        for entry in self._store.values():
            result.append({
                "dataset_id": entry.dataset_id,
                "filename": entry.filename,
                "rows": len(entry.df),
                "columns": len(entry.df.columns),
                "created_at": entry.created_at,
                "age_seconds": round(time.time() - entry.created_at, 1),
            })
        return result

    def remove(self, dataset_id: str) -> bool:
        """Remove a dataset by ID."""
        if dataset_id in self._store:
            del self._store[dataset_id]
            return True
        return False

    @property
    def count(self) -> int:
        self._evict_expired()
        return len(self._store)

    # ── internal ────────────────────────────────────────────────────────

    def _evict_expired(self):
        expired = [k for k, v in self._store.items() if v.is_expired]
        for k in expired:
            del self._store[k]


# ── Module-level singleton ──────────────────────────────────────────────────
dataset_store = DatasetSessionStore()
