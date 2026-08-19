@echo off
set JAVA_HOME=C:\dev\jdk17\jdk-17.0.20+8
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
set PATH=C:\dev\flutter\bin;%PATH%
cd /d %~dp0
call flutter build apk --debug 2>&1
