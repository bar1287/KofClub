@echo off
rem KofClub demo for Windows (PowerShell or Command Prompt). Needs only
rem Docker Desktop. From the KofClub folder run:   .\demo.cmd
rem It starts Docker Desktop if needed, creates .env, builds and starts every
rem service in Docker and loads the demo accounts.
rem Stop it with:   docker compose down
setlocal
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 (
  echo Docker is not installed, or this window was opened before it was installed.
  echo Install Docker Desktop from https://www.docker.com/products/docker-desktop/
  echo then open a NEW PowerShell window, go to this folder and run .\demo.cmd again.
  exit /b 1
)

docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
  echo == Starting Docker Desktop
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
)
echo == Waiting for the Docker engine (up to 4 minutes; accept any Docker Desktop prompts)
set /a tries=0
:wait_docker
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
set /a tries+=1
if %tries% geq 80 goto docker_failed
ping -n 4 127.0.0.1 >nul
goto wait_docker

:docker_failed
echo.
echo Docker is still not running. Open Docker Desktop and wait until it shows
echo "Engine running" (the first start can ask you to accept terms or to
echo install/update WSL and restart Windows), then run .\demo.cmd again.
echo What Docker reports:
docker info 2>&1 | findstr /i /c:"error" /c:"cannot" /c:"failed"
exit /b 1

:docker_ready
echo == Docker is running

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
