@echo off
title GolfTracker - Expo Dev Server
cd /d "%~dp0"

rem Detect the current Wi-Fi IPv4 address dynamically instead of a hardcoded
rem one going stale every time this machine joins a different network.
for /f "tokens=* usebackq" %%A in (`powershell -NoProfile -Command "(Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress"`) do set WIFI_IP=%%A

echo.
echo ==========================================
echo   GolfTracker - Iniciando servidor Expo
echo ==========================================
echo.
if defined WIFI_IP (
  echo Si no ves el QR, abre Expo Go en tu iPhone
  echo y escribe manualmente: exp://%WIFI_IP%:8081
  set REACT_NATIVE_PACKAGER_HOSTNAME=%WIFI_IP%
) else (
  echo No se pudo detectar la IP de WiFi automaticamente.
  echo Ejecuta "ipconfig" y busca la IPv4 del adaptador Wi-Fi.
)
echo.
echo Asegurate de que el iPhone este en la misma WiFi
echo.
npx expo start --lan
pause
