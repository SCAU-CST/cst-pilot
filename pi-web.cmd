@echo off
rem ============================================================
rem  CST Pilot Web UI launcher (dev checkout)
rem  Starts @agegr/pi-web (browser UI for the pi coding agent)
rem  against this checkout's isolated agent home, mirroring the
rem  isolation model of pi.cmd:
rem    - PI_CODING_AGENT_DIR unconditionally overridden -> agent\home
rem    - STRICT PATH whitelist (host PATH ignored)
rem    - Temporary state under .state\
rem  Engine: node\ runtime (dev 0.2 layout). NOT part of the 0.3
rem  release tree: the release has no node runtime (official
rem  pi.exe cannot host a node server app), so pi-web is a
rem  development-side tool. Known limit: Next.js may fetch its
rem  swc wasm into the user's LOCALAPPDATA on first run
rem  (hardcoded in Next; no official switch).
rem  NOTE: keep this file pure ASCII; cmd parses it as ANSI/GBK
rem ============================================================
setlocal
set "ROOT=%~dp0"
set "STATE=%ROOT%.state"

set "PI_CODING_AGENT_DIR=%ROOT%agent\home"
set "PI_OFFLINE=1"

md "%STATE%\tmp" 2>nul
md "%STATE%\cache" 2>nul
if not exist "%STATE%\tmp\" goto :state_fail
if not exist "%STATE%\cache\" goto :state_fail

set "TMP=%STATE%\tmp"
set "TEMP=%STATE%\tmp"
set "XDG_CACHE_HOME=%STATE%\cache"

if defined PI_INHERIT_HOST_PATH (
    set "PATH=%ROOT%pwsh;%ROOT%node;%PATH%"
) else (
    set "PATH=%ROOT%pwsh;%ROOT%node;%WINDIR%\System32;%WINDIR%;%WINDIR%\System32\Wbem;%WINDIR%\System32\WindowsPowerShell\v1.0"
)

chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

if not exist "%ROOT%node\node.exe" (
    echo [cst-pilot] ERROR: node\ runtime not found. Dev checkout required. 1>&2
    exit /b 1
)
if not exist "%ROOT%agent\node_modules\@agegr\pi-web\bin\pi-web.js" (
    echo [cst-pilot] ERROR: @agegr/pi-web not installed. Run: cd agent ^&^& npm install 1>&2
    exit /b 1
)

"%ROOT%node\node.exe" "%ROOT%agent\node_modules\@agegr\pi-web\bin\pi-web.js" %*
endlocal
exit /b %errorlevel%

:state_fail
echo [cst-pilot] ERROR: cannot create or write state directories. 1>&2
echo [cst-pilot] The media may be write-protected, read-only or full. 1>&2
exit /b 1
