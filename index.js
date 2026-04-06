// ============================================================
// エントリポイント
// 設定バリデーション → Slash Command 自動登録 → Bot 起動
// ============================================================
require("dotenv").config();
const { validate, config } = require("./src/config");
const { createBot } = require("./src/bot");
const logger = require("./src/logger");

// 起動時バリデーション
validate();

// Discord クライアント生成・起動
const client = createBot();

client.login(config.DISCORD_TOKEN).catch((err) => {
  logger.error("Discord ログイン失敗", { message: err.message });
  process.exit(1);
});
