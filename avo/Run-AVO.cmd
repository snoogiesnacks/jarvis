@echo off
rem A.V.O. live simulation: real Claude (your Claude Code login), Halle and Gemini as labelled stand-ins.
rem Talk only - no tools, no messages sent, no spending. Transcripts go to avo\runs\
cd /d "%~dp0.."
node avo\run.mjs --max-turns 8 %*
echo.
echo Transcripts are in %~dp0runs
pause
