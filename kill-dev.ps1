$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*LifePlanTodolist*' }
$ids = @()
foreach ($p in $procs) { $ids += $p.ProcessId }
Write-Output ('PIDS=' + ($ids -join ','))
foreach ($id in $ids) { taskkill /PID $id /T /F 2>&1 | Out-Null }
Write-Output 'DONE'