import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.routers import admin, auth, cart, catalog, content, orders, shipping, users
from app.services import settlements
from app.services.media import media_root
from app.services.orders import expire_reservations_job

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("gfw")


async def _reservation_worker():
    """PY-06: release stock of unpaid orders after 15 minutes."""
    while True:
        await asyncio.to_thread(expire_reservations_job)
        await asyncio.sleep(60)


async def _settlement_worker():
    """PY-10: keep Razorpay settlement data fresh for the daily reconciliation report."""
    while True:
        await asyncio.to_thread(settlements.sync_job)
        await asyncio.sleep(6 * 3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [asyncio.create_task(_reservation_worker()), asyncio.create_task(_settlement_worker())]
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(
    title="Great Foot Wear API",
    version="1.0.0",
    description="E-commerce backend for Great Foot Wear, Manali, Chennai.",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    """NF-07 clear error messages."""
    errors = []
    for e in exc.errors():
        field = ".".join(str(p) for p in e.get("loc", []) if p not in ("body", "query", "path"))
        msg = e.get("msg", "Invalid value").removeprefix("Value error, ")
        errors.append({"field": field, "message": msg})
    first = errors[0] if errors else {"field": "", "message": "Invalid request"}
    detail = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
    return JSONResponse(status_code=422, content={"detail": detail, "errors": errors})


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong. Please try again."})


api_routers = [
    auth.router, users.router, catalog.router, cart.router, orders.router, content.router, shipping.router, admin.router,
]
for r in api_routers:
    app.include_router(r, prefix="/api")

app.mount(settings.MEDIA_URL, StaticFiles(directory=str(media_root())), name="media")


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok"}
