# OpenF1 Service (NestJS)

A lightweight NestJS service that proxies and orchestrates data from the public OpenF1 API (`https://api.openf1.org/v1`). Includes Swagger docs, strong typing, and basic error handling.

## Quick Start
```bash
npm install
npm run start
# API base: http://localhost:3000/api
# Swagger:   http://localhost:3000/api/docs
```

## Endpoints
- GET `/api/openf1/drivers`
	- Returns deduplicated active drivers (fields: `driver_number`, `full_name`, `team_name`, `team_colour`, `headshot_url`).

- GET `/api/openf1/drivers/:driverNumber/last-race`
	- Hardcoded to year 2025 (per requirement).
	- Picks the latest race session from `/sessions?year=2025&session_type=Race` (last element of the returned array).
	- Returns `{ session_key, position, points }` using `/session_result` with `/position` fallback.

- GET `/api/openf1/telemetry?sessionKey=###&driverNumber=###`
	- Parallel fetch: `/laps`, `/stints`, `/pit`, `/weather`.
	- Merges per lap: compound (stint range), nearest weather (por timestamp), lap/sector durations.
	- Pit stops disponibles a nivel raíz (`pitStops[]`), no dentro de cada vuelta.
	- Omite claves con valor `null` en la respuesta para evitar confusiones con sensores.
	- Returns `{ raceSummary, pitStops[], telemetry[] }`.

## Swagger
- Served at `/api/docs` (Swagger UI).
- Tags: `openf1`.
- Describes the three endpoints above.

## Notes
- Telemetry maps `lap_duration` and `duration_sector_1/2/3` fields; falls back to legacy `duration`/`sector1/2/3` if needed.
- When `date_start` is missing in laps, start time is inferred from prior lap + `lap_duration`; if it cannot be inferred, weather is left null for that lap.
- The last-race endpoint is pinned to 2025 as requested. Adjust in `getLastRaceResult` if future seasons are needed.
- `telemetry[].pitStop` fue eliminado; usar `pitStops[]` top-level. Las claves con `null` no aparecen en el JSON final.
