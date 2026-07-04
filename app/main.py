from __future__ import annotations

from app import create_app


def main() -> None:
    app = create_app()
    app.run(host="127.0.0.1", port=3001)


if __name__ == "__main__":
    main()
