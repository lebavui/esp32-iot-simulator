# Build the Docker image and push it to Docker Hub (run on the dev machine, after `docker login`).
# Usage: .\deploy\push.ps1 -User <dockerhub-username> [-Tag latest] [-Platform linux/amd64]
#   VPS on ARM (e.g. Oracle Ampere): -Platform linux/arm64   both: -Platform linux/amd64,linux/arm64
param(
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Tag = 'latest',
  [string]$Platform = 'linux/amd64'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$image = "$User/esp32-iot-simulator"
$rev = (git -C $root rev-parse --short HEAD).Trim()

Write-Host "Building $image (tags: $Tag, $rev) for $Platform ..."
docker buildx build --platform $Platform -t "${image}:$Tag" -t "${image}:$rev" --push $root
if ($LASTEXITCODE -ne 0) { throw "docker buildx build failed ($LASTEXITCODE)" }
Write-Host "Pushed ${image}:$Tag and ${image}:$rev"
