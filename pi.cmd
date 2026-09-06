@echo off
rem ============================================================
rem  CST Pilot launcher v9 (0.3 layout + full client zero-write)
rem  cst-pilot: Computer Service Team portable diagnostics kit,
rem  built on pi coding agent. 'pi' kept in the name in tribute.
rem  Layout:
rem    pi.exe   = official pi SEA binary (0.3 release, if present)
rem    node\    = Node.js runtime (dev checkout fallback, 0.2 layout)
rem    pwsh\    = PowerShell 7 runtime
rem    wiztree\ = WizTree portable (fast disk usage, admin only)
rem  Isolation:
rem    - PI_CODING_AGENT_DIR unconditionally overridden -> agent\home
rem    - STRICT PATH whitelist (host PATH ignored)
rem    - All volatile state under .state\ (U-disk only):
rem        TMP/TEMP       -> .state\tmp   (jiti cache, pi logs, PDF out)
rem        XDG_CACHE_HOME -> .state\cache (fff host-cache redirect)
rem        FFF_*_DB       -> .state\data  (fff frecency/history)
rem        PSModuleAnalysisCachePath -> .state\cache (PS7 module cache;
rem          its LOCALAPPDATA default is NOT covered by XDG_CACHE_HOME)
rem    - Telemetry / update checks disabled:
rem        PI_OFFLINE=1 (pi: no startup network ops, no install/update
rem        telemetry, no version check), plus enableInstallTelemetry
rem        =false in settings.json as belt-and-braces
rem        POWERSHELL_TELEMETRY_OPTOUT=1, POWERSHELL_UPDATECHECK=Off
rem    - --no-skills + explicit --skill (only agent\home\skills)
rem    - --no-context-files, defaultProjectTrust=never (settings)
rem    - UTF-8 console (chcp 65001) + PYTHONUTF8 injection
rem  Engine selection: pi.exe when present (0.3 release), otherwise
rem  the node-based dev checkout (0.2 layout, agent\node_modules).
rem  Client-machine writes (audited 2026-09-06):
rem    - Fresh client (never had pwsh 7): full zero-write.
rem    - Known limit: if client already has pwsh profile files, pwsh
rem      updates StartupProfileData-NonInteractive (JIT start profile,
rem      binary, no user data). Hardcoded in pwsh (.NET ProfileOpti-
rem      mization), no official switch (PowerShell issue #26528).
rem  NOTE: keep this file pure ASCII; cmd parses it as ANSI/GBK
rem ============================================================
setlocal
set "ROOT=%~dp0"
set "STATE=%ROOT%.state"

set "PI_CODING_AGENT_DIR=%ROOT%agent\home"
set "PI_OFFLINE=1"
set "POWERSHELL_TELEMETRY_OPTOUT=1"
set "POWERSHELL_UPDATECHECK=Off"

rem ---- create volatile state dirs; fail loudly if volume is
rem ---- read-only, write-protected or full (never leak to host)
md "%STATE%\tmp" 2>nul
md "%STATE%\cache" 2>nul
md "%STATE%\data" 2>nul
if not exist "%STATE%\tmp" goto :state_fail
if not exist "%STATE%\cache" goto :state_fail
if not exist "%STATE%\data" goto :state_fail

set "TMP=%STATE%\tmp"
set "TEMP=%STATE%\tmp"
set "XDG_CACHE_HOME=%STATE%\cache"
set "FFF_FRECENCY_DB=%STATE%\data\fff-frecency.mdb"
set "FFF_HISTORY_DB=%STATE%\data\fff-history.mdb"
set "PSModuleAnalysisCachePath=%STATE%\cache\PSModuleAnalysisCache.txt"

if defined PI_INHERIT_HOST_PATH (
    set "PATH=%ROOT%pwsh;%ROOT%node;%PATH%"
) else (
    set "PATH=%ROOT%pwsh;%ROOT%node;%WINDIR%\System32;%WINDIR%;%WINDIR%\System32\Wbem;%WINDIR%\System32\WindowsPowerShell\v1.0"
)

chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

if exist "%ROOT%pi.exe" goto :run_sea
goto :run_node

:run_sea
"%ROOT%pi.exe" --no-skills --skill "%ROOT%agent\home\skills" --no-context-files %*
endlocal
exit /b %errorlevel%

:run_node
"%ROOT%node\node.exe" "%ROOT%agent\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --no-skills --skill "%ROOT%agent\home\skills" --no-context-files %*
endlocal
exit /b %errorlevel%

:state_fail
echo [cst-pilot] ERROR: cannot create state directory on this volume. 1>&2
echo [cst-pilot] The media may be write-protected, read-only or full. 1>&2
echo [cst-pilot] Refusing to start: state would leak to the host machine. 1>&2
exit /b 1
