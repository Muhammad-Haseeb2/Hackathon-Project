"""
Synthetic Data Platform — FastAPI Application
Serves the API and the built React frontend from frontend/dist.
"""

import os
import io
import time
import traceback
import psutil
from pathlib import Path
from contextlib import asynccontextmanager

import uuid
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import pandas as pd
import numpy as np
import json

load_dotenv()

from locales import SUPPORTED_LOCALES
from profiler import read_uploaded_file, profile_dataframe
from tabular import generate_tabular
from privacy import apply_privacy
from quality import compare_datasets, generate_fidelity_report
from relational import (
    generate_relational, export_relational_zip, generate_sql_dump, DEFAULT_TEMPLATE,
    RelationalLearnedModel, learn_relational_distributions,
    load_built_in_relational_sample, compare_relational_datasets,
)
from session_store import dataset_store
from association import association_matrix, _build_column_types_from_schema
from synth_model import CopulaSynthesizer
from documents import (
    generate_invoice_data, render_invoice_pdf, render_invoice_html,
    generate_bank_statement, render_statement_pdf, render_statement_html,
    generate_bulk_invoices, mimic_invoice_from_file,
)
from validators import run_relational_validation, check_running_balance
from llm import call_llm, infer_schema, get_content_pool, suggest_edge_cases, get_cache_stats
from security import (
    rate_limiter, audit_logger, api_key_manager,
    verify_admin, RateLimitMiddleware, SecureHeadersMiddleware,
    validate_row_count, validate_file_size,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    print("[OK] Synthetic Data Platform started")
    yield
    print("[--] Shutting down")


app = FastAPI(
    title="Synthetic Data Platform",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Middleware ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecureHeadersMiddleware)


# ── In-memory storage for uploaded profiles (legacy, kept for compat) ──
_uploaded_profiles: dict[str, dict] = {}  # session_key -> {df, schema}

# ── Sample datasets directory ──
SAMPLE_DATA_DIR = Path(__file__).resolve().parent / "sample_data"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  HEALTH
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "service": "Synthetic Data Platform",
    }


@app.get("/api/v1/locales")
async def get_locales():
    """Return all supported locales with metadata and currency info."""
    return {"locales": list(SUPPORTED_LOCALES.values())}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  TABULAR
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.post("/api/v1/tabular/profile")
async def tabular_profile(file: UploadFile = File(...)):
    """Upload CSV/Excel, profile it, return detected schema."""
    start = time.time()
    try:
        contents = await file.read()
        if not validate_file_size(len(contents)):
            raise HTTPException(status_code=400, detail="File too large. Max 5 MB.")

        df = read_uploaded_file(contents, file.filename or "data.csv")
        schema = profile_dataframe(df)

        # Store in the new dataset session store
        dataset_id = dataset_store.store(df, schema, filename=file.filename or "data.csv")

        # Also keep the legacy session_key for backward compat
        session_key = f"profile_{hash(file.filename)}_{len(df)}"
        _uploaded_profiles[session_key] = {
            'df': df,
            'schema': schema,
        }

        elapsed = (time.time() - start) * 1000
        audit_logger.log_event("/api/v1/tabular/profile", row_count=len(df), execution_time_ms=elapsed)

        return {
            "schema": schema,
            "row_count": len(df),
            "columns": len(schema),
            "session_key": session_key,
            "dataset_id": dataset_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not process file: {str(e)}")


def _generate_with_method(
    schema: list[dict],
    row_count: int,
    seed: int,
    locale: str,
    null_rate: float,
    outlier_rate: float,
    dataset_id: str = "",
    method: str = "auto",
) -> tuple[pd.DataFrame, str, list[str]]:
    """
    Generate synthetic data using the requested method.

    Returns:
        (df, method_used, warnings)
    """
    warnings = []

    # Determine method
    if method == "auto":
        method = "copula" if dataset_id else "independent"

    if method == "copula" and dataset_id:
        entry = dataset_store.get(dataset_id)
        if entry is None:
            warnings.append("Dataset expired or not found. Falling back to independent generation.")
            method = "independent"
        else:
            col_types = _build_column_types_from_schema(entry.schema)
            synth = CopulaSynthesizer()
            synth.fit(entry.df, col_types)
            warnings.extend(synth.warnings)

            if synth.is_fallback:
                method = "independent"
            else:
                df = synth.sample(row_count, seed=seed)

                # Apply null/outlier injection on top if requested
                if null_rate > 0:
                    rng = np.random.default_rng(seed + 1000)
                    for col in df.columns:
                        mask = rng.random(len(df)) < null_rate
                        df.loc[mask, col] = None

                return df, "copula", warnings

    # Independent generation (the original behaviour)
    df = generate_tabular(
        schema=schema,
        row_count=row_count,
        seed=seed,
        locale=locale,
        null_rate=null_rate,
        outlier_rate=outlier_rate,
    )
    return df, "independent", warnings


@app.post("/api/v1/tabular/generate")
async def tabular_generate(request: Request):
    """Generate synthetic tabular data from schema."""
    start = time.time()
    try:
        body = await request.json()
        schema = body.get("schema", [])
        row_count = validate_row_count(body.get("row_count", 100))
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        null_rate = body.get("null_rate", 0.0)
        outlier_rate = body.get("outlier_rate", 0.0)
        privacy_rules = body.get("privacy_rules", [])
        dataset_id = body.get("dataset_id", "")
        method = body.get("method", "auto")

        if not schema and not dataset_id:
            raise HTTPException(status_code=400, detail="Schema or dataset_id is required.")

        # If dataset_id provided but no schema, use the stored schema
        if not schema and dataset_id:
            entry = dataset_store.get(dataset_id)
            if entry is None:
                raise HTTPException(status_code=404, detail="Dataset not found or expired.")
            schema = entry.schema

        df, method_used, gen_warnings = _generate_with_method(
            schema=schema,
            row_count=row_count,
            seed=seed,
            locale=locale,
            null_rate=null_rate,
            outlier_rate=outlier_rate,
            dataset_id=dataset_id,
            method=method,
        )

        # Apply privacy if rules provided
        has_privacy = len(privacy_rules) > 0
        if has_privacy:
            df = apply_privacy(df, privacy_rules, seed=seed)

        # Return preview with all requested rows up to 1,000 for browser display
        preview_limit = min(row_count, 1000)
        preview = df.head(preview_limit).replace({np.nan: None}).to_dict(orient='records')
        columns = list(df.columns)

        elapsed = (time.time() - start) * 1000
        audit_logger.log_event(
            "/api/v1/tabular/generate",
            row_count=row_count,
            privacy_noise=has_privacy,
            execution_time_ms=elapsed,
            extra={"method": method_used},
        )

        return {
            "preview": preview,
            "columns": columns,
            "total_rows": row_count,
            "seed": seed,
            "method": method_used,
            "warnings": gen_warnings,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/tabular/export")
async def tabular_export(request: Request):
    """Generate and export tabular data as CSV, JSON, or Excel."""
    start = time.time()
    try:
        body = await request.json()
        schema = body.get("schema", [])
        row_count = validate_row_count(body.get("row_count", 100))
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        null_rate = body.get("null_rate", 0.0)
        outlier_rate = body.get("outlier_rate", 0.0)
        privacy_rules = body.get("privacy_rules", [])
        fmt = str(body.get("format", "csv")).strip().lower()
        dataset_id = body.get("dataset_id", "")
        method = body.get("method", "auto")

        if not schema and not dataset_id:
            raise HTTPException(status_code=400, detail="Schema or dataset_id is required.")

        # If dataset_id provided but no schema, use the stored schema
        if not schema and dataset_id:
            entry = dataset_store.get(dataset_id)
            if entry is None:
                raise HTTPException(status_code=404, detail="Dataset not found or expired.")
            schema = entry.schema

        df, method_used, gen_warnings = _generate_with_method(
            schema=schema,
            row_count=row_count,
            seed=seed,
            locale=locale,
            null_rate=null_rate,
            outlier_rate=outlier_rate,
            dataset_id=dataset_id,
            method=method,
        )

        if privacy_rules:
            df = apply_privacy(df, privacy_rules, seed=seed)

        elapsed = (time.time() - start) * 1000
        audit_logger.log_event(
            "/api/v1/tabular/export",
            row_count=row_count,
            privacy_noise=len(privacy_rules) > 0,
            execution_time_ms=elapsed,
            extra={"method": method_used},
        )

        if fmt == "json":
            data = df.replace({np.nan: None}).to_dict(orient='records')
            content = json.dumps(data, indent=2, default=str)
            return StreamingResponse(
                io.BytesIO(content.encode("utf-8")),
                media_type="application/json; charset=utf-8",
                headers={"Content-Disposition": 'attachment; filename="synthetia_data.json"'},
            )
        elif fmt in ("excel", "xlsx"):
            buf = io.BytesIO()
            df.to_excel(buf, index=False, engine='openpyxl')
            buf.seek(0)
            return StreamingResponse(
                buf,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": 'attachment; filename="synthetia_data.xlsx"'},
            )
        else:  # csv
            content = df.to_csv(index=False)
            return StreamingResponse(
                io.BytesIO(content.encode("utf-8")),
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": 'attachment; filename="synthetia_data.csv"'},
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/tabular/quality")
async def tabular_quality(request: Request):
    """Compare uploaded data vs synthetic data for quality report."""
    try:
        body = await request.json()
        schema = body.get("schema", [])
        row_count = body.get("row_count", 100)
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        session_key = body.get("session_key", "")
        dataset_id = body.get("dataset_id", "")

        if not schema:
            raise HTTPException(status_code=400, detail="Schema is required.")

        # Generate synthetic data
        synth_df = generate_tabular(schema=schema, row_count=row_count, seed=seed, locale=locale)

        # Get original data — prefer dataset_store, fallback to legacy
        real_df = None
        if dataset_id:
            entry = dataset_store.get(dataset_id)
            if entry:
                real_df = entry.df
        if real_df is None and session_key and session_key in _uploaded_profiles:
            real_df = _uploaded_profiles[session_key]['df']
        if real_df is None:
            # Use the same schema to generate a "real" baseline
            real_df = generate_tabular(schema=schema, row_count=row_count, seed=seed + 1, locale=locale)

        report = compare_datasets(real_df, synth_df, schema)
        return report

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/quality/report")
@app.post("/api/v1/quality/report")
async def quality_fidelity_report(request: Request):
    """
    Generate comprehensive fidelity report comparing real data with both
    Copula-synthesized and independent-baseline data.
    """
    try:
        body = await request.json()
        dataset_id = body.get("dataset_id", "")
        row_count = validate_row_count(body.get("row_count", 1000))
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        privacy_settings = body.get("privacy_settings", {})
        privacy_rules = body.get("privacy_rules", [])

        if not dataset_id:
            raise HTTPException(status_code=400, detail="dataset_id is required.")

        entry = dataset_store.get(dataset_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Dataset not found or expired.")

        real_df = entry.df
        schema = entry.schema
        col_types = _build_column_types_from_schema(schema)

        # 1. Copula synthetic generation
        synth = CopulaSynthesizer()
        synth.fit(real_df, col_types)
        synth_copula = synth.sample(row_count, seed=seed)

        # Apply privacy noise to copula output if requested
        if privacy_rules:
            synth_copula = apply_privacy(synth_copula, privacy_rules, seed=seed)

        # 2. Independent baseline generation
        synth_indep = generate_tabular(
            schema=schema,
            row_count=row_count,
            seed=seed,
            locale=locale,
        )

        # 3. Produce fidelity report
        report = generate_fidelity_report(
            real_df=real_df,
            synth_copula=synth_copula,
            synth_independent=synth_indep,
            schema=schema,
            privacy_settings=privacy_settings,
        )

        return report

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  SAMPLE DATASETS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Metadata for bundled demo datasets
SAMPLE_DATASETS = {
    "customer_profiles": {
        "name": "customer_profiles",
        "title": "Customer Profiles (Email, Phone, Name, City, Spent)",
        "description": "Full customer profiles with emails, phone numbers, full names, locations, and spending tiers. Perfect for testing privacy masking and pseudonymization.",
        "rows": 2000,
        "columns": 7,
    },
    "hr_employees": {
        "name": "hr_employees",
        "title": "HR Employees",
        "description": "Employee data with age, experience, department, city, salary, and performance. Strong relationships: salary depends on experience, department, and city.",
        "rows": 2000,
        "columns": 6,
    },
    "retail_sales": {
        "name": "retail_sales",
        "title": "Retail Sales",
        "description": "Sales transactions with category-dependent pricing, inverse price-quantity relationship, seasonal December peak, and computed revenue.",
        "rows": 2000,
        "columns": 7,
    },
    "patient_vitals": {
        "name": "patient_vitals",
        "title": "Patient Vitals",
        "description": "Patient health data with age-linked BMI, blood pressure tied to age/BMI/smoking, cholesterol, and risk-based diagnosis.",
        "rows": 2000,
        "columns": 6,
    },
}


@app.get("/api/samples")
@app.get("/api/v1/samples")
async def list_samples():
    """List available bundled demo datasets."""
    return {"samples": list(SAMPLE_DATASETS.values())}


@app.post("/api/samples/{name}/load")
@app.post("/api/v1/samples/{name}/load")
async def load_sample(name: str):
    """Load a bundled demo dataset into the session store and return its profile."""
    if name not in SAMPLE_DATASETS:
        raise HTTPException(status_code=404, detail=f"Sample dataset '{name}' not found. Available: {list(SAMPLE_DATASETS.keys())}")

    csv_path = SAMPLE_DATA_DIR / f"{name}.csv"
    if not csv_path.exists():
        raise HTTPException(status_code=500, detail=f"Sample CSV file not found on disk: {name}.csv")

    df = pd.read_csv(csv_path)
    schema = profile_dataframe(df)
    dataset_id = dataset_store.store(df, schema, filename=f"{name}.csv")

    return {
        "dataset_id": dataset_id,
        "schema": schema,
        "row_count": len(df),
        "columns": len(schema),
        "sample_info": SAMPLE_DATASETS[name],
    }


@app.get("/api/v1/datasets")
async def list_datasets():
    """List all active datasets in the session store."""
    return {"datasets": dataset_store.list_datasets()}


@app.post("/api/v1/association")
async def compute_association(request: Request):
    """Compute association matrix for a stored dataset."""
    try:
        body = await request.json()
        dataset_id = body.get("dataset_id", "")

        if not dataset_id:
            raise HTTPException(status_code=400, detail="dataset_id is required.")

        entry = dataset_store.get(dataset_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Dataset not found or expired.")

        col_types = _build_column_types_from_schema(entry.schema)
        result = association_matrix(entry.df, column_types=col_types)
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  RELATIONAL
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# In-memory storage for learned relational models: model_id -> (model, real_tables)
_relational_models: dict[str, tuple[RelationalLearnedModel, dict[str, pd.DataFrame]]] = {}


@app.get("/api/relational/sample")
@app.get("/api/v1/relational/sample")
async def relational_sample_info():
    """Get metadata and learned statistics about the bundled relational sample."""
    try:
        cust, ords, items = load_built_in_relational_sample()
        model = learn_relational_distributions(cust, ords, items)
        return {
            "name": "E-Commerce Linked Dataset",
            "tables": {
                "customers": len(cust),
                "orders": len(ords),
                "order_items": len(items),
            },
            "summary": model.to_summary_dict(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/relational/learn")
@app.post("/api/v1/relational/learn")
async def relational_learn(
    request: Request,
    customers_file: Optional[UploadFile] = File(None),
    orders_file: Optional[UploadFile] = File(None),
    order_items_file: Optional[UploadFile] = File(None),
):
    """
    Learn relational distributions from uploaded CSV files or the built-in sample.
    Returns model_id and summary of learned distributions.
    """
    try:
        cust_df = None
        ords_df = None
        items_df = None

        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type:
            body = await request.json()
            if body.get("use_sample", True):
                cust_df, ords_df, items_df = load_built_in_relational_sample()
        elif customers_file and orders_file and order_items_file:
            cust_bytes = await customers_file.read()
            ords_bytes = await orders_file.read()
            items_bytes = await order_items_file.read()
            cust_df = pd.read_csv(io.BytesIO(cust_bytes))
            ords_df = pd.read_csv(io.BytesIO(ords_bytes))
            items_df = pd.read_csv(io.BytesIO(items_bytes))
        else:
            cust_df, ords_df, items_df = load_built_in_relational_sample()

        if cust_df is None or ords_df is None or items_df is None:
            raise HTTPException(
                status_code=400,
                detail="Missing required relational tables (customers, orders, order_items)."
            )

        model = learn_relational_distributions(cust_df, ords_df, items_df)
        model_id = str(uuid.uuid4())[:12]
        _relational_models[model_id] = (model, {
            "customers": cust_df,
            "orders": ords_df,
            "order_items": items_df,
        })

        return {
            "model_id": model_id,
            "learned_summary": model.to_summary_dict(),
            "real_counts": {
                "customers": len(cust_df),
                "orders": len(ords_df),
                "order_items": len(items_df),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/relational/generate")
@app.post("/api/v1/relational/generate")
async def relational_generate(request: Request):
    """Generate relational datasets with referential integrity (supports template or learned mode)."""
    start = time.time()
    try:
        body = await request.json()
        customer_count = validate_row_count(body.get("customer_count", 50))
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        template = body.get("template")
        use_learned = body.get("use_learned", False)
        model_id = body.get("model_id", "")

        learned_model = None
        real_tables = None

        if use_learned or model_id:
            if model_id and model_id in _relational_models:
                learned_model, real_tables = _relational_models[model_id]
            else:
                cust, ords, items = load_built_in_relational_sample()
                learned_model = learn_relational_distributions(cust, ords, items)
                real_tables = {"customers": cust, "orders": ords, "order_items": items}
                if not model_id:
                    model_id = "sample_relational"
                    _relational_models[model_id] = (learned_model, real_tables)

        tables = generate_relational(
            template=template,
            customer_count=customer_count,
            seed=seed,
            locale=locale,
            learned_model=learned_model,
        )

        # Run referential integrity validation
        validation = run_relational_validation(tables)

        # Comparison table (real vs synthetic) if learned mode was used
        comparison = None
        if real_tables is not None:
            comparison = compare_relational_datasets(real_tables, tables)

        # Convert to preview
        previews = {}
        for name, df in tables.items():
            previews[name] = {
                "columns": list(df.columns),
                "rows": df.head(min(len(df), 500)).replace({np.nan: None}).to_dict(orient='records'),
                "total_rows": len(df),
            }

        elapsed = (time.time() - start) * 1000
        total_rows = sum(len(df) for df in tables.values())
        audit_logger.log_event(
            "/api/v1/relational/generate",
            row_count=total_rows,
            execution_time_ms=elapsed,
            extra={"tables": len(tables), "is_learned": learned_model is not None},
        )

        return {
            "tables": previews,
            "validation": validation,
            "comparison": comparison,
            "seed": seed,
            "is_learned": learned_model is not None,
            "model_id": model_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/relational/export")
@app.post("/api/v1/relational/export")
async def relational_export(request: Request):
    """Export relational data as ZIP of CSVs + SQL dump."""
    start = time.time()
    try:
        body = await request.json()
        customer_count = validate_row_count(body.get("customer_count", 50))
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        fmt = body.get("format", "zip")
        use_learned = body.get("use_learned", False)
        model_id = body.get("model_id", "")

        learned_model = None
        if use_learned or model_id:
            if model_id and model_id in _relational_models:
                learned_model, _ = _relational_models[model_id]
            else:
                cust, ords, items = load_built_in_relational_sample()
                learned_model = learn_relational_distributions(cust, ords, items)

        tables = generate_relational(
            customer_count=customer_count,
            seed=seed,
            locale=locale,
            learned_model=learned_model,
        )

        elapsed = (time.time() - start) * 1000
        total_rows = sum(len(df) for df in tables.values())
        audit_logger.log_event("/api/v1/relational/export", row_count=total_rows, execution_time_ms=elapsed)

        if fmt == "sql":
            sql = generate_sql_dump(tables)
            return StreamingResponse(
                io.BytesIO(sql.encode()),
                media_type="application/sql",
                headers={"Content-Disposition": "attachment; filename=relational_data.sql"},
            )
        else:
            zip_bytes = export_relational_zip(tables)
            return StreamingResponse(
                io.BytesIO(zip_bytes),
                media_type="application/zip",
                headers={"Content-Disposition": "attachment; filename=relational_data.zip"},
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  DOCUMENTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.post("/api/v1/documents/invoice/generate")
async def invoice_generate(request: Request):
    """Generate an invoice and return data + HTML preview."""
    start = time.time()
    try:
        body = await request.json()
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        n_items = body.get("n_items", 0)
        discount_pct = body.get("discount_pct", 0)

        invoice = generate_invoice_data(seed=seed, locale=locale, n_items=n_items, discount_pct=discount_pct)
        html = render_invoice_html(invoice)

        elapsed = (time.time() - start) * 1000
        audit_logger.log_event("/api/v1/documents/invoice/generate", row_count=len(invoice['items']), execution_time_ms=elapsed)

        return {
            "invoice": invoice,
            "html_preview": html,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/documents/invoice/export")
async def invoice_export(request: Request):
    """Export invoice as PDF or bulk as ZIP."""
    start = time.time()
    try:
        body = await request.json()
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        count = body.get("count", 1)
        fmt = body.get("format", "pdf")

        if count > 1:
            zip_bytes, invoices = generate_bulk_invoices(count=min(count, 50), seed=seed, locale=locale)
            elapsed = (time.time() - start) * 1000
            audit_logger.log_event("/api/v1/documents/invoice/export", row_count=count, execution_time_ms=elapsed)
            return StreamingResponse(
                io.BytesIO(zip_bytes),
                media_type="application/zip",
                headers={"Content-Disposition": f"attachment; filename=invoices_{count}.zip"},
            )
        else:
            invoice = generate_invoice_data(seed=seed, locale=locale)

            if fmt == "json":
                content = json.dumps(invoice, indent=2, default=str)
                return StreamingResponse(
                    io.BytesIO(content.encode("utf-8")),
                    media_type="application/json; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{invoice["invoice_number"]}.json"'},
                )
            else:
                pdf_bytes = render_invoice_pdf(invoice)
                elapsed = (time.time() - start) * 1000
                audit_logger.log_event("/api/v1/documents/invoice/export", row_count=1, execution_time_ms=elapsed)
                return StreamingResponse(
                    io.BytesIO(pdf_bytes),
                    media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={invoice['invoice_number']}.pdf"},
                )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/documents/clone")
async def document_clone(file: UploadFile = File(...), seed: int = Form(42)):
    """
    Accept an uploaded PDF or document, inspect its content/structure,
    and generate a synthetic PDF clone immediately.
    """
    start = time.time()
    try:
        contents = await file.read()
        result = mimic_invoice_from_file(contents=contents, filename=file.filename or "uploaded.pdf", seed=seed)
        elapsed = (time.time() - start) * 1000
        audit_logger.log_event("/api/v1/documents/clone", row_count=result.get('item_count', 1), execution_time_ms=elapsed)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/documents/clone/export")
async def document_clone_export(file: UploadFile = File(...), seed: int = Form(42)):
    """
    Accept an uploaded PDF, generate the synthetic cloned PDF, and return it directly as a downloadable PDF.
    """
    try:
        import base64
        contents = await file.read()
        result = mimic_invoice_from_file(contents=contents, filename=file.filename or "uploaded.pdf", seed=seed)
        pdf_bytes = base64.b64decode(result['pdf_base64'])
        inv_num = result.get('invoice', {}).get('invoice_number', 'cloned_doc')
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={inv_num}.pdf"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/documents/statement/generate")
async def statement_generate(request: Request):
    """Generate a bank statement and return data + HTML preview."""
    start = time.time()
    try:
        body = await request.json()
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        n_transactions = body.get("n_transactions", 30)
        opening_balance = body.get("opening_balance", 5000.0)
        days = body.get("days", 90)
        allow_overdraft = body.get("allow_overdraft", False)
        salary_on_1st = body.get("salary_on_1st", False)

        statement = generate_bank_statement(
            seed=seed, locale=locale, n_transactions=n_transactions,
            opening_balance=opening_balance, days=days,
            allow_overdraft=allow_overdraft, salary_on_1st=salary_on_1st,
        )
        html = render_statement_html(statement)

        # Run balance validation
        txn_df = pd.DataFrame(statement['transactions'])
        balance_check = check_running_balance(
            txn_df, statement['opening_balance'], allow_overdraft=allow_overdraft
        )

        elapsed = (time.time() - start) * 1000
        audit_logger.log_event("/api/v1/documents/statement/generate", row_count=len(statement['transactions']), execution_time_ms=elapsed)

        return {
            "statement": statement,
            "html_preview": html,
            "balance_validation": balance_check,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/documents/statement/export")
async def statement_export(request: Request):
    """Export bank statement as PDF, CSV, or JSON."""
    start = time.time()
    try:
        body = await request.json()
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        n_transactions = body.get("n_transactions", 30)
        opening_balance = body.get("opening_balance", 5000.0)
        days = body.get("days", 90)
        fmt = body.get("format", "pdf")
        allow_overdraft = body.get("allow_overdraft", False)
        salary_on_1st = body.get("salary_on_1st", False)

        statement = generate_bank_statement(
            seed=seed, locale=locale, n_transactions=n_transactions,
            opening_balance=opening_balance, days=days,
            allow_overdraft=allow_overdraft, salary_on_1st=salary_on_1st,
        )

        elapsed = (time.time() - start) * 1000
        audit_logger.log_event("/api/v1/documents/statement/export", row_count=len(statement['transactions']), execution_time_ms=elapsed)

        if fmt == "json":
            content = json.dumps(statement, indent=2, default=str)
            return StreamingResponse(
                io.BytesIO(content.encode("utf-8")),
                media_type="application/json; charset=utf-8",
                headers={"Content-Disposition": 'attachment; filename="bank_statement.json"'},
            )
        elif fmt == "csv":
            df = pd.DataFrame(statement['transactions'])
            csv = df.to_csv(index=False)
            return StreamingResponse(
                io.BytesIO(csv.encode()),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=bank_statement.csv"},
            )
        else:
            pdf_bytes = render_statement_pdf(statement)
            return StreamingResponse(
                io.BytesIO(pdf_bytes),
                media_type="application/pdf",
                headers={"Content-Disposition": "attachment; filename=bank_statement.pdf"},
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  AI / LLM
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.post("/api/v1/ai/infer-schema")
async def ai_infer_schema(request: Request):
    """Use LLM to infer a table schema from natural language."""
    try:
        body = await request.json()
        description = body.get("description", "")
        if not description:
            raise HTTPException(status_code=400, detail="Description is required.")

        result = infer_schema(description)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/ai/content-pool")
async def ai_content_pool(request: Request):
    """Get a pool of realistic content items from LLM or fallback."""
    try:
        body = await request.json()
        pool_type = body.get("pool_type", "merchant")
        count = min(body.get("count", 100), 200)

        result = get_content_pool(pool_type, count)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/ai/edge-cases")
async def ai_edge_cases(request: Request):
    """Get edge case suggestions for a schema."""
    try:
        body = await request.json()
        schema = body.get("schema", [])
        if not schema:
            raise HTTPException(status_code=400, detail="Schema is required.")

        result = suggest_edge_cases(schema)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ADMIN & SECURITY
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.post("/api/v1/admin/auth")
async def admin_auth(request: Request):
    """Authenticate with admin secret."""
    body = await request.json()
    secret = body.get("secret", "")
    if verify_admin(secret):
        return {"authenticated": True}
    raise HTTPException(status_code=401, detail="Invalid admin secret")


@app.get("/api/v1/admin/health")
async def admin_health():
    """Get system health metrics."""
    try:
        process = psutil.Process()
        mem = process.memory_info()
        return {
            "memory_mb": round(mem.rss / 1024 / 1024, 1),
            "memory_pct": round(process.memory_percent(), 1),
            "cpu_pct": round(process.cpu_percent(interval=0.1), 1),
            "rate_limiter": rate_limiter.get_status(),
            "cache_stats": get_cache_stats(),
            "audit_stats": audit_logger.get_stats(),
        }
    except Exception:
        return {
            "memory_mb": 0,
            "memory_pct": 0,
            "cpu_pct": 0,
            "rate_limiter": rate_limiter.get_status(),
            "cache_stats": get_cache_stats(),
            "audit_stats": audit_logger.get_stats(),
        }


@app.get("/api/v1/admin/audit-log")
async def admin_audit_log():
    """Get recent audit log entries."""
    return {
        "entries": audit_logger.get_recent(50),
        "stats": audit_logger.get_stats(),
    }


@app.post("/api/v1/admin/api-keys/generate")
async def admin_generate_key(request: Request):
    """Generate a new test API key."""
    body = await request.json()
    label = body.get("label", "default")
    key_data = api_key_manager.generate_key(label)
    return key_data


@app.get("/api/v1/admin/api-keys")
async def admin_list_keys():
    """List all API keys."""
    return {"keys": api_key_manager.list_keys()}


@app.post("/api/v1/admin/api-keys/revoke")
async def admin_revoke_key(request: Request):
    """Revoke an API key."""
    body = await request.json()
    key = body.get("key", "")
    if api_key_manager.revoke_key(key):
        return {"revoked": True}
    raise HTTPException(status_code=404, detail="Key not found")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  SERVE REACT FRONTEND (production build)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if FRONTEND_DIR.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIR / "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = FRONTEND_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_DIR / "index.html"))


# ── Entry point ──
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
