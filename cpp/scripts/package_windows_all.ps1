#!/usr/bin/pwsh

$scriptpath = $MyInvocation.MyCommand.Path
$dir = Split-Path $scriptpath

Set-Location $dir\..

$env:Path = "c:\program files\git\bin;$env:Path"
$output = invoke-expression "bash.exe scripts\package_windows_all.sh" ; $output

if (Test-Path "inhumate-rti-cpp-client-windows-all-*.zip") {
    Exit 0
} else {
    Exit 1
}
