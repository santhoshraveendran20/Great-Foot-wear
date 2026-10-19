"""Public CMS content: static pages, store settings, sitemap (AD-12, NF-06, NF-09)."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.models import Category, Page, Product
from app.services.store_settings import public_settings

router = APIRouter(tags=["content"])

STATIC_PAGES = ("about", "contact", "shipping", "returns", "privacy", "terms")


@router.get("/content/settings")
def store_settings(db: Session = Depends(get_db)):
    return public_settings(db)


@router.get("/content/pages/{slug}")
def page(slug: str, db: Session = Depends(get_db)):
    p = db.scalar(select(Page).where(Page.slug == slug))
    if not p:
        raise HTTPException(404, "Page not found")
    return {"slug": p.slug, "title": p.title, "content": p.content, "updated_at": p.updated_at}


def sitemap_xml(db: Session) -> str:
    base = settings.FRONTEND_URL.rstrip("/")
    urls = [f"{base}/"] + [f"{base}/{s}" for s in STATIC_PAGES]
    urls += [f"{base}/category/{slug}" for slug in db.scalars(select(Category.slug).where(Category.is_active.is_(True)))]
    urls += [f"{base}/product/{slug}" for slug in db.scalars(select(Product.slug).where(Product.is_active.is_(True)))]
    body = "".join(f"<url><loc>{u}</loc></url>" for u in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>'


@router.get("/sitemap.xml", include_in_schema=False)
def sitemap(db: Session = Depends(get_db)):
    return Response(sitemap_xml(db), media_type="application/xml")
