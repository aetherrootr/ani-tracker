from __future__ import annotations

import re
from datetime import date, timedelta

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue
from sqlalchemy.orm import Session

from app.api.utils.auth import require_auth_user
from app.models.user import User
from app.services.airing_calendar import get_user_airing_calendar

airing_calendar_bp = Blueprint('airing_calendar', __name__)


@airing_calendar_bp.get('/airing-calendar')
@require_auth_user
def get_airing_calendar(db: Session, user: User) -> ResponseReturnValue:
    start_date_value = request.args.get('startDate')
    if start_date_value is not None and re.fullmatch(r'\d{4}-\d{2}-\d{2}', start_date_value) is None:
        return jsonify({'message': 'startDate must be an ISO date'}), 400
    try:
        start_date = date.fromisoformat(start_date_value) if start_date_value is not None else None
    except ValueError:
        return jsonify({'message': 'startDate must be an ISO date'}), 400
    if start_date is not None and start_date > date.max - timedelta(days=6):
        return jsonify({'message': 'startDate is outside the supported range'}), 400

    response = jsonify(get_user_airing_calendar(db, user, start_date=start_date))
    response.headers['Cache-Control'] = 'private, no-store'
    return response
