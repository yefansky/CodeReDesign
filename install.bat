@echo off
setlocal EnableDelayedExpansion

echo Initializing environment...

REM install dev dependens
call npm install --save-dev ^
    @types/vscode@1.70.0 ^
    @types/estree ^
    standard-version
call npm install openai

REM global install vsce
call npm install -g vsce

echo Environment setup completed!