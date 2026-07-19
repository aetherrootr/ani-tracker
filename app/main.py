from __future__ import annotations

import multiprocessing
import os
import secrets
import string
from typing import Literal

import click
from flask import Flask
from gunicorn.app.base import BaseApplication
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import create_app
from app.api.utils.auth import hash_password
from app.celery_app import celery_app
from app.db import default_database_url, ensure_database_current
from app.models.user import User
from app.utils import env_int

BIND = '0.0.0.0:3001'


class GunicornApplication(BaseApplication):
    def __init__(self, application: Flask, options: dict[str, object]) -> None:
        self.application = application
        self.options = options
        super().__init__()

    def load_config(self) -> None:
        for key, value in self.options.items():
            if key in self.cfg.settings and value is not None:
                self.cfg.set(key, value)

    def load(self) -> Flask:
        return self.application


def gunicorn_workers() -> int:
    worker_count = os.getenv('WEB_CONCURRENCY')
    if worker_count:
        return int(worker_count)

    return multiprocessing.cpu_count() * 2 + 1


def gunicorn_timeout() -> int:
    return env_int('GUNICORN_TIMEOUT', default=120, minimum=1)


def run_server(mode: Literal['dev', 'prod']) -> None:
    app = create_app()
    if mode == 'dev':
        app.run(host='0.0.0.0', port=3001)
        return

    GunicornApplication(
        app,
        {
            'bind': BIND,
            'workers': gunicorn_workers(),
            'timeout': gunicorn_timeout(),
        },
    ).run()


def run_worker(loglevel: str, celery_args: tuple[str, ...]) -> None:
    celery_app.worker_main(['worker', '--loglevel', loglevel, *celery_args])


def run_beat(loglevel: str, celery_args: tuple[str, ...]) -> None:
    celery_app.start(['beat', '--loglevel', loglevel, *celery_args])


def generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def reset_user_password(username: str) -> str:
    next_password = generate_password()
    database_url = default_database_url()
    ensure_database_current(database_url)
    connect_args = {'check_same_thread': False} if database_url.startswith('sqlite') else {}
    engine = create_engine(database_url, connect_args=connect_args)
    try:
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            user = db.scalar(select(User).where(User.username == username))
            if user is None:
                message = f'User not found: {username}'
                raise click.ClickException(message)
            user.password_hash = hash_password(next_password)
            db.commit()
    finally:
        engine.dispose()
    return next_password


@click.group(invoke_without_command=True)
@click.option('--dev', 'mode', flag_value='dev', help='Run the Flask development server.')
@click.option('--prod', 'mode', flag_value='prod', default='prod', help='Run with Gunicorn.')
@click.pass_context
def main(ctx: click.Context, mode: Literal['dev', 'prod']) -> None:
    if ctx.invoked_subcommand is None:
        run_server(mode)


@main.command()
@click.option('--dev', 'mode', flag_value='dev', help='Run the Flask development server.')
@click.option('--prod', 'mode', flag_value='prod', default='prod', help='Run with Gunicorn.')
def server(mode: Literal['dev', 'prod']) -> None:
    run_server(mode)


@main.command(context_settings={'ignore_unknown_options': True, 'allow_extra_args': True})
@click.option('--loglevel', default='info', show_default=True, help='Celery worker log level.')
@click.pass_context
def worker(ctx: click.Context, loglevel: str) -> None:
    run_worker(loglevel, tuple(ctx.args))


@main.command(context_settings={'ignore_unknown_options': True, 'allow_extra_args': True})
@click.option('--loglevel', default='info', show_default=True, help='Celery Beat log level.')
@click.pass_context
def beat(ctx: click.Context, loglevel: str) -> None:
    run_beat(loglevel, tuple(ctx.args))


@main.command('reset-password')
@click.argument('username')
def reset_password(username: str) -> None:
    next_password = reset_user_password(username)
    click.echo(next_password)


if __name__ == "__main__":
    main()
