# Synthetic Data Platform

A realistic, privacy-safe synthetic data platform with zero real data stored. Features four unified workspaces: **Tabular Data**, **Relational Databases**, **Documents (Invoices & Bank Statements)**, and an **Admin & Security Governance Panel**.

---

## Key Features & Guarantees

1. **Hybrid Core Architecture**:
   - Offline generators (Faker, NumPy, Pandas, ReportLab) handle 100% of data synthesis.
   - LLM (Google Gemini API free tier) is used strictly for schema inference, natural language translation, and pool generation.
   - Built-in offline fallback ensures uninterrupted generation even if the LLM API is unavailable or rate-limited.
2. **Mathematical Correctness**:
   - Zero-orphan foreign keys guaranteed across parents and children.
   - Order totals strictly equal `sum(qty * unit_price) - discount + tax`.
   - Bank ledger reconciles strictly: `Balance_t = Balance_{t-1} + Credit - Debit`.
3. **Differential Privacy & Masking**:
   - Pattern-preserving masking (`j****n@example.com`, `****-****-1234`).
   - Salted SHA-256 deterministic pseudonymization.
   - Controlled Laplacian noise scaled to column sensitivity ($x' = x + \text{Laplace}(0, \text{sensitivity}/\epsilon)$).
4. **Zero-PII Ephemeral Policy**:
   - No persistent disk storage. Generated CSV, JSON, SQL, PDF, and ZIP files stream directly to the browser.
   - Sliding-window in-memory rate limiting and audit logging.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    React + Vite Frontend                    │
│   (Tabular │ Relational │ Documents │ Admin & Security)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON / Streams
┌──────────────────────────────▼──────────────────────────────┐
│                    FastAPI Backend Engine                    │
│   ├── Security & Governance (Rate Limiter, Audit, Keys)     │
│   ├── Tabular Profiler & Generator (Faker / NumPy)          │
│   ├── Privacy Engine (Laplace Noise, Masking, Hashing)      │
│   ├── Relational Engine & Integrity Validator               │
│   ├── Document Engine (ReportLab PDF, Running Balance)      │
│   └── LLM Gateway (Gemini API with Fallback & Cache)        │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start (Local Development)

### Prerequisites
- Python 3.11+
- Node.js 20+

### 1. Environment Setup
```bash
cp .env.example .env
```
Edit `.env`:
```ini
GEMINI_API_KEY=your_gemini_api_key_here
ADMIN_SECRET_KEY=admin123
```

### 2. Backend
```bash
# Install dependencies
pip install -r requirements.txt

# Run server
cd backend
python main.py
```
Backend runs at `http://localhost:8000`.

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
Frontend runs at `http://localhost:5173`.

---

## Automated Verification Suite

Run all mathematical, relational, privacy, and security checks:
```bash
python -m unittest backend/tests/test_platform.py -v
```

---

## Deployment to Render (Free Web Service)

1. Push your repository to GitHub.
2. In [Render Dashboard](https://dashboard.render.com), click **New +** -> **Web Service** and connect this repository.
3. Render automatically picks up `render.yaml`:
   - **Build Command**: `pip install -r requirements.txt && cd frontend && npm install && npm run build`
   - **Start Command**: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Set Environment Variables in Render:
   - `GEMINI_API_KEY`: Your Google Gemini API key (optional, graceful fallback enabled).
   - `ADMIN_SECRET_KEY`: Passcode for the Admin & Security panel.
   - `PYTHON_VERSION`: `3.11.9`
   - `NODE_VERSION`: `20.17.0`

> **Note on Free Hosts (Keep-Alive)**: Free-tier web services on Render spin down after 15 minutes of inactivity. For live hackathon demos, please open the public URL 2–3 minutes before presenting to wake up the container.

---

## Programmatic Developer API

Developer keys (`sk_test_...`) can be generated from the **Admin & Security** tab.

### Authentication Header
Pass your test key with the `X-API-KEY` header or authorization Bearer token:
```bash
curl -X POST https://your-app.onrender.com/api/v1/tabular/generate \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: sk_test_your_generated_key" \
  -d '{
    "schema": [
      {"name": "user_id", "type": "id"},
      {"name": "full_name", "type": "name"},
      {"name": "email", "type": "email"}
    ],
    "row_count": 25,
    "seed": 42
  }'
```

---

## Future Roadmap

- [ ] **CTGAN & Copula Synthesis**: Optional self-hosted models for non-linear correlation preservation.
- [ ] **Background Worker Queues**: Celery / Redis integration for multi-million-row exports.
- [ ] **Cloud Storage Connectors**: S3 / GCS presigned URLs for enterprise bulk drops.
- [ ] **Local Ollama Integration**: Fully air-gapped on-premise LLM inference.
