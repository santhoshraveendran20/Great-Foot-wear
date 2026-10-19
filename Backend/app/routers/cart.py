"""/cart and /wishlist (CW-01 … CW-06, UM-18)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.deps import get_current_user, get_optional_user
from app.db import get_db
from app.models import Address, Cart, CartItem, Product, ProductVariant, User, Wishlist
from app.schemas import CartItemIn, CartMergeIn, CartQtyIn, CouponApplyIn, QuoteIn, WishlistIn
from app.serializers import product_card
from app.services.pricing import MAX_QTY_PER_SKU, build_quote, serialize_quote

router = APIRouter(tags=["cart"])


def _variant(db: Session, variant_id: int) -> ProductVariant:
    v = db.scalar(
        select(ProductVariant)
        .options(selectinload(ProductVariant.product).selectinload(Product.images))
        .where(ProductVariant.id == variant_id)
    )
    if not v or not v.is_active or not v.product.is_active:
        raise HTTPException(404, "This product is no longer available")
    return v


def get_cart(db: Session, user: User) -> Cart:
    stmt = select(Cart).options(
        selectinload(Cart.items).selectinload(CartItem.variant).selectinload(ProductVariant.product).selectinload(Product.images)
    ).where(Cart.user_id == user.id)
    cart = db.scalar(stmt)
    if not cart:
        try:
            with db.begin_nested():
                db.add(Cart(user_id=user.id))
        except IntegrityError:  # created by a concurrent request
            pass
        cart = db.scalar(stmt.execution_options(populate_existing=True))
    return cart


def _item_out(variant: ProductVariant, qty: int, item_id: int | None = None) -> dict:
    p = variant.product
    available = variant.is_active and p.is_active and variant.stock_qty > 0
    return {
        "id": item_id,
        "variant_id": variant.id,
        "product_id": p.id,
        "slug": p.slug,
        "name": p.name,
        "image": p.images[0].url if p.images else None,
        "size": variant.size,
        "colour": variant.colour,
        "sku": variant.sku,
        "mrp": p.mrp,
        "price": variant.effective_price,
        "qty": qty,
        "max_qty": min(MAX_QTY_PER_SKU, variant.stock_qty),
        "available": available,
        "stock_issue": None if available and qty <= variant.stock_qty else (
            "Out of stock" if not available else f"Only {variant.stock_qty} left"
        ),
    }


def resolve_address(db: Session, user: User, address_id: int | None) -> Address | None:
    if address_id is None:
        return None
    addr = db.get(Address, address_id)
    if not addr or addr.user_id != user.id:
        raise HTTPException(404, "Address not found")
    return addr


def cart_out(db: Session, user: User, cart: Cart, quote_in: QuoteIn | None = None) -> dict:
    items = [_item_out(ci.variant, ci.qty, ci.id) for ci in cart.items]
    valid = [(ci.variant, ci.qty) for ci in cart.items if ci.variant.is_active and ci.variant.product.is_active]
    qi = quote_in or QuoteIn()
    addr = resolve_address(db, user, qi.address_id) if qi.address_id else None
    quote = build_quote(
        db, valid, user=user, coupon_code=cart.coupon_code, fulfilment=qi.fulfilment,
        delivery_state=addr.state if addr else None, payment_method=qi.payment_method,
    )
    return {"items": items, "summary": serialize_quote(quote), "count": sum(i["qty"] for i in items)}


def _add(db: Session, cart: Cart, variant: ProductVariant, qty: int, replace: bool = False) -> None:
    item = next((ci for ci in cart.items if ci.variant_id == variant.id), None)
    new_qty = qty if (replace or not item) else item.qty + qty
    new_qty = min(new_qty, MAX_QTY_PER_SKU, variant.stock_qty)  # CW-02: max 5, never above stock
    if new_qty < 1:
        raise HTTPException(409, f"Size {variant.size} in {variant.colour} is out of stock")
    if item:
        item.qty = new_qty
    else:
        item = CartItem(cart_id=cart.id, variant_id=variant.id, qty=new_qty)
        item.variant = variant
        cart.items.append(item)


# ------------------------------------------------------------------ cart

@router.get("/cart")
def view_cart(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cart = get_cart(db, user)
    db.commit()
    return cart_out(db, user, cart)


@router.post("/cart/quote")
def cart_quote(body: QuoteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cart = get_cart(db, user)
    db.commit()
    return cart_out(db, user, cart, body)


@router.post("/cart/items")
def add_item(body: CartItemIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """CW-01: variant (size + colour) is mandatory."""
    cart = get_cart(db, user)
    _add(db, cart, _variant(db, body.variant_id), body.qty)
    db.commit()
    return cart_out(db, user, cart)


@router.patch("/cart/items/{item_id}")
def update_item(item_id: int, body: CartQtyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cart = get_cart(db, user)
    item = next((ci for ci in cart.items if ci.id == item_id), None)
    if not item:
        raise HTTPException(404, "Item not in cart")
    if body.qty > item.variant.stock_qty:
        raise HTTPException(409, f"Only {item.variant.stock_qty} left in stock")
    _add(db, cart, item.variant, body.qty, replace=True)
    db.commit()
    return cart_out(db, user, cart)


@router.delete("/cart/items/{item_id}")
def remove_item(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cart = get_cart(db, user)
    item = next((ci for ci in cart.items if ci.id == item_id), None)
    if not item:
        raise HTTPException(404, "Item not in cart")
    cart.items.remove(item)
    db.commit()
    return cart_out(db, user, cart)


@router.post("/cart/items/{item_id}/move-to-wishlist")
def move_to_wishlist(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cart = get_cart(db, user)
    item = next((ci for ci in cart.items if ci.id == item_id), None)
    if not item:
        raise HTTPException(404, "Item not in cart")
    pid = item.variant.product_id
    if not db.scalar(select(Wishlist.id).where(Wishlist.user_id == user.id, Wishlist.product_id == pid)):
        db.add(Wishlist(user_id=user.id, product_id=pid))
    cart.items.remove(item)
    db.commit()
    return cart_out(db, user, cart)


@router.post("/cart/merge")
def merge_cart(body: CartMergeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """UM-18: guest (local) cart merges into the account cart after login."""
    cart = get_cart(db, user)
    for it in body.items:
        v = db.get(ProductVariant, it.variant_id)
        if not v or not v.is_active or not v.product.is_active or v.stock_qty < 1:
            continue
        _add(db, cart, v, it.qty)
    db.commit()
    return cart_out(db, user, cart)


@router.post("/cart/guest")
def guest_cart(body: CartMergeIn, db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    """Price a guest's local cart (section 3: guest cart is local)."""
    items, lines = [], []
    for it in body.items:
        v = db.scalar(
            select(ProductVariant).options(selectinload(ProductVariant.product).selectinload(Product.images))
            .where(ProductVariant.id == it.variant_id)
        )
        if not v:
            continue
        items.append(_item_out(v, it.qty))
        if v.is_active and v.product.is_active:
            lines.append((v, min(it.qty, MAX_QTY_PER_SKU)))
    quote = build_quote(db, lines, user=user)
    return {"items": items, "summary": serialize_quote(quote), "count": sum(i["qty"] for i in items)}


@router.post("/cart/apply-coupon")
def apply_coupon(body: CouponApplyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """CW-04: validate expiry, min order, usage limit, first-order only."""
    cart = get_cart(db, user)
    lines = [(ci.variant, ci.qty) for ci in cart.items if ci.variant.is_active]
    if not lines:
        raise HTTPException(400, "Your cart is empty")
    quote = build_quote(db, lines, user=user, coupon_code=body.code, strict_coupon=True)
    cart.coupon_code = quote.coupon_code
    db.commit()
    return cart_out(db, user, cart)


@router.delete("/cart/coupon")
def remove_coupon(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cart = get_cart(db, user)
    cart.coupon_code = None
    db.commit()
    return cart_out(db, user, cart)


# ------------------------------------------------------------------ wishlist (CW-06)

@router.get("/wishlist")
def wishlist(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Wishlist).options(
            selectinload(Wishlist.product).selectinload(Product.images),
            selectinload(Wishlist.product).selectinload(Product.variants),
            selectinload(Wishlist.product).selectinload(Product.brand),
            selectinload(Wishlist.product).selectinload(Product.category),
        ).where(Wishlist.user_id == user.id).order_by(Wishlist.id.desc())
    ).all()
    out = []
    for w in rows:
        card = product_card(w.product)
        card["is_active"] = w.product.is_active
        card["variants"] = [
            {"id": v.id, "size": v.size, "colour": v.colour, "in_stock": v.stock_qty > 0}
            for v in w.product.variants if v.is_active
        ]
        out.append(card)
    return out


@router.get("/wishlist/ids")
def wishlist_ids(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.scalars(select(Wishlist.product_id).where(Wishlist.user_id == user.id)).all())


@router.post("/wishlist", status_code=201)
def add_wishlist(body: WishlistIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Product, body.product_id)
    if not p or not p.is_active:
        raise HTTPException(404, "Product not found")
    if not db.scalar(select(Wishlist.id).where(Wishlist.user_id == user.id, Wishlist.product_id == p.id)):
        db.add(Wishlist(user_id=user.id, product_id=p.id))
        db.commit()
    return {"ok": True}


@router.delete("/wishlist/{product_id}")
def remove_wishlist(product_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(Wishlist).where(Wishlist.user_id == user.id, Wishlist.product_id == product_id))
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.post("/wishlist/{product_id}/move-to-cart")
def wishlist_to_cart(product_id: int, body: CartItemIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    v = _variant(db, body.variant_id)
    if v.product_id != product_id:
        raise HTTPException(400, "Variant does not belong to this product")
    cart = get_cart(db, user)
    _add(db, cart, v, body.qty)
    row = db.scalar(select(Wishlist).where(Wishlist.user_id == user.id, Wishlist.product_id == product_id))
    if row:
        db.delete(row)
    db.commit()
    return cart_out(db, user, cart)
