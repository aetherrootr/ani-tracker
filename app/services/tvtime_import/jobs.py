from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any


def job_path(root: str | Path, job_id: str) -> Path:
    return Path(root) / f'{job_id}.json'


def input_dir(root: str | Path, job_id: str) -> Path:
    return Path(root) / 'inputs' / job_id


def store_job(root: str | Path, job_id: str, payload: dict[str, Any]) -> None:
    path = job_path(root, job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')


def load_job(root: str | Path, job_id: str) -> dict[str, Any] | None:
    if not job_id.isalnum():
        return None
    path = job_path(root, job_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding='utf-8'))


def list_user_jobs(root: str | Path, user_id: int) -> list[dict[str, Any]]:
    directory = Path(root)
    if not directory.exists():
        return []
    jobs: list[dict[str, Any]] = []
    for path in directory.glob('*.json'):
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if payload.get('userId') == user_id:
            payload['_mtime'] = path.stat().st_mtime
            jobs.append(payload)
    return sorted(jobs, key=lambda item: float(item.get('_mtime') or 0), reverse=True)


def active_user_job(root: str | Path, user_id: int) -> dict[str, Any] | None:
    for job in list_user_jobs(root, user_id):
        if job.get('status') in {'queued', 'running'}:
            return job
    return None


def latest_user_job(root: str | Path, user_id: int) -> dict[str, Any] | None:
    jobs = list_user_jobs(root, user_id)
    return jobs[0] if jobs else None


def update_job(root: str | Path, job_id: str, **fields: Any) -> dict[str, Any] | None:
    payload = load_job(root, job_id)
    if payload is None:
        return None
    payload.update(fields)
    store_job(root, job_id, payload)
    return payload


def store_input_files(root: str | Path, job_id: str, files: dict[str, bytes]) -> Path:
    directory = input_dir(root, job_id)
    directory.mkdir(parents=True, exist_ok=True)
    for filename, content in files.items():
        (directory / filename).write_bytes(content)
    return directory


def load_input_files(directory: str | Path) -> dict[str, bytes]:
    root = Path(directory)
    return {path.name: path.read_bytes() for path in root.iterdir() if path.is_file()}


def cleanup_input_files(directory: str | Path) -> None:
    shutil.rmtree(directory, ignore_errors=True)
