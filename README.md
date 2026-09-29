# Synthetic Data Platform

Generate realistic, privacy-safe synthetic data with zero real data stored.

## Quick Start (Local)

### Prerequisites
- Python 3.11+
- Node.js 20+

### Backend
```bash
cd backend
pip install -r ../requirements.txt
cp ../.env.example ../.env   # Fill in your keys
python main.py
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Deploy to Render
1. Push to GitHub
2. Connect repo in Render dashboard
3. Set env vars: `GEMINI_API_KEY`, `ADMIN_SECRET_KEY`
4. Deploy — Render uses `render.yaml` automatically

## Architecture
```
Browser  ──▶  FastAPI (serves React + API)
                ├── /api/health
                ├── /api/v1/tabular/*
                ├── /api/v1/relational/*
                ├── /api/v1/documents/*
                └── /api/v1/admin/*
```

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | No | Google Gemini API key (AI features) |
| `ADMIN_SECRET_KEY` | Yes | Admin panel access key |
| `PORT` | Auto | Set by Render |
