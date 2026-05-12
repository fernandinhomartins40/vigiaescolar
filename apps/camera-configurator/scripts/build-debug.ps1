$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$toolRoot = Join-Path $repoRoot "tools\android-build"
$localGradle = Join-Path $toolRoot "gradle-8.10.2\bin\gradle.bat"

if (Test-Path $localGradle) {
  $env:JAVA_HOME = Join-Path $toolRoot "jdk-17"
  $env:ANDROID_HOME = Join-Path $toolRoot "android-sdk"
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  $env:GRADLE_USER_HOME = Join-Path $toolRoot "gradle-home"
  $env:PATH = (Join-Path $env:JAVA_HOME "bin") + ";" + (Join-Path $toolRoot "gradle-8.10.2\bin") + ";" + (Join-Path $env:ANDROID_HOME "platform-tools") + ";" + $env:PATH
}

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  if (Test-Path $localGradle) {
    & $localGradle --no-daemon assembleDebug
  } else {
    gradle assembleDebug
  }
  Write-Host "APK gerado em app/build/outputs/apk/debug/app-debug.apk"
} finally {
  Pop-Location
}
