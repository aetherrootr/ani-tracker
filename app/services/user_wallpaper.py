from __future__ import annotations

import hashlib
import os
from pathlib import Path

from werkzeug.datastructures import FileStorage

ALLOWED_VARIANTS = {"desktop", "mobile"}
IMAGE_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
)


def read_wallpaper_upload(upload: FileStorage | None, max_bytes: int) -> tuple[bytes, str, str] | str:
    if upload is None or not upload.filename:
        return "Wallpaper image is required"
    content = upload.read(max_bytes + 1)
    if not content:
        return "Wallpaper image is empty"
    if len(content) > max_bytes:
        return "Wallpaper image exceeds maximum size"

    for signature, mime_type, suffix in IMAGE_SIGNATURES:
        if content.startswith(signature):
            return content, mime_type, suffix
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return content, "image/webp", ".webp"
    return "Wallpaper image must be JPEG, PNG, or WebP"


def write_wallpaper(storage_dir: str, user_id: int, variant: str, content: bytes, suffix: str) -> tuple[str, str]:
    content_hash = wallpaper_content_hash(content)
    storage_path = f"user-{user_id}-{variant}-{content_hash[:16]}{suffix}"
    destination = resolve_wallpaper_path(storage_dir, storage_path)
    if destination is None:
        message = "Invalid wallpaper storage path"
        raise ValueError(message)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".tmp-{destination.name}")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return storage_path, content_hash


def wallpaper_content_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def resolve_wallpaper_path(storage_dir: str, storage_path: str) -> Path | None:
    base = Path(storage_dir).resolve()
    candidate = (base / storage_path).resolve()
    if candidate == base or base not in candidate.parents:
        return None
    return candidate


def delete_wallpaper_file(storage_dir: str, storage_path: str) -> None:
    path = resolve_wallpaper_path(storage_dir, storage_path)
    if path is not None:
        path.unlink(missing_ok=True)
