# Great Foot Wear – E-Commerce Platform

Online store and admin panel for **Great Foot Wear**, #106/3, Kamarajar Salai, Manali, Mathur MMDA, Chennai – 68,
built from *BRD – Great Foot Wear E-Commerce Platform v1.0*.

| Layer    | Technology (BRD §9.1) |
|----------|------------|
| Frontend | React 18 (Vite), Tailwind CSS, **shadcn/ui**, React Router, Axios, React Query, React Hook Form + Zod |
| Backend  | Python 3.11+ (tested on 3.14), FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, passlib (bcrypt), python-jose (JWT) |
| Database | MySQL 8 (InnoDB, utf8mb4) |
| Payments | Razorpay Checkout + server SDK + webhooks; Cash on Delivery |

```
Great-footwear/
├── Backend/    FastAPI app (app/), Alembic migrations, seed.py, tests/
└── Frontend/   React app — User view at /  ·  Admin view at /admin
```

---

## 1. Run it locally

### Backend

```powershell
cd Backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# 1. create the database (MySQL 8)
mysql -u root -p -e "CREATE DATABASE great_footwear CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. edit .env  →  DATABASE_URL=mysql+pymysql://root:<password>@localhost:3306/great_footwear?charset=utf8mb4
#    (a .env with a random JWT_SECRET is already created; .env.example lists every setting)

# 3. create tables and initial data
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\python seed.py

# 4. start the API  → http://localhost:8000/api/docs (Swagger, NF-11)
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

`seed.py` creates only what the BRD defines: the Super Admin login, the 7 categories from CT-01
(Men, Women, Kids, School shoes, Sports, Formal, Sandals & Slippers), default settings and the 6 policy pages.
**Products, brands, prices, HSN codes and stock are added by the owner** (BRD §10.1) from Admin → Products
or the CSV/Excel bulk upload.

First admin login: `owner@greatfootwear.in` / `ChangeMe123` (from `.env`), and the system forces a password change on first login (UM-15).

### Frontend

```powershell
cd Frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api and /media to :8000)
npm run build        # production build in dist/
```

### Tests

```powershell
cd Backend
.\.venv\Scripts\pip install -r requirements-dev.txt
.\.venv\Scripts\python -m pytest tests     # uses a temporary SQLite DB, no MySQL needed
```

The 22 tests cover the BRD §10.4 acceptance criteria. They include:
- register, OTP and email verification;
- lockout;
- filter, search and sort;
- coupon, then COD checkout;
- stock decreasing and increasing;
- admin order flow from Confirmed to Delivered;
- GST invoice PDF;
- return, restock and refund;
- Razorpay signature and webhook verification, plus idempotency;
- cancellation with auto-refund;
- stock released for unpaid orders;
- no SKU below zero;
- staff RBAC checked at the API;
- all reports;
- bulk import and export.

---

## 2. Before going live – owner / developer checklist

| Item | Where |
|------|-------|
| MySQL password, strong `JWT_SECRET`, `COOKIE_SECURE=true`, `CORS_ORIGINS=https://<your-domain>` | `Backend/.env` |
| Razorpay test keys → test payments → live keys (KYC first, BRD §10.2) | `.env` `RAZORPAY_*`; switch **Test/Live** in Admin → Settings → Payments |
| Razorpay webhook: URL `https://<domain>/api/payments/webhook`, events `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`, secret → `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard |
| SMTP for emails (verification links, order mails) | `.env` `SMTP_*` |
| SMS provider for OTP / order SMS. The BRD names none, so the code has a hook: `_send_sms` in `app/services/notify.py`. Until one is connected, OTPs are printed in the backend log. | `app/services/notify.py` |
| GSTIN, store email, logo | Admin → Settings → Store |
| Shipping fee, free-shipping threshold, serviceable PIN codes, delivery days, COD limit / fee / blocked PINs | Admin → Settings → Shipping & COD |
| Review and complete the Shipping, Returns, Privacy (DPDP Act 2023) and Terms pages. Placeholders are marked in the text. | Admin → Banners & pages |
| Confirm with the accountant how shipping and COD fee should be taxed. Today they appear on the invoice as separate charges, and GST is computed on the goods. | `app/services/pricing.py` |

### Production hosting (BRD §9.1)

- Build the frontend (`npm run build`) and serve `dist/` with Nginx, Vercel or Netlify. All unknown paths must fall back to `index.html`.
- Run the backend with Gunicorn + Uvicorn workers on Linux, behind Nginx with SSL:
  `gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 127.0.0.1:8000`
- Nginx: proxy `/api/` and `/media/` to the backend; also map `/sitemap.xml` → `/api/sitemap.xml` (NF-09).
- Product images are stored as WebP in `MEDIA_DIR`. Put them behind a CDN, or swap `save_image` in
  `app/services/media.py` for S3 / Cloudinary.
- MySQL: daily automated backups kept for 30 days (NF-03), for example AWS RDS automated backups.
- The login/OTP rate limiter is in-process. With several server instances, move it to Redis (`app/core/ratelimit.py`).

---

## 3. BRD coverage

Status column: ✅ built · ⚙️ built and needs configuration or a third-party account · ⏭ not built.

| Area | Requirements | Status |
|------|--------------|--------|
| User management | UM-01 … UM-03, UM-05 … UM-18 | ✅ |
| Google sign-in | UM-04 (C) | ⏭ needs Google OAuth client; marked *Could have* |
| Catalogue | CT-01 … CT-09 (filters, sort, typo-tolerant search + auto-suggest, PIN check, verified-buyer reviews, similar + recently viewed) | ✅ |
| "Notify me" for out-of-stock size | CT-10 (C) | ⏭ *Could have* |
| Cart & wishlist | CW-01 … CW-06, guest cart merge (UM-18) | ✅ |
| Checkout | CO-01 … CO-06 (store pickup at Manali, 15-min stock reservation, order no. `GFW-2026-000123`) | ✅ |
| Orders | OR-01 … OR-06 (timeline, invoice PDF, cancel + auto-refund, 7-day return / size exchange with photo, AWB tracking, email/SMS per status) | ✅ (SMS ⚙️) |
| Payments | PY-01 … PY-09, PY-11, PY-12 | ⚙️ Razorpay keys |
| Reconciliation | PY-10 (S): report of orders vs gateway payments | ✅ (settlement data from Razorpay is not pulled) |
| Admin panel | AD-01 … AD-17 | ✅ |
| Courier | OR-05 asks for AWB/tracking link. These are entered manually; there is no Shiprocket API integration. | ✅ manual |
| Security | bcrypt, JWT + httpOnly refresh cookie, RBAC on every `/admin` API, Pydantic validation, ORM only, CORS, rate limits, lockout | ✅ |
| Phase 2 items (apps, Tamil UI, POS, loyalty, WhatsApp) | §10.3 | ⏭ out of scope |

### Roles (BRD §3)

- **Customer**: storefront, account, orders.
- **Staff**:
  - products, categories, inventory, orders, returns and reviews;
  - view customers;
  - a limited dashboard with no revenue figures;
  - can *request* refunds.
- **Super Admin**: everything Staff has, plus:
  - issue and approve refunds, view payments;
  - coupons, banners and pages, reports, staff users, audit log, settings;
  - block and unblock customers.

The API enforces every rule; the menu only hides items.

---

## Android app (APK)

The `Frontend/android/` folder wraps the React app with Capacitor. The phone talks to the
public backend, so the backend must be on HTTPS first.

Backend `.env` for the app:

```
COOKIE_SECURE=true
COOKIE_SAMESITE=none
CORS_ORIGINS=https://your-site.com,https://localhost
MEDIA_URL=https://api.your-site.com/media
```

Build (needs JDK 21 and the Android SDK; `android/local.properties` points to the SDK):

```powershell
cd Frontend
copy .env.android.example .env.android   # set VITE_API_URL=https://api.your-site.com
npm run apk                               # -> android/app/build/outputs/apk/debug/app-debug.apk
```
