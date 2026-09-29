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

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import pandas as pd
import numpy as np
import json

load_dotenv()

# Local imports
from profiler import read_uploaded_file, profile_dataframe
from tabular import generate_tabular
from privacy import apply_privacy
from quality import compare_datasets
from relational import generate_relational, export_relational_zip, generate_sql_dump, DEFAULT_TEMPLATE
from documents import (
    generate_invoice_data, render_invoice_pdf, render_invoice_html,
    generate_bank_statement, render_statement_pdf, render_statement_html,
    generate_bulk_invoices,
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
)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecureHeadersMiddleware)


# ── In-memory storage for uploaded profiles ──
_uploaded_profiles: dict[str, dict] = {}  # session_key -> {df, schema}


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

        # Store for later use
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
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not process file: {str(e)}")


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

        if not schema:
            raise HTTPException(status_code=400, detail="Schema is required.")

        df = generate_tabular(
            schema=schema,
            row_count=row_count,
            seed=seed,
            locale=locale,
            null_rate=null_rate,
            outlier_rate=outlier_rate,
        )

        # Apply privacy if rules provided
        has_privacy = len(privacy_rules) > 0
        if has_privacy:
            df = apply_privacy(df, privacy_rules, seed=seed)

        # Return preview (first 20 rows)
        preview = df.head(20).replace({np.nan: None}).to_dict(orient='records')
        columns = list(df.columns)

        elapsed = (time.time() - start) * 1000
        audit_logger.log_event(
            "/api/v1/tabular/generate",
            row_count=row_count,
            privacy_noise=has_privacy,
            execution_time_ms=elapsed,
        )

        return {
            "preview": preview,
            "columns": columns,
            "total_rows": row_count,
            "seed": seed,
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
        fmt = body.get("format", "csv")

        if not schema:
            raise HTTPException(status_code=400, detail="Schema is required.")

        df = generate_tabular(
            schema=schema,
            row_count=row_count,
            seed=seed,
            locale=locale,
            null_rate=null_rate,
            outlier_rate=outlier_rate,
        )

        if privacy_rules:
            df = apply_privacy(df, privacy_rules, seed=seed)

        elapsed = (time.time() - start) * 1000
        audit_logger.log_event(
            "/api/v1/tabular/export",
            row_count=row_count,
            privacy_noise=len(privacy_rules) > 0,
            execution_time_ms=elapsed,
        )

        if fmt == "json":
            data = df.replace({np.nan: None}).to_dict(orient='records')
            content = json.dumps(data, indent=2, default=str)
            return StreamingResponse(
                io.BytesIO(content.encode()),
                media_type="application/json",
                headers={"Content-Disposition": "attachment; filename=synthetic_data.json"},
            )
        elif fmt == "excel":
            buf = io.BytesIO()
            df.to_excel(buf, index=False, engine='openpyxl')
            buf.seek(0)
            return StreamingResponse(
                buf,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": "attachment; filename=synthetic_data.xlsx"},
            )
        else:  # csv
            content = df.to_csv(index=False)
            return StreamingResponse(
                io.BytesIO(content.encode()),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=synthetic_data.csv"},
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

        if not schema:
            raise HTTPException(status_code=400, detail="Schema is required.")

        # Generate synthetic data
        synth_df = generate_tabular(schema=schema, row_count=row_count, seed=seed, locale=locale)

        # Get original data
        if session_key and session_key in _uploaded_profiles:
            real_df = _uploaded_profiles[session_key]['df']
        else:
            # Use the same schema to generate a "real" baseline
            real_df = generate_tabular(schema=schema, row_count=row_count, seed=seed + 1, locale=locale)

        report = compare_datasets(real_df, synth_df, schema)
        return report

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  RELATIONAL
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@app.post("/api/v1/relational/generate")
async def relational_generate(request: Request):
    """Generate relational datasets with referential integrity."""
    start = time.time()
    try:
        body = await request.json()
        customer_count = validate_row_count(body.get("customer_count", 50))
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        template = body.get("template")  # Custom template or None for default

        tables = generate_relational(
            template=template,
            customer_count=customer_count,
            seed=seed,
            locale=locale,
        )

        # Run validation
        validation = run_relational_validation(tables)

        # Convert to preview
        previews = {}
        for name, df in tables.items():
            previews[name] = {
                "columns": list(df.columns),
                "rows": df.head(20).replace({np.nan: None}).to_dict(orient='records'),
                "total_rows": len(df),
            }

        elapsed = (time.time() - start) * 1000
        total_rows = sum(len(df) for df in tables.values())
        audit_logger.log_event(
            "/api/v1/relational/generate",
            row_count=total_rows,
            execution_time_ms=elapsed,
            extra={"tables": len(tables)},
        )

        return {
            "tables": previews,
            "validation": validation,
            "seed": seed,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/relational/export")
async def relational_export(request: Request):
    """Export relational data as ZIP of CSVs + SQL dump."""
    start = time.time()
    try:
        body = await request.json()
        customer_count = validate_row_count(body.get("customer_count", 50))
        seed = body.get("seed", 42)
        locale = body.get("locale", "en_US")
        fmt = body.get("format", "zip")  # zip or sql

        tables = generate_relational(customer_count=customer_count, seed=seed, locale=locale)

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
                return JSONResponse(invoice)
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
            return JSONResponse(statement)
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
