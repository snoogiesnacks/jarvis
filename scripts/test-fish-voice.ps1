# Speak one test line through the running JARVIS bridge and play it.
#
# Exercises the same path the app uses: browser -> bridge /tts -> Fish Audio.
# The API key stays inside the bridge; this script never reads or prints it.
# Start JARVIS first (npm start), then in a second window:
#
#   powershell -ExecutionPolicy Bypass -File scripts\test-fish-voice.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\test-fish-voice.ps1 -Text "Systems online."

param(
  [string]$Text = 'Good morning, Mr. White. JARVIS voice systems are online.',
  [int]$Port = $(if ($env:JARVIS_BRIDGE_PORT) { [int]$env:JARVIS_BRIDGE_PORT } else { 8787 })
)

$base = "http://localhost:$Port"
try {
  $health = Invoke-RestMethod "$base/health" -TimeoutSec 5
} catch {
  Write-Host "Bridge not reachable at $base. Start JARVIS with 'npm start' first." -ForegroundColor Red
  exit 1
}
Write-Host "Bridge health: tts=$($health.tts) stt=$($health.stt) voice=$($health.voice)"
if ($health.voice -ne 'fish') {
  Write-Host "The bridge is not using Fish Audio. Check FISH_API_KEY in .env.local, then restart JARVIS." -ForegroundColor Yellow
  exit 1
}

$out = Join-Path $env:TEMP 'jarvis-fish-test.mp3'
$body = @{ text = $Text } | ConvertTo-Json -Compress
$timer = [Diagnostics.Stopwatch]::StartNew()
try {
  Invoke-WebRequest "$base/tts" -Method Post -ContentType 'application/json' -Body $body `
    -OutFile $out -UseBasicParsing -TimeoutSec 60
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  $detail = $_.ErrorDetails.Message
  Write-Host "Fish Audio request failed (HTTP $code): $detail" -ForegroundColor Red
  switch ($code) {
    401 { Write-Host 'The key was rejected. Re-run scripts\set-fish-key.ps1 with a fresh key.' }
    402 { Write-Host 'No credit/plan for this model. Keep FISH_MODEL=s2.1-pro-free or add credit.' }
    404 { Write-Host 'Fish could not find the voice. Check FISH_VOICE_ID.' }
  }
  exit 1
}
$timer.Stop()
$size = (Get-Item $out).Length
Write-Host ("Received {0:N0} bytes of audio in {1:N1}s -> {2}" -f $size, $timer.Elapsed.TotalSeconds, $out) -ForegroundColor Green
if ($size -lt 1000) { Write-Host 'That is suspiciously small for speech; open the file to check.' -ForegroundColor Yellow }
Start-Process $out
