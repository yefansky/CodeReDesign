@echo off
setlocal EnableDelayedExpansion

echo Initializing environment...

REM 安装开发依赖
call npm install --save-dev ^
    @types/vscode@1.70.0 ^
    @types/estree ^
    standard-version ^
    openai@latest

REM 全局安装 vsce
call npm install -g vsce

echo Environment setup completed!