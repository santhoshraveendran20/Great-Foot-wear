"""Request bodies, validated with Pydantic v2 (NF-04)."""
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field, field_validator

from app.core.security import validate_password_rules

MOBILE = r"^[6-9]\d{9}$"
PINCODE = r"^[1-9]\d{5}$"


def _check_password(v: str) -> str:
    validate_password_rules(v)
    return v


# UM-06: min 8 chars, 1 letter + 1 number (72 = bcrypt input limit)
Password = Annotated[str, Field(max_length=72), AfterValidator(_check_password)]


# ------------------------------------------------------------------ auth

class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    mobile: str = Field(pattern=MOBILE)
    email: EmailStr
    password: Password


class LoginIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=190)  # email or mobile
    password: str = Field(max_length=72)


class OtpSendIn(BaseModel):
    mobile: str = Field(pattern=MOBILE)
    purpose: Literal["verify_mobile", "login", "reset_password"]


class OtpLoginIn(BaseModel):
    mobile: str = Field(pattern=MOBILE)
    code: str = Field(pattern=r"^\d{6}$")


class OtpVerifyIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


class ForgotPasswordIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=190)


class ResetPasswordIn(BaseModel):
    token: str | None = None  # email link
    mobile: str | None = Field(default=None, pattern=MOBILE)  # or OTP
    code: str | None = Field(default=None, pattern=r"^\d{6}$")
    new_password: Password


class TokenIn(BaseModel):
    token: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: Password


# ------------------------------------------------------------------ users

class ProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    mobile: str = Field(pattern=MOBILE)
    gender: Literal["male", "female", "other"] | None = None
    date_of_birth: date | None = None


class PreferencesIn(BaseModel):
    promo_email: bool
    promo_sms: bool
    promo_whatsapp: bool


class AddressIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    mobile: str = Field(pattern=MOBILE)
    line1: str = Field(min_length=3, max_length=255)
    line2: str | None = Field(default=None, max_length=255)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=100)
    pincode: str = Field(pattern=PINCODE)
    is_default: bool = False


class DeleteAccountIn(BaseModel):
    password: str


# ------------------------------------------------------------------ cart / checkout

class CartItemIn(BaseModel):
    variant_id: int
    qty: int = Field(ge=1, le=5)


class CartQtyIn(BaseModel):
    qty: int = Field(ge=1, le=5)


class CartMergeIn(BaseModel):
    items: list[CartItemIn] = Field(default_factory=list, max_length=50)


class CouponApplyIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)


class WishlistIn(BaseModel):
    product_id: int


class CheckoutIn(BaseModel):
    fulfilment: Literal["delivery", "pickup"] = "delivery"
    address_id: int | None = None
    payment_method: Literal["online", "cod"]


class QuoteIn(BaseModel):
    fulfilment: Literal["delivery", "pickup"] = "delivery"
    address_id: int | None = None
    payment_method: Literal["online", "cod"] | None = None


class PaymentVerifyIn(BaseModel):
    order_id: int
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class PaymentFailedIn(BaseModel):
    order_id: int
    razorpay_order_id: str | None = None
    reason: str | None = Field(default=None, max_length=255)


class RefundDetailsIn(BaseModel):
    """PY-08: bank / UPI details for COD refunds."""
    account_name: str | None = Field(default=None, max_length=120)
    account_number: str | None = Field(default=None, max_length=30)
    ifsc: str | None = Field(default=None, pattern=r"^[A-Z]{4}0[A-Z0-9]{6}$")
    upi_id: str | None = Field(default=None, max_length=100)


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=255)


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


# ------------------------------------------------------------------ admin

class CategoryIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str | None = Field(default=None, max_length=140)
    parent_id: int | None = None
    image_url: str | None = None
    sort_order: int = 0
    is_active: bool = True


class ReorderIn(BaseModel):
    ids: list[int]


class BrandIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=140)
    logo_url: str | None = None
    is_active: bool = True


GST_RATES = (0, 5, 12, 18, 28, 40)  # GST slab rates (%) a product can carry
GENDERS = ("men", "women", "kids", "unisex")


def check_gst_rate(v: Decimal) -> Decimal:
    if v not in [Decimal(r) for r in GST_RATES]:
        raise ValueError(f"GST % must be one of {', '.join(map(str, GST_RATES))}")
    return v


class VariantIn(BaseModel):
    id: int | None = None
    sku: str = Field(min_length=1, max_length=64)
    size: str = Field(min_length=1, max_length=20)
    colour: str = Field(min_length=1, max_length=50)
    stock_qty: int | None = Field(default=None, ge=0)  # only used when creating; later via inventory adjust
    price_override: Decimal | None = Field(default=None, gt=0)
    low_stock_threshold: int = Field(default=3, ge=0)
    is_active: bool = True

    @field_validator("sku", "size", "colour")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("SKU, size and colour are required for every variant")
        return v


class ProductIn(BaseModel):
    """Mandatory: name, gender, category, MRP, selling price, HSN code, GST % and at least one variant.
    Optional: slug (generated from the name), brand ("No brand"), description, material, care, size chart, tags."""
    name: str = Field(min_length=2, max_length=200)
    slug: str | None = Field(default=None, max_length=220)
    brand_id: int | None = None
    category_id: int
    gender: Literal["men", "women", "kids", "unisex"]
    description: str | None = None
    material: str | None = Field(default=None, max_length=120)
    care: str | None = None
    size_chart: str | None = None
    hsn_code: str = Field(pattern=r"^\d{4,8}$")
    gst_rate: Annotated[Decimal, AfterValidator(check_gst_rate)]
    mrp: Decimal = Field(gt=0)
    price: Decimal = Field(gt=0)
    tags: str | None = Field(default=None, max_length=500)
    is_active: bool = False
    variants: list[VariantIn] = Field(min_length=1)

    @field_validator("price")
    @classmethod
    def price_not_above_mrp(cls, v, info):
        mrp = info.data.get("mrp")
        if mrp is not None and v > mrp:
            raise ValueError("Selling price cannot be more than MRP")
        return v

    @field_validator("variants")
    @classmethod
    def overrides_not_above_mrp(cls, v, info):
        mrp = info.data.get("mrp")
        if mrp is not None and any(x.price_override is not None and x.price_override > mrp for x in v):
            raise ValueError("A variant price override cannot be more than MRP")
        return v


class ImageOrderIn(BaseModel):
    ids: list[int]


class StockAdjustIn(BaseModel):
    variant_id: int
    change_qty: int
    reason: Literal["purchase", "damage", "store_sale", "return", "correction"]
    note: str | None = Field(default=None, max_length=255)


class ThresholdIn(BaseModel):
    low_stock_threshold: int = Field(ge=0)


class OrderStatusIn(BaseModel):
    status: Literal["confirmed", "packed", "shipped", "out_for_delivery", "delivered", "cancelled"]
    note: str | None = Field(default=None, max_length=255)


class ShipmentIn(BaseModel):
    courier: str = Field(min_length=2, max_length=100)
    awb_no: str = Field(min_length=2, max_length=64)
    tracking_url: str | None = Field(default=None, max_length=500)


class ReturnDecisionIn(BaseModel):
    action: Literal["approve", "reject", "receive"]
    note: str | None = Field(default=None, max_length=500)
    restock: bool = True


class RefundIn(BaseModel):
    amount: Decimal = Field(gt=0)
    reason: str | None = Field(default=None, max_length=255)


class CouponIn(BaseModel):
    code: str = Field(min_length=2, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    description: str | None = Field(default=None, max_length=255)
    type: Literal["flat", "percent"]
    value: Decimal = Field(gt=0)
    min_order: Decimal = Field(default=Decimal("0"), ge=0)
    max_discount: Decimal | None = Field(default=None, ge=0)
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    usage_limit: int | None = Field(default=None, ge=1)
    per_user_limit: int | None = Field(default=None, ge=1)
    first_order_only: bool = False
    category_ids: list[int] | None = None
    product_ids: list[int] | None = None
    is_active: bool = True

    @field_validator("value")
    @classmethod
    def percent_max(cls, v, info):
        if info.data.get("type") == "percent" and v > 100:
            raise ValueError("Percent discount cannot exceed 100")
        return v


class BannerIn(BaseModel):
    kind: Literal["banner", "offer_strip"] = "banner"
    title: str = Field(min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=300)
    image_url: str | None = None
    link_url: str | None = Field(default=None, max_length=500)
    sort_order: int = 0
    is_active: bool = True


class PageIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    content: str


class StaffIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    mobile: str = Field(pattern=MOBILE)
    role: Literal["staff", "admin"] = "staff"
    temp_password: Password


class StaffUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    role: Literal["staff", "admin"] | None = None
    is_active: bool | None = None
    reset_password: Password | None = None


class BlockIn(BaseModel):
    is_active: bool


class ReviewModerateIn(BaseModel):
    is_approved: bool
