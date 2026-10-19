from fastapi import APIRouter

from app.routers.admin import catalog, management, operations, settlements, shipping

router = APIRouter(prefix="/admin", tags=["admin"])
router.include_router(catalog.router)
router.include_router(operations.router)
router.include_router(management.router)
router.include_router(shipping.router)
router.include_router(settlements.router)
