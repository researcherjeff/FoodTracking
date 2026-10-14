$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Fail 'Supabase CLI was not found. Install it first, then run this script again: https://supabase.com/docs/guides/cli'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'config.js'
$defaultProjectRef = ''
if (Test-Path $configPath) {
    $configText = Get-Content -Raw -Path $configPath
    if ($configText -match 'https://([a-z0-9-]+)\.supabase\.co') {
        $defaultProjectRef = $Matches[1]
    }
}

Write-Host ''
Write-Host 'FoodTracker USDA FoodData Central search deployment' -ForegroundColor Cyan
Write-Host 'This script stores the USDA key as a Supabase Edge Function secret; it does not add the key to website files.'
Write-Host 'You must already be logged into the Supabase CLI (run: supabase login).'
Write-Host ''

if ($defaultProjectRef) {
    $inputProjectRef = Read-Host "Supabase project ref [$defaultProjectRef]"
    $projectRef = if ([string]::IsNullOrWhiteSpace($inputProjectRef)) { $defaultProjectRef } else { $inputProjectRef.Trim() }
} else {
    $projectRef = (Read-Host 'Supabase project ref').Trim()
}
if ($projectRef -notmatch '^[a-z0-9]{20,30}$') {
    Fail 'That project ref does not look valid. It is the subdomain before .supabase.co in your Supabase project URL.'
}

$secureKey = Read-Host 'USDA FoodData Central API key (input is hidden)' -AsSecureString
if ($secureKey.Length -eq 0) { Fail 'A USDA API key is required.' }
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
$plainKey = ''
$tempEnv = Join-Path $projectRoot '.food-search-secret.tmp.env'
Push-Location $projectRoot
try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ([string]::IsNullOrWhiteSpace($plainKey) -or $plainKey.Contains("`n") -or $plainKey.Contains("`r")) {
        Fail 'The USDA API key is empty or contains a line break.'
    }

    # Supabase CLI reads secrets from this short-lived file. It is removed in finally.
    [System.IO.File]::WriteAllText($tempEnv, "USDA_API_KEY=$plainKey`n", [System.Text.Encoding]::ASCII)
    Write-Host 'Uploading USDA_API_KEY secret…' -ForegroundColor Yellow
    & supabase secrets set --project-ref $projectRef --env-file $tempEnv
    if ($LASTEXITCODE -ne 0) { Fail 'Supabase could not save the secret. Confirm you are logged in and have access to this project.' }

    Write-Host 'Deploying food-search Edge Function…' -ForegroundColor Yellow
    & supabase functions deploy food-search --project-ref $projectRef
    if ($LASTEXITCODE -ne 0) { Fail 'The secret was set, but function deployment failed. Review the Supabase CLI output and retry.' }

    Write-Host ''
    Write-Host 'Food database search deployed successfully.' -ForegroundColor Green
    Write-Host 'Open FoodTracker → Foods → Search Food Database to test it.'
}
finally {
    if (Test-Path $tempEnv) { Remove-Item -Force $tempEnv -ErrorAction SilentlyContinue }
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $plainKey = $null
    $secureKey = $null
    Pop-Location
}
