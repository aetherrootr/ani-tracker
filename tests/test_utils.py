from __future__ import annotations

from zoneinfo import ZoneInfo

import pytest

from app.utils import local_timezone


def test_local_timezone_ignores_invalid_abbreviation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv('TZ', 'UTC')

    timezone = local_timezone('CST')

    assert timezone == 'UTC'
    assert ZoneInfo(timezone) is not None


def test_local_timezone_accepts_iana_timezone() -> None:
    timezone = local_timezone('Asia/Shanghai')

    assert timezone == 'Asia/Shanghai'
