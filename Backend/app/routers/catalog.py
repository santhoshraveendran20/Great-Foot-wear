"""/catalog — home, categories, brands, product listing with filters/sort/search,
product detail, PIN code check, reviews, "Notify me" stock alerts (CT-01 … CT-10)."""
import math
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field, field_validator
from rapidfuzz import fuzz, process
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import bearer, get_current_user, get_customer, get_optional_user
from app.core.ratelimit import rate_limit
from app.db import get_db
from app.models import (
    Banner,
    Brand,
    Category,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductVariant,
    Review,
    Role,
    StockAlert,
    User,
)
from app.schemas import MOBILE, ReviewIn
from app.serializers import brand_out, category_out, product_card, product_detail, review_out
from app.services.pricing import check_pincode

router = APIRouter(prefix="/catalog", tags=["catalog"])

PAGE_SIZE = 24  # CT-02
FUZZY_THRESHOLD = 72


def _load_opts():
    return (
        selectinload(Product.images),
        selectinload(Product.variants),
        selectinload(Product.brand),
        selectinload(Product.category),
    )


def _active_products():
    return select(Product).where(Product.is_active.is_(True))


def _category_ids_with_children(db: Session, root: Category) -> list[int]:
    cats = db.scalars(select(Category).where(Category.is_active.is_(True))).all()
    ids, frontier = {root.id}, [root.id]
    while frontier:
        nxt = [c.id for c in cats if c.parent_id in frontier and c.id not in ids]
        ids.update(nxt)
        frontier = nxt
    return list(ids)


def _search_ids(db: Session, q: str) -> list[int]:
    """CT-05: name / brand / category search, typo tolerant (fuzzy) — ranked by relevance."""
    rows = db.execute(
        select(Product.id, Product.name, Brand.name, Category.name, Product.tags)
        .outerjoin(Brand, Brand.id == Product.brand_id)
        .outerjoin(Category, Category.id == Product.category_id)
        .where(Product.is_active.is_(True))
    ).all()
    if not rows:
        return []
    corpus = {r[0]: " ".join(x for x in r[1:] if x).lower() for r in rows}
    query = q.strip().lower()
    scored = []
    for pid, text in corpus.items():
        if query in text:
            scored.append((pid, 100.0))
            continue
        score = max(fuzz.partial_ratio(query, text), fuzz.token_set_ratio(query, text))
        if score >= FUZZY_THRESHOLD:
            scored.append((pid, score))
    scored.sort(key=lambda x: -x[1])
    return [pid for pid, _ in scored]


@router.get("/home")
def home(db: Session = Depends(get_db)):
    """CT-01: banners/offers, categories, new arrivals, best sellers."""
    banners = db.scalars(select(Banner).where(Banner.is_active.is_(True)).order_by(Banner.sort_order, Banner.id)).all()
    cats = db.scalars(
        select(Category).where(Category.is_active.is_(True), Category.parent_id.is_(None)).order_by(Category.sort_order, Category.name)
    ).all()
    new_arrivals = db.scalars(_active_products().options(*_load_opts()).order_by(Product.created_at.desc(), Product.id.desc()).limit(8)).all()
    best = db.scalars(
        _active_products().options(*_load_opts()).where(Product.sold_count > 0).order_by(Product.sold_count.desc()).limit(8)
    ).all()
    return {
        "banners": [
            {"id": b.id, "kind": b.kind, "title": b.title, "subtitle": b.subtitle, "image_url": b.image_url, "link_url": b.link_url}
            for b in banners
        ],
        "categories": [category_out(c) for c in cats],
        "new_arrivals": [product_card(p) for p in new_arrivals],
        "best_sellers": [product_card(p) for p in best],
    }


@router.get("/categories")
def categories(db: Session = Depends(get_db)):
    rows = db.scalars(select(Category).where(Category.is_active.is_(True)).order_by(Category.sort_order, Category.name)).all()
    return [category_out(c) for c in rows]


@router.get("/brands")
def brands(db: Session = Depends(get_db)):
    rows = db.scalars(select(Brand).where(Brand.is_active.is_(True)).order_by(Brand.name)).all()
    return [brand_out(b) for b in rows]


@router.get("/products")
def list_products(
    db: Session = Depends(get_db),
    category: str | None = None,
    brand: list[str] = Query(default=[]),
    size: list[str] = Query(default=[]),
    colour: list[str] = Query(default=[]),
    gender: list[str] = Query(default=[]),
    material: list[str] = Query(default=[]),
    price_min: Decimal | None = Query(default=None, ge=0),
    price_max: Decimal | None = Query(default=None, ge=0),
    discount_min: int | None = Query(default=None, ge=0, le=100),
    rating_min: float | None = Query(default=None, ge=0, le=5),
    q: str | None = Query(default=None, max_length=100),
    sort: str = Query(default="popularity", pattern="^(popularity|newest|price_asc|price_desc|discount|relevance)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=PAGE_SIZE, ge=1, le=60),
):
    """CT-02 pagination (24/page), CT-03 filters, CT-04 sort, CT-05 search."""
    stmt = _active_products()
    current_category = None
    if category:
        current_category = db.scalar(select(Category).where(Category.slug == category, Category.is_active.is_(True)))
        if not current_category:
            raise HTTPException(404, "Category not found")
        stmt = stmt.where(Product.category_id.in_(_category_ids_with_children(db, current_category)))

    search_order: list[int] | None = None
    if q and q.strip():
        search_order = _search_ids(db, q)
        stmt = stmt.where(Product.id.in_(search_order or [-1]))

    # facets are computed on the category/search scope, before the remaining filters
    scope = stmt.subquery()
    scope_ids = select(scope.c.id)
    scope_variant = and_(ProductVariant.product_id.in_(scope_ids), ProductVariant.is_active.is_(True))
    facets = {
        "brands": [
            {"slug": s, "name": n}
            for s, n in db.execute(
                select(Brand.slug, Brand.name).join(Product, Product.brand_id == Brand.id)
                .where(Product.id.in_(scope_ids)).distinct().order_by(Brand.name)
            ).all()
        ],
        "sizes": sorted(
            db.scalars(select(ProductVariant.size).where(scope_variant).distinct()).all(),
            key=lambda s: (float(s) if s.replace(".", "", 1).isdigit() else math.inf, s),
        ),
        "colours": sorted(db.scalars(select(ProductVariant.colour).where(scope_variant).distinct()).all()),
        "materials": sorted(
            m for m in db.scalars(select(Product.material).where(Product.id.in_(scope_ids)).distinct()).all() if m
        ),
        "genders": sorted(g for g in db.scalars(select(Product.gender).where(Product.id.in_(scope_ids)).distinct()).all() if g),
        "price": dict(zip(("min", "max"), db.execute(
            select(func.min(Product.price), func.max(Product.price)).where(Product.id.in_(scope_ids))
        ).one())),
    }

    if brand:
        stmt = stmt.where(Product.brand_id.in_(select(Brand.id).where(Brand.slug.in_(brand))))
    if gender:
        stmt = stmt.where(Product.gender.in_(gender))
    if material:
        stmt = stmt.where(Product.material.in_(material))
    if price_min is not None:
        stmt = stmt.where(Product.price >= price_min)
    if price_max is not None:
        stmt = stmt.where(Product.price <= price_max)
    discount_expr = (Product.mrp - Product.price) * 100 / Product.mrp
    if discount_min:
        stmt = stmt.where(discount_expr >= discount_min)
    if rating_min:
        stmt = stmt.where(Product.rating_avg >= rating_min)
    if size or colour:
        conds = [ProductVariant.is_active.is_(True), ProductVariant.stock_qty > 0]
        if size:
            conds.append(ProductVariant.size.in_(size))
        if colour:
            conds.append(ProductVariant.colour.in_(colour))
        stmt = stmt.where(Product.id.in_(select(ProductVariant.product_id).where(*conds)))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    if sort == "relevance" and search_order:
        order_by = [case({pid: i for i, pid in enumerate(search_order)}, value=Product.id)]
    elif sort == "newest":
        order_by = [Product.created_at.desc(), Product.id.desc()]
    elif sort == "price_asc":
        order_by = [Product.price.asc(), Product.id]
    elif sort == "price_desc":
        order_by = [Product.price.desc(), Product.id]
    elif sort == "discount":
        order_by = [discount_expr.desc(), Product.id]
    else:  # popularity
        order_by = [Product.sold_count.desc(), Product.rating_avg.desc(), Product.id.desc()]

    rows = db.scalars(
        stmt.options(*_load_opts()).order_by(*order_by).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {
        "items": [product_card(p) for p in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)),
        "facets": facets,
        "category": category_out(current_category) if current_category else None,
    }


@router.get("/search/suggest")
def suggest(q: str = Query(min_length=1, max_length=100), db: Session = Depends(get_db)):
    """CT-05 auto-suggest."""
    ids = _search_ids(db, q)[:6]
    products = []
    if ids:
        found = {p.id: p for p in db.scalars(select(Product).options(selectinload(Product.images)).where(Product.id.in_(ids))).all()}
        products = [
            {"name": found[i].name, "slug": found[i].slug, "image": found[i].images[0].url if found[i].images else None, "price": found[i].price}
            for i in ids if i in found
        ]
    cats = db.scalars(select(Category).where(Category.is_active.is_(True))).all()
    cat_hits = process.extract(q, {c.id: c.name for c in cats}, scorer=fuzz.WRatio, limit=3, score_cutoff=75)
    cat_by_id = {c.id: c for c in cats}
    brands_all = db.scalars(select(Brand).where(Brand.is_active.is_(True))).all()
    brand_hits = process.extract(q, {b.id: b.name for b in brands_all}, scorer=fuzz.WRatio, limit=3, score_cutoff=75)
    brand_by_id = {b.id: b for b in brands_all}
    return {
        "products": products,
        "categories": [{"name": cat_by_id[k].name, "slug": cat_by_id[k].slug} for _, _, k in cat_hits],
        "brands": [{"name": brand_by_id[k].name, "slug": brand_by_id[k].slug} for _, _, k in brand_hits],
    }


@router.get("/products/{slug}")
def product(slug: str, db: Session = Depends(get_db)):
    p = db.scalar(_active_products().options(*_load_opts()).where(Product.slug == slug))
    if not p:
        raise HTTPException(404, "Product not found")
    similar = db.scalars(
        _active_products().options(*_load_opts())
        .where(Product.category_id == p.category_id, Product.id != p.id)
        .order_by(Product.sold_count.desc()).limit(8)
    ).all() if p.category_id else []
    data = product_detail(p)
    data["similar"] = [product_card(s) for s in similar]  # CT-09
    return data


@router.get("/products/{slug}/reviews")
def product_reviews(slug: str, db: Session = Depends(get_db)):
    p = db.scalar(select(Product).where(Product.slug == slug))
    if not p:
        raise HTTPException(404, "Product not found")
    rows = db.scalars(
        select(Review).options(selectinload(Review.user))
        .where(Review.product_id == p.id, Review.is_approved.is_(True)).order_by(Review.created_at.desc())
    ).all()
    return [review_out(r) for r in rows]


def _is_verified_buyer(db: Session, user: User, product_id: int) -> bool:
    return bool(db.scalar(
        select(OrderItem.id).join(Order, Order.id == OrderItem.order_id).where(
            Order.user_id == user.id,
            OrderItem.product_id == product_id,
            Order.order_status.in_([OrderStatus.DELIVERED, OrderStatus.RETURN_REQUESTED, OrderStatus.RETURNED, OrderStatus.REFUNDED]),
        ).limit(1)
    ))


@router.get("/products/{slug}/can-review")
def can_review(slug: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.scalar(select(Product).where(Product.slug == slug))
    if not p:
        raise HTTPException(404, "Product not found")
    existing = db.scalar(select(Review).where(Review.product_id == p.id, Review.user_id == user.id))
    return {"eligible": _is_verified_buyer(db, user, p.id), "existing": review_out(existing) if existing else None}


@router.post("/products/{slug}/reviews", status_code=201)
def add_review(slug: str, body: ReviewIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """CT-08: only verified buyers; goes to admin moderation."""
    p = db.scalar(select(Product).where(Product.slug == slug))
    if not p:
        raise HTTPException(404, "Product not found")
    if not _is_verified_buyer(db, user, p.id):
        raise HTTPException(403, "Only customers who received this product can review it")
    review = db.scalar(select(Review).where(Review.product_id == p.id, Review.user_id == user.id))
    if review:
        review.rating, review.comment, review.is_approved = body.rating, body.comment, False
    else:
        review = Review(product_id=p.id, user_id=user.id, rating=body.rating, comment=body.comment)
        db.add(review)
    db.flush()
    recompute_rating(db, p.id)
    db.commit()
    return {"ok": True, "message": "Thank you! Your review will appear after moderation."}


def recompute_rating(db: Session, product_id: int) -> None:
    avg, cnt = db.execute(
        select(func.avg(Review.rating), func.count(Review.id)).where(Review.product_id == product_id, Review.is_approved.is_(True))
    ).one()
    p = db.get(Product, product_id)
    p.rating_avg = Decimal(str(round(float(avg or 0), 2)))
    p.rating_count = cnt or 0


@router.get("/pincode/{code}")
def pincode(code: str, order_value: Decimal | None = None, db: Session = Depends(get_db)):
    """CT-07 delivery check."""
    if not (len(code) == 6 and code.isdigit() and code[0] != "0"):
        raise HTTPException(400, "Enter a valid 6-digit PIN code")
    return check_pincode(db, code, order_value)


# ------------------------------------------------------------------ "Notify me" (CT-10)

class NotifyMeIn(BaseModel):
    """Guests give an email (mobile optional); signed-in customers are notified on their account details."""
    email: EmailStr | None = None
    mobile: str | None = Field(default=None, pattern=MOBILE)

    @field_validator("email", "mobile", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


def _alert_out(a: StockAlert) -> dict:
    v = a.variant
    p = v.product
    return {
        "id": a.id, "variant_id": v.id, "product_id": p.id, "product_name": p.name, "product_slug": p.slug,
        "image": p.images[0].url if p.images else None, "size": v.size, "colour": v.colour,
        "created_at": a.created_at,
    }


def _own_alerts(user: User):
    """Alerts of this customer: made while signed in, or as a guest with their verified account email."""
    mine = StockAlert.user_id == user.id
    if user.email_verified:
        mine = or_(mine, and_(StockAlert.user_id.is_(None), StockAlert.email == user.email.lower()))
    return mine


@router.post("/variants/{variant_id}/notify-me", status_code=201, dependencies=[Depends(rate_limit("notify-me", 20, 600))])
def notify_me(
    variant_id: int,
    body: NotifyMeIn,
    response: Response,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """CT-10: ask to be told when an out-of-stock size is back. Idempotent per (size, email) while pending."""
    if creds and not user:  # expired token: 401 lets the app refresh the session instead of treating it as a guest
        raise HTTPException(401, "Not authenticated")
    if user and user.role != Role.CUSTOMER:
        raise HTTPException(403, "Store staff accounts cannot sign up for stock alerts")
    if user:  # account details; SMS only to a verified mobile number
        email, mobile = user.email.lower(), user.mobile if user.mobile_verified else None
    else:
        if not body.email:
            raise HTTPException(400, "Enter your email address so we can tell you when this size is back")
        email, mobile = body.email.lower(), body.mobile

    # row lock on the variant: a restock running at the same moment either sees this alert or makes us see the stock
    v = db.scalar(
        select(ProductVariant).where(ProductVariant.id == variant_id)
        .with_for_update().execution_options(populate_existing=True)
    )
    if not v:
        raise HTTPException(404, "Size not found")
    if not (v.is_active and v.product.is_active):
        raise HTTPException(400, "This size is no longer sold, so we cannot notify you about it")
    if v.stock_qty > 0:
        raise HTTPException(400, f"Size {v.size} is in stock now. Add it to your cart.")

    alert = db.scalar(
        select(StockAlert).where(StockAlert.variant_id == v.id, StockAlert.email == email, StockAlert.notified_at.is_(None))
        .order_by(StockAlert.id).limit(1)
    )
    created = alert is None
    if created:
        alert = StockAlert(variant_id=v.id, user_id=user.id if user else None, email=email, mobile=mobile)
        db.add(alert)
    else:
        if user and alert.user_id is None:
            alert.user_id = user.id
        if mobile and not alert.mobile:
            alert.mobile = mobile
        response.status_code = 200
    db.commit()
    channels = f"{email} and by SMS" if alert.mobile else email
    return {
        "ok": True,
        "alert_id": alert.id,
        "already_subscribed": not created,
        "message": f"We will notify you at {channels} when size {v.size} ({v.colour}) is back in stock.",
    }


@router.get("/notify-me")
def my_stock_alerts(user: User = Depends(get_customer), db: Session = Depends(get_db)):
    """CT-10: the customer's pending "Notify me" requests."""
    rows = db.scalars(
        select(StockAlert)
        .options(selectinload(StockAlert.variant).selectinload(ProductVariant.product).selectinload(Product.images))
        .where(_own_alerts(user), StockAlert.notified_at.is_(None))
        .order_by(StockAlert.created_at.desc(), StockAlert.id.desc())
    ).all()
    return [_alert_out(a) for a in rows if a.variant is not None]


@router.delete("/notify-me/{alert_id}")
def cancel_stock_alert(alert_id: int, user: User = Depends(get_customer), db: Session = Depends(get_db)):
    alert = db.scalar(select(StockAlert).where(StockAlert.id == alert_id, _own_alerts(user)))
    if not alert:
        raise HTTPException(404, "Alert not found")
    db.delete(alert)
    db.commit()
    return {"ok": True}
