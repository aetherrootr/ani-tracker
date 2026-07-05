from __future__ import annotations

from app import create_app


def main() -> None:
    app = create_app()
    app.run(host="0.0.0.0", port=3001)


if __name__ == "__main__":
    main()
