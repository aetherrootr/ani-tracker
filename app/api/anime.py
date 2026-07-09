from __future__ import annotations

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.utils.anime import (
    TRACKING_LIST_RECENT_LIMIT,
    build_navigation_anchors,
    get_import_provider_factory,
    get_search_library_markers,
    library_search_condition,
    parse_library_limit,
    parse_library_offset,
    parse_library_order,
    parse_library_sort,
    parse_library_status,
    parse_search_limit,
    parse_search_offset,
    select_anime_name_for_user,
    select_episode_name_for_user,
    select_poster_for_user,
    send_poster_file,
    serialize_anime,
    serialize_anime_name,
    serialize_episode_name,
    serialize_episode_with_watch_state,
    serialize_import_search_result,
    serialize_library_progress,
    serialize_poster,
    serialize_progress,
    serialize_summary,
    sort_library_progresses,
    total_pages,
    tracking_list_backlog_page,
    tracking_list_recently_watched_page,
    tracking_list_tracking_page,
)
from app.api.utils.auth import require_auth_user
from app.import_provider.exceptions import (
    ImportProviderResponseError,
    ImportProviderTimeoutError,
)
from app.import_provider.types import ProviderType
from app.models.anime import (
    AnimeMetaInfo,
    AnimeName,
    AnimePoster,
    AnimeSummary,
    Episode,
    EpisodeName,
)
from app.models.progress import (
    UserAnimeProgress,
    UserAnimeStatus,
    UserEpisodeProgress,
    get_anime_episodes_with_watch_state,
)
from app.models.user import User
from app.services.anime_library import (
    add_anime_to_user_library,
    get_user_progress,
    set_anime_name_preference,
    set_episode_name_preference,
    set_episode_watch_state,
    set_poster_preference,
    set_summary_preference,
    update_user_anime_status,
)

anime_bp = Blueprint('anime', __name__)


@anime_bp.get('/search')
@require_auth_user
def search_anime(db: Session, user: User) -> ResponseReturnValue:
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

    markers = get_search_library_markers(db, user_id=user.id, results=page.results)
    return jsonify(
        {
            'total': page.total,
            'limit': page.limit,
            'offset': page.offset,
            'results': [
                serialize_import_search_result(
                    result,
                    anime_id=markers[result.provider, result.external_id][0],
                    library_status=markers[result.provider, result.external_id][1],
                )
                for result in page.results
            ],
        },
    )


@anime_bp.post('/library')
@require_auth_user
def add_to_library(db: Session, user: User) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'message': 'Request body must be a JSON object'}), 400
    provider_name = payload.get('provider')
    external_id = payload.get('externalId')
    if not isinstance(provider_name, str) or not provider_name.strip():
        return jsonify({'message': 'Anime provider is required'}), 400
    if not isinstance(external_id, str) or not external_id.strip():
        return jsonify({'message': 'Anime externalId is required'}), 400
    provider_name = provider_name.strip()
    external_id = external_id.strip()
    try:
        provider_type = ProviderType(provider_name)
    except ValueError:
        return jsonify({'message': 'Unknown import provider'}), 400
    provider_name = provider_type.value

    try:
        provider = get_import_provider_factory().get_provider(provider_name)
        anime, progress, anime_created, library_changed, progress_created = add_anime_to_user_library(
            db,
            provider,
            user_id=user.id,
            external_id=external_id,
        )
    except ImportProviderTimeoutError:
        db.rollback()
        return jsonify({'message': 'Import provider request timed out'}), 504
    except ImportProviderResponseError:
        db.rollback()
        return jsonify({'message': 'Import provider response error'}), 502

    status_code = 201 if progress_created else 200
    return jsonify(
        {
            'anime': serialize_anime(anime, progress, user),
            'progress': serialize_progress(progress),
            'animeCreated': anime_created,
            'libraryEntryCreatedOrRestored': library_changed,
        },
    ), status_code


@anime_bp.get('/library')
@require_auth_user
def list_library(db: Session, user: User) -> ResponseReturnValue:
    limit, error = parse_library_limit(request.args.get('limit'), maximum=100)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    status, error = parse_library_status(request.args.get('status'))
    if error is not None:
        return jsonify({'message': error}), 400
    sort, error = parse_library_sort(request.args.get('sort'))
    if error is not None:
        return jsonify({'message': error}), 400
    order, error = parse_library_order(request.args.get('order'))
    if error is not None:
        return jsonify({'message': error}), 400
    keyword = request.args.get('q', '').strip()

    stmt = (
        select(UserAnimeProgress)
        .options(
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.summaries),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.names),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.episodes),
            selectinload(UserAnimeProgress.anime).selectinload(AnimeMetaInfo.posters),
        )
        .join(UserAnimeProgress.anime)
        .where(
            UserAnimeProgress.user_id == user.id,
        )
    )
    if status is None:
        stmt = stmt.where(UserAnimeProgress.status != UserAnimeStatus.DROPPED)
    else:
        stmt = stmt.where(UserAnimeProgress.status == status)
    if keyword:
        stmt = stmt.where(library_search_condition(keyword))

    all_progresses = sort_library_progresses(db.scalars(stmt).all(), sort=sort, order=order, user=user)
    total = len(all_progresses)
    progresses = all_progresses[offset : offset + limit]
    anime_ids = [progress.anime_id for progress in progresses]
    watched_counts = dict.fromkeys(anime_ids, 0)
    if anime_ids:
        watched_count_rows = db.execute(
            select(Episode.anime_id, func.count(UserEpisodeProgress.id))
            .join(UserEpisodeProgress, UserEpisodeProgress.episode_id == Episode.id)
            .where(
                Episode.anime_id.in_(anime_ids),
                UserEpisodeProgress.user_id == user.id,
                UserEpisodeProgress.watched.is_(True),
            )
            .group_by(Episode.anime_id),
        ).all()
        for anime_id, count in watched_count_rows:
            watched_counts[anime_id] = count
    return jsonify(
        {
            'total': total,
            'limit': limit,
            'offset': offset,
            'page': offset // limit + 1,
            'totalPages': total_pages(total, limit),
            'sort': sort,
            'order': order,
            'navigationAnchors': build_navigation_anchors(all_progresses, sort=sort, limit=limit, user=user),
            'items': [
                {
                    'anime': serialize_anime(progress.anime, progress, user),
                    'progress': serialize_library_progress(
                        progress,
                        watched_episode_count=watched_counts[progress.anime_id],
                        total_episode_count=progress.anime.total_episodes or len(progress.anime.episodes) or None,
                    ),
                }
                for progress in progresses
            ],
        },
    )


@anime_bp.get('/library/tracking-list/tracking')
@require_auth_user
def get_tracking_list_tracking(db: Session, user: User) -> ResponseReturnValue:
    limit, error = parse_library_limit(request.args.get('limit'), default=20, maximum=100)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    return jsonify(tracking_list_tracking_page(db, user, limit=limit, offset=offset))


@anime_bp.get('/library/tracking-list/backlog')
@require_auth_user
def get_tracking_list_backlog(db: Session, user: User) -> ResponseReturnValue:
    limit, error = parse_library_limit(request.args.get('limit'), default=20, maximum=100)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    return jsonify(tracking_list_backlog_page(db, user, limit=limit, offset=offset))


@anime_bp.get('/library/tracking-list/recently-watched')
@require_auth_user
def get_tracking_list_recently_watched(db: Session, user: User) -> ResponseReturnValue:
    limit, error = parse_library_limit(request.args.get('limit'), default=TRACKING_LIST_RECENT_LIMIT, maximum=100)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    return jsonify(tracking_list_recently_watched_page(db, user, limit=limit, offset=offset))


@anime_bp.get('/<int:anime_id>')
@require_auth_user
def get_anime_detail(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    anime = db.scalar(
        select(AnimeMetaInfo)
        .options(
            selectinload(AnimeMetaInfo.summaries),
            selectinload(AnimeMetaInfo.names),
            selectinload(AnimeMetaInfo.episodes),
            selectinload(AnimeMetaInfo.posters),
        )
        .where(AnimeMetaInfo.id == anime_id),
    )
    if anime is None:
        return jsonify({'message': 'Anime not found'}), 404
    return jsonify(
        {
            'anime': serialize_anime(
                anime,
                progress,
                user,
                include_available_summaries=True,
                include_available_names=True,
                include_available_posters=True,
            ),
            'progress': serialize_progress(progress),
        },
    )


@anime_bp.get('/library/<int:anime_id>/episodes')
@require_auth_user
def list_episodes(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    if get_user_progress(db, user_id=user.id, anime_id=anime_id) is None:
        return jsonify({'message': 'Anime not found'}), 404
    limit, error = parse_library_limit(request.args.get('limit'), default=200, maximum=500)
    if error is not None:
        return jsonify({'message': error}), 400
    offset, error = parse_library_offset(request.args.get('offset'))
    if error is not None:
        return jsonify({'message': error}), 400
    rows = get_anime_episodes_with_watch_state(db, anime_id=anime_id, user_id=user.id, limit=limit, offset=offset)
    total = db.scalar(select(func.count(Episode.id)).where(Episode.anime_id == anime_id)) or 0
    episode_ids = [row['episode_id'] for row in rows]
    names_by_episode: dict[int, list[EpisodeName]] = {episode_id: [] for episode_id in episode_ids}
    if episode_ids:
        episode_names = db.scalars(
            select(EpisodeName)
            .where(EpisodeName.episode_id.in_(episode_ids))
            .order_by(EpisodeName.id),
        ).all()
        for name in episode_names:
            names_by_episode.setdefault(name.episode_id, []).append(name)
    return jsonify(
        {
            'animeId': anime_id,
            'total': total,
            'limit': limit,
            'offset': offset,
            'page': offset // limit + 1,
            'totalPages': total_pages(total, limit),
            'episodes': [
                {
                    **serialize_episode_with_watch_state(
                        row,
                        selected_name=select_episode_name_for_user(
                            names_by_episode.get(row['episode_id'], []),
                            user,
                            preferred_name_id=row['preferred_name_id'],
                        ),
                    ),
                    'availableNames': [
                        serialize_episode_name(name)
                        for name in names_by_episode.get(row['episode_id'], [])
                    ],
                    'preferredNameId': row['preferred_name_id'],
                }
                for row in rows
            ],
        },
    )


@anime_bp.patch('/library/<int:anime_id>/episodes/<int:episode_id>/watch-state')
@require_auth_user
def update_episode_watch_state(db: Session, user: User, anime_id: int, episode_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get('watched'), bool):
        return jsonify({'message': 'Episode watched state is required'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    episode = db.get(Episode, episode_id)
    if progress is None or episode is None or episode.anime_id != anime_id:
        return jsonify({'message': 'Episode not found'}), 404
    watch_progress = set_episode_watch_state(db, progress=progress, episode=episode, watched=payload['watched'])
    return jsonify(
        {
            'episode': {
                'id': episode.id,
                'episodeNumber': episode.episode_number,
                'watched': bool(watch_progress.watched) if watch_progress is not None else False,
                'watchedAt': watch_progress.watched_at.isoformat() if watch_progress is not None and watch_progress.watched_at else None,
            },
            'progress': serialize_progress(progress),
        },
    )


@anime_bp.patch('/library/<int:anime_id>/status')
@require_auth_user
def update_library_status(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get('status'), str):
        return jsonify({'message': 'Anime status is required'}), 400
    try:
        status = UserAnimeStatus(payload['status'])
    except ValueError:
        return jsonify({'message': 'Anime status is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    update_user_anime_status(db, progress=progress, status=status)
    return jsonify({'progress': serialize_progress(progress, include_anime_id=True)})


@anime_bp.patch('/library/<int:anime_id>/name-preference')
@require_auth_user
def update_anime_name_preference(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or ('nameId' not in payload):
        return jsonify({'message': 'nameId is required'}), 400
    name_id = payload['nameId']
    if name_id is not None and not isinstance(name_id, int):
        return jsonify({'message': 'nameId is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    if set_anime_name_preference(db, progress=progress, name_id=name_id) is None:
        return jsonify({'message': 'nameId is invalid'}), 400
    names = db.scalars(select(AnimeName).where(AnimeName.anime_id == anime_id).order_by(AnimeName.id)).all()
    selected = select_anime_name_for_user(names, progress, user)
    return jsonify(
        {
            'name': serialize_anime_name(selected),
            'progress': {'id': progress.id, 'animeId': anime_id, 'preferredNameId': progress.preferred_name_id},
        },
    )


@anime_bp.patch('/library/<int:anime_id>/summary-preference')
@require_auth_user
def update_summary_preference(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or ('summaryId' not in payload):
        return jsonify({'message': 'summaryId is required'}), 400
    summary_id = payload['summaryId']
    if summary_id is not None and not isinstance(summary_id, int):
        return jsonify({'message': 'summaryId is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    if set_summary_preference(db, progress=progress, summary_id=summary_id) is None:
        return jsonify({'message': 'summaryId is invalid'}), 400
    summaries = db.scalars(select(AnimeSummary).where(AnimeSummary.anime_id == anime_id).order_by(AnimeSummary.id)).all()
    selected = next((summary for summary in summaries if summary.id == summary_id), None) if summary_id is not None else None
    if selected is None and summaries:
        selected = summaries[0]
    return jsonify(
        {
            'summary': serialize_summary(selected, progress),
            'progress': {'id': progress.id, 'animeId': anime_id, 'preferredSummaryId': progress.preferred_summary_id},
        },
    )


@anime_bp.patch('/library/<int:anime_id>/episodes/<int:episode_id>/name-preference')
@require_auth_user
def update_episode_name_preference(db: Session, user: User, anime_id: int, episode_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or ('nameId' not in payload):
        return jsonify({'message': 'nameId is required'}), 400
    name_id = payload['nameId']
    if name_id is not None and not isinstance(name_id, int):
        return jsonify({'message': 'nameId is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    episode = db.get(Episode, episode_id)
    if progress is None or episode is None or episode.anime_id != anime_id:
        return jsonify({'message': 'Episode not found'}), 404
    episode_progress = set_episode_name_preference(db, progress=progress, episode=episode, name_id=name_id)
    if episode_progress is None:
        return jsonify({'message': 'nameId is invalid'}), 400
    names = db.scalars(select(EpisodeName).where(EpisodeName.episode_id == episode_id).order_by(EpisodeName.id)).all()
    selected = select_episode_name_for_user(names, user, preferred_name_id=episode_progress.preferred_name_id)
    return jsonify(
        {
            'name': serialize_episode_name(selected),
            'episode': {'id': episode.id, 'animeId': anime_id, 'preferredNameId': episode_progress.preferred_name_id},
        },
    )


@anime_bp.patch('/library/<int:anime_id>/poster-preference')
@require_auth_user
def update_poster_preference(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or ('posterId' not in payload):
        return jsonify({'message': 'posterId is required'}), 400
    poster_id = payload['posterId']
    if poster_id is not None and not isinstance(poster_id, int):
        return jsonify({'message': 'posterId is invalid'}), 400
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Anime not found'}), 404
    if set_poster_preference(db, progress=progress, poster_id=poster_id) is None:
        return jsonify({'message': 'posterId is invalid'}), 400
    poster = db.scalar(select(AnimePoster).where(AnimePoster.id == poster_id)) if poster_id is not None else None
    return jsonify(
        {
            'poster': serialize_poster(poster, progress) if poster is not None else None,
            'progress': {'id': progress.id, 'animeId': anime_id, 'preferredPosterId': progress.preferred_poster_id},
        },
    )


@anime_bp.get('/library/<int:anime_id>/poster')
@require_auth_user
def get_poster(db: Session, user: User, anime_id: int) -> ResponseReturnValue:
    progress = get_user_progress(db, user_id=user.id, anime_id=anime_id)
    if progress is None:
        return jsonify({'message': 'Poster not found'}), 404
    posters = db.scalars(select(AnimePoster).where(AnimePoster.anime_id == anime_id).order_by(AnimePoster.id)).all()
    poster = select_poster_for_user(posters, progress)
    return send_poster_file(poster)


@anime_bp.get('/library/<int:anime_id>/posters/<int:poster_id>')
@require_auth_user
def get_poster_by_id(db: Session, user: User, anime_id: int, poster_id: int) -> ResponseReturnValue:
    if get_user_progress(db, user_id=user.id, anime_id=anime_id) is None:
        return jsonify({'message': 'Poster not found'}), 404
    poster = db.get(AnimePoster, poster_id)
    if poster is None or poster.anime_id != anime_id:
        return jsonify({'message': 'Poster not found'}), 404
    return send_poster_file(poster)
