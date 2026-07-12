from __future__ import annotations

import io
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

from flask import current_app, request
from werkzeug.datastructures import FileStorage

from app.models.user import User
from app.services.tvtime_import import EXPECTED_CSV_FILES, TvtimeImportOptions

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_SUPPORTED_ZIP_FILES = len(EXPECTED_CSV_FILES)
MAX_EXTRACTED_BYTES = 50 * 1024 * 1024


def parse_tvtime_import_options() -> tuple[TvtimeImportOptions | None, str | None]:
    backend = request.form.get('backend', 'tvdb').strip() or 'tvdb'
    if backend != 'tvdb':
        return None, 'Unsupported TV Time import backend'
    dry_run = parse_bool(request.form.get('dryRun'), default=True)
    include_followed = parse_bool(request.form.get('includeFollowed'), default=True)
    include_specials = parse_bool(request.form.get('includeSpecials'), default=True)
    try:
        workers = int(request.form.get('tvdbWorkers', '2'))
    except ValueError:
        return None, 'tvdbWorkers is invalid'
    workers = min(max(workers, 1), 5)
    return TvtimeImportOptions(backend=backend, dry_run=dry_run, include_followed=include_followed, include_specials=include_specials, tvdb_workers=workers), None


def read_tvtime_upload_files(uploads: list[FileStorage]) -> tuple[dict[str, bytes], str | None]:
    if not uploads:
        return {}, 'Upload a TV Time zip or CSV file'
    files: dict[str, bytes] = {}
    total = 0
    for upload in uploads:
        filename = Path(upload.filename or '').name
        content = upload.read(MAX_UPLOAD_BYTES + 1)
        total += len(content)
        if total > MAX_UPLOAD_BYTES or len(content) > MAX_UPLOAD_BYTES:
            return {}, 'Upload is too large'
        if filename.lower().endswith('.zip'):
            extracted, error = extract_tvtime_zip(content)
            if error is not None:
                return {}, error
            files.update(extracted)
        elif filename in EXPECTED_CSV_FILES:
            files[filename] = content
        else:
            return {}, 'Only TV Time zip exports or expected CSV files are supported'
    if not files:
        return {}, 'No supported TV Time CSV files were found'
    if 'tracking-prod-records-v2.csv' not in files and 'user_tv_show_data.csv' not in files:
        return {}, 'Upload must include tracking-prod-records-v2.csv or user_tv_show_data.csv'
    return files, None


def extract_tvtime_zip(content: bytes) -> tuple[dict[str, bytes], str | None]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        return {}, 'Uploaded zip is invalid'
    result: dict[str, bytes] = {}
    total = 0
    infos = [info for info in archive.infolist() if not info.is_dir()]
    supported_infos = []
    for info in infos:
        path = PurePosixPath(info.filename)
        if path.is_absolute() or '..' in path.parts:
            return {}, 'Uploaded zip contains unsafe paths'
        name = path.name
        if name not in EXPECTED_CSV_FILES:
            continue
        supported_infos.append(info)
    if len(supported_infos) > MAX_SUPPORTED_ZIP_FILES:
        return {}, 'Uploaded zip contains too many TV Time CSV files'
    for info in supported_infos:
        name = PurePosixPath(info.filename).name
        if info.file_size > MAX_UPLOAD_BYTES:
            return {}, 'Uploaded CSV is too large'
        total += info.file_size
        if total > MAX_EXTRACTED_BYTES:
            return {}, 'Uploaded zip is too large after extraction'
        result[name] = archive.read(info)
    return result, None


def tvtime_report_dir() -> Path:
    return Path(str(current_app.config.get('TVTIME_IMPORT_REPORT_DIR') or Path(current_app.instance_path) / 'tvtime_import_reports'))


def tvtime_job_response(job_id: str, user_id: int, status: str, report: dict[str, Any]) -> dict[str, Any]:
    nested_report = report.get('report')
    report_data: dict[str, Any] = nested_report if isinstance(nested_report, dict) else report
    return {
        'jobId': job_id,
        'userId': user_id,
        'status': status,
        'progress': report.get('progress') or report_data.get('progress'),
        'summary': report.get('summary') or report_data.get('summary'),
        'backend': report_data.get('backend'),
        'dryRun': report_data.get('dryRun'),
        'reportUrl': f'/api/import/tvtime/{job_id}/report',
    }


def queued_tvtime_report(options: TvtimeImportOptions, user: User) -> dict[str, Any]:
    return {
        'summary': {},
        'progress': {'stage': 'queued', 'processed': 0, 'total': 1, 'percent': 0, 'message': 'Import job queued'},
        'backend': options.backend,
        'languagePreference': user.language_preference,
        'dryRun': options.dry_run,
        'includeSpecials': options.include_specials,
        'unresolved': [],
        'providerFailures': [],
        'relatedAnimeWarnings': [],
        'extraWatchEvents': [],
    }


def parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}
