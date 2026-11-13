param(
  [Parameter(Mandatory=$true)][string]$Package,
  [Parameter(Mandatory=$true)][string]$SourceRevision,
  [Parameter(Mandatory=$true)][string]$Chrome,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = 'Stop'
$chromeVersion = (Get-Item -LiteralPath $Chrome).VersionInfo.ProductVersion
if (-not $chromeVersion) { throw 'Chrome executable version unavailable' }
node (Join-Path $PSScriptRoot '../native-acceptance.mjs') --platform windows-x64 --package $Package --source-revision $SourceRevision --chrome-version $chromeVersion --output $Output
exit $LASTEXITCODE
