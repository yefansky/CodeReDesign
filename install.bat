@echo off
setlocal EnableDelayedExpansion

echo Initializing environment...

REM install dev dependens
call npm install --save-dev ^
    @types/vscode@1.70.0 ^
    @types/estree ^
    @types/axios ^
    standard-version
call npm install openai axios cheerio
REM global install vsce
call npm install -g vsce
call npm cli

echo Environment setup completed!