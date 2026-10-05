@echo off
rem KofClub demo for Windows (PowerShell or Command Prompt). Needs only
rem Docker Desktop. From the KofClub folder run:   .\demo.cmd
rem It creates .env, builds and starts every service in Docker and loads the
rem demo accounts. Stop it with:   docker compose down
setlocal
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker is not running. Start Docker Desktop, wait until it shows "Engine running", then run .\demo.cmd again.
  exit /b 1
)

echo == Creating .env with generated secrets
docker run --rm -v "%cd%:/repo" -w /repo node:22-alpine node scripts/init-env.mjs
if errorlevel 1 exit /b 1

echo == Building and starting the services (the first run takes 5-10 minutes)
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build --wait
if errorlevel 1 (
  echo Starting failed. "docker compose logs" shows why; ports 3000, 4000 and 4100 must be free.
  exit /b 1
)

echo == Creating the demo accounts
docker compose exec -T -e SEED_FILE=/app/seeds/demo.json control-api node dist/seed/run-seed.js
if errorlevel 1 exit /b 1

echo.
echo KofClub is running: open http://localhost:3000
echo Log in as alice / alice-demo-password, bob / bob-demo-password or carol / carol-demo-password.
echo Use a second browser or a private window to play against yourself.
echo Stop it with: docker compose down
