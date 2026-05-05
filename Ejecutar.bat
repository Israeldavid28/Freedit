@echo off
title Freedit - Simulador Reddit con Arboles Binarios (Portable)
color 0A
cls

echo.
echo  ====================================================
echo   FREEDIT - Programacion No Numerica
echo   Iniciando el servidor en modo PORTABLE
echo  ====================================================
echo.

:: Configuración de directorios
cd /d "%~dp0"
set NODE_DIR=%~dp0node_portable
set NODE_EXE=%NODE_DIR%\node.exe
set NPM_CMD=%NODE_DIR%\npm.cmd

:: Verificar si PostgreSQL esta corriendo (Requisito del sistema)
echo [1/3] Verificando PostgreSQL...
sc query postgresql-x64-18 | findstr "RUNNING" >nul 2>&1
if %errorlevel% neq 0 (
    echo  ^! PostgreSQL no esta corriendo. Intentando iniciarlo...
    net start postgresql-x64-18 >nul 2>&1
    timeout /t 3 /nobreak >nul
    sc query postgresql-x64-18 | findstr "RUNNING" >nul 2>&1
    if %errorlevel% neq 0 (
        echo  X ERROR: No se pudo iniciar PostgreSQL.
        echo    Abre "Servicios" y asegurate que postgresql-x64-18 este en ejecucion.
        pause
        exit /b 1
    )
)
echo  OK PostgreSQL esta corriendo.

:: Configurar Node.js Portable
echo [2/3] Verificando entorno Node.js portable...
if not exist "%NODE_EXE%" (
    echo  - Descargando Node.js Portable... (esto puede tardar unos minutos dependiendo de tu conexion)
    mkdir "%NODE_DIR%" 2>nul
    powershell -Command "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip' -OutFile 'node.zip'"
    echo  - Extrayendo Node.js...
    powershell -Command "Expand-Archive -Path 'node.zip' -DestinationPath 'node_temp' -Force"
    xcopy /E /Y /Q "node_temp\node-v20.11.1-win-x64\*" "%NODE_DIR%\" >nul
    rmdir /S /Q "node_temp"
    del "node.zip"
    echo  OK Node.js portable instalado exitosamente.
) else (
    echo  OK Node.js portable ya esta configurado.
)

:: Verificar que node_modules existe
if not exist "node_modules\" (
    echo [2.5/3] Instalando dependencias del proyecto usando npm portable...
    call "%NPM_CMD%" install
    if %errorlevel% neq 0 (
        echo  X ERROR al instalar dependencias.
        pause
        exit /b 1
    )
) else (
    echo  OK Dependencias instaladas.
)

echo [3/3] Iniciando servidor Express...
echo.
echo  ====================================================
echo   Servidor iniciando en http://localhost:3000
echo   Presiona Ctrl+C para detener el servidor
echo  ====================================================
echo.

:: Abrir el navegador despues de 3 segundos
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

:: Iniciar el servidor con el Node portable
"%NODE_EXE%" src/index.js

:: Si el servidor termina, mantener la ventana abierta
echo.
echo  El servidor se detuvo.
pause
