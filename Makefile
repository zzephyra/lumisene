.PHONY: install test run migrate up create-user create-admin grant-admin

install:
	cd backend && uv sync

test:
	cd backend && uv run pytest

run:
	cd backend && uv run uvicorn app.main:app --reload

migrate:
	cd backend && uv run alembic upgrade head

up:
	docker compose up -d --build postgres api frontend

create-user:
	@test -n "$(EMAIL)" || (echo "用法: make create-user EMAIL=user@example.com PASSWORD='password'" && exit 1)
	@test -n "$(PASSWORD)" || (echo "用法: make create-user EMAIL=user@example.com PASSWORD='password'" && exit 1)
	docker compose exec api python -m app.modules.auth.cli --email "$(EMAIL)" --password "$(PASSWORD)"

create-admin:
	@test -n "$(EMAIL)" || (echo "用法: make create-admin EMAIL=admin@example.com PASSWORD='password'" && exit 1)
	@test -n "$(PASSWORD)" || (echo "用法: make create-admin EMAIL=admin@example.com PASSWORD='password'" && exit 1)
	docker compose exec api python -m app.modules.auth.cli --email "$(EMAIL)" --password "$(PASSWORD)" --platform-admin

grant-admin:
	@test -n "$(EMAIL)" || (echo "用法: make grant-admin EMAIL=user@example.com" && exit 1)
	docker compose exec api python -m app.modules.auth.cli --grant-platform-admin --email "$(EMAIL)"
