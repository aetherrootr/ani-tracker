from __future__ import annotations

from app.import_provider.utils import coerce_int


def pick_episode_count(subject: dict[object, object]) -> int | None:
    eps = coerce_int(subject.get('eps'))
    if eps is not None:
        return eps
    return coerce_int(subject.get('total_episodes'))


def pick_image_url(images: object) -> str | None:
    if not isinstance(images, dict):
        return None

    for key in ('medium', 'common', 'grid', 'large', 'small'):
        image_url = images.get(key)
        if isinstance(image_url, str) and image_url.strip():
            return image_url
    return None
