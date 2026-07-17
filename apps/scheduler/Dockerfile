FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build

WORKDIR /app
COPY apps/scheduler/pyproject.toml apps/scheduler/uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim-bookworm AS runtime
ARG SOURCE_REVISION=unknown
ARG SOURCE_URL=unknown
ARG SOURCE_CREATED_AT=1970-01-01T00:00:00Z
COPY scripts/release/upgrade-debian.sh /tmp/upgrade-debian.sh
RUN sh /tmp/upgrade-debian.sh \
    && rm -f /tmp/upgrade-debian.sh \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10002 scheduler \
    && useradd --uid 10002 --gid 10002 --create-home scheduler

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
LABEL org.opencontainers.image.title="ExamForge Scheduler" \
    org.opencontainers.image.source="${SOURCE_URL}" \
    org.opencontainers.image.revision="${SOURCE_REVISION}" \
    org.opencontainers.image.created="${SOURCE_CREATED_AT}"

COPY --from=build --chown=10002:10002 /app/.venv /app/.venv
COPY --chown=10002:10002 apps/scheduler/examforge_scheduler /app/examforge_scheduler

USER 10002:10002
EXPOSE 8000
CMD ["uvicorn", "examforge_scheduler.http_api:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
