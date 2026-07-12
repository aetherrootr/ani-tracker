from __future__ import annotations

import re
import shutil
from pathlib import Path

import pytest


@pytest.fixture()
def test_instance_path(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> Path:
    safe_name = re.sub(r'[^A-Za-z0-9_.-]+', '-', request.node.nodeid).strip('-')
    path = Path('/tmp/ani-tracker') / safe_name  # noqa: S108 - Tests intentionally use this shared root.
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv('ANIME_TRACKER_INSTANCE_PATH', str(path))
    return path
