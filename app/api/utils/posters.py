from __future__ import annotations

from pathlib import Path

from flask import current_app, jsonify, send_file
from flask.typing import ResponseReturnValue

from app.models.anime import AnimePoster
from app.services.anime_poster import resolve_poster_path


def send_poster_file(poster: AnimePoster | None) -> ResponseReturnValue:
    if poster is None or poster.status != 'ready':
        return jsonify({'message': 'Poster not found'}), 404
    path = resolve_poster_path(str(current_app.config['ANIME_POSTER_STORAGE_DIR']), poster.storage_path)
    if path is None or not Path(path).is_file():
        return jsonify({'message': 'Poster not found'}), 404
    response = send_file(path, mimetype=poster.mime_type)
    response.headers['Cache-Control'] = 'public, max-age=86400'
    return response
