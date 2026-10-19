"""Response shapes shared by storefront and admin routers."""
from decimal import Decimal

from app.models import (
    Address,
    Brand,
    Category,
    Order,
    Product,
    ProductVariant,
    Refund,
    Return,
    Review,
    User,
)


def user_out(u: User) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "mobile": u.mobile,
        "role": u.role,
        "mobile_verified": u.mobile_verified,
        "email_verified": u.email_verified,
        "is_verified": u.is_verified,
        "is_active": u.is_active,
        "must_change_password": u.must_change_password,
        "password_set": u.password_set,
        "google_linked": bool(u.google_sub),
        "gender": u.gender,
        "date_of_birth": u.date_of_birth,
        "promo_email": u.promo_email,
        "promo_sms": u.promo_sms,
        "promo_whatsapp": u.promo_whatsapp,
        "deletion_requested_at": u.deletion_requested_at,
        "created_at": u.created_at,
    }


def address_out(a: Address) -> dict:
    return {
        "id": a.id, "name": a.name, "mobile": a.mobile, "line1": a.line1, "line2": a.line2,
        "city": a.city, "state": a.state, "pincode": a.pincode, "is_default": a.is_default,
    }


def address_snapshot(a: Address) -> dict:
    snap = address_out(a)
    snap.pop("id")
    snap.pop("is_default")
    return snap


def category_out(c: Category) -> dict:
    return {
        "id": c.id, "name": c.name, "slug": c.slug, "parent_id": c.parent_id, "image_url": c.image_url,
        "sort_order": c.sort_order, "is_active": c.is_active,
    }


def brand_out(b: Brand) -> dict:
    return {"id": b.id, "name": b.name, "slug": b.slug, "logo_url": b.logo_url, "is_active": b.is_active}


def discount_pct(mrp: Decimal, price: Decimal) -> int:
    if not mrp or mrp <= 0 or price >= mrp:
        return 0
    return int(((mrp - price) * 100 / mrp).to_integral_value(rounding="ROUND_FLOOR"))


def variant_out(v: ProductVariant, admin: bool = False) -> dict:
    data = {
        "id": v.id,
        "sku": v.sku,
        "size": v.size,
        "colour": v.colour,
        "price": v.effective_price,
        "in_stock": v.is_active and v.stock_qty > 0,
        "max_qty": min(5, v.stock_qty) if v.is_active else 0,
    }
    if admin:
        data.update(
            stock_qty=v.stock_qty,
            price_override=v.price_override,
            low_stock_threshold=v.low_stock_threshold,
            is_active=v.is_active,
        )
    return data


def product_card(p: Product) -> dict:
    image = p.images[0].url if p.images else None
    in_stock = any(v.is_active and v.stock_qty > 0 for v in p.variants)
    return {
        "id": p.id,
        "name": p.name,
        "slug": p.slug,
        "brand": p.brand.name if p.brand else None,
        "category": p.category.name if p.category else None,
        "category_slug": p.category.slug if p.category else None,
        "gender": p.gender,
        "mrp": p.mrp,
        "price": p.price,
        "discount_pct": discount_pct(p.mrp, p.price),
        "image": image,
        "rating_avg": p.rating_avg,
        "rating_count": p.rating_count,
        "in_stock": in_stock,
        "colours": sorted({v.colour for v in p.variants if v.is_active}),
    }


def product_detail(p: Product, admin: bool = False) -> dict:
    data = product_card(p)
    data.update(
        description=p.description,
        material=p.material,
        care=p.care,
        size_chart=p.size_chart,
        tags=p.tags,
        brand_id=p.brand_id,
        category_id=p.category_id,
        images=[{"id": i.id, "url": i.url, "sort_order": i.sort_order} for i in p.images],
        variants=[variant_out(v, admin) for v in p.variants if admin or v.is_active],
    )
    if admin:
        data.update(
            hsn_code=p.hsn_code, gst_rate=p.gst_rate, is_active=p.is_active, sold_count=p.sold_count,
            created_at=p.created_at, updated_at=p.updated_at,
        )
    return data


def order_summary(o: Order) -> dict:
    first = o.items[0] if o.items else None
    return {
        "id": o.id,
        "order_no": o.order_no,
        "created_at": o.created_at,
        "order_status": o.order_status,
        "payment_status": o.payment_status,
        "payment_method": o.payment_method,
        "fulfilment": o.fulfilment,
        "total": o.total,
        "item_count": sum(i.qty for i in o.items),
        "first_item": {"name": first.product_name, "image_url": first.image_url} if first else None,
        "customer": {"id": o.user.id, "name": o.user.name, "mobile": o.user.mobile} if o.user else None,
    }


def order_detail(o: Order, admin: bool = False) -> dict:
    data = order_summary(o)
    data.update(
        address=o.address,
        subtotal=o.subtotal,
        mrp_total=o.mrp_total,
        discount=o.discount,
        coupon_code=o.coupon_code,
        shipping=o.shipping,
        cod_fee=o.cod_fee,
        tax=o.tax,
        is_inter_state=o.is_inter_state,
        invoice_no=o.invoice_no,
        cancel_reason=o.cancel_reason,
        delivered_at=o.delivered_at,
        reserved_until=o.reserved_until,
        items=[
            {
                "id": i.id, "variant_id": i.variant_id, "product_id": i.product_id, "product_name": i.product_name,
                "sku": i.sku, "size": i.size, "colour": i.colour, "image_url": i.image_url, "mrp": i.mrp,
                "price": i.price, "qty": i.qty, "discount": i.discount, "gst_rate": i.gst_rate,
                "tax_amount": i.tax_amount, "line_total": i.line_total,
            }
            for i in o.items
        ],
        history=[{"status": h.status, "note": h.note, "created_at": h.created_at} for h in o.history],
        shipment=(
            {
                "courier": o.shipment.courier, "awb_no": o.shipment.awb_no, "tracking_url": o.shipment.tracking_url,
                "shipped_at": o.shipment.shipped_at, "delivered_at": o.shipment.delivered_at,
            }
            if o.shipment else None
        ),
    )
    if admin:
        data["customer"] = {"id": o.user.id, "name": o.user.name, "mobile": o.user.mobile, "email": o.user.email}
        data["refund_details"] = o.refund_details
        data["payments"] = [
            {
                "id": p.id, "gateway": p.gateway, "gateway_order_id": p.gateway_order_id,
                "gateway_payment_id": p.gateway_payment_id, "method": p.method, "amount": p.amount,
                "status": p.status, "error_reason": p.error_reason, "created_at": p.created_at,
            }
            for p in o.payments
        ]
    return data


def refund_out(r: Refund) -> dict:
    return {
        "id": r.id, "order_id": r.order_id, "order_no": r.order.order_no if r.order else None,
        "amount": r.amount, "reason": r.reason, "mode": r.mode, "status": r.status,
        "gateway_refund_id": r.gateway_refund_id, "requested_by": r.requested_by, "processed_by": r.processed_by,
        "created_at": r.created_at, "updated_at": r.updated_at,
    }


def return_out(r: Return) -> dict:
    it = r.order_item
    return {
        "id": r.id,
        "order_id": r.order_id,
        "order_no": r.order.order_no if r.order else None,
        "order_item_id": r.order_item_id,
        "item": {"product_name": it.product_name, "size": it.size, "colour": it.colour, "sku": it.sku,
                 "image_url": it.image_url, "price": it.price} if it else None,
        "type": r.type,
        "qty": r.qty,
        "reason": r.reason,
        "photo_url": r.photo_url,
        "exchange_variant": (
            {"id": r.exchange_variant.id, "size": r.exchange_variant.size, "colour": r.exchange_variant.colour,
             "sku": r.exchange_variant.sku} if r.exchange_variant else None
        ),
        "status": r.status,
        "admin_note": r.admin_note,
        "replacement_order_id": r.replacement_order_id,
        "refund_id": r.refund_id,
        "created_at": r.created_at,
    }


def review_out(r: Review) -> dict:
    return {
        "id": r.id, "product_id": r.product_id, "rating": r.rating, "comment": r.comment,
        "is_approved": r.is_approved, "created_at": r.created_at, "user_name": r.user.name if r.user else "Customer",
    }
