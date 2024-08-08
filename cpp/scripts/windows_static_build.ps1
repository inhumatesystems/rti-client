#!/usr/bin/pwsh

$scriptpath = $MyInvocation.MyCommand.Path
$dir = Split-Path $scriptpath
Set-Location $dir\..

$env:Path = "c:\program files\git\bin;$env:Path"
$output = invoke-expression "bash.exe scripts\windows_static_build.sh" ; $output
if (Test-Path "build\Release\inhumaterti.lib") {
    Exit 0
} else {
    Exit 1
}
