[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Repository = 'xpbl/libtorrent-ci'
$AssetName = 'td-windows-x64.exe'

if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'td supports only 64-bit Windows.'
}

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  throw 'LOCALAPPDATA is not set.'
}

if ($PSVersionTable.PSVersion.Major -lt 6) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

function Find-LatestReleaseAsset {
  param(
    [Parameter(Mandatory)]
    [string] $Repository,
    [Parameter(Mandatory)]
    [string] $AssetName
  )

  $api = "https://api.github.com/repos/$Repository/releases"
  $page = 1

  while ($true) {
    $releases = @(Invoke-RestMethod -Uri "${api}?per_page=100&page=$page" -Headers @{
      Accept = 'application/vnd.github+json'
      'User-Agent' = 'td-installer'
    })
    if ($releases.Count -eq 0) {
      break
    }

    foreach ($release in $releases) {
      if (-not $release.tag_name.StartsWith('td-', [StringComparison]::Ordinal)) {
        continue
      }

      $asset = @($release.assets | Where-Object { $_.name -eq $AssetName })[0]
      if ($null -ne $asset) {
        return [pscustomobject]@{
          Tag = $release.tag_name
          Url = $asset.browser_download_url
        }
      }
    }

    $page += 1
  }

  throw "No $AssetName asset found in td-* releases for $Repository."
}

function Normalize-PathEntry {
  param([AllowEmptyString()][string] $PathEntry)

  if ([string]::IsNullOrWhiteSpace($PathEntry)) {
    return ''
  }

  $expanded = [Environment]::ExpandEnvironmentVariables($PathEntry.Trim().Trim('"'))
  return $expanded.TrimEnd([char[]]@('\', '/')).ToUpperInvariant()
}

function Add-UserPathEntry {
  param(
    [Parameter(Mandatory)]
    [string] $Directory
  )

  $normalizedDirectory = Normalize-PathEntry $Directory
  $userPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
  $userEntries = if ($null -eq $userPath) { @() } else { @($userPath -split ';') }
  $hasUserEntry = @($userEntries | Where-Object {
    (Normalize-PathEntry $_) -eq $normalizedDirectory
  }).Count -gt 0

  if (-not $hasUserEntry) {
    $newUserPath = if ([string]::IsNullOrEmpty($userPath)) {
      $Directory
    } else {
      "$userPath;$Directory"
    }
    [Environment]::SetEnvironmentVariable('Path', $newUserPath, [EnvironmentVariableTarget]::User)
    Write-Host "Added $Directory to the User PATH."
  }

  $processEntries = @($env:Path -split ';')
  $hasProcessEntry = @($processEntries | Where-Object {
    (Normalize-PathEntry $_) -eq $normalizedDirectory
  }).Count -gt 0
  if (-not $hasProcessEntry) {
    $env:Path = if ([string]::IsNullOrEmpty($env:Path)) {
      $Directory
    } else {
      "$env:Path;$Directory"
    }
  }
}

$installDirectory = Join-Path $env:LOCALAPPDATA 'Programs\td'
$targetPath = Join-Path $installDirectory 'td.exe'
$temporaryPath = Join-Path ([IO.Path]::GetTempPath()) "$([IO.Path]::GetRandomFileName()).exe"
$release = Find-LatestReleaseAsset -Repository $Repository -AssetName $AssetName

try {
  Write-Host "Downloading td from $($release.Tag)..."
  Invoke-WebRequest -Uri $release.Url -OutFile $temporaryPath
  New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
  Move-Item -Path $temporaryPath -Destination $targetPath -Force
} finally {
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}

Add-UserPathEntry -Directory $installDirectory
Write-Host "Installed $targetPath"
Write-Host 'Open a new terminal to make td available in other sessions.'
