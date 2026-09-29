"""
Tests for Step 6: Relational Learning Mode.
- Learning empirical distributions from real customers/orders/order_items CSVs
- Generating relational tables using learned statistical distributions
- Mathematical validation of foreign keys (0 orphans) and order totals (subtotal, discount, tax, order_total)
- Comparison table (real vs synthetic)
- API endpoints: /api/relational/sample, /api/relational/learn, /api/relational/generate, /api/relational/export
"""

import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import io
import zipfile
import pytest
import pandas as pd
import numpy as np
from fastapi.testclient import TestClient

from main import app
from relational import (
    load_built_in_relational_sample,
    learn_relational_distributions,
    generate_relational_learned,
    compare_relational_datasets,
    RelationalLearnedModel,
)
from validators import (
    check_all_orphan_keys,
    check_order_totals,
    run_relational_validation,
)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def real_sample():
    cust, ords, items = load_built_in_relational_sample()
    return cust, ords, items


# ── 1. Built-in Sample & Learning Tests ───────────────────────────────────────

def test_load_built_in_sample(real_sample):
    cust, ords, items = real_sample
    assert len(cust) >= 100
    assert len(ords) >= 200
    assert len(items) >= 400
    
    # Check required columns
    assert "customer_id" in cust.columns
    assert "customer_id" in ords.columns
    assert "order_id" in ords.columns
    assert "order_id" in items.columns
    assert "unit_price" in items.columns
    assert "category" in items.columns

    # Verify real data has zero orphan keys
    orphans = check_all_orphan_keys({"customers": cust, "orders": ords, "order_items": items})
    assert orphans["all_valid"] is True


def test_learn_relational_distributions(real_sample):
    cust, ords, items = real_sample
    model = learn_relational_distributions(cust, ords, items)

    assert isinstance(model, RelationalLearnedModel)
    assert len(model.orders_per_cust_samples) == len(cust)
    assert len(model.items_per_order_samples) == len(ords)
    assert len(model.quantity_samples) == len(items)
    assert len(model.categories) > 0
    assert "Electronics" in model.category_quantiles
    assert "Books" in model.category_quantiles

    # Electronics prices should be significantly higher than Books
    elec_median = np.median(model.category_quantiles["Electronics"])
    books_median = np.median(model.category_quantiles["Books"])
    assert elec_median > books_median

    summary = model.to_summary_dict()
    assert "orders_per_customer" in summary
    assert "categories" in summary
    assert summary["orders_per_customer"]["mean"] > 1.0


# ── 2. Learned Generation & Integrity Tests ───────────────────────────────────

def test_generate_relational_learned_referential_integrity(real_sample):
    cust, ords, items = real_sample
    model = learn_relational_distributions(cust, ords, items)

    synth = generate_relational_learned(model, customer_count=75, seed=123)

    assert "customers" in synth
    assert "orders" in synth
    assert "order_items" in synth

    assert len(synth["customers"]) == 75
    assert len(synth["orders"]) > 75
    assert len(synth["order_items"]) > len(synth["orders"])

    # Strict foreign key validation: 0 orphan keys
    orphan_res = check_all_orphan_keys(synth)
    assert orphan_res["all_valid"] is True, f"Orphan keys found: {orphan_res}"

    # Strict totals validation: subtotals and order_totals strictly reconcile
    totals_res = check_order_totals(synth["orders"], synth["order_items"])
    assert totals_res["valid"] is True, f"Totals reconciliation failed: {totals_res}"
    assert totals_res["subtotal_mismatches"] == 0
    assert totals_res["total_mismatches"] == 0


def test_generate_relational_learned_preserves_category_pricing(real_sample):
    cust, ords, items = real_sample
    model = learn_relational_distributions(cust, ords, items)
    synth = generate_relational_learned(model, customer_count=150, seed=42)

    synth_items = synth["order_items"]
    elec_prices = synth_items[synth_items["category"] == "Electronics"]["unit_price"].values
    books_prices = synth_items[synth_items["category"] == "Books"]["unit_price"].values

    if len(elec_prices) and len(books_prices):
        assert np.mean(elec_prices) > np.mean(books_prices)


def test_generate_relational_learned_determinism(real_sample):
    cust, ords, items = real_sample
    model = learn_relational_distributions(cust, ords, items)

    synth1 = generate_relational_learned(model, customer_count=30, seed=999)
    synth2 = generate_relational_learned(model, customer_count=30, seed=999)

    pd.testing.assert_frame_equal(synth1["customers"], synth2["customers"])
    pd.testing.assert_frame_equal(synth1["orders"], synth2["orders"])
    pd.testing.assert_frame_equal(synth1["order_items"], synth2["order_items"])


# ── 3. Comparison Tests ───────────────────────────────────────────────────────

def test_compare_relational_datasets(real_sample):
    cust, ords, items = real_sample
    model = learn_relational_distributions(cust, ords, items)
    synth = generate_relational_learned(model, customer_count=100, seed=42)

    real_dict = {"customers": cust, "orders": ords, "order_items": items}
    comp = compare_relational_datasets(real_dict, synth)

    assert "orders_per_customer" in comp
    assert "items_per_order" in comp
    assert "quantity" in comp
    assert "price_by_category" in comp

    # Orders per customer mean should be close
    opc = comp["orders_per_customer"]
    assert abs(opc["real_mean"] - opc["synth_mean"]) < 1.0

    # Price by category list should contain categories
    assert len(comp["price_by_category"]) > 0
    cat_names = [p["category"] for p in comp["price_by_category"]]
    assert "Electronics" in cat_names


# ── 4. API Endpoint Tests ─────────────────────────────────────────────────────

def test_api_relational_sample(client):
    res = client.get("/api/relational/sample")
    assert res.status_code == 200
    data = res.json()
    assert "tables" in data
    assert "summary" in data
    assert data["tables"]["customers"] >= 100


def test_api_relational_learn_and_generate(client):
    # 1. Learn from sample
    learn_res = client.post("/api/relational/learn", json={"use_sample": True})
    assert learn_res.status_code == 200
    learn_data = learn_res.json()
    assert "model_id" in learn_data
    assert "learned_summary" in learn_data
    model_id = learn_data["model_id"]

    # 2. Generate with learned model
    gen_res = client.post("/api/relational/generate", json={
        "customer_count": 40,
        "seed": 42,
        "use_learned": True,
        "model_id": model_id,
    })
    assert gen_res.status_code == 200
    gen_data = gen_res.json()
    assert gen_data["is_learned"] is True
    assert "customers" in gen_data["tables"]
    assert "orders" in gen_data["tables"]
    assert "order_items" in gen_data["tables"]

    # Validate referential integrity & totals
    val = gen_data["validation"]
    assert val["all_valid"] is True
    assert val["checks"]["orphan_keys"]["all_valid"] is True
    assert val["checks"]["order_totals"]["valid"] is True

    # Validate comparison table
    assert gen_data["comparison"] is not None
    assert "orders_per_customer" in gen_data["comparison"]
    assert "price_by_category" in gen_data["comparison"]


def test_api_relational_export_learned(client):
    res = client.post("/api/relational/export", json={
        "customer_count": 25,
        "seed": 42,
        "use_learned": True,
        "format": "zip",
    })
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"

    # Verify zip content
    z = zipfile.ZipFile(io.BytesIO(res.content))
    names = z.namelist()
    assert "customers.csv" in names
    assert "orders.csv" in names
    assert "order_items.csv" in names
