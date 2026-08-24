# Implementation plan

## Milestone 0 — Research

Written in `docs/research.md`. Transport isolated; no source copied from community proxies.

## Milestone 1 — Single account

Monorepo, Fastify, `HttpAlphaTransport`, `GET /v1/models`, `POST /v1/chat/completions` streaming + tools, SQLite, CLI `start` / `init`.

## Milestone 2 — Multi account

Account pool, sticky router, persistence, Anthropic `/v1/messages`.

## Milestone 3 — Reliability

Error classifier, failover (max 2), cooldown + recovery timer, health monitor (whoami + billing, no expensive generate).

## Milestone 4 — Quota engine

Upstream credits/windows, local estimates, pool aggregation, usage tracker, subsidy math when subscription cost is configured.

## Milestone 5 — Dashboard

Vue 3 Overview / Accounts / Sessions / Usage / Events / Settings + SSE.

## Milestone 6 — Integrations

`setup opencode`, `setup claude`, Docker, encrypted secrets, first-run onboarding.

## Milestone 7 — Release

Unit / integration / chaos / Playwright E2E against mock transport, npm bin, CI, README, troubleshooting.

## Out of MVP

External PAYG fallback, automatic vision escalation, Prometheus, multi-user, account groups.
