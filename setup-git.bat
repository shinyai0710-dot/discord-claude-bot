@echo off
cd /d C:\Users\user\discord-claude-bot

echo [1/5] Git初期化...
git init
git branch -M main

echo [2/5] Gitユーザー設定...
git config user.email "shinya.i.0710@gmail.com"
git config user.name "shinyai0710-dot"

echo [3/5] ファイルをステージング...
git add .

echo [4/5] 初回コミット...
git commit -m "initial commit: discord-claude-bot with session continuity"

echo [5/5] GitHubにプッシュ...
git remote add origin https://github.com/shinyai0710-dot/discord-claude-bot.git
git push -u origin main

echo.
echo ===================================
echo プッシュ完了！
echo https://github.com/shinyai0710-dot/discord-claude-bot
echo ===================================
pause
