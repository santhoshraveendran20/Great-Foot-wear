"""Admin: Shiprocket courier actions on an order (create shipment + AWB, pickup, label, tracking).
Filled in by the Shiprocket feature."""
from fastapi import APIRouter, Depends

from app.core.deps import staff_or_admin

router = APIRouter(dependencies=[Depends(staff_or_admin)])
