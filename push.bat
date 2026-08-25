@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo ========================================
echo   Backend Deploy Script
echo   Current Dir: %cd%
echo ========================================
echo.
echo [INFO] This script will:
echo        1) git add .
echo        2) git commit
echo        3) git push origin %CUR_BRANCH%        (save to GitHub)
echo        4) wrangler deploy                    (deploy Worker to Cloudflare)
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Not inside a Git repository.
    echo         Please run: git init
    echo         then add remote: git remote add origin ^<url^>
    pause
    exit /b 1
)

set REMOTE_URL=
for /f "usebackq delims=" %%i in (`git remote get-url origin`) do set REMOTE_URL=%%i
if "%REMOTE_URL%"=="" (
    echo [ERROR] Remote 'origin' not configured.
    echo         Run: git remote add origin ^<url^>
    pause
    exit /b 1
)
echo [INFO] Remote: %REMOTE_URL%

set CUR_BRANCH=
for /f "usebackq delims=" %%i in (`git branch --show-current`) do set CUR_BRANCH=%%i
if "%CUR_BRANCH%"=="" set CUR_BRANCH=main
echo [INFO] Branch: %CUR_BRANCH%
if not "%CUR_BRANCH%"=="main" (
    echo [WARN] Current branch is '%CUR_BRANCH%', not 'main'. Cloudflare auto-deploy listens on 'main'.
)
echo.

set HAS_CHANGES=0
for /f "usebackq delims=" %%i in (`git status --porcelain`) do set HAS_CHANGES=1
if %HAS_CHANGES%==0 (
    echo [SKIP] No changes detected. Nothing to commit.
    echo.
    pause
    exit /b 0
)

echo [INFO] Changes detected:
git status --short
echo.

echo [1/4] git add . ...
git add .
if errorlevel 1 (
    echo [ERROR] git add failed!
    pause
    exit /b 1
)
echo       OK.
echo.

set TS=
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%i
if "%TS%"=="" set TS=%DATE% %TIME%
set COMMIT_MSG=Update %TS%

echo [2/4] git commit -m "%COMMIT_MSG%" ...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo [ERROR] git commit failed!
    pause
    exit /b 1
)
echo       OK.
echo.

echo [3/4] git push origin %CUR_BRANCH% ...
git push origin %CUR_BRANCH%
set PUSH_ERR=%errorlevel%

if %PUSH_ERR% neq 0 (
    echo.
    echo [ERROR] git push failed ^(exit code %PUSH_ERR%^).
    echo.
    echo   Common causes and solutions:
    echo   - Remote has newer commits:   git pull --rebase origin %CUR_BRANCH%
    echo                                ^(if that fails, use: git fetch origin main ^&^& git reset --hard origin/main^)
    echo   - Remote diverged / stale:    git push --force-with-lease origin %CUR_BRANCH%
    echo   - Wrong target branch:        ensure pushing to 'main' ^(not 'master'^), Cloudflare listens on 'main'
    echo   - No push permission:         check GitHub SSH key or PAT token
    echo   - Network issue:              check internet or proxy settings
    echo.
    pause
    exit /b %PUSH_ERR%
)

echo       OK.
echo.

echo [4/4] wrangler deploy (deploy Worker to Cloudflare) ...
where wrangler >nul 2>&1
if errorlevel 1 (
    echo [WARN] 'wrangler' command not found in PATH.
    echo        Install:  npm install -g wrangler@latest
    echo        Login:    wrangler login
    echo        Then re-run this script, or deploy manually:
    echo          cd /d "%cd%"
    echo          wrangler deploy
    echo.
    pause
    exit /b 2
)

wrangler deploy
set W_ERR=%errorlevel%
if %W_ERR% neq 0 (
    echo.
    echo [ERROR] wrangler deploy failed ^(exit code %W_ERR%^).
    echo.
    echo   Common causes and solutions:
    echo   - Not logged in:              wrangler login
    echo   - Wrong Cloudflare account:   wrangler whoami   (check matches 'chat' Worker)
    echo   - wrangler.toml syntax error: check file for typos
    echo   - KV namespace not found:     verify CHAT_KV id in wrangler.toml
    echo   - Network / auth issue:       wrangler logout ^&^& wrangler login
    echo.
    pause
    exit /b %W_ERR%
)
echo       OK.
echo.

echo ========================================
echo   Done! Push + Deploy successful.
echo   - Worker:   https://chat.zztxer.dpdns.org
echo   - Health:   https://chat.zztxer.dpdns.org/health
echo   - Version:  https://chat.zztxer.dpdns.org/api/app-version
echo ========================================
echo.
pause
endlocal
