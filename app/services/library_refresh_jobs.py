from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

LOCK_TTL = timedelta(hours=6)


@dataclass(frozen=True)
class LibraryRefreshLock:
    acquired: bool
    task_id: str
    lock_path: str


def acquire_library_refresh_lock(*, user_id: int, task_id: str, lock_dir: str) -> LibraryRefreshLock:
    directory = Path(lock_dir)
    directory.mkdir(parents=True, exist_ok=True)
    lock_path = directory / f'user-{user_id}.json'
    _remove_stale_lock(lock_path)
    payload = json.dumps({'taskId': task_id, 'createdAt': datetime.now(UTC).isoformat()})
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return LibraryRefreshLock(acquired=False, task_id=_existing_task_id(lock_path) or task_id, lock_path=str(lock_path))
    with os.fdopen(fd, 'w', encoding='utf-8') as file:
        file.write(payload)
    return LibraryRefreshLock(acquired=True, task_id=task_id, lock_path=str(lock_path))


def store_library_refresh_job(root: str | Path, job_id: str, payload: dict[str, Any]) -> None:
    path = _job_path(root, job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')


def load_library_refresh_job(root: str | Path, job_id: str) -> dict[str, Any] | None:
    if not job_id.isalnum():
        return None
    path = _job_path(root, job_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding='utf-8'))


def update_library_refresh_job(root: str | Path, job_id: str, **fields: Any) -> dict[str, Any] | None:
    payload = load_library_refresh_job(root, job_id)
    if payload is None:
        return None
    payload.update(fields)
    store_library_refresh_job(root, job_id, payload)
    return payload


def current_library_refresh_job(root: str | Path, user_id: int) -> dict[str, Any] | None:
    jobs = [job for job in _user_jobs(root, user_id) if job.get('kind') in {None, 'library_refresh'}]
    active = next((job for job in jobs if job.get('status') in {'queued', 'running'}), None)
    return active or (jobs[0] if jobs else None)


def current_user_job(
    root: str | Path,
    *,
    user_id: int,
    kind: str,
    anime_id: int | None = None,
) -> dict[str, Any] | None:
    jobs = [job for job in _user_jobs(root, user_id) if job.get('kind') == kind and (anime_id is None or job.get('animeId') == anime_id)]
    active = next((job for job in jobs if job.get('status') in {'queued', 'running'}), None)
    return active or (jobs[0] if jobs else None)


def current_job_by_kind(root: str | Path, *, kind: str) -> dict[str, Any] | None:
    jobs = [job for job in _jobs(root) if job.get('kind') == kind]
    active = next((job for job in jobs if job.get('status') in {'queued', 'running'}), None)
    return active or (jobs[0] if jobs else None)


def release_library_refresh_lock(lock_path: str | None) -> None:
    if not lock_path:
        return
    try:
        Path(lock_path).unlink()
    except FileNotFoundError:
        return


def _existing_task_id(lock_path: Path) -> str | None:
    try:
        data = json.loads(lock_path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    task_id = data.get('taskId') if isinstance(data, dict) else None
    return task_id if isinstance(task_id, str) else None


def _job_path(root: str | Path, job_id: str) -> Path:
    return Path(root) / f'{job_id}.json'


def _user_jobs(root: str | Path, user_id: int) -> list[dict[str, Any]]:
    return [job for job in _jobs(root) if job.get('userId') == user_id]


def _jobs(root: str | Path) -> list[dict[str, Any]]:
    directory = Path(root)
    if not directory.exists():
        return []
    jobs: list[dict[str, Any]] = []
    for path in directory.glob('*.json'):
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        payload['_mtime'] = path.stat().st_mtime
        jobs.append(payload)
    return sorted(jobs, key=lambda item: float(item.get('_mtime') or 0), reverse=True)


def _remove_stale_lock(lock_path: Path) -> None:
    try:
        data = json.loads(lock_path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return
    except (OSError, ValueError):
        _unlink_quietly(lock_path)
        return
    created_at = data.get('createdAt') if isinstance(data, dict) else None
    if not isinstance(created_at, str):
        _unlink_quietly(lock_path)
        return
    try:
        created = datetime.fromisoformat(created_at)
    except ValueError:
        _unlink_quietly(lock_path)
        return
    if datetime.now(UTC) - created > LOCK_TTL:
        _unlink_quietly(lock_path)


def _unlink_quietly(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        return
