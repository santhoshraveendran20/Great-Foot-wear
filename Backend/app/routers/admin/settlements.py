"""Admin: Razorpay settlements sync and listing (PY-10). Super Admin only (AD-09).
Filled in by the settlements feature."""
from fastapi import APIRouter, Depends

from app.core.deps import admin_only

router = APIRouter(dependencies=[Depends(admin_only)])
