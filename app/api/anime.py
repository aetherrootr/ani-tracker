from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue

from app.api.utils.anime import (
    get_import_provider_factory,
    parse_search_limit,
    parse_search_offset,
    serialize_import_search_result,
)
from app.import_provider.exceptions import (
    ImportProviderResponseError,
    ImportProviderTimeoutError,
)

anime_bp = Blueprint('anime', __name__)


@anime_bp.get('/search')
def search_anime() -> ResponseReturnValue:
    keyword = request.args.get('q', '').strip()
    if not keyword:
        return jsonify({'message': 'Search keyword is required'}), 400

    limit, error = parse_search_limit(request.args.get('limit'))
    if error is not None:
        return jsonify({'message': error}), 400

    offset, error = parse_search_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400

    provider_name = request.args.get('provider', 'bangumi')
    factory = get_import_provider_factory()

    try:
        provider = factory.get_provider(provider_name)
        page = provider.search_anime(keyword, limit=limit, offset=offset)
    except ImportProviderTimeoutError:
        return jsonify({'message': 'Import provider request timed out'}), 504
    except ImportProviderResponseError:
        return jsonify({'message': 'Import provider response error'}), 502

    return jsonify(
        {
            'total': page.total,
            'limit': page.limit,
            'offset': page.offset,
            'results': [serialize_import_search_result(result) for result in page.results],
        },
    )
