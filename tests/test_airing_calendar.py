from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, time, timedelta

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from app import create_app
from app.models.anime import AnimeMetaInfo, AnimeName, Episode, EpisodeStatus
from app.models.progress import (
    UserAnimeMetadataEpisodeSnapshot,
    UserAnimeMetadataSnapshot,
    UserAnimeMetadataSource,
    UserAnimeProgress,
    UserAnimeStatus,
)
from app.models.user import User
from app.services.airing_calendar import get_user_airing_calendar
from tests.test_auth import register_user


@pytest.fixture()
def app(test_instance_path) -> Flask:  # type: ignore[no-untyped-def]
    return create_app(
        {
            'DATABASE_URL': f"sqlite:///{test_instance_path / 'test.db'}",
            'SECRET_KEY': 'test-secret',
            'TESTING': True,
        },
    )


@pytest.fixture()
def client(app: Flask) -> FlaskClient:
    return app.test_client()


@pytest.fixture()
def db_session(app: Flask) -> Iterator[Session]:
    with app.extensions['db_session_factory']() as session:
        yield session


def add_anime(
    session: Session,
    *,
    external_id: str,
    title: str,
    user_id: int = 1,
    user_status: UserAnimeStatus = UserAnimeStatus.WATCHING,
    provider_type: str = 'bangumi',
) -> AnimeMetaInfo:
    anime = AnimeMetaInfo(
        provider_type=provider_type,
        external_id=external_id,
        original_name=title,
        total_episodes=3,
    )
    session.add(anime)
    session.flush()
    session.add(AnimeName(anime_id=anime.id, name=title, language='en'))
    session.add(UserAnimeProgress(user_id=user_id, anime_id=anime.id, status=user_status))
    session.flush()
    return anime


def add_episode(
    session: Session,
    anime: AnimeMetaInfo,
    *,
    number: int,
    air_at: datetime,
    status: EpisodeStatus,
    has_time: bool,
    status_air_at: datetime | None = None,
) -> Episode:
    episode = Episode(
        anime_id=anime.id,
        episode_number=number,
        original_title=f'Episode {number}',
        air_at=air_at,
        air_at_has_time=has_time,
        status=status,
        status_air_at=status_air_at or air_at,
    )
    session.add(episode)
    session.flush()
    return episode


def test_airing_calendar_requires_authentication_and_valid_date(client: FlaskClient) -> None:
    assert client.get('/api/anime/airing-calendar').status_code == 401
    assert register_user(client).status_code == 201
    assert client.get('/api/anime/airing-calendar?startDate=invalid').status_code == 400
    assert client.get('/api/anime/airing-calendar?startDate=9999-12-31').status_code == 400


def test_airing_calendar_returns_seven_empty_days(client: FlaskClient) -> None:
    assert register_user(client).status_code == 201

    response = client.get('/api/anime/airing-calendar?startDate=2026-08-02')

    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'private, no-store'
    body = response.get_json()
    assert body['startDate'] == '2026-08-02'
    assert body['endDate'] == '2026-08-08'
    assert body['totalAnimeCount'] == 0
    assert [day['date'] for day in body['days']] == [
        '2026-08-02',
        '2026-08-03',
        '2026-08-04',
        '2026-08-05',
        '2026-08-06',
        '2026-08-07',
        '2026-08-08',
    ]


def test_airing_calendar_preserves_date_precision_and_groups_datetime_in_user_zone(
    db_session: Session,
) -> None:
    now = datetime(2026, 8, 2, 12, tzinfo=UTC)
    user = db_session.get(User, 1)
    if user is None:
        user = User(
            username='calendar-user',
            email='calendar@example.com',
            password_hash='test',
            time_zone='America/Los_Angeles',
        )
        db_session.add(user)
        db_session.flush()

    timed = add_anime(db_session, external_id='timed', title='Timed', user_id=user.id)
    add_episode(
        db_session,
        timed,
        number=1,
        air_at=now - timedelta(days=7),
        status=EpisodeStatus.AIRED,
        has_time=True,
    )
    timed_episode = add_episode(
        db_session,
        timed,
        number=2,
        air_at=datetime(2026, 8, 3, 2, tzinfo=UTC),
        status=EpisodeStatus.UPCOMING,
        has_time=True,
    )

    date_only = add_anime(db_session, external_id='date', title='Date only', user_id=user.id)
    add_episode(
        db_session,
        date_only,
        number=1,
        air_at=now - timedelta(days=7),
        status=EpisodeStatus.AIRED,
        has_time=False,
    )
    date_episode = add_episode(
        db_session,
        date_only,
        number=2,
        air_at=datetime.combine(now.date() + timedelta(days=1), time(), UTC),
        status=EpisodeStatus.UPCOMING,
        has_time=False,
    )
    db_session.commit()

    result = get_user_airing_calendar(db_session, user, start_date=now.date(), now=now)

    first_day_items = result['days'][0]['items']
    second_day_items = result['days'][1]['items']
    assert first_day_items[0]['anime']['id'] == timed.id
    assert first_day_items[0]['episodes'][0] == {
        'id': timed_episode.id,
        'episodeNumber': 2,
        'displayName': 'Episode 2',
        'airAt': '2026-08-03T02:00:00Z',
        'airAtPrecision': 'datetime',
        'status': 'upcoming',
        'watched': False,
    }
    assert first_day_items[0]['minimumEpisodeTitle'] == 'Episode 2'
    assert second_day_items[0]['anime']['id'] == date_only.id
    assert second_day_items[0]['episodes'][0]['id'] == date_episode.id
    assert second_day_items[0]['episodes'][0]['airAtPrecision'] == 'date'


def test_airing_calendar_filters_library_statuses_and_groups_anime_on_every_air_date(
    db_session: Session,
) -> None:
    now = datetime(2026, 8, 2, 8, tzinfo=UTC)
    user = User(username='scope-user', email='scope@example.com', password_hash='test', time_zone='UTC')
    db_session.add(user)
    db_session.flush()
    anime = add_anime(db_session, external_id='dedupe', title='Dedupe', user_id=user.id)
    add_episode(
        db_session,
        anime,
        number=1,
        air_at=now - timedelta(days=1),
        status=EpisodeStatus.AIRED,
        has_time=True,
    )
    first = add_episode(
        db_session,
        anime,
        number=2,
        air_at=now + timedelta(days=1),
        status=EpisodeStatus.UPCOMING,
        has_time=True,
    )
    same_day = add_episode(
        db_session,
        anime,
        number=3,
        air_at=now + timedelta(days=1, hours=1),
        status=EpisodeStatus.UPCOMING,
        has_time=True,
    )
    next_day = add_episode(
        db_session,
        anime,
        number=4,
        air_at=now + timedelta(days=2),
        status=EpisodeStatus.UPCOMING,
        has_time=True,
    )
    on_hold = add_anime(
        db_session,
        external_id='on-hold',
        title='On hold',
        user_id=user.id,
        user_status=UserAnimeStatus.ON_HOLD,
    )
    add_episode(
        db_session,
        on_hold,
        number=1,
        air_at=now + timedelta(days=1),
        status=EpisodeStatus.UPCOMING,
        has_time=True,
    )
    dropped = add_anime(
        db_session,
        external_id='dropped',
        title='Dropped',
        user_id=user.id,
        user_status=UserAnimeStatus.DROPPED,
    )
    add_episode(
        db_session,
        dropped,
        number=1,
        air_at=now + timedelta(days=1),
        status=EpisodeStatus.UPCOMING,
        has_time=True,
    )
    completed = add_anime(
        db_session,
        external_id='completed',
        title='Completed',
        user_id=user.id,
        user_status=UserAnimeStatus.COMPLETED,
    )
    completed_episode = add_episode(
        db_session,
        completed,
        number=1,
        air_at=now + timedelta(days=1, hours=2),
        status=EpisodeStatus.AIRED,
        has_time=True,
    )
    db_session.commit()

    result = get_user_airing_calendar(db_session, user, start_date=now.date(), now=now)

    assert result['totalAnimeCount'] == 2
    second_day_items = {item['anime']['id']: item for item in result['days'][1]['items']}
    assert [episode['id'] for episode in second_day_items[anime.id]['episodes']] == [first.id, same_day.id]
    assert second_day_items[completed.id]['episodes'][0]['id'] == completed_episode.id
    assert result['days'][2]['items'][0]['anime']['id'] == anime.id
    assert result['days'][2]['items'][0]['episodes'][0]['id'] == next_day.id
    assert all(not day['items'] for day in result['days'][3:])


def test_airing_calendar_keeps_date_only_final_episode_that_turned_aired_today(
    db_session: Session,
) -> None:
    now = datetime(2026, 8, 2, 12, tzinfo=UTC)
    user = User(username='final-user', email='final@example.com', password_hash='test', time_zone='UTC')
    db_session.add(user)
    db_session.flush()
    anime = add_anime(db_session, external_id='final', title='Final', user_id=user.id)
    anime.total_episodes = 2
    add_episode(
        db_session,
        anime,
        number=1,
        air_at=now - timedelta(days=7),
        status=EpisodeStatus.AIRED,
        has_time=False,
    )
    final_episode = add_episode(
        db_session,
        anime,
        number=2,
        air_at=datetime.combine(now.date(), time(), UTC),
        status=EpisodeStatus.AIRED,
        has_time=False,
    )
    db_session.commit()

    result = get_user_airing_calendar(db_session, user, start_date=now.date(), now=now)

    assert result['totalAnimeCount'] == 1
    assert result['days'][0]['items'][0]['episodes'][0]['id'] == final_episode.id
    assert result['days'][0]['items'][0]['episodes'][0]['airAtPrecision'] == 'date'


def test_airing_calendar_keeps_timed_final_episode_after_it_airs_today(
    db_session: Session,
) -> None:
    now = datetime(2026, 8, 3, 15, tzinfo=UTC)
    user = User(
        username='timed-final-user',
        email='timed-final@example.com',
        password_hash='test',
        time_zone='Asia/Shanghai',
    )
    db_session.add(user)
    db_session.flush()
    anime = add_anime(db_session, external_id='timed-final', title='Timed final', user_id=user.id)
    anime.total_episodes = 1
    final_episode = add_episode(
        db_session,
        anime,
        number=1,
        air_at=datetime(2026, 8, 3, 14, tzinfo=UTC),
        status=EpisodeStatus.AIRED,
        has_time=True,
    )
    db_session.commit()

    result = get_user_airing_calendar(db_session, user, start_date=now.date(), now=now)

    assert result['totalAnimeCount'] == 1
    assert result['days'][0]['items'][0]['episodes'][0]['id'] == final_episode.id
    assert result['days'][0]['items'][0]['episodes'][0]['airAtPrecision'] == 'datetime'


def test_airing_calendar_uses_only_the_active_local_snapshot(db_session: Session) -> None:
    now = datetime(2026, 8, 2, 12, tzinfo=UTC)
    user = User(username='snapshot-user', email='snapshot@example.com', password_hash='test', time_zone='UTC')
    db_session.add(user)
    db_session.flush()
    anime = add_anime(db_session, external_id='snapshot', title='Upstream title', user_id=user.id)
    add_episode(
        db_session,
        anime,
        number=1,
        air_at=now - timedelta(days=2),
        status=EpisodeStatus.AIRED,
        has_time=True,
    )
    add_episode(
        db_session,
        anime,
        number=2,
        air_at=now + timedelta(days=2),
        status=EpisodeStatus.UPCOMING,
        has_time=True,
    )
    snapshot = UserAnimeMetadataSnapshot(
        user_id=user.id,
        anime_id=anime.id,
        source_provider='bangumi',
        source_external_id='snapshot-local',
        source_title='Frozen title',
        episode_count=2,
    )
    db_session.add(snapshot)
    db_session.flush()
    db_session.add_all(
        [
            UserAnimeMetadataEpisodeSnapshot(
                snapshot_id=snapshot.id,
                episode_number=1,
                title='Frozen episode 1',
                air_at=now - timedelta(days=2),
                air_at_has_time=True,
                status=EpisodeStatus.AIRED.value,
            ),
            UserAnimeMetadataEpisodeSnapshot(
                snapshot_id=snapshot.id,
                episode_number=2,
                title='Frozen episode 2',
                air_at=now + timedelta(days=1),
                air_at_has_time=True,
                status=EpisodeStatus.UPCOMING.value,
            ),
        ],
    )
    progress = db_session.query(UserAnimeProgress).filter_by(user_id=user.id, anime_id=anime.id).one()
    progress.metadata_source = UserAnimeMetadataSource.LOCAL_SNAPSHOT.value
    progress.metadata_snapshot_id = snapshot.id
    db_session.commit()

    result = get_user_airing_calendar(db_session, user, start_date=now.date(), now=now)

    item = result['days'][1]['items'][0]
    assert item['anime']['displayName'] == 'Frozen title'
    assert item['episodes'][0]['displayName'] == 'Frozen episode 2'
    assert not result['days'][2]['items']


def test_airing_calendar_does_not_expose_tvdb_status_boundary_as_exact_time(
    db_session: Session,
) -> None:
    now = datetime(2026, 8, 2, 8, tzinfo=UTC)
    user = User(username='tvdb-user', email='tvdb@example.com', password_hash='test', time_zone='Asia/Shanghai')
    db_session.add(user)
    db_session.flush()
    anime = add_anime(
        db_session,
        external_id='tvdb-time',
        title='TVDB time',
        user_id=user.id,
        provider_type='tvdb',
    )
    add_episode(
        db_session,
        anime,
        number=1,
        air_at=now - timedelta(days=7),
        status=EpisodeStatus.AIRED,
        has_time=False,
    )
    episode = add_episode(
        db_session,
        anime,
        number=2,
        air_at=datetime(2026, 8, 3, tzinfo=UTC),
        status=EpisodeStatus.UPCOMING,
        has_time=False,
        status_air_at=datetime(2026, 8, 3, 14, 30, tzinfo=UTC),
    )
    db_session.commit()

    result = get_user_airing_calendar(db_session, user, start_date=now.date(), now=now)

    item = result['days'][1]['items'][0]
    assert item['scheduleSummary'] == {
        'earliestExactAirAt': None,
        'exactTimeSlotCount': 0,
        'hasDatePrecision': True,
    }
    assert item['episodes'][0]['id'] == episode.id
    assert item['episodes'][0]['airAt'] == '2026-08-03T00:00:00Z'
    assert item['episodes'][0]['airAtPrecision'] == 'date'
