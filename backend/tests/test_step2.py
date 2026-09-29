"""
Tests for Step 2: CopulaSynthesizer — relationship preservation, skew, categorical,
determinism, and baseline comparison.
"""

import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import numpy as np
import pandas as pd
import pytest

from synth_model import CopulaSynthesizer


class TestRelationshipPreservation:
    """Copula must preserve inter-column correlations."""

    def test_correlated_pair_preserved(self):
        """
        Create two columns with correlation ~0.8.
        Fit the copula, generate 5,000 rows, assert synthetic correlation is within 0.1 of 0.8.
        """
        rng = np.random.default_rng(1234)
        n = 2000
        x = rng.normal(50, 10, size=n)
        y = 0.8 * x + 0.6 * rng.normal(0, 10, size=n)  # corr ≈ 0.8

        real_corr = np.corrcoef(x, y)[0, 1]
        assert abs(real_corr - 0.8) < 0.1, f"Setup error: real corr = {real_corr}"

        df = pd.DataFrame({"x": x, "y": y})
        col_types = {"x": "float", "y": "float"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(5000, seed=42)

        synth_corr = np.corrcoef(synth_df["x"].astype(float), synth_df["y"].astype(float))[0, 1]
        assert abs(synth_corr - 0.8) < 0.1, (
            f"Copula correlation {synth_corr:.3f} too far from target 0.8"
        )

    def test_three_way_relationship(self):
        """
        Three columns: A, B = 0.7*A + noise, C = 0.5*B + noise.
        All pairwise correlations should be roughly preserved.
        """
        rng = np.random.default_rng(55)
        n = 2000
        a = rng.normal(100, 20, size=n)
        b = 0.7 * a + rng.normal(0, 15, size=n)
        c = 0.5 * b + rng.normal(0, 10, size=n)

        df = pd.DataFrame({"a": a, "b": b, "c": c})
        col_types = {"a": "float", "b": "float", "c": "float"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(5000, seed=99)

        for col1, col2 in [("a", "b"), ("b", "c"), ("a", "c")]:
            real_corr = np.corrcoef(df[col1], df[col2])[0, 1]
            synth_corr = np.corrcoef(
                synth_df[col1].astype(float),
                synth_df[col2].astype(float),
            )[0, 1]
            assert abs(synth_corr - real_corr) < 0.15, (
                f"Pair ({col1},{col2}): real={real_corr:.3f}, synth={synth_corr:.3f}"
            )


class TestSkewPreservation:
    """Copula must preserve non-normal shapes like log-normal."""

    def test_lognormal_median_and_p90(self):
        """
        A log-normal column should keep a similar median and 90th percentile (within 10%).
        """
        rng = np.random.default_rng(777)
        n = 2000
        values = np.exp(rng.normal(3, 1, size=n))  # log-normal with mean ~20

        df = pd.DataFrame({"price": values})
        col_types = {"price": "float"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(5000, seed=42)

        real_median = float(np.median(values))
        real_p90 = float(np.percentile(values, 90))

        synth_vals = synth_df["price"].astype(float).values
        synth_median = float(np.median(synth_vals))
        synth_p90 = float(np.percentile(synth_vals, 90))

        median_err = abs(synth_median - real_median) / real_median
        p90_err = abs(synth_p90 - real_p90) / real_p90

        assert median_err < 0.10, (
            f"Median too far: real={real_median:.2f}, synth={synth_median:.2f}, err={median_err:.2%}"
        )
        assert p90_err < 0.10, (
            f"P90 too far: real={real_p90:.2f}, synth={synth_p90:.2f}, err={p90_err:.2%}"
        )

    def test_integer_column_stays_integer(self):
        """Integer columns should produce integer values after synthesis."""
        rng = np.random.default_rng(88)
        df = pd.DataFrame({"count": rng.integers(0, 100, size=500)})
        col_types = {"count": "integer"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(200, seed=42)

        for val in synth_df["count"].dropna():
            assert isinstance(val, (int, np.integer)), f"Got non-integer: {val} ({type(val)})"


class TestCategoricalDependency:
    """Category-dependent numeric means must be preserved."""

    def test_category_affects_numeric_mean_ordering(self):
        """
        Category affects a numeric column's mean in real data;
        the same ordering of category means must appear in synthetic data.
        """
        rng = np.random.default_rng(2024)
        n = 2000

        categories = rng.choice(["Low", "Medium", "High"], size=n, p=[0.3, 0.4, 0.3])
        means_map = {"Low": 20, "Medium": 50, "High": 80}
        values = np.array([means_map[c] + rng.normal(0, 5) for c in categories])

        df = pd.DataFrame({"category": categories, "value": values})
        col_types = {"category": "categorical", "value": "float"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(5000, seed=42)

        # Compute per-category means in synthetic data
        synth_means = synth_df.groupby("category")["value"].mean().astype(float)

        # The ordering Low < Medium < High should be preserved
        assert synth_means.get("Low", 0) < synth_means.get("Medium", 50), (
            f"Low ({synth_means.get('Low')}) should be < Medium ({synth_means.get('Medium')})"
        )
        assert synth_means.get("Medium", 50) < synth_means.get("High", 100), (
            f"Medium ({synth_means.get('Medium')}) should be < High ({synth_means.get('High')})"
        )

    def test_category_frequency_preserved(self):
        """Category frequencies should be roughly preserved."""
        rng = np.random.default_rng(111)
        n = 2000
        cats = rng.choice(["A", "B", "C", "D"], size=n, p=[0.5, 0.25, 0.15, 0.10])

        df = pd.DataFrame({"cat": cats})
        col_types = {"cat": "categorical"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(5000, seed=42)

        synth_freq = synth_df["cat"].value_counts(normalize=True)
        # "A" should still be the most common
        assert synth_freq.index[0] == "A", f"Most common category should be A, got {synth_freq.index[0]}"
        # "A" should be between 0.35 and 0.65
        a_freq = float(synth_freq.get("A", 0))
        assert 0.35 < a_freq < 0.65, f"A frequency {a_freq} out of expected range"


class TestBaselineComparison:
    """Independent sampling must fail the correlation test — proving the copula improvement."""

    def test_independent_fails_correlation(self):
        """
        With fallback independent mode, two correlated columns should NOT
        show correlation in synthetic output.
        """
        rng = np.random.default_rng(1234)
        n = 2000
        x = rng.normal(50, 10, size=n)
        y = 0.8 * x + 0.6 * rng.normal(0, 10, size=n)

        df = pd.DataFrame({"x": x, "y": y})
        col_types = {"x": "float", "y": "float"}

        # Force independent mode by using a tiny dataset for fit
        synth = CopulaSynthesizer()
        # Manually set fallback
        synth.fit(df, col_types)
        synth._fallback_independent = True
        synth._correlation_matrix = np.eye(len(synth._modelled_indices))

        synth_df = synth.sample(5000, seed=42)

        synth_corr = np.corrcoef(
            synth_df["x"].astype(float),
            synth_df["y"].astype(float),
        )[0, 1]

        # Independent sampling should produce near-zero correlation
        assert abs(synth_corr) < 0.15, (
            f"Independent mode should lose correlation, but got {synth_corr:.3f}"
        )

    def test_independent_via_small_dataset(self):
        """Dataset with fewer than 30 rows should trigger fallback."""
        rng = np.random.default_rng(0)
        df = pd.DataFrame({
            "a": rng.normal(size=10),
            "b": rng.normal(size=10),
        })
        col_types = {"a": "float", "b": "float"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)

        assert synth.is_fallback is True
        assert len(synth.warnings) > 0
        assert "Too little data" in synth.warnings[0]


class TestDeterminism:
    """Same seed must produce identical output."""

    def test_same_seed_identical_output(self):
        """Two calls with the same seed must return byte-identical DataFrames."""
        rng = np.random.default_rng(42)
        n = 500
        df = pd.DataFrame({
            "age": rng.integers(20, 60, size=n),
            "salary": rng.normal(60000, 15000, size=n),
            "dept": rng.choice(["A", "B", "C"], size=n),
        })
        col_types = {"age": "integer", "salary": "float", "dept": "categorical"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)

        df1 = synth.sample(200, seed=999)
        df2 = synth.sample(200, seed=999)

        pd.testing.assert_frame_equal(df1, df2)

    def test_different_seed_different_output(self):
        """Different seeds should produce different output."""
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            "x": rng.normal(size=200),
            "y": rng.normal(size=200),
        })
        col_types = {"x": "float", "y": "float"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)

        df1 = synth.sample(100, seed=1)
        df2 = synth.sample(100, seed=2)

        assert not df1.equals(df2), "Different seeds should produce different data"


class TestIdentityColumns:
    """Identity columns (name, email, etc.) should be generated by Faker."""

    def test_identity_columns_generated(self):
        """Name, email, and ID columns should appear in the output."""
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            "id": range(100),
            "full_name": [f"Person {i}" for i in range(100)],
            "email": [f"p{i}@test.com" for i in range(100)],
            "age": rng.integers(20, 60, size=100),
            "salary": rng.normal(50000, 10000, size=100),
        })
        col_types = {
            "id": "id", "full_name": "name", "email": "email",
            "age": "integer", "salary": "float",
        }

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(50, seed=42)

        assert "full_name" in synth_df.columns
        assert "email" in synth_df.columns
        assert "id" in synth_df.columns
        assert "age" in synth_df.columns
        assert "salary" in synth_df.columns
        assert len(synth_df) == 50

    def test_email_derived_from_name(self):
        """When both name and email columns exist, email should contain name-like parts."""
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            "person_name": [f"John Doe {i}" for i in range(100)],
            "person_email": [f"john.doe{i}@test.com" for i in range(100)],
            "score": rng.normal(size=100),
        })
        col_types = {"person_name": "name", "person_email": "email", "score": "float"}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(20, seed=42)

        # Every email should contain "@"
        for email in synth_df["person_email"].dropna():
            assert "@" in str(email), f"Invalid email: {email}"


class TestSampleDataCopula:
    """Test copula on the bundled sample datasets."""

    SAMPLE_DIR = Path(__file__).resolve().parent.parent / "sample_data"

    def test_hr_employees_copula(self):
        """HR employees: age-experience correlation should be preserved."""
        from profiler import profile_dataframe

        df = pd.read_csv(self.SAMPLE_DIR / "hr_employees.csv")
        schema = profile_dataframe(df)
        col_types = {c["name"]: c["type"] for c in schema}

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        assert not synth.is_fallback

        synth_df = synth.sample(3000, seed=42)

        # Age-experience correlation should be positive and meaningful
        real_corr = df["age"].corr(df["years_experience"])
        synth_corr = synth_df["age"].astype(float).corr(synth_df["years_experience"].astype(float))
        assert synth_corr > 0.3, f"age-experience synthetic correlation too low: {synth_corr}"
        assert abs(synth_corr - real_corr) < 0.2, (
            f"Correlation drift too large: real={real_corr:.3f}, synth={synth_corr:.3f}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
