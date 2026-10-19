"""Image uploads. Images are converted to WebP (NF-01) and stored under MEDIA_DIR,
served at MEDIA_URL. For production, put MEDIA_DIR behind a CDN or replace
`save_image` with an S3 / Cloudinary upload (BRD 9.1 "Files")."""
import io
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings

MAX_BYTES = 8 * 1024 * 1024
ALLOWED = {"image/jpeg", "image/png", "image/webp"}


def media_root() -> Path:
    root = Path(settings.MEDIA_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root


async def save_image(file: UploadFile, folder: str, max_side: int = 1600) -> str:
    if file.content_type not in ALLOWED:
        raise HTTPException(400, "Only JPG, PNG or WebP images are allowed")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(400, "Image is larger than 8 MB")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(400, "File is not a valid image") from exc
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    img.thumbnail((max_side, max_side))
    target_dir = media_root() / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.webp"
    img.save(target_dir / name, "WEBP", quality=82, method=4)
    return f"{settings.MEDIA_URL}/{folder}/{name}"


def delete_media(url: str | None) -> None:
    if not url or not url.startswith(settings.MEDIA_URL + "/"):
        return
    rel = url[len(settings.MEDIA_URL) + 1:]
    path = (media_root() / rel).resolve()
    if media_root().resolve() in path.parents and path.exists():
        path.unlink()
