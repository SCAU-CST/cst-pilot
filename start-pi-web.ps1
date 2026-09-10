# Start @agegr/pi-web against THIS worktree's isolated agent home.
# Mirrors pi.cmd's isolation: PI_CODING_AGENT_DIR -> agent\home.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PI_CODING_AGENT_DIR = Join-Path $root 'agent\home'
& (Join-Path $root 'node\node.exe') (Join-Path $root 'node_modules\@agegr\pi-web\bin\pi-web.js') --no-open @args
