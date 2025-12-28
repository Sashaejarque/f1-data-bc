# OpenF1Module Minimal Service

A minimal NestJS setup exposing OpenF1-backed endpoints.

## Endpoints
- GET `/api/openf1/drivers`
- GET `/api/openf1/drivers/:driverNumber/last-race`
- GET `/api/openf1/telemetry?sessionKey=###&driverNumber=###`

## Setup
```bash
npm install
```

## Run
```bash
npm run start
# Open http://localhost:3000/api/openf1/drivers
```
