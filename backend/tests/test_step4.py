"""
Tests for Step 4:
  - privacy_check.py: exact match detection and distance-to-closest-record (DCR)
  - quality.py: generate_fidelity_report() with 3-part scoring, distributions, scatter, network
  - /api/quality/report & /api/v1/quality/report endpoints
  - Required tests:
    * Privacy test: exact_match_count is 0 on the bundled datasets
    * Score test: score >= 80 and score - score_independent >= 20 on bundled datasets
"""

import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import pytest
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from main import app
from session_store import dataset_store
from profiler import profile_dataframe
from synth_model import CopulaSynthesizer
from association import association_matrix, _build_column_types_from_schema
from privacy_check import (
    check_exact_matches,
    check_distance_to_closest,
    run_privacy_check,
)
from quality import generate_fidelity_report, compare_datasets
from tabular import generate_tabular

SAMPLE_DIR = backend_dir / "sample_data"
client = TestClient(app)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  PRIVACY CHECK UNIT TESTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestPrivacyCheckUnit:
    """Unit tests for exact matching and DCR distance checking."""

    def test_exact_matches_zero_on_copula(self):
        df = pd.read_csv(SAMPLE_DIR / "hr_employees.csv")
        schema = profile_dataframe(df)
        col_types = _build_column_types_from_schema(schema)

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(1000, seed=42)

        res = check_exact_matches(df, synth_df, list(col_types.keys()))
        assert res["exact_match_count"] == 0
        assert res["exact_match_rate"] == 0.0

    def test_exact_matches_detects_duplicates(self):
        """When real rows are explicitly inserted, exact match must detect them."""
        df = pd.read_csv(SAMPLE_DIR / "hr_employees.csv").head(100)
        # Duplicate 5 rows into synthetic data
        synth_df = df.head(5).copy()

        res = check_exact_matches(df, synth_df, list(df.columns))
        assert res["exact_match_count"] == 5
        assert res["exact_match_rate"] == 1.0

    def test_dcr_ratio_above_threshold(self):
        """DCR ratio should be >= 0.8 on copula generated data."""
        df = pd.read_csv(SAMPLE_DIR / "hr_employees.csv")
        schema = profile_dataframe(df)
        col_types = _build_column_types_from_schema(schema)

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(1000, seed=42)

        dcr = check_distance_to_closest(df, synth_df, list(col_types.keys()), col_types)
        assert dcr["dcr_ratio"] >= 0.8
        assert dcr["synth_median_dist"] > 0
        assert dcr["real_median_dist"] > 0

    def test_run_privacy_check_full(self):
        """Full privacy check pipeline returns pass status and explanation."""
        df = pd.read_csv(SAMPLE_DIR / "retail_sales.csv")
        schema = profile_dataframe(df)
        col_types = _build_column_types_from_schema(schema)

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(1000, seed=42)

        report = run_privacy_check(df, synth_df, col_types)
        assert report["status"] == "pass"
        assert report["exact_match_count"] == 0
        assert report["dcr_ratio"] >= 0.8
        assert len(report["explanation"]) > 10


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  MANDATORY BUNDLED DATASET TESTS (SPECIFICATION REQUIREMENT)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestBundledDatasetsFidelityAndPrivacy:
    """
    Mandatory tests from specification:
      - Privacy test: exact_match_count is 0 on the bundled datasets.
      - Score test: on the bundled datasets score is at least 80 and
        greater than score_independent by at least 20.
    """

    @pytest.mark.parametrize("dataset_name", ["hr_employees", "retail_sales", "patient_vitals"])
    def test_privacy_on_bundled_datasets(self, dataset_name):
        """exact_match_count must be 0 on all bundled datasets."""
        df = pd.read_csv(SAMPLE_DIR / f"{dataset_name}.csv")
        schema = profile_dataframe(df)
        col_types = _build_column_types_from_schema(schema)

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        synth_df = synth.sample(2000, seed=42)

        privacy = run_privacy_check(df, synth_df, col_types)
        assert privacy["exact_match_count"] == 0, (
            f"Expected 0 exact matches for {dataset_name}, got {privacy['exact_match_count']}"
        )
        assert privacy["status"] == "pass"

    @pytest.mark.parametrize("dataset_name", ["hr_employees", "retail_sales", "patient_vitals"])
    def test_score_and_improvement_on_bundled_datasets(self, dataset_name):
        """
        Score must be at least 80, and score - score_independent >= 20
        on all bundled datasets.
        """
        df = pd.read_csv(SAMPLE_DIR / f"{dataset_name}.csv")
        schema = profile_dataframe(df)
        col_types = _build_column_types_from_schema(schema)

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        copula_df = synth.sample(2000, seed=42)

        indep_df = generate_tabular(schema, row_count=2000, seed=42)

        report = generate_fidelity_report(df, copula_df, indep_df, schema)

        score = report["score"]
        score_indep = report["score_independent"]
        diff = report["score_breakdown"]["improvement"]

        assert score >= 80.0, f"Score for {dataset_name} ({score}) should be >= 80"
        assert diff >= 20.0, (
            f"Improvement for {dataset_name} ({diff:.1f}) should be >= 20 "
            f"(copula={score}, indep={score_indep})"
        )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  FIDELITY REPORT STRUCTURE TESTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestFidelityReportStructure:
    """Verify all required sections of the fidelity report exist and are valid."""

    @pytest.fixture
    def sample_report(self):
        df = pd.read_csv(SAMPLE_DIR / "hr_employees.csv")
        schema = profile_dataframe(df)
        col_types = _build_column_types_from_schema(schema)

        synth = CopulaSynthesizer()
        synth.fit(df, col_types)
        copula_df = synth.sample(1000, seed=42)
        indep_df = generate_tabular(schema, row_count=1000, seed=42)

        return generate_fidelity_report(df, copula_df, indep_df, schema)

    def test_required_keys_present(self, sample_report):
        required_keys = [
            "score", "score_independent", "score_breakdown",
            "per_column", "distributions", "association",
            "scatter", "network", "privacy", "top_relationships"
        ]
        for key in required_keys:
            assert key in sample_report, f"Missing key in report: {key}"

    def test_distributions_chart_ready(self, sample_report):
        dists = sample_report["distributions"]
        assert len(dists) > 0

        # Numeric column should have 20 bins with real and synthetic percentages
        age_dist = dists.get("age") or dists.get("years_experience")
        assert age_dist is not None
        assert len(age_dist) == 20
        assert "bin" in age_dist[0]
        assert "real" in age_dist[0]
        assert "synthetic" in age_dist[0]

        # Categorical column
        dept_dist = dists.get("department")
        assert dept_dist is not None
        assert len(dept_dist) > 0
        assert "category" in dept_dist[0]
        assert "real" in dept_dist[0]
        assert "synthetic" in dept_dist[0]

    def test_association_matrices_structure(self, sample_report):
        assoc = sample_report["association"]
        cols = assoc["columns"]
        n = len(cols)
        assert len(assoc["real"]) == n
        assert len(assoc["synthetic"]) == n
        assert len(assoc["difference"]) == n
        assert len(assoc["independent"]) == n
        assert len(assoc["difference_independent"]) == n

    def test_scatter_top_numeric_pairs(self, sample_report):
        scatter = sample_report["scatter"]
        assert 1 <= len(scatter) <= 3
        first = scatter[0]
        assert "x_col" in first and "y_col" in first
        assert "real_points" in first and "synth_points" in first
        assert len(first["real_points"]) > 0
        assert "x" in first["real_points"][0] and "y" in first["real_points"][0]

    def test_network_structure(self, sample_report):
        net = sample_report["network"]
        assert "nodes" in net
        assert "edges_real" in net
        assert "edges_synthetic" in net
        assert "threshold" in net
        assert net["threshold"] == 0.3

    def test_top_relationships_plain_data(self, sample_report):
        top_rels = sample_report["top_relationships"]
        assert len(top_rels) == 5
        top = top_rels[0]
        assert "col1" in top and "col2" in top
        assert "real_strength" in top
        assert "synth_strength" in top
        assert "indep_strength" in top
        assert "description" in top


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  API ENDPOINT INTEGRATION TESTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestQualityReportAPI:
    """Test POST /api/quality/report and legacy endpoints."""

    def test_quality_report_endpoint_success(self):
        # 1. Load sample dataset
        load_res = client.post("/api/samples/hr_employees/load")
        assert load_res.status_code == 200
        dataset_id = load_res.json()["dataset_id"]

        # 2. Call /api/quality/report
        res = client.post("/api/quality/report", json={
            "dataset_id": dataset_id,
            "row_count": 500,
            "seed": 42,
        })
        assert res.status_code == 200
        data = res.json()
        assert data["score"] >= 80.0
        assert data["score_breakdown"]["improvement"] >= 20.0
        assert data["privacy"]["status"] == "pass"

    def test_quality_report_v1_alias(self):
        load_res = client.post("/api/v1/samples/retail_sales/load")
        assert load_res.status_code == 200
        dataset_id = load_res.json()["dataset_id"]

        res = client.post("/api/v1/quality/report", json={
            "dataset_id": dataset_id,
            "row_count": 500,
            "seed": 99,
        })
        assert res.status_code == 200
        assert res.json()["score"] >= 80.0

    def test_missing_dataset_id_returns_400(self):
        res = client.post("/api/quality/report", json={"row_count": 100})
        assert res.status_code == 400

    def test_expired_dataset_id_returns_404(self):
        res = client.post("/api/quality/report", json={
            "dataset_id": "non_existent_id",
            "row_count": 100,
        })
        assert res.status_code == 404

    def test_legacy_quality_endpoint_unbroken(self):
        """Existing /api/v1/tabular/quality endpoint must still work unchanged."""
        schema = [
            {"name": "age", "type": "integer", "stats": {"min": 18, "max": 65, "mean": 40, "std": 10}},
            {"name": "dept", "type": "categorical", "stats": {"categories": {"Eng": 0.6, "Sales": 0.4}}},
        ]
        res = client.post("/api/v1/tabular/quality", json={
            "schema": schema,
            "row_count": 100,
            "seed": 42,
        })
        assert res.status_code == 200
        data = res.json()
        assert "overall_score" in data
        assert "columns" in data
