from __future__ import annotations

import json
import uuid

from flask import Blueprint, Response, current_app, jsonify, request
from flask.typing import ResponseReturnValue
from sqlalchemy.orm import Session

from app.api.utils.auth import require_auth_user
from app.api.utils.providers import get_import_provider_factory
from app.api.utils.tvtime_import import (
    parse_tvtime_import_options,
    queued_tvtime_report,
    read_tvtime_upload_files,
    tvtime_job_response,
    tvtime_report_dir,
)
from app.import_provider.exceptions import ImportProviderResponseError
from app.models.user import User
from app.services.tvtime_import.jobs import (
    active_user_job,
    latest_user_job,
    load_job,
    store_input_files,
    store_job,
)
from app.tasks.tvtime_import import run_tvtime_import_job

tvtime_import_bp = Blueprint('tvtime_import', __name__)


@tvtime_import_bp.get('/tvtime')
@require_auth_user
def get_current_tvtime_import(_db: Session, user: User) -> ResponseReturnValue:
    report_dir = tvtime_report_dir()
    job = active_user_job(report_dir, user.id) or latest_user_job(report_dir, user.id)
    if job is None:
        return jsonify({'job': None})
    return jsonify({'job': tvtime_job_response(str(job['jobId']), user.id, str(job['status']), job)})


@tvtime_import_bp.post('/tvtime')
@require_auth_user
def upload_tvtime_import(_db: Session, user: User) -> ResponseReturnValue:
    options, error = parse_tvtime_import_options()
    if error is not None:
        return jsonify({'message': error}), 400
    try:
        get_import_provider_factory().get_provider(options.backend)
    except ImportProviderResponseError:
        return jsonify({'message': 'TVDB import provider is not available'}), 400

    report_dir = tvtime_report_dir()
    active_job = active_user_job(report_dir, user.id)
    if active_job is not None:
        return jsonify(
            {
                'message': 'A TV Time import is already running',
                'job': tvtime_job_response(str(active_job['jobId']), user.id, str(active_job['status']), active_job),
            },
        ), 409

    files, error = read_tvtime_upload_files(request.files.getlist('file'))
    if error is not None:
        return jsonify({'message': error}), 400

    job_id = uuid.uuid4().hex
    input_path = store_input_files(report_dir, job_id, files)
    report = queued_tvtime_report(options, user)
    store_job(report_dir, job_id, {'jobId': job_id, 'userId': user.id, 'status': 'queued', 'report': report, 'progress': report['progress'], 'summary': report['summary']})
    run_tvtime_import_job.delay(
        job_id,
        user.id,
        str(input_path),
        str(report_dir),
        str(current_app.config.get('DATABASE_URL') or ''),
        {
            'backend': options.backend,
            'dryRun': options.dry_run,
            'includeFollowed': options.include_followed,
            'includeSpecials': options.include_specials,
            'tvdbWorkers': options.tvdb_workers,
        },
    )
    return jsonify(tvtime_job_response(job_id, user.id, 'queued', report)), 202


@tvtime_import_bp.get('/tvtime/<job_id>')
@require_auth_user
def get_tvtime_import(_db: Session, user: User, job_id: str) -> ResponseReturnValue:
    job = load_job(tvtime_report_dir(), job_id)
    if job is None or job.get('userId') != user.id:
        return jsonify({'message': 'Import job not found'}), 404
    return jsonify(tvtime_job_response(job_id, user.id, str(job['status']), job))


@tvtime_import_bp.get('/tvtime/<job_id>/report')
@require_auth_user
def download_tvtime_import_report(_db: Session, user: User, job_id: str) -> ResponseReturnValue:
    job = load_job(tvtime_report_dir(), job_id)
    if job is None or job.get('userId') != user.id:
        return jsonify({'message': 'Import job not found'}), 404
    return Response(
        json.dumps(job.get('report', {}), ensure_ascii=False, indent=2),
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment; filename=tvtime-import-{job_id}.json'},
    )
