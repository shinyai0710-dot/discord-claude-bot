// ============================================================
// メンション（@Bot）ハンドラ（後方互換）
// /claude スラッシュコマンドへの移行を促しつつ従来通り動作
// ============================================================
const fs = require("fs");
const sessionManager = require("../services/sessionManager");
const { runClaudeCode } = require("../services/claudeRunner");
const { downloadFile } = require("../services/fileService");
const { sendChunked } = require("../utils/chunker");
const { isAllowed } = require("../utils/permissions");
const { config } = require("../config");
const logger = require("../logger");

/**
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').Client} client
 */
async function handleMessage(message, client) {
  // Botからのメッセージは無視
  if (message.author.bot) return;

  // メンションされていない場合は無視
  if (!message.mentions.has(client.user)) return;

  // アクセス制御
  if (!isAllowed(message.member, message.author.id)) {
    await message.reply("❌ このBotを使用する権限がありません。");
    return;
  }

  // メンション部分を除いた本文
  const userMessage = message.content.replace(/<@!?\d+>/g, "").trim();
  if (!userMessage) {
    await message.reply(
      "何か指示してください！ `/help` でコマンド一覧を確認できます。"
    );
    return;
  }

  const channelId = message.channelId;

  // ─────────────────────────────────────────────
  // !setdir コマンド
  // ─────────────────────────────────────────────
  if (userMessage.startsWith("!setdir ")) {
    const newDir = userMessage.slice(8).trim();
    if (!newDir) {
      await message.reply(
        "❌ パスを指定してください。例: `!setdir C:\\Users\\user\\myproject`"
      );
      return;
    }
    if (!fs.existsSync(newDir)) {
      await message.reply(`❌ ディレクトリが存在しません:\n\`${newDir}\``);
      return;
    }
    sessionManager.setDir(channelId, newDir);
    await message.reply(
      `📁 作業ディレクトリを変更しました:\n\`${newDir}\``
    );
    return;
  }

  // ─────────────────────────────────────────────
  // !dir / !pwd コマンド
  // ─────────────────────────────────────────────
  if (userMessage === "!dir" || userMessage === "!pwd") {
    const currentDir = sessionManager.getDir(channelId);
    await message.reply(`📁 現在の作業ディレクトリ:\n\`${currentDir}\``);
    return;
  }

  // ─────────────────────────────────────────────
  // !reset コマンド（会話履歴をクリア）
  // ─────────────────────────────────────────────
  if (userMessage === "!reset") {
    const cleared = sessionManager.clearSession(channelId);
    await message.reply(
      cleared
        ? "🔄 会話履歴をリセットしました。次のメッセージから新しい会話が始まります。"
        : "ℹ️ このチャンネルにはリセットするセッションがありません。"
    );
    return;
  }

  // ─────────────────────────────────────────────
  // !help コマンド
  // ─────────────────────────────────────────────
  if (userMessage === "!help") {
    const currentDir = sessionManager.getDir(channelId);
    const hasSession = !!sessionManager.getSessionId(channelId);
    const helpText = [
      "**🤖 Claude Code Discord Bot**",
      "スラッシュコマンドまたはメンションで指示できます！",
      "",
      "**スラッシュコマンド（推奨）:**",
      "`/claude <指示>` — Claude に指示を送る",
      "`/reset` — 会話履歴をリセット",
      "`/setdir <パス>` — 作業ディレクトリを変更",
      "`/dir` — 現在のディレクトリを表示",
      "`/help` — ヘルプを表示",
      "",
      "**メンションコマンド:**",
      "> `@Bot <指示>`  — Claude に指示を送る",
      "`!reset` — 会話履歴をリセット",
      "`!setdir <パス>` — 作業ディレクトリを変更",
      "`!dir` / `!pwd` — ディレクトリ確認",
      "`!help` — このヘルプを表示",
      "",
      `**現在の作業ディレクトリ:** \`${currentDir}\``,
      `**会話セッション:** ${hasSession ? "✅ 継続中（\`!reset\` でリセット）" : "🆕 新規"}`,
      `**モード:** ${config.ALLOW_DANGEROUS_MODE ? "⚠️ Dangerous (全ツール許可)" : `🔒 Safe (${config.ALLOWED_TOOLS})`}`,
    ].join("\n");
    await message.reply(helpText);
    return;
  }

  // ─────────────────────────────────────────────
  // Claude 実行
  // ─────────────────────────────────────────────

  // 同時実行チェック
  if (sessionManager.isLocked(channelId)) {
    await message.reply(
      "⏳ このチャンネルでは現在処理中です。完了後に再度お試しください。"
    );
    return;
  }
  if (sessionManager.isFull()) {
    await message.reply(
      `⚠️ 同時実行数の上限（${config.MAX_CONCURRENT}件）に達しています。しばらくお待ちください。`
    );
    return;
  }

  // タイピングインジケーター
  await message.channel.sendTyping();
  const typingInterval = setInterval(() => {
    message.channel.sendTyping().catch(() => {});
  }, 8000);

  const cwd = sessionManager.getDir(channelId);

  // 添付ファイルのダウンロード
  const downloadedFiles = [];
  if (message.attachments.size > 0) {
    for (const [, attachment] of message.attachments) {
      try {
        const { safeName } = await downloadFile(
          attachment.url,
          cwd,
          attachment.name
        );
        downloadedFiles.push(safeName);
      } catch (e) {
        logger.warn(`添付ファイルのダウンロード失敗: ${e.message}`);
      }
    }
  }

  let prompt = userMessage;
  if (downloadedFiles.length > 0) {
    prompt += `\n\n（作業ディレクトリに以下のファイルをダウンロード済みです: ${downloadedFiles.join(", ")}）`;
  }

  logger.info(`[mention] ${message.author.tag}`, {
    prompt: prompt.slice(0, 100),
    cwd,
  });

  // セッションIDを取得（会話継続）
  const sessionId = sessionManager.getSessionId(channelId);

  try {
    const { result, sessionId: newSessionId } = await sessionManager.run(
      channelId,
      () => runClaudeCode(prompt, cwd, sessionId)
    );
    clearInterval(typingInterval);

    // セッションIDを保存して次回も会話を継続
    sessionManager.setSessionId(channelId, newSessionId);

    await sendChunked(message.channel, result, message);
  } catch (err) {
    clearInterval(typingInterval);
    logger.error("Claude Code エラー", { message: err.message });
    await message.reply(
      `❌ エラーが発生しました:\n\`\`\`\n${err.message.slice(0, 800)}\n\`\`\``
    );
  }
}

module.exports = { handleMessage };
