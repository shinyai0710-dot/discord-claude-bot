// ============================================================
// Discord クライアント + イベント設定
// ============================================================
const { Client, GatewayIntentBits, Events } = require("discord.js");
const { handleInteraction } = require("./handlers/interactionHandler");
const { handleMessage } = require("./handlers/messageHandler");
const { config } = require("./config");
const logger = require("./logger");

function createBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // ─────────────────────────────────────────────
  // 起動完了
  // ─────────────────────────────────────────────
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Bot起動完了: ${readyClient.user.tag}`, {
      defaultDir: config.DEFAULT_WORK_DIR,
      dangerousMode: config.ALLOW_DANGEROUS_MODE,
      allowedTools: config.ALLOW_DANGEROUS_MODE ? "ALL" : config.ALLOWED_TOOLS,
      maxConcurrent: config.MAX_CONCURRENT,
    });
  });

  // ─────────────────────────────────────────────
  // Slash Command インタラクション
  // ─────────────────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleInteraction(interaction);
    } catch (err) {
      logger.error("インタラクション処理エラー", { message: err.message, stack: err.stack });
    }
  });

  // ─────────────────────────────────────────────
  // メンション（後方互換）
  // ─────────────────────────────────────────────
  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleMessage(message, client);
    } catch (err) {
      logger.error("メッセージ処理エラー", { message: err.message, stack: err.stack });
    }
  });

  // ─────────────────────────────────────────────
  // グローバルエラーハンドリング
  // ─────────────────────────────────────────────
  process.on("unhandledRejection", (err) => {
    logger.error("未処理のPromise拒否", {
      message: err?.message,
      stack: err?.stack,
    });
  });

  return client;
}

module.exports = { createBot };
