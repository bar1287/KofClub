@echo off
rem KofClub demo for Windows (PowerShell or Command Prompt). Needs only
rem Docker Desktop. From the KofClub folder run:   .\demo.cmd
rem It starts Docker Desktop if needed, creates .env, builds and starts every
rem service in Docker, loads the demo accounts and opens the site.
rem If something fails it saves what is needed to find out why in
rem demo-log.txt (".\demo.cmd diagnose" saves it at any time).
rem Stop it with:   docker compose down
setlocal
cd /d "%~dp0"
set "DEMO_VERSION=2026-10-07"
set "COMPOSE=docker compose -f docker-compose.yml -f docker-compose.demo.yml"
echo == KofClub demo (demo.cmd %DEMO_VERSION%)
if /i "%~1"=="diagnose" goto diagnose

where docker >nul 2>&1
if errorlevel 1 (
  echo Docker is not installed, or this window was opened before it was installed.
  echo Install Docker Desktop from https://www.docker.com/products/docker-desktop/
  echo then open a NEW PowerShell window, go to this folder and run .\demo.cmd again.
  pause
  exit /b 1
)

docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
set "DOCKER_DESKTOP=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if exist "%DOCKER_DESKTOP%" (
  echo == Starting Docker Desktop - look for its window or its whale icon in the taskbar
  start "" "%DOCKER_DESKTOP%"
) else (
  echo == Start Docker Desktop from the Start menu now
)
echo == Waiting for the Docker engine (up to 6 minutes; accept any Docker Desktop prompts)
set /a tries=0
:wait_docker
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
set /a tries+=1
if %tries% geq 120 goto docker_failed
ping -n 4 127.0.0.1 >nul
goto wait_docker

:docker_failed
echo.
echo Docker Desktop is installed but its engine is not running. Open Docker
echo Desktop and read what it shows: it may ask you to accept its terms, to
echo update WSL (run "wsl --update" in PowerShell, then restart Windows) or to
echo enable virtualization. When it shows "Engine running", run .\demo.cmd again.
echo.
echo What Docker reports:
docker version
call :collect_docker
echo.
echo Details were saved to demo-log.txt in this folder: send that file to
echo whoever is helping you.
pause
exit /b 1

:docker_ready
echo == Docker is running

echo == Creating .env with generated secrets
docker run --rm -v "%cd%:/repo" -w /repo node:22-alpine node scripts/init-env.mjs
if errorlevel 1 goto failed

echo == Building and starting the services (the first run can take 10-25 minutes)
%COMPOSE% up -d --build --wait
if errorlevel 1 goto failed

echo == Creating the demo accounts
%COMPOSE% exec -T -e SEED_FILE=/app/seeds/demo.json control-api node dist/seed/run-seed.js
if errorlevel 1 goto failed

echo.
echo KofClub is running: http://localhost:3000 (opening it in your browser)
echo Log in as alice / alice-demo-password, bob / bob-demo-password or carol / carol-demo-password.
echo Use a second browser or a private window to play against yourself.
echo Stop it with: docker compose down
start "" http://localhost:3000
pause
exit /b 0

:failed
call :collect
echo.
echo Something went wrong. Everything needed to find out why was saved to
echo demo-log.txt in this folder: send that file to whoever is helping you.
pause
exit /b 1

:diagnose
call :collect
echo Saved demo-log.txt in this folder.
exit /b 0

rem Writes Docker Desktop's state to demo-log.txt: versions, engine status,
rem WSL and the end of Docker Desktop's own log (why the engine stopped).
:collect_docker
> demo-log.txt echo KofClub demo diagnostics, demo.cmd %DEMO_VERSION%, %date% %time%
ver >> demo-log.txt 2>&1
if exist .env (>> demo-log.txt echo .env exists) else (>> demo-log.txt echo .env is missing)
>> demo-log.txt echo ==== docker version
docker version >> demo-log.txt 2>&1
>> demo-log.txt echo ==== docker context ls
docker context ls >> demo-log.txt 2>&1
>> demo-log.txt echo ==== docker desktop status
docker desktop status >> demo-log.txt 2>&1
set "WSL_UTF8=1"
>> demo-log.txt echo ==== wsl --version
wsl --version >> demo-log.txt 2>&1
>> demo-log.txt echo ==== wsl -l -v
wsl -l -v >> demo-log.txt 2>&1
>> demo-log.txt echo ==== Docker Desktop processes
tasklist /fi "imagename eq Docker Desktop.exe" >> demo-log.txt 2>&1
tasklist /fi "imagename eq com.docker.backend.exe" >> demo-log.txt 2>&1
>> demo-log.txt echo ==== end of Docker Desktop's log
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -Tail 150 -LiteralPath (Join-Path $env:LOCALAPPDATA 'Docker\log\host\com.docker.backend.exe.log')" >> demo-log.txt 2>&1
exit /b 0

rem Adds port use, a rebuild and the container logs (no secrets: .env is
rem not included).
:collect
echo.
echo == Saving details to demo-log.txt (this can take a few minutes)
call :collect_docker
>> demo-log.txt echo ==== docker compose version
docker compose version >> demo-log.txt 2>&1
>> demo-log.txt echo ==== docker info
docker info >> demo-log.txt 2>&1
>> demo-log.txt echo ==== ports 3000, 4000 and 4100 in use
netstat -ano -p tcp | findstr /c:":3000 " /c:":4000 " /c:":4100 " >> demo-log.txt 2>&1
>> demo-log.txt echo ==== ports reserved by Windows
netsh interface ipv4 show excludedportrange protocol=tcp >> demo-log.txt 2>&1
>> demo-log.txt echo ==== build
%COMPOSE% build >> demo-log.txt 2>&1
>> demo-log.txt echo ==== start
%COMPOSE% up -d >> demo-log.txt 2>&1
>> demo-log.txt echo ==== containers
%COMPOSE% ps -a >> demo-log.txt 2>&1
>> demo-log.txt echo ==== logs
%COMPOSE% logs --no-color --tail 80 >> demo-log.txt 2>&1
exit /b 0
