# jira-worklog 安装（Windows / PowerShell）
#
#   powershell -File install.ps1                 # 装到所有检测到的宿主
#   powershell -File install.ps1 -Target dsh     # 只装 DSH
#   powershell -File install.ps1 -Target claude  # 只装 Claude Code
#   powershell -File install.ps1 -Target codex   # 只装 Codex
#   powershell -File install.ps1 -AddToPath      # 顺便把 scripts 加进用户 PATH
param(
  [ValidateSet('all', 'dsh', 'claude', 'codex')]
  [string]$Target = 'all',
  [switch]$AddToPath
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillName = 'jira-worklog'

# 宿主 -> 技能目录
$hosts = [ordered]@{
  dsh    = Join-Path $HOME ".dsh\skills\$skillName"
  claude = Join-Path $HOME ".claude\skills\$skillName"
  codex  = Join-Path $HOME ".codex\skills\$skillName"
}

function Install-Skill([string]$dest) {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item (Join-Path $repo 'SKILL.md') $dest -Force
  foreach ($d in 'lib', 'commands', 'scripts') {
    $src = Join-Path $repo $d
    $dst = Join-Path $dest $d
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    Copy-Item $src $dst -Recurse -Force
  }
  $n = (Get-ChildItem $dest -Recurse -File).Count
  Write-Host "  installed -> $dest ($n files)"
}

$selected = if ($Target -eq 'all') { $hosts.Keys } else { @($Target) }
Write-Host "安装 jira-worklog（目标: $Target）"
foreach ($h in $selected) {
  Install-Skill $hosts[$h]
}

if ($Target -eq 'all' -or $Target -eq 'dsh') {
  $cfg = Join-Path $HOME '.jira-worklog.json'
  if (-not (Test-Path $cfg)) {
    Copy-Item (Join-Path $repo 'config.example.json') $cfg
    Write-Host "  配置模板 -> $cfg"
  }
}

if ($AddToPath) {
  $scripts = Join-Path $repo 'scripts'
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -notlike "*$scripts*") {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$scripts", 'User')
    Write-Host "  已加入用户 PATH（新终端生效）: $scripts"
  } else {
    Write-Host "  PATH 已包含: $scripts"
  }
}

Write-Host ""
Write-Host "验证："
Write-Host "  node `"$($hosts['dsh'])\scripts\wl.js`" hours --check"
Write-Host "  node `"$($hosts['dsh'])\scripts\wl.js`" verify"
