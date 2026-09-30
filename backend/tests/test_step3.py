
"""
Tests for Step 3: Copula/independent method wiring into tabular routes.
Tests the _generate_with_method helper and the API endpoint integration.
"""

import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import numpy as np
import pandas as pd
import pytest

from session_store import DatasetSessionStore, dataset_store
from profiler import profile_dataframe


class TestGenerateWithMethod:
    """Test the _generate_with_method helper function."""

    def _setup_dataset(self, store=None):
        """Create a correlated dataset and store it."""
        if store is None:
            store = dataset_store
        rng = np.random.default_rng(42)
        n = 500
        x = rng.normal(50, 10, size=n)
        y = 0.7 * x + rng.normal(0, 5, size=n)
        df = pd.DataFrame({"x": x, "y": y})
        schema = profile_dataframe(df)
        did = store.store(df, schema, "test.csv")
        return did, schema

    def test_auto_method_with_dataset_id_uses_copula(self):
        """When dataset_id is provided and method is auto, should use copula."""
        from main import _generate_with_method
        did, schema = self._setup_dataset()

        df, method_used, warnings = _generate_with_method(
            schema=schema, row_count=200, seed=42,
            locale="en_US", null_rate=0.0, outlier_rate=0.0,
            dataset_id=did, method="auto",
        )
        assert method_used == "copula"
        assert len(df) == 200

    def test_auto_method_without_dataset_id_uses_independent(self):
        """When no dataset_id and method is auto, should use independent."""
        from main import _generate_with_method
        schema = [
            {"name": "x", "type": "float", "stats": {"min": 0, "max": 100, "mean": 50, "std": 10}},
            {"name": "y", "type": "float", "stats": {"min": 0, "max": 100, "mean": 50, "std": 10}},
        ]
        df, method_used, warnings = _generate_with_method(
            schema=schema, row_count=100, seed=42,
            locale="en_US", null_rate=0.0, outlier_rate=0.0,
            dataset_id="", method="auto",
        )
        assert method_used == "independent"
        assert len(df) == 100

    def test_explicit_independent_method(self):
        """When method='independent' is explicitly set, use independent even with dataset_id."""
        from main import _generate_with_method
        did, schema = self._setup_dataset()

        df, method_used, warnings = _generate_with_method(
            schema=schema, row_count=200, seed=42,
            locale="en_US", null_rate=0.0, outlier_rate=0.0,
            dataset_id=did, method="independent",
        )
        assert method_used == "independent"

    def test_explicit_copula_method(self):
        """When method='copula' is set with a valid dataset_id, use copula."""
        from main import _generate_with_method
        did, schema = self._setup_dataset()

        df, method_used, warnings = _generate_with_method(
            schema=schema, row_count=300, seed=99,
            locale="en_US", null_rate=0.0, outlier_rate=0.0,
            dataset_id=did, method="copula",
        )
        assert method_used == "copula"
        assert len(df) == 300

    def test_copula_preserves_correlation(self):
        """Copula-generated data should preserve the original correlation."""
        from main import _generate_with_method
        did, schema = self._setup_dataset()

        df, method_used, warnings = _generate_with_method(
            schema=schema, row_count=2000, seed=42,
            locale="en_US", null_rate=0.0, outlier_rate=0.0,
            dataset_id=did, method="copula",
        )
        assert method_used == "copula"
        corr = df["x"].astype(float).corr(df["y"].astype(float))
        assert corr > 0.4, f"Copula correlation too low: {corr}"

    def test_independent_loses_correlation(self):
        """Independent-generated data should NOT preserve the original correlation."""
        from main import _generate_with_method
        did, schema = self._setup_dataset()

        df, method_used, warnings = _generate_with_method(
            schema=schema, row_count=2000, seed=42,
            locale="en_US", null_rate=0.0, outlier_rate=0.0,
            dataset_id=did, method="independent",
        )
        assert method_used == "independent"
        corr = df["x"].astype(float).corr(df["y"].astype(float))
        assert abs(corr) < 0.15, f"Independent should lose correlation, got: {corr}"

    def test_expired_dataset_falls_back(self):
        """If dataset_id is invalid, should fall back to independent with a warning."""
        from main import _generate_with_method
        schema = [
            {"name": "x", "type": "float", "stats": {"min": 0, "max": 100, "mean": 50, "std": 10}},
        ]
        df, method_used, warnings = _generate_with_method(
            schema=schema, row_count=50, seed=42,
            locale="en_US", null_rate=0.0, outlier_rate=0.0,
            dataset_id="nonexistent_id", method="copula",
        )
        assert method_used == "independent"
        assert any("expired" in w.lower() or "not found" in w.lower() for w in warnings)

    def test_manual_schema_without_dataset_works(self):
        """Manual schemas without dataset_id should still work (backward compat)."""
        from main import _generate_with_method
        schema = [
            {"name": "id", "type": "id"},
            {"name": "value", "type": "integer", "stats": {"min": 1, "max": 100, "mean": 50, "std": 20}},
            {"name": "category", "type": "categorical", "stats": {"categories": {"A": 0.5, "B": 0.3, "C": 0.2}}},
        ]
        df, method_used, warnings = _generate_with_method(
            schema=schema, row_count=100, seed=42,
            locale="en_US", null_rate=0.0, outlier_rate=0.0,
        )
        assert method_used == "independent"
        assert len(df) == 100
        assert set(df.columns) == {"id", "value", "category"}

    def test_sample_dataset_copula_round_trip(self):
        """Load a sample dataset, generate with copula, verify it works end-to-end."""
        from main import _generate_with_method

        sample_dir = Path(__file__).resolve().parent.parent / "sample_data"
        df_real = pd.read_csv(sample_dir / "hr_employees.csv")
        schema = profile_dataframe(df_real)
        did = dataset_store.store(df_real, schema, "hr_employees.csv")

        df_synth, method_used, warnings = _generate_with_method(
            schema=schema, row_count=500, seed=42,
            locale="en_US", null_rate=0.0, outlier_rate=0.0,
            dataset_id=did, method="copula",
        )
        assert method_used == "copula"
        assert len(df_synth) == 500
        # Should have the modelled columns
        assert "salary" in df_synth.columns or "age" in df_synth.columns


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
