"""Public courier webhook endpoint (Shiprocket tracking updates). Filled in by the Shiprocket feature."""
from fastapi import APIRouter

router = APIRouter(tags=["shipping"])
