"""Vercel entrypoint: exposes the FastAPI app that lives in backend/main.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from main import app  # noqa: E402,F401
