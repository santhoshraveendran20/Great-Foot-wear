"""SQLAlchemy models — BRD section 9.2 (core data model) plus supporting tables
needed by specific requirements (refresh tokens UM-07, OTP UM-02/UM-05,
order timeline OR-01, webhook log PY-05/PY-09)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

Money = Numeric(12, 2)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


# ---------------------------------------------------------------- users

class Role:
    CUSTOMER = "customer"
    STAFF = "staff"
    ADMIN = "admin"  # Super Admin (owner)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("google_sub", name="uq_users_google_sub"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True)
    # nullable only for Google sign-in accounts (UM-04) until the customer adds and verifies a mobile number
    mobile: Mapped[str | None] = mapped_column(String(15), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # False for accounts created with Google sign-in that have never set a password (UM-04)
    password_set: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("1"))
    google_sub: Mapped[str | None] = mapped_column(String(64), nullable=True)  # Google account id ("sub" claim)
    role: Mapped[str] = mapped_column(String(20), default=Role.CUSTOMER, index=True)
    mobile_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)  # mobile + email verified (UM-02)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # False = blocked / deactivated
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)  # UM-15
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)  # UM-08
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    # UM-14 notification preferences (promotions opt-in)
    promo_email: Mapped[bool] = mapped_column(Boolean, default=False)
    promo_sms: Mapped[bool] = mapped_column(Boolean, default=False)
    promo_whatsapp: Mapped[bool] = mapped_column(Boolean, default=False)
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # UM-13
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    addresses: Mapped[list[Address]] = relationship(back_populates="user", cascade="all, delete-orphan")

    def refresh_verified(self) -> None:
        self.is_verified = bool(self.mobile_verified and self.email_verified)


class RefreshToken(TimestampMixin, Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class OtpCode(TimestampMixin, Base):
    """One-time codes sent by SMS: verify_mobile, login, reset_password, cod_confirm."""
    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    target: Mapped[str] = mapped_column(String(190), index=True)
    purpose: Mapped[str] = mapped_column(String(30))
    code_hash: Mapped[str] = mapped_column(String(255))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ActionToken(TimestampMixin, Base):
    """Single-use email link tokens: verify_email, reset_password (valid 15 min, UM-05)."""
    __tablename__ = "action_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(30))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Address(TimestampMixin, Base):
    __tablename__ = "addresses"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    mobile: Mapped[str] = mapped_column(String(15))
    line1: Mapped[str] = mapped_column(String(255))
    line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(100))
    pincode: Mapped[str] = mapped_column(String(6))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship(back_populates="addresses")


# ---------------------------------------------------------------- catalogue

class Category(TimestampMixin, Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Brand(TimestampMixin, Base):
    __tablename__ = "brands"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Product(TimestampMixin, Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    slug: Mapped[str] = mapped_column(String(220), unique=True, index=True)
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)  # men / women / kids / unisex
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    material: Mapped[str | None] = mapped_column(String(120), nullable=True)
    care: Mapped[str | None] = mapped_column(Text, nullable=True)
    size_chart: Mapped[str | None] = mapped_column(Text, nullable=True)
    hsn_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    gst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0"))
    mrp: Mapped[Decimal] = mapped_column(Money)
    price: Mapped[Decimal] = mapped_column(Money)  # selling price, GST inclusive
    tags: Mapped[str | None] = mapped_column(String(500), nullable=True)  # comma separated
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)  # False = draft
    sold_count: Mapped[int] = mapped_column(Integer, default=0)  # popularity sort
    rating_avg: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=Decimal("0"))
    rating_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    brand: Mapped[Brand | None] = relationship()
    category: Mapped[Category | None] = relationship()
    images: Mapped[list[ProductImage]] = relationship(
        cascade="all, delete-orphan", order_by="ProductImage.sort_order"
    )
    variants: Mapped[list[ProductVariant]] = relationship(
        back_populates="product", cascade="all, delete-orphan", order_by="ProductVariant.id"
    )


class ProductImage(Base):
    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ProductVariant(Base):
    __tablename__ = "product_variants"
    __table_args__ = (UniqueConstraint("product_id", "size", "colour", name="uq_variant_size_colour"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    size: Mapped[str] = mapped_column(String(20))  # UK/IND size, e.g. "7"
    colour: Mapped[str] = mapped_column(String(50))
    stock_qty: Mapped[int] = mapped_column(Integer, default=0)
    price_override: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=3)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    product: Mapped[Product] = relationship(back_populates="variants")

    @property
    def effective_price(self) -> Decimal:
        return self.price_override if self.price_override is not None else self.product.price


class StockMovement(TimestampMixin, Base):
    """reason: purchase, damage, store_sale, return, order, cancellation, payment_failed, correction"""
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"), index=True)
    change_qty: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(30))
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ref_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


# ---------------------------------------------------------------- cart / wishlist / coupons

class Cart(TimestampMixin, Base):
    __tablename__ = "carts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    coupon_code: Mapped[str | None] = mapped_column(String(40), nullable=True)

    items: Mapped[list[CartItem]] = relationship(cascade="all, delete-orphan", order_by="CartItem.id")


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("cart_id", "variant_id", name="uq_cart_variant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    cart_id: Mapped[int] = mapped_column(ForeignKey("carts.id", ondelete="CASCADE"), index=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"))
    qty: Mapped[int] = mapped_column(Integer, default=1)

    variant: Mapped[ProductVariant] = relationship()


class Wishlist(TimestampMixin, Base):
    __tablename__ = "wishlist"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_wishlist"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))

    product: Mapped[Product] = relationship()


class Coupon(TimestampMixin, Base):
    __tablename__ = "coupons"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    type: Mapped[str] = mapped_column(String(10))  # flat | percent
    value: Mapped[Decimal] = mapped_column(Money)
    min_order: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    max_discount: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    usage_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)  # overall
    per_user_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    first_order_only: Mapped[bool] = mapped_column(Boolean, default=False)
    category_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)  # restriction
    product_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)  # restriction
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class CouponUsage(TimestampMixin, Base):
    __tablename__ = "coupon_usage"

    id: Mapped[int] = mapped_column(primary_key=True)
    coupon_id: Mapped[int] = mapped_column(ForeignKey("coupons.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))


# ---------------------------------------------------------------- orders

class OrderStatus:
    PENDING_PAYMENT = "pending_payment"
    CONFIRMED = "confirmed"
    PACKED = "packed"
    SHIPPED = "shipped"
    OUT_FOR_DELIVERY = "out_for_delivery"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"
    RETURN_REQUESTED = "return_requested"
    RETURNED = "returned"
    REFUNDED = "refunded"

    FLOW = [PENDING_PAYMENT, CONFIRMED, PACKED, SHIPPED, OUT_FOR_DELIVERY, DELIVERED]
    CANCELLABLE = {PENDING_PAYMENT, CONFIRMED, PACKED}  # OR-03: before "Shipped"


class PaymentStatus:
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    COD_PENDING = "cod_pending"
    COD_COLLECTED = "cod_collected"
    PARTIALLY_REFUNDED = "partially_refunded"
    REFUNDED = "refunded"


class Order(TimestampMixin, Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_no: Mapped[str | None] = mapped_column(String(30), unique=True, index=True)  # GFW-2026-000123
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    fulfilment: Mapped[str] = mapped_column(String(10), default="delivery")  # delivery | pickup
    address: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # snapshot
    subtotal: Mapped[Decimal] = mapped_column(Money)  # item total at selling price (GST incl.)
    mrp_total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    discount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))  # coupon discount
    shipping: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    cod_fee: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))  # GST included in total
    total: Mapped[Decimal] = mapped_column(Money)
    coupon_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    payment_method: Mapped[str] = mapped_column(String(10))  # online | cod
    payment_status: Mapped[str] = mapped_column(String(20), index=True)
    order_status: Mapped[str] = mapped_column(String(20), index=True)
    is_inter_state: Mapped[bool] = mapped_column(Boolean, default=False)  # IGST vs CGST+SGST
    reserved_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # CO-03
    stock_released: Mapped[bool] = mapped_column(Boolean, default=False)
    invoice_no: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True)
    invoice_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    refund_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # PY-08 COD bank/UPI
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped[User] = relationship()
    items: Mapped[list[OrderItem]] = relationship(cascade="all, delete-orphan", order_by="OrderItem.id")
    history: Mapped[list[OrderStatusHistory]] = relationship(
        cascade="all, delete-orphan", order_by="OrderStatusHistory.id"
    )
    payments: Mapped[list[Payment]] = relationship(back_populates="order", order_by="Payment.id")
    shipment: Mapped[Shipment | None] = relationship(uselist=False)


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id", ondelete="SET NULL"), nullable=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    product_name: Mapped[str] = mapped_column(String(200))
    sku: Mapped[str] = mapped_column(String(64))
    size: Mapped[str] = mapped_column(String(20))
    colour: Mapped[str] = mapped_column(String(50))
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    hsn_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    mrp: Mapped[Decimal] = mapped_column(Money)
    price: Mapped[Decimal] = mapped_column(Money)  # unit selling price, GST incl.
    qty: Mapped[int] = mapped_column(Integer)
    discount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))  # coupon share for this line
    gst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    taxable_value: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    line_total: Mapped[Decimal] = mapped_column(Money)  # after discount, GST incl.


class OrderStatusHistory(TimestampMixin, Base):
    __tablename__ = "order_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    gateway: Mapped[str] = mapped_column(String(20))  # razorpay | cod
    gateway_order_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    method: Mapped[str | None] = mapped_column(String(30), nullable=True)  # upi / card / netbanking / wallet / cod
    amount: Mapped[Decimal] = mapped_column(Money)
    status: Mapped[str] = mapped_column(String(20))  # created / captured / failed / refunded / cod_pending / cod_collected
    error_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    order: Mapped[Order] = relationship(back_populates="payments")


class Refund(TimestampMixin, Base):
    """status: requested (by staff) / processing / processed / failed / rejected"""
    __tablename__ = "refunds"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mode: Mapped[str] = mapped_column(String(20), default="gateway")  # gateway | manual (COD bank/UPI)
    gateway_refund_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(20))
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    processed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    raw_response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    order: Mapped[Order] = relationship()


class Return(TimestampMixin, Base):
    """status: requested / approved / rejected / received / completed"""
    __tablename__ = "returns"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    type: Mapped[str] = mapped_column(String(10))  # return | exchange
    qty: Mapped[int] = mapped_column(Integer, default=1)
    reason: Mapped[str] = mapped_column(String(500))
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    exchange_variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="requested")
    admin_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    replacement_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    refund_id: Mapped[int | None] = mapped_column(ForeignKey("refunds.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    order_item: Mapped[OrderItem] = relationship()
    order: Mapped[Order] = relationship(foreign_keys=[order_id])
    exchange_variant: Mapped[ProductVariant | None] = relationship()


class Shipment(TimestampMixin, Base):
    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True)
    courier: Mapped[str | None] = mapped_column(String(100), nullable=True)
    awb_no: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    tracking_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Courier API integration (Shiprocket). provider: manual | shiprocket
    provider: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual")
    provider_order_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    provider_shipment_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    courier_company_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    label_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pickup_scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    courier_status: Mapped[str | None] = mapped_column(String(100), nullable=True)  # latest status text from courier
    tracking_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # latest raw tracking payload
    tracking_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Review(TimestampMixin, Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("product_id", "user_id", name="uq_review_user_product"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship()
    product: Mapped[Product] = relationship()


# ---------------------------------------------------------------- CMS / settings / audit

class Banner(TimestampMixin, Base):
    __tablename__ = "banners"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), default="banner")  # banner | offer_strip
    title: Mapped[str] = mapped_column(String(200))
    subtitle: Mapped[str | None] = mapped_column(String(300), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    link_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Page(Base):
    __tablename__ = "pages"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True)  # about, contact, shipping, returns, privacy, terms
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON, nullable=True)


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    user: Mapped[User | None] = relationship()


class StockAlert(TimestampMixin, Base):
    """CT-10 "Notify me" when an out-of-stock size returns. Pending while notified_at is NULL."""
    __tablename__ = "stock_alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(190))
    mobile: Mapped[str | None] = mapped_column(String(15), nullable=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    variant: Mapped[ProductVariant] = relationship()


class GatewaySettlement(Base):
    """Razorpay settlement (bank payout) synced from the gateway (PY-10). Amounts in rupees."""
    __tablename__ = "gateway_settlements"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)  # setl_...
    amount: Mapped[Decimal] = mapped_column(Money)
    fees: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    utr: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime)  # settlement time at the gateway (UTC)
    raw: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class GatewaySettlementItem(Base):
    """One row of Razorpay's settlement recon report: a payment / refund / adjustment and the settlement it went into."""
    __tablename__ = "gateway_settlement_items"
    __table_args__ = (UniqueConstraint("entity_id", "entity_type", name="uq_settlement_item_entity"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_id: Mapped[str] = mapped_column(String(40), index=True)  # pay_... / rfnd_... / adj_...
    entity_type: Mapped[str] = mapped_column(String(20))  # payment | refund | adjustment | transfer | ...
    payment_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    gateway_order_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    settlement_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    settlement_utr: Mapped[str | None] = mapped_column(String(60), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    credit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    debit: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    fee: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    settled: Mapped[bool] = mapped_column(Boolean, default=False)
    entity_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    raw: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class WebhookEvent(TimestampMixin, Base):
    """Raw webhook log + idempotency (PY-05, PY-09)."""
    __tablename__ = "webhook_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[str] = mapped_column(String(80), unique=True)
    event: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict] = mapped_column(JSON)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
