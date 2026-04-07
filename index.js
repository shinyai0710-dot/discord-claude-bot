// ============================================================
// エントリポイント
// 設定バリデーション → Slash Command 自動登録 → Bot 起動
// ============================================================
require("dotenv").config();
const { validate, config } = require("./src/config");
const { createBot } = require("./src/bot");
const logger = require("./src/logger");
const http = require("http");

// 起動時バリデーション
validate();

// Render の Web Service 要件を満たすための最小 HTTP サーバー
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Discord bot is running");
}).listen(PORT, () => {
  logger.info(`HTTP health check server listening on port ${PORT}`);
});

// Discord クライアント生成・起動
const client = createBot();

client.login(config.DISCORD_TOKEN).catch((err) => {
  logger.error("Discord ログイン失敗", { message: err.message });
  process.exit(1);
});
