"""
Tests for Step 1: session_store, association module, and sample datasets.
"""

import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import numpy as np
import pandas as pd
import pytest

from session_store import DatasetSessionStore, dataset_store
from association import association_matrix, _spearman_abs, _cramers_v, _correlation_ratio
from profiler import profile_dataframe


class TestSessionStore:
    """Tests for the in-memory dataset session store."""

    def test_store_and_retrieve(self):
        store = DatasetSessionStore()
        df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
        schema = [{"name": "a", "type": "integer"}, {"name": "b", "type": "categorical"}]
        did = store.store(df, schema, "test.csv")
        entry = store.get(did)
        assert entry is not None
        assert len(entry.df) == 3
        assert entry.filename == "test.csv"

    def test_max_5_datasets_eviction(self):
        store = DatasetSessionStore()
        ids = []
        for i in range(6):
            df = pd.DataFrame({"x": [i]})
            did = store.store(df, [{"name": "x", "type": "integer"}], f"file_{i}.csv")
            ids.append(did)
        # First one should have been evicted
        assert store.get(ids[0]) is None
        # Last 5 should be present
        for did in ids[1:]:
            assert store.get(did) is not None
        assert store.count == 5

    def test_row_cap_50000(self):
        store = DatasetSessionStore()
        df = pd.DataFrame({"a": range(60000)})
        did = store.store(df, [{"name": "a", "type": "integer"}])
        entry = store.get(did)
        assert len(entry.df) == 50000

    def test_column_cap_60(self):
        store = DatasetSessionStore()
        df = pd.DataFrame({f"col_{i}": [1] for i in range(70)})
        schema = [{"name": f"col_{i}", "type": "integer"} for i in range(70)]
        did = store.store(df, schema)
        entry = store.get(did)
        assert len(entry.df.columns) == 60

    def test_list_datasets(self):
        store = DatasetSessionStore()
        df = pd.DataFrame({"a": [1, 2]})
        schema = [{"name": "a", "type": "integer"}]
        store.store(df, schema, "f1.csv")
        store.store(df, schema, "f2.csv")
        listing = store.list_datasets()
        assert len(listing) == 2
        assert all("dataset_id" in d for d in listing)

    def test_remove(self):
        store = DatasetSessionStore()
        df = pd.DataFrame({"a": [1]})
        did = store.store(df, [{"name": "a", "type": "integer"}])
        assert store.remove(did) is True
        assert store.get(did) is None


class TestAssociation:
    """Tests for the association matrix module."""

    def test_numeric_numeric_spearman(self):
        """Correlated numeric columns should have high association."""
        rng = np.random.default_rng(42)
        x = rng.normal(0, 1, size=1000)
        y = x * 2 + rng.normal(0, 0.3, size=1000)
        df = pd.DataFrame({"x": x, "y": y})
        result = association_matrix(df, {"x": "float", "y": "float"})
        assert len(result["columns"]) == 2
        # Should be strongly associated
        assert result["matrix"][0][1] > 0.8

    def test_independent_numeric_columns(self):
        """Independent numeric columns should have low association."""
        rng = np.random.default_rng(99)
        df = pd.DataFrame({
            "a": rng.normal(0, 1, size=500),
            "b": rng.normal(0, 1, size=500),
        })
        result = association_matrix(df, {"a": "float", "b": "float"})
        assert result["matrix"][0][1] < 0.15

    def test_categorical_association(self):
        """Dependent categorical columns should show association."""
        rng = np.random.default_rng(7)
        n = 1000
        cat_a = rng.choice(["A", "B", "C"], size=n)
        # cat_b strongly depends on cat_a
        cat_b = []
        for a in cat_a:
            if a == "A":
                cat_b.append(rng.choice(["X", "Y"], p=[0.9, 0.1]))
            elif a == "B":
                cat_b.append(rng.choice(["Y", "Z"], p=[0.9, 0.1]))
            else:
                cat_b.append(rng.choice(["Z", "X"], p=[0.9, 0.1]))

        df = pd.DataFrame({"cat_a": cat_a, "cat_b": cat_b})
        result = association_matrix(df, {"cat_a": "categorical", "cat_b": "categorical"})
        assert result["matrix"][0][1] > 0.5

    def test_numeric_categorical_eta(self):
        """Numeric column that varies by category should have high eta."""
        rng = np.random.default_rng(10)
        n = 500
        cats = rng.choice(["Low", "Medium", "High"], size=n)
        means = {"Low": 10, "Medium": 50, "High": 90}
        values = np.array([means[c] + rng.normal(0, 5) for c in cats])

        df = pd.DataFrame({"category": cats, "value": values})
        result = association_matrix(df, {"category": "categorical", "value": "float"})
        assert result["matrix"][0][1] > 0.8

    def test_identity_columns_excluded(self):
        """Identity columns (name, email, etc.) should be excluded."""
        df = pd.DataFrame({
            "name": ["Alice", "Bob", "Carol"],
            "email": ["a@x.com", "b@x.com", "c@x.com"],
            "age": [25, 30, 35],
            "salary": [50000, 60000, 70000],
        })
        col_types = {"name": "name", "email": "email", "age": "integer", "salary": "integer"}
        result = association_matrix(df, col_types)
        assert "name" not in result["columns"]
        assert "email" not in result["columns"]
        assert "age" in result["columns"]
        assert "salary" in result["columns"]

    def test_matrix_is_square_symmetric(self):
        """Association matrix should be square and symmetric."""
        rng = np.random.default_rng(0)
        df = pd.DataFrame({
            "a": rng.normal(size=200),
            "b": rng.normal(size=200),
            "c": rng.choice(["X", "Y"], size=200),
        })
        result = association_matrix(df, {"a": "float", "b": "float", "c": "categorical"})
        mat = np.array(result["matrix"])
        assert mat.shape[0] == mat.shape[1]
        np.testing.assert_array_almost_equal(mat, mat.T, decimal=10)


class TestSampleDatasets:
    """Tests for the bundled demo CSV datasets."""

    SAMPLE_DIR = Path(__file__).resolve().parent.parent / "sample_data"

    def test_hr_employees_exists_and_has_relationships(self):
        df = pd.read_csv(self.SAMPLE_DIR / "hr_employees.csv")
        assert len(df) == 2000
        assert set(df.columns) == {"age", "years_experience", "department", "city", "salary", "performance_score"}
        # age and years_experience should be strongly correlated
        corr = df["age"].corr(df["years_experience"])
        assert corr > 0.7, f"age-experience correlation too low: {corr}"

    def test_retail_sales_exists_and_has_relationships(self):
        df = pd.read_csv(self.SAMPLE_DIR / "retail_sales.csv")
        assert len(df) == 2000
        assert "product_category" in df.columns
        # Price should vary by category
        group_means = df.groupby("product_category")["unit_price"].mean()
        assert group_means.std() > 10, "Price variation across categories is too low"

    def test_patient_vitals_exists_and_has_relationships(self):
        df = pd.read_csv(self.SAMPLE_DIR / "patient_vitals.csv")
        assert len(df) == 2000
        assert "diagnosis" in df.columns
        # Blood pressure should correlate with age
        corr = df["age"].corr(df["blood_pressure"])
        assert corr > 0.3, f"age-bp correlation too low: {corr}"

    def test_association_on_sample_data(self):
        """Association matrix on sample data should show known relationships."""
        df = pd.read_csv(self.SAMPLE_DIR / "hr_employees.csv")
        schema = profile_dataframe(df)
        col_types = {c["name"]: c["type"] for c in schema}
        result = association_matrix(df, col_types)
        cols = result["columns"]
        mat = np.array(result["matrix"])

        # Find age-experience association
        if "age" in cols and "years_experience" in cols:
            i_age = cols.index("age")
            i_exp = cols.index("years_experience")
            assert mat[i_age, i_exp] > 0.25, f"age-experience association too low: {mat[i_age, i_exp]}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
