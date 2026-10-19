"""Initial data: Super Admin account, the categories listed in BRD CT-01, default
settings and the static pages (AD-12). Safe to run more than once.

Products, brands, prices, HSN codes and stock are supplied by the owner (BRD 10.1)
and are added from Admin → Products or the CSV/Excel bulk upload."""
from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Category, Page, Role, Setting, User
from app.services.store_settings import DEFAULTS
from app.utils import slugify

CATEGORIES = ["Men", "Women", "Kids", "School shoes", "Sports", "Formal", "Sandals & Slippers"]  # CT-01

STORE = DEFAULTS["store"]
PHONES = " / ".join(STORE["phones"])

PAGES = {
    "about": ("About us", f"""Great Foot Wear is a footwear store at {STORE['address']}.

We stock footwear for men, women and kids, including school shoes, sports shoes, formal shoes, sandals and slippers.

You can now shop with us online and get your order delivered to your home, or pick it up from our store in Manali.

(Edit this page in Admin → Banners & pages.)"""),
    "contact": ("Contact us", f"""Great Foot Wear
{STORE['address']}

Phone: {PHONES}

(Edit this page in Admin → Banners & pages.)"""),
    "shipping": ("Shipping policy", """We deliver to serviceable PIN codes across India. Use the PIN code check on any product page to see the estimated delivery date and whether Cash on Delivery is available.

Store pickup is available at our Manali store.

Shipping charges, if any, are shown in your cart before you pay.

(The store owner must review and complete this policy in Admin → Banners & pages.)"""),
    "returns": ("Return & refund policy", """You can request a return or a size exchange within 7 days of delivery from My Orders. Please add the reason and a photo of the product.

Refunds for online payments go back to the original payment method. For Cash on Delivery orders, we refund to the bank account or UPI ID you provide.

(The store owner must review and complete this policy in Admin → Banners & pages.)"""),
    "privacy": ("Privacy policy", """We collect your name, mobile number, email and delivery addresses to process your orders. Card details are handled by our payment gateway and are never stored by us.

You can update your details or request deletion of your account from My Account. Order records are kept as required for GST and accounting.

(The store owner must review and complete this policy, in line with India's DPDP Act 2023, in Admin → Banners & pages.)"""),
    "terms": ("Terms & conditions", """By using this website you agree to these terms.

(The store owner must review and complete these terms in Admin → Banners & pages.)"""),
}


def run() -> None:
    db = SessionLocal()
    try:
        if not db.scalar(select(User.id).where(User.role == Role.ADMIN)):
            db.add(User(
                name=settings.SUPERADMIN_NAME,
                email=settings.SUPERADMIN_EMAIL.lower(),
                mobile=settings.SUPERADMIN_MOBILE,
                password_hash=hash_password(settings.SUPERADMIN_PASSWORD),
                role=Role.ADMIN,
                mobile_verified=True,
                email_verified=True,
                is_verified=True,
                must_change_password=True,
            ))
            print(f"Created Super Admin {settings.SUPERADMIN_EMAIL} (password change required on first login)")

        for i, name in enumerate(CATEGORIES):
            slug = slugify(name)
            if not db.scalar(select(Category.id).where(Category.slug == slug)):
                db.add(Category(name=name, slug=slug, sort_order=i, is_active=True))

        for key, value in DEFAULTS.items():
            if not db.get(Setting, key):
                db.add(Setting(key=key, value=value))

        for slug, (title, content) in PAGES.items():
            if not db.scalar(select(Page.id).where(Page.slug == slug)):
                db.add(Page(slug=slug, title=title, content=content))

        db.commit()
        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
