@echo off
rem Build and push a preview to the phone via WeChat DevTools CLI.
rem Requires DevTools logged in, and Settings > Security > Service port enabled.
"D:\Program Files (x86)\Tencent\wechatdev\cli.bat" auto-preview --project D:\AutoAgent\XiaoBiaoji --port 35422
