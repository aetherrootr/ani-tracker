## 开发

运行后端应用：

```bash
uv run python -m app.main server
```

后端默认以 Gunicorn 生产模式运行。可以使用 `--prod` 显式选择生产模式，或使用 `--dev` 启动 Flask 开发服务器：

```bash
uv run python -m app.main server --prod
uv run python -m app.main server --dev
```

启动用于后台任务的 Celery worker：

```bash
uv run python -m app.main worker
```

额外的 Celery worker 参数会继续透传，例如 `uv run python -m app.main worker --pool=solo`。

运行本地前后端集成开发环境：

```bash
./launch_dev_service.sh
```

运行检查和测试：

```bash
uv run ruff check .
uv run mypy .
uv run pytest
```