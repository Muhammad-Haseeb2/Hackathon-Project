# Synthetic Data Platform — 3-Minute Hackathon Demo Script

## Overview
- **Duration**: 3 Minutes
- **URL**: Your deployed Render URL (or `http://localhost:5173`)
- **Key Message**: Zero real data stored, mathematical correctness guaranteed, instant browser streaming, production-ready privacy controls.

---

## 3-Minute Demo Flow

### 0:00 – 0:30 | The Problem & Architecture (Hook)
> *"Modern engineering and AI teams face three painful bottlenecks: stringent GDPR/HIPAA compliance, agonizingly slow data procurement cycles, and synthetic data tools that either hallucinate foreign keys or require heavy GPUs.*
>
> *Today, we present the **Synthetic Data Platform**: a lightweight, privacy-safe platform that runs on standard CPU, guarantees strict mathematical and relational integrity, and never persists a single byte of real or synthetic data."*

---

### 0:30 – 1:05 | Tabular Engine with Differential Privacy & Quality
1. **Click Tabular Tab**.
2. Click the preset: **"🛒 E-commerce Customers"** or **"🏥 HIPAA Masked Dataset"**.
3. Point out the schema configuration:
   - *"Notice how column types are intelligently mapped—from identity columns like names and emails to statistical distributions for age and balances."*
4. Apply Privacy Rules:
   - Set `email` to **Mask** (`j****n@example.com`).
   - Set `total_spent` / `blood_pressure` to **Laplace Noise** (set $\epsilon = 0.5$).
5. Click **Generate Preview**:
   - Show the live preview table with masked emails and noised numbers.
6. Click **Quality Report**:
   - Highlight the Similarity Score (e.g. 94%), Wasserstein/KS distance, and distribution preservation.
7. Click **Export CSV / JSON / Excel** to show instant streaming download.

---

### 1:05 – 1:40 | Relational Engine with Zero-Orphan Mathematical Verification
1. **Click Relational Tab**.
2. Explain the schema: `Customers (1) ──▶ Orders (1..N) ──▶ Order Items (1..N)`.
3. Set Customer Count to `50` and click **Generate Relational Data**.
4. Switch between the sub-tabs: `Customers`, `Orders`, `Order Items`.
5. Point to the **green "Integrity Verified" badge**:
   - *"Here is our core technical differentiator: Foreign keys are strictly validated. Zero orphan rows exist in child tables. Furthermore, every order total mathematically equals `sum(line items) - discount + tax`."*
6. Click **Export ZIP (CSVs)** or **Export SQLite SQL Dump** with DDL constraints.

---

### 1:40 – 2:15 | Document Engine: Invoices & Reconciled Bank Statements
1. **Click Documents Tab**.
2. **Invoice Demo**:
   - Select Locale: switch between `US ($)`, `UK (£)`, `Pakistan (Rs.)`, `EU (€)`.
   - Click **Generate Invoice**: show HTML preview with computed line items, tax rate, and total.
   - Click **Export PDF** (generated in-memory with ReportLab).
3. **Bank Statement Demo**:
   - Toggle to **Bank Statement**.
   - Show structured parameters: *Opening balance $5,000, 30 transactions, 90 days*.
   - Click **Generate Statement**:
   - Highlight the ledger balance reconciliation badge:
     $$\text{Balance}_t = \text{Balance}_{t-1} + \text{Credit}_t - \text{Debit}_t$$
   - Emphasize that overdraft prevention is enforced mathematically in code.

---

### 2:15 – 2:40 | AI Schema Inference & Offline Graceful Fallback
1. Go back to Tabular -> click **AI Assistant Prompt**.
2. Enter: *"500 IoT cold-storage temperature readings with device_id, warehouse_location, temp_celsius, and warning_alert"*.
3. Click **Infer Schema with AI**:
   - Watch Gemini return a structured typed schema ready for generation.
4. Highlight the **"AI" / "Offline Fallback" badge**:
   - *"If API keys expire or rate limits hit, the system automatically falls back to our offline deterministic generators without throwing a 500 error."*

---

### 2:40 – 3:00 | Admin & Security Governance (Zero-PII Audit)
1. **Click Admin & Security Tab**.
2. Unlock with passcode (`admin123`).
3. **Telemetry Overview**:
   - Show live memory usage (<150 MB RSS), rate limiter (60 req/min per IP), and LLM cache hit ratio.
4. **Developer API Key**:
   - Generate `sk_test_...` key in 1 click for CI/CD pipelines.
5. **Ephemeral Audit Log**:
   - Show real-time activity log capturing timestamps, endpoints, row counts, and privacy noise status.
   - Point out: **Zero PII retained, ephemeral sliding window in RAM only.**

---

## 3 Tested Presets for Live Testing

1. **Preset 1 (E-commerce & Analytics)**:
   - Preset: "🛒 E-commerce Customers"
   - Seed: `42`
   - Row count: `100`
   - Privacy: Mask email, Laplace noise on `total_spent`
2. **Preset 2 (FinTech & Banking Audit)**:
   - Preset: "💰 FinTech Transactions"
   - Seed: `123`
   - Tab: Relational or Documents (Monthly Bank Statement)
   - Parameters: 40 transactions, opening balance $10,000, salary on 1st enabled
3. **Preset 3 (Regulated Healthcare / HIPAA)**:
   - Preset: "🏥 HIPAA Masked Dataset"
   - Seed: `99`
   - Privacy: Pseudonymize patient name, mask phone/email, noise blood pressure
