@echo off
setlocal EnableDelayedExpansion

echo Initializing environment...

REM ��װ��������
call npm install --save-dev ^
    @types/vscode@1.70.0 ^
    @types/estree ^
    standard-version ^
    openai@latest

REM ȫ�ְ�װ vsce
call npm install -g vsce

echo Environment setup completed!