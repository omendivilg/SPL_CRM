param(
  [string]$Directory = 'D:\Respaldo_SPL',
  [ValidateSet('spl-crm')][string]$App = 'spl-crm',
  [ValidateSet('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')]
  [string]$Day = 'Monday',
  [string]$Time = '09:00',
  [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
  [string]$FlyPath = "$env:USERPROFILE\.fly\bin\flyctl.exe"
)
$ErrorActionPreference = 'Stop'
$backupDirectory = [IO.Path]::GetFullPath($Directory)
if (-not (Test-Path -LiteralPath ([IO.Path]::GetPathRoot($backupDirectory)))) { throw 'El disco de respaldo no está disponible.' }
if (-not [IO.Path]::IsPathRooted($NodePath) -or -not [IO.Path]::IsPathRooted($FlyPath)) { throw 'Las rutas de Node y Fly deben ser absolutas.' }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'No se encontró Node.js.' }
if (-not (Test-Path -LiteralPath $FlyPath -PathType Leaf)) { throw 'No se encontró Fly CLI.' }
$scheduleTime = [DateTime]::ParseExact($Time, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$user = [Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $user.User.Value
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

# Protect this folder without modifying any other directory on D:.
$acl = Get-Acl -LiteralPath $backupDirectory
$acl.SetAccessRuleProtection($true, $false)
foreach ($existingRule in @($acl.Access)) { $acl.RemoveAccessRuleAll($existingRule) }
foreach ($sid in @($userSid, 'S-1-5-18', 'S-1-5-32-544')) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new($sid), 'FullControl',
    'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.SetAccessRule($rule)
}
Set-Acl -LiteralPath $backupDirectory -AclObject $acl
$tooling = Join-Path $backupDirectory '_tooling'
New-Item -ItemType Directory -Path $tooling -Force | Out-Null
$runner = Join-Path $tooling 'windows-backup.mjs'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-backup.mjs') -Destination $runner -Force
$configPath = Join-Path $tooling 'config.json'
@{directory=$backupDirectory; app=$App; flyPath=$FlyPath; healthUrl="https://$App.fly.dev/health"} |
  ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
$launcher = Join-Path $tooling 'run-backup.ps1'
# All paths are single-quoted literals in the hidden PowerShell launcher.
$quotedNode = $NodePath.Replace("'", "''")
$quotedRunner = $runner.Replace("'", "''")
$quotedConfig = $configPath.Replace("'", "''")
"& '$quotedNode' '$quotedRunner' '$quotedConfig'`r`nexit `$LASTEXITCODE" |
  Set-Content -LiteralPath $launcher -Encoding UTF8
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $launcher) -WorkingDirectory $tooling
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $scheduleTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId $user.Name -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'SPL Respaldo Semanal' -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Description 'Respaldo semanal completo de la base conectada a SPL en Fly.' -Force | Out-Null
Write-Output "Respaldo programado: $Day $Time, hora local de Windows, en $backupDirectory."
Write-Output 'Requiere sesión de Windows iniciada, internet y autenticación vigente de Fly. No elimina respaldos anteriores.'
