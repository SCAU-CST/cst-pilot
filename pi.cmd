@echo off
rem ============================================================
rem  CST Pilot launcher v7 (hard isolation, ASCII only)
rem  cst-pilot: Computer Service Team portable diagnostics kit,
rem  built on pi coding agent. 'pi' kept in the name in tribute.
rem  Layout:
rem    agent\   = pi itself (node_modules + home)
rem    node\    = Node.js runtime
rem    pwsh\    = PowerShell 7 runtime
rem    wiztree\ = WizTree portable (fast disk usage, admin only)
rem  Isolation:
rem    - PI_CODING_AGENT_DIR unconditionally overridden -> agent\home
rem    - STRICT PATH whitelist (host PATH ignored)
rem    - --no-skills + explicit --skill (only agent\home\skills)
rem    - --no-context-files, defaultProjectTrust=never (settings)
rem    - UTF-8 console (chcp 65001) + PYTHONUTF8 injection
rem  NOTE: keep this file pure ASCII; cmd parses it as ANSI/GBK
rem ============================================================
setlocal
set "ROOT=%~dp0"
set "AGENT=%ROOT%agent"

set "PI_CODING_AGENT_DIR=%AGENT%\home"

if defined PI_INHERIT_HOST_PATH (
    set "PATH=%ROOT%pwsh;%ROOT%node;%PATH%"
) else (
    set "PATH=%ROOT%pwsh;%ROOT%node;%WINDIR%\System32;%WINDIR%;%WINDIR%\System32\Wbem;%WINDIR%\System32\WindowsPowerShell\v1.0"
)

chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

"%ROOT%node\node.exe" "%AGENT%\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" --no-skills --skill "%AGENT%\home\skills" --no-context-files %*
endlocal
