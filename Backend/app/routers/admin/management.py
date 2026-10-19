"""Admin: dashboard (AD-01), customers (AD-10, UM-16), staff (UM-15), audit log (UM-17),
coupons (AD-11), content (AD-12), reviews (AD-13), reports (AD-15), settings (AD-14, AD-16)."""
import csv
import io
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import admin_only, staff_or_admin
from app.core.security import hash_password, utcnow
from app.db import get_db
from app.models import (
    AuditLog,
    Banner,
    Category,
    Coupon,
    CouponUsage,
    Order,
    OrderItem,
    OrderStatus,
    Page,
    Payment,
    Product,
    ProductVariant,
    Review,
    Role,
    User,
)
from app.routers.auth import revoke_all_refresh_tokens
from app.routers.catalog import recompute_rating
from app.schemas import BannerIn, BlockIn, CouponIn, PageIn, ReviewModerateIn, StaffIn, StaffUpdateIn
from app.serializers import order_summary, review_out, user_out
from app.services.audit import audit
from app.services.store_settings import DEFAULTS, all_settings, set_setting
from app.utils import ist_date, ist_day_start, ist_today

router = APIRouter(dependencies=[Depends(staff_or_admin)])
S = OrderStatus

# Orders that count as sales: placed and not cancelled / unpaid
SALE_STATUSES = [S.CONFIRMED, S.PACKED, S.SHIPPED, S.OUT_FOR_DELIVERY, S.DELIVERED, S.RETURN_REQUESTED, S.RETURNED, S.REFUNDED]


def _range(d_from: date | None, d_to: date | None, default_days: int = 30) -> tuple[datetime, datetime]:
    """IST calendar days [d_from, d_to] as stored (naive UTC) datetimes [start, end)."""
    today = ist_today()
    d_to = d_to or today
    d_from = d_from or (d_to - timedelta(days=default_days - 1))
    if d_from > d_to:
        raise HTTPException(400, "Start date must be before end date")
    return ist_day_start(d_from), ist_day_start(d_to + timedelta(days=1))


def _sales_filter(start: datetime, end: datetime):
    return (Order.order_status.in_(SALE_STATUSES), Order.created_at >= start, Order.created_at < end, Order.total > 0)


# ------------------------------------------------------------------ dashboard (AD-01)

PERIOD_DAYS = {"today": 0, "week": 6, "month": 29}
DETAILS_LIMIT = 100

@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(staff_or_admin)):
    """Super Admin: full figures. Staff: limited (operational counts only, no revenue)."""
    full = user.role == Role.ADMIN
    today = ist_today()  # the shop's calendar day, not UTC
    periods = {
        "today": (ist_day_start(today), None),
        "week": (ist_day_start(today - timedelta(days=6)), None),
        "month": (ist_day_start(today - timedelta(days=29)), None),
    }
    stats = {}
    for key, (start, _) in periods.items():
        sales, orders = db.execute(
            select(func.coalesce(func.sum(Order.total), 0), func.count(Order.id))
            .where(Order.order_status.in_(SALE_STATUSES), Order.created_at >= start, Order.total > 0)
        ).one()
        new_customers = db.scalar(select(func.count(User.id)).where(User.role == Role.CUSTOMER, User.created_at >= start)) or 0
        entry = {"orders": orders, "new_customers": new_customers}
        if full:
            entry["sales"] = Decimal(sales)
            entry["avg_order_value"] = (Decimal(sales) / orders).quantize(Decimal("0.01")) if orders else Decimal("0")
        stats[key] = entry

    pending = db.scalar(select(func.count(Order.id)).where(Order.order_status.in_([S.CONFIRMED, S.PACKED]))) or 0
    awaiting_payment = db.scalar(select(func.count(Order.id)).where(Order.order_status == S.PENDING_PAYMENT, Order.stock_released.is_(False))) or 0
    returns_open = db.scalar(select(func.count(Order.id)).where(Order.order_status == S.RETURN_REQUESTED)) or 0
    low = db.scalars(
        select(ProductVariant).options(selectinload(ProductVariant.product))
        .where(ProductVariant.is_active.is_(True), ProductVariant.stock_qty <= ProductVariant.low_stock_threshold)
        .order_by(ProductVariant.stock_qty).limit(20)
    ).all()
    low_count = db.scalar(select(func.count(ProductVariant.id)).where(
        ProductVariant.is_active.is_(True), ProductVariant.stock_qty <= ProductVariant.low_stock_threshold)) or 0

    month_start = periods["month"][0]
    top = db.execute(
        select(OrderItem.product_id, OrderItem.product_name, func.sum(OrderItem.qty).label("qty"), func.sum(OrderItem.line_total).label("revenue"))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.order_status.in_(SALE_STATUSES), Order.created_at >= month_start)
        .group_by(OrderItem.product_id, OrderItem.product_name).order_by(func.sum(OrderItem.qty).desc()).limit(10)
    ).all()

    # bucket by IST day in Python (SQL date() would group by UTC day)
    by_day: dict[str, tuple[Decimal, int]] = {}
    for created, total in db.execute(
        select(Order.created_at, Order.total)
        .where(Order.order_status.in_(SALE_STATUSES), Order.created_at >= month_start, Order.total > 0)
    ).all():
        key = ist_date(created).isoformat()
        s, c = by_day.get(key, (Decimal("0"), 0))
        by_day[key] = (s + Decimal(total), c + 1)
    chart = []
    for i in range(30):
        d = (today - timedelta(days=29 - i)).isoformat()
        sales, cnt = by_day.get(d, (Decimal("0"), 0))
        point = {"date": d, "orders": cnt}
        if full:
            point["sales"] = sales
        chart.append(point)

    recent = db.scalars(
        select(Order).options(selectinload(Order.items), selectinload(Order.user))
        .where(Order.order_status != S.PENDING_PAYMENT).order_by(Order.id.desc()).limit(8)
    ).all()
    return {
        "full": full,
        "stats": stats,
        "pending_orders": pending,
        "awaiting_payment": awaiting_payment,
        "open_returns": returns_open,
        "low_stock_count": low_count,
        "low_stock": [
            {"variant_id": v.id, "product_name": v.product.name, "sku": v.sku, "size": v.size, "colour": v.colour,
             "stock_qty": v.stock_qty, "low_stock_threshold": v.low_stock_threshold}
            for v in low
        ],
        "top_products": [
            {"product_id": r.product_id, "name": r.product_name, "qty": int(r.qty), **({"revenue": Decimal(r.revenue)} if full else {})}
            for r in top
        ],
        "chart": chart,
        "recent_orders": [order_summary(o) for o in recent],
    }


@router.get("/dashboard/details")
def dashboard_details(
    metric: str = Query(pattern="^(customers|orders|sales|pending|returns)$"),
    period: str = Query(default="today", pattern="^(today|week|month)$"),
    db: Session = Depends(get_db),
    user: User = Depends(staff_or_admin),
):
    """The records behind a dashboard card, counted exactly like the card (IST days)."""
    if metric == "sales" and user.role != Role.ADMIN:
        raise HTTPException(403, "Only the Super Admin can see sales figures")
    start = ist_day_start(ist_today() - timedelta(days=PERIOD_DAYS[period]))

    if metric == "customers":
        stmt = select(User).where(User.role == Role.CUSTOMER, User.created_at >= start)
        total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        users = db.scalars(stmt.order_by(User.created_at.desc()).limit(DETAILS_LIMIT)).all()
        # lifetime orders / spend of these customers (sales statuses only)
        stats = dict(
            (uid, (cnt, spent)) for uid, cnt, spent in db.execute(
                select(Order.user_id, func.count(Order.id), func.coalesce(func.sum(Order.total), 0))
                .where(Order.user_id.in_([u.id for u in users] or [0]), Order.order_status.in_(SALE_STATUSES), Order.total > 0)
                .group_by(Order.user_id)
            ).all()
        )
        items = [{
            "id": u.id, "name": u.name, "email": u.email, "mobile": u.mobile, "created_at": u.created_at,
            "mobile_verified": u.mobile_verified, "email_verified": u.email_verified, "is_verified": u.is_verified,
            "is_active": u.is_active, "orders": stats.get(u.id, (0, 0))[0], "spent": Decimal(stats.get(u.id, (0, 0))[1]),
        } for u in users]
        return {"metric": metric, "period": period, "total": total, "items": items}

    if metric in ("orders", "sales"):
        stmt = select(Order).where(Order.order_status.in_(SALE_STATUSES), Order.created_at >= start, Order.total > 0)
    elif metric == "pending":  # same as the card: confirmed / packed, any date
        stmt = select(Order).where(Order.order_status.in_([S.CONFIRMED, S.PACKED]))
    else:  # returns
        stmt = select(Order).where(Order.order_status == S.RETURN_REQUESTED)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    orders = db.scalars(
        stmt.options(selectinload(Order.items), selectinload(Order.user)).order_by(Order.id.desc()).limit(DETAILS_LIMIT)
    ).all()
    items = [order_summary(o) for o in orders]
    if user.role != Role.ADMIN:  # staff do not see money figures on the dashboard
        for it in items:
            it.pop("total", None)
    return {"metric": metric, "period": period, "total": total, "items": items}


# ------------------------------------------------------------------ customers (AD-10, UM-16)

def _customer_stmt(q: str | None):
    stmt = select(User).where(User.role == Role.CUSTOMER, User.deleted_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.name.like(like), User.email.like(like), User.mobile.like(like)))
    return stmt


@router.get("/customers", dependencies=[Depends(staff_or_admin)])
def customers(db: Session = Depends(get_db), q: str | None = None, page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=100)):
    stmt = _customer_stmt(q)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(User.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    ids = [u.id for u in rows] or [-1]
    agg = {
        r[0]: (r[1], Decimal(r[2]))
        for r in db.execute(
            select(Order.user_id, func.count(Order.id), func.coalesce(func.sum(Order.total), 0))
            .where(Order.user_id.in_(ids), Order.order_status.in_(SALE_STATUSES)).group_by(Order.user_id)
        ).all()
    }
    return {
        "items": [{**user_out(u), "order_count": agg.get(u.id, (0, 0))[0], "total_spent": agg.get(u.id, (0, Decimal("0")))[1]} for u in rows],
        "total": total, "page": page, "page_size": page_size,
    }


@router.get("/customers-export", dependencies=[Depends(admin_only)])
def export_customers(db: Session = Depends(get_db), q: str | None = None):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "name", "email", "mobile", "verified", "active", "registered_on", "promo_email", "promo_sms", "promo_whatsapp"])
    for u in db.scalars(_customer_stmt(q).order_by(User.id)).all():
        w.writerow([u.id, u.name, u.email, u.mobile, u.is_verified, u.is_active, u.created_at.date(), u.promo_email, u.promo_sms, u.promo_whatsapp])
    return StreamingResponse(io.BytesIO(buf.getvalue().encode("utf-8-sig")), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="customers.csv"'})


@router.get("/customers/{uid}", dependencies=[Depends(staff_or_admin)])
def customer(uid: int, db: Session = Depends(get_db)):
    u = db.scalar(select(User).options(selectinload(User.addresses)).where(User.id == uid, User.role == Role.CUSTOMER))
    if not u:
        raise HTTPException(404, "Customer not found")
    orders = db.scalars(select(Order).options(selectinload(Order.items), selectinload(Order.user)).where(Order.user_id == uid).order_by(Order.id.desc())).all()
    return {
        **user_out(u),
        "addresses": [{"id": a.id, "name": a.name, "line1": a.line1, "line2": a.line2, "city": a.city, "state": a.state,
                       "pincode": a.pincode, "mobile": a.mobile, "is_default": a.is_default} for a in u.addresses],
        "orders": [order_summary(o) for o in orders],
    }


@router.post("/customers/{uid}/block")
def block_customer(uid: int, body: BlockIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    u = db.scalar(select(User).where(User.id == uid, User.role == Role.CUSTOMER))
    if not u:
        raise HTTPException(404, "Customer not found")
    u.is_active = body.is_active
    if not body.is_active:
        revoke_all_refresh_tokens(db, u.id)
    audit(db, admin, "unblock" if body.is_active else "block", "customer", u.id, None, request)
    db.commit()
    return user_out(u)


# ------------------------------------------------------------------ staff (UM-15) — Super Admin

@router.get("/staff", dependencies=[Depends(admin_only)])
def staff_list(db: Session = Depends(get_db)):
    rows = db.scalars(select(User).where(User.role.in_([Role.STAFF, Role.ADMIN])).order_by(User.id)).all()
    return [user_out(u) for u in rows]


@router.post("/staff", status_code=201)
def create_staff(body: StaffIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    email = body.email.lower()
    if db.scalar(select(User.id).where(or_(User.email == email, User.mobile == body.mobile))):
        raise HTTPException(409, "A user with this email or mobile already exists")
    u = User(
        name=body.name, email=email, mobile=body.mobile, role=body.role, password_hash=hash_password(body.temp_password),
        must_change_password=True, mobile_verified=True, email_verified=True, is_verified=True,
    )
    db.add(u)
    db.flush()
    audit(db, admin, "create", "staff", u.id, {"email": email, "role": body.role}, request)
    db.commit()
    return user_out(u)


@router.put("/staff/{uid}")
def update_staff(uid: int, body: StaffUpdateIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    u = db.scalar(select(User).where(User.id == uid, User.role.in_([Role.STAFF, Role.ADMIN])))
    if not u:
        raise HTTPException(404, "Staff user not found")
    if u.id == admin.id and (body.is_active is False or (body.role and body.role != Role.ADMIN)):
        raise HTTPException(400, "You cannot deactivate or demote your own account")
    changes = body.model_dump(exclude_none=True, exclude={"reset_password"})
    for k, v in changes.items():
        setattr(u, k, v)
    if body.reset_password:
        u.password_hash = hash_password(body.reset_password)
        u.must_change_password = True
        changes["password_reset"] = True
    if body.is_active is False or body.reset_password:
        revoke_all_refresh_tokens(db, u.id)
    audit(db, admin, "update", "staff", u.id, changes, request)
    db.commit()
    return user_out(u)


@router.get("/audit-logs", dependencies=[Depends(admin_only)])
def audit_logs(db: Session = Depends(get_db), page: int = Query(default=1, ge=1), page_size: int = Query(default=50, ge=1, le=200)):
    total = db.scalar(select(func.count(AuditLog.id))) or 0
    rows = db.scalars(select(AuditLog).options(selectinload(AuditLog.user)).order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {
        "items": [
            {"id": a.id, "user": a.user.name if a.user else None, "action": a.action, "entity": a.entity, "entity_id": a.entity_id,
             "details": a.details, "ip": a.ip, "created_at": a.created_at}
            for a in rows
        ],
        "total": total, "page": page, "page_size": page_size,
    }


# ------------------------------------------------------------------ coupons (AD-11) — Super Admin

def _coupon_out(c: Coupon, used: int = 0) -> dict:
    return {
        "id": c.id, "code": c.code, "description": c.description, "type": c.type, "value": c.value, "min_order": c.min_order,
        "max_discount": c.max_discount, "valid_from": c.valid_from, "valid_to": c.valid_to, "usage_limit": c.usage_limit,
        "per_user_limit": c.per_user_limit, "first_order_only": c.first_order_only, "category_ids": c.category_ids or [],
        "product_ids": c.product_ids or [], "is_active": c.is_active, "used": used,
    }


@router.get("/coupons", dependencies=[Depends(admin_only)])
def coupons(db: Session = Depends(get_db)):
    used = dict(db.execute(select(CouponUsage.coupon_id, func.count(CouponUsage.id)).group_by(CouponUsage.coupon_id)).all())
    return [_coupon_out(c, used.get(c.id, 0)) for c in db.scalars(select(Coupon).order_by(Coupon.id.desc())).all()]


def _coupon_save(db: Session, c: Coupon, body: CouponIn) -> None:
    if body.valid_from and body.valid_to and body.valid_from > body.valid_to:
        raise HTTPException(400, "Valid-from must be before valid-to")
    data = body.model_dump()
    data["code"] = body.code.upper()
    data["category_ids"] = body.category_ids or None
    data["product_ids"] = body.product_ids or None
    for k, v in data.items():
        setattr(c, k, v)


@router.post("/coupons", status_code=201)
def create_coupon(body: CouponIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    if db.scalar(select(Coupon.id).where(func.upper(Coupon.code) == body.code.upper())):
        raise HTTPException(409, "A coupon with this code already exists")
    c = Coupon()
    _coupon_save(db, c, body)
    db.add(c)
    db.flush()
    audit(db, admin, "create", "coupon", c.id, {"code": c.code}, request)
    db.commit()
    return _coupon_out(c)


@router.put("/coupons/{cid}")
def update_coupon(cid: int, body: CouponIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    c = db.get(Coupon, cid)
    if not c:
        raise HTTPException(404, "Coupon not found")
    if db.scalar(select(Coupon.id).where(func.upper(Coupon.code) == body.code.upper(), Coupon.id != cid)):
        raise HTTPException(409, "A coupon with this code already exists")
    _coupon_save(db, c, body)
    audit(db, admin, "update", "coupon", c.id, {"code": c.code}, request)
    db.commit()
    return _coupon_out(c)


@router.delete("/coupons/{cid}")
def delete_coupon(cid: int, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    c = db.get(Coupon, cid)
    if not c:
        raise HTTPException(404, "Coupon not found")
    if db.scalar(select(CouponUsage.id).where(CouponUsage.coupon_id == cid).limit(1)):
        c.is_active = False
        msg = "Coupon has been used, so it was deactivated instead of deleted"
    else:
        db.delete(c)
        msg = "Coupon deleted"
    audit(db, admin, "delete", "coupon", cid, {"code": c.code}, request)
    db.commit()
    return {"ok": True, "message": msg}


# ------------------------------------------------------------------ content (AD-12) — Super Admin

def _banner_out(b: Banner) -> dict:
    return {"id": b.id, "kind": b.kind, "title": b.title, "subtitle": b.subtitle, "image_url": b.image_url,
            "link_url": b.link_url, "sort_order": b.sort_order, "is_active": b.is_active}


@router.get("/banners", dependencies=[Depends(admin_only)])
def banners(db: Session = Depends(get_db)):
    return [_banner_out(b) for b in db.scalars(select(Banner).order_by(Banner.kind, Banner.sort_order, Banner.id)).all()]


@router.post("/banners", status_code=201)
def create_banner(body: BannerIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    b = Banner(**body.model_dump())
    db.add(b)
    db.flush()
    audit(db, admin, "create", "banner", b.id, {"title": b.title}, request)
    db.commit()
    return _banner_out(b)


@router.put("/banners/{bid}")
def update_banner(bid: int, body: BannerIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    b = db.get(Banner, bid)
    if not b:
        raise HTTPException(404, "Banner not found")
    for k, v in body.model_dump().items():
        setattr(b, k, v)
    audit(db, admin, "update", "banner", b.id, {"title": b.title}, request)
    db.commit()
    return _banner_out(b)


@router.delete("/banners/{bid}")
def delete_banner(bid: int, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    b = db.get(Banner, bid)
    if not b:
        raise HTTPException(404, "Banner not found")
    db.delete(b)
    audit(db, admin, "delete", "banner", bid, {"title": b.title}, request)
    db.commit()
    return {"ok": True}


@router.get("/pages", dependencies=[Depends(admin_only)])
def pages(db: Session = Depends(get_db)):
    return [{"slug": p.slug, "title": p.title, "content": p.content, "updated_at": p.updated_at}
            for p in db.scalars(select(Page).order_by(Page.slug)).all()]


@router.put("/pages/{slug}")
def update_page(slug: str, body: PageIn, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    p = db.scalar(select(Page).where(Page.slug == slug))
    if not p:
        raise HTTPException(404, "Page not found")
    p.title, p.content = body.title, body.content
    audit(db, admin, "update", "page", slug, None, request)
    db.commit()
    return {"slug": p.slug, "title": p.title, "content": p.content, "updated_at": p.updated_at}


# ------------------------------------------------------------------ reviews (AD-13)

@router.get("/reviews", dependencies=[Depends(staff_or_admin)])
def reviews(db: Session = Depends(get_db), status: str | None = Query(default=None, pattern="^(pending|approved)$")):
    stmt = select(Review).options(selectinload(Review.user), selectinload(Review.product))
    if status:
        stmt = stmt.where(Review.is_approved.is_(status == "approved"))
    return [{**review_out(r), "product_name": r.product.name, "product_slug": r.product.slug}
            for r in db.scalars(stmt.order_by(Review.id.desc()).limit(500)).all()]


@router.post("/reviews/{rid}")
def moderate_review(rid: int, body: ReviewModerateIn, request: Request, db: Session = Depends(get_db), user: User = Depends(staff_or_admin)):
    r = db.get(Review, rid)
    if not r:
        raise HTTPException(404, "Review not found")
    r.is_approved = body.is_approved
    db.flush()
    recompute_rating(db, r.product_id)
    audit(db, user, "approve" if body.is_approved else "hide", "review", rid, None, request)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ reports (AD-15) — Super Admin

def _ist_day(dt: datetime | None) -> str | None:
    d = ist_date(dt)
    return d.isoformat() if d else None


def _report_data(db: Session, kind: str, start: datetime, end: datetime) -> tuple[list[str], list[list]]:
    sale = _sales_filter(start, end)
    if kind == "sales_by_day":
        # grouped by IST day in Python (SQL date() would group by UTC day)
        days: dict[date, list] = {}
        for created, subtotal, discount, shipping, tax, total in db.execute(
            select(Order.created_at, Order.subtotal, Order.discount, Order.shipping, Order.tax, Order.total).where(*sale)
        ).all():
            row = days.setdefault(ist_date(created), [0, Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0")])
            row[0] += 1
            for i, v in enumerate((subtotal, discount, shipping, tax, total), start=1):
                row[i] += Decimal(v or 0)
        rows = [[d.isoformat(), *v] for d, v in sorted(days.items())]
        return ["Date", "Orders", "Item total", "Coupon discount", "Shipping", "GST (incl.)", "Net sales"], rows
    if kind == "sales_by_product":
        rows = db.execute(
            select(OrderItem.product_name, func.sum(OrderItem.qty), func.sum(OrderItem.line_total), func.sum(OrderItem.tax_amount))
            .join(Order, Order.id == OrderItem.order_id).where(*sale)
            .group_by(OrderItem.product_name).order_by(func.sum(OrderItem.line_total).desc())
        ).all()
        return ["Product", "Qty sold", "Sales (incl. GST)", "GST"], [list(r) for r in rows]
    if kind == "sales_by_category":
        rows = db.execute(
            select(func.coalesce(Category.name, "Uncategorised"), func.sum(OrderItem.qty), func.sum(OrderItem.line_total))
            .join(Order, Order.id == OrderItem.order_id)
            .outerjoin(Product, Product.id == OrderItem.product_id)
            .outerjoin(Category, Category.id == Product.category_id)
            .where(*sale).group_by(Category.name).order_by(func.sum(OrderItem.line_total).desc())
        ).all()
        return ["Category", "Qty sold", "Sales (incl. GST)"], [list(r) for r in rows]
    if kind == "gst":
        half = OrderItem.tax_amount / 2
        rows = db.execute(
            select(
                Order.invoice_no, Order.invoice_date, Order.order_no, OrderItem.hsn_code, OrderItem.gst_rate,
                OrderItem.taxable_value,
                case((Order.is_inter_state.is_(False), half), else_=0),
                case((Order.is_inter_state.is_(False), OrderItem.tax_amount - half), else_=0),
                case((Order.is_inter_state.is_(True), OrderItem.tax_amount), else_=0),
                OrderItem.line_total,
            ).join(Order, Order.id == OrderItem.order_id)
            .where(Order.invoice_no.is_not(None), Order.invoice_date >= start, Order.invoice_date < end)
            .order_by(Order.invoice_date, Order.id)
        ).all()
        return (["Invoice no", "Invoice date", "Order no", "HSN", "GST %", "Taxable value", "CGST", "SGST", "IGST", "Total"],
                [[r[0], _ist_day(r[1]), r[2], r[3], r[4], r[5], Decimal(r[6]).quantize(Decimal("0.01")),
                  Decimal(r[7]).quantize(Decimal("0.01")), r[8], r[9]] for r in rows])
    if kind == "payment_split":
        rows = db.execute(
            select(case((Order.payment_method == "cod", "COD"), else_=func.coalesce(Payment.method, "online")),
                   func.count(func.distinct(Order.id)), func.sum(Order.total))
            .outerjoin(Payment, (Payment.order_id == Order.id) & (Payment.status.in_(["captured", "refunded", "partially_refunded"])))
            .where(*sale).group_by(case((Order.payment_method == "cod", "COD"), else_=func.coalesce(Payment.method, "online")))
        ).all()
        return ["Method", "Orders", "Amount"], [list(r) for r in rows]
    if kind == "stock_valuation":
        price = func.coalesce(ProductVariant.price_override, Product.price)
        rows = db.execute(
            select(Product.name, ProductVariant.sku, ProductVariant.size, ProductVariant.colour, ProductVariant.stock_qty,
                   price, ProductVariant.stock_qty * price)
            .join(Product, Product.id == ProductVariant.product_id).where(ProductVariant.stock_qty > 0)
            .order_by(Product.name, ProductVariant.sku)
        ).all()
        return ["Product", "SKU", "Size", "Colour", "Stock", "Selling price", "Value at selling price"], [list(r) for r in rows]
    if kind == "reconciliation":  # PY-10
        rows = db.execute(
            select(Order.order_no, Order.created_at, Order.payment_method, Order.total, Order.payment_status,
                   Payment.gateway_payment_id, Payment.amount, Payment.status)
            .outerjoin(Payment, Payment.order_id == Order.id)
            .where(Order.created_at >= start, Order.created_at < end, Order.payment_method == "online")
            .order_by(Order.id)
        ).all()
        return (["Order no", "Date", "Method", "Order total", "Order payment status", "Gateway payment id", "Gateway amount", "Gateway status"],
                [[r[0], _ist_day(r[1]), *r[2:]] for r in rows])
    raise HTTPException(400, "Unknown report")


REPORTS = {
    "sales_by_day": "Sales by day", "sales_by_product": "Sales by product", "sales_by_category": "Sales by category",
    "gst": "GST report", "payment_split": "Payment method split", "stock_valuation": "Stock valuation",
    "reconciliation": "Payment reconciliation",
}


def _cell(v):
    if isinstance(v, Decimal):
        return f"{v:.2f}"
    return "" if v is None else str(v)


@router.get("/reports/{kind}", dependencies=[Depends(admin_only)])
def report(
    kind: str,
    db: Session = Depends(get_db),
    date_from: date | None = None,
    date_to: date | None = None,
    format: str = Query(default="json", pattern="^(json|csv|pdf)$"),
):
    if kind not in REPORTS:
        raise HTTPException(404, "Unknown report")
    start, end = _range(date_from, date_to)
    headers, rows = _report_data(db, kind, start, end)
    title = f"{REPORTS[kind]} ({ist_date(start)} to {ist_date(end - timedelta(seconds=1))})"
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(headers)
        w.writerows([[_cell(c) for c in r] for r in rows])
        return StreamingResponse(io.BytesIO(buf.getvalue().encode("utf-8-sig")), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{kind}.csv"'})
    if format == "pdf":
        out = io.BytesIO()
        doc = SimpleDocTemplate(out, pagesize=landscape(A4))
        st = getSampleStyleSheet()
        table = Table([headers] + [[_cell(c) for c in r] for r in rows] or [["No data"]], repeatRows=1)
        table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 7.5), ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ]))
        doc.build([Paragraph(f"Great Foot Wear – {title}", st["Heading2"]), Spacer(1, 8), table])
        return Response(out.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{kind}.pdf"'})
    return {"title": title, "headers": headers, "rows": [[_cell(c) for c in r] for r in rows]}


# ------------------------------------------------------------------ settings (AD-14, AD-16, PY-12) — Super Admin

@router.get("/settings", dependencies=[Depends(admin_only)])
def get_settings(db: Session = Depends(get_db)):
    from app.services import gateway
    data = all_settings(db)
    data["gateway_status"] = {"configured": gateway.is_configured(db), "mode": data["payment"]["gateway_mode"]}
    return data


@router.put("/settings/{key}")
def put_settings(key: str, body: dict, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    if key not in DEFAULTS:
        raise HTTPException(404, "Unknown settings group")
    allowed = set(DEFAULTS[key].keys())
    unknown = set(body) - allowed
    if unknown:
        raise HTTPException(400, f"Unknown fields: {', '.join(sorted(unknown))}")
    if key == "payment" and body.get("gateway_mode") not in (None, "test", "live"):
        raise HTTPException(400, "gateway_mode must be test or live")
    for coord, limit in (("map_lat", 90), ("map_lng", 180)):
        if coord in body:
            try:
                body[coord] = float(body[coord])
            except (TypeError, ValueError):
                raise HTTPException(400, f"{coord} must be a number") from None
            if not -limit <= body[coord] <= limit:
                raise HTTPException(400, f"{coord} must be between -{limit} and {limit}")
    if "map_cid" in body:
        body["map_cid"] = str(body["map_cid"] or "").strip()
        if body["map_cid"] and not body["map_cid"].isdigit():
            raise HTTPException(400, "map_cid must be the numeric Google Maps listing id")
    if "map_url" in body and body["map_url"] and not str(body["map_url"]).startswith("https://"):
        raise HTTPException(400, "map_url must be an https:// Google Maps link")
    for list_key in ("serviceable_pincodes", "blocked_pincodes"):
        if list_key in body:
            pins = [str(p).strip() for p in body[list_key] or [] if str(p).strip()]
            bad = [p for p in pins if not (len(p) == 6 and p.isdigit())]
            if bad:
                raise HTTPException(400, f"Invalid PIN codes: {', '.join(bad[:5])}")
            body[list_key] = pins
    value = set_setting(db, key, body)
    audit(db, admin, "update", "settings", key, body, request)
    db.commit()
    return value
