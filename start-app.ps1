$ErrorActionPreference = "Stop"

$port = 8123
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-Python {
  $candidates = @("py", "python", "python3")
  foreach ($candidate in $candidates) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) {
      return $cmd.Source
    }
  }
  return $null
}

$python = Find-Python
if (-not $python) {
  Write-Host "Python est introuvable. Installe Python ou lance un autre serveur HTTP local dans ce dossier."
  exit 1
}

$args = @()
if ((Split-Path -Leaf $python) -eq "py.exe") {
  $args += "-3"
}
$args += @("-m", "http.server", "$port", "--bind", "127.0.0.1", "--directory", "$root")

Write-Host "App disponible sur http://localhost:$port"
Write-Host "Appuie sur Ctrl+C pour arreter le serveur."
& $python @args
