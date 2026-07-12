from __future__ import annotations

import multiprocessing
import os
from typing import Literal

import click
from flask import Flask
from gunicorn.app.base import BaseApplication

from app import create_app
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


@click.command()
@click.option('--dev', 'mode', flag_value='dev', help='Run the Flask development server.')
@click.option('--prod', 'mode', flag_value='prod', default='prod', help='Run with Gunicorn.')
def main(mode: Literal['dev', 'prod']) -> None:
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


if __name__ == "__main__":
    main()
