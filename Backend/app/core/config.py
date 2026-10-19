from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_ENV: str = "development"  # development | staging | production
    APP_NAME: str = "Great Foot Wear"

    # MySQL 8 (InnoDB, utf8mb4)
    DATABASE_URL: str = "mysql+pymysql://root:@localhost:3306/great_footwear?charset=utf8mb4"

    # JWT (UM-07)
    JWT_SECRET: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 15
    REFRESH_TOKEN_DAYS: int = 7
    COOKIE_SECURE: bool = False  # set True in production (HTTPS everywhere, NF-04)

    # URLs
    FRONTEND_URL: str = "http://localhost:5173"
    BACKEND_URL: str = "http://localhost:8000"
    CORS_ORIGINS: str = "http://localhost:5173"  # comma separated; limited to the site domain (NF-04)

    # Razorpay (PY-12: keys only in server environment variables)
    RAZORPAY_MODE: str = "test"  # test | live
    RAZORPAY_TEST_KEY_ID: str = ""
    RAZORPAY_TEST_KEY_SECRET: str = ""
    RAZORPAY_LIVE_KEY_ID: str = ""
    RAZORPAY_LIVE_KEY_SECRET: str = ""
    RAZORPAY_WEBHOOK_SECRET: str = ""

    # Email (SMTP). Empty host = emails are written to the server log (development).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "Great Foot Wear <no-reply@greatfootwear.in>"
    SMTP_TLS: bool = True

    # SMS. "console" = SMS/OTP written to the server log (development).
    SMS_PROVIDER: str = "console"

    # Uploaded files (product images, return photos).
    # STORAGE_BACKEND: local (MEDIA_DIR served at MEDIA_URL) | s3 | cloudinary
    STORAGE_BACKEND: str = "local"
    MEDIA_DIR: str = "media"
    MEDIA_URL: str = "/media"
    # S3 or any S3-compatible store; S3_PUBLIC_BASE_URL = CDN (e.g. CloudFront) base URL
    S3_BUCKET: str = ""
    S3_REGION: str = "ap-south-1"
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    S3_ENDPOINT_URL: str = ""
    S3_PUBLIC_BASE_URL: str = ""
    S3_KEY_PREFIX: str = "media"
    # Cloudinary
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""
    CLOUDINARY_FOLDER: str = "great-footwear"

    # Google sign-in (UM-04) — OAuth 2.0 Web client ID from Google Cloud Console
    GOOGLE_CLIENT_ID: str = ""

    # Shiprocket courier API (BRD 2.4 courier partner)
    SHIPROCKET_BASE_URL: str = "https://apiv2.shiprocket.in/v1/external"
    SHIPROCKET_EMAIL: str = ""
    SHIPROCKET_PASSWORD: str = ""
    SHIPROCKET_WEBHOOK_TOKEN: str = ""

    # Initial Super Admin created by seed.py
    SUPERADMIN_NAME: str = "Owner"
    SUPERADMIN_EMAIL: str = "owner@greatfootwear.in"
    SUPERADMIN_MOBILE: str = "9385938581"
    SUPERADMIN_PASSWORD: str = "ChangeMe123"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def razorpay_key_id(self) -> str:
        return self.RAZORPAY_LIVE_KEY_ID if self.RAZORPAY_MODE == "live" else self.RAZORPAY_TEST_KEY_ID

    @property
    def razorpay_key_secret(self) -> str:
        return self.RAZORPAY_LIVE_KEY_SECRET if self.RAZORPAY_MODE == "live" else self.RAZORPAY_TEST_KEY_SECRET


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
