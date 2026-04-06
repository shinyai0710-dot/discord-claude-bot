// ============================================================
// Slash Command インタラクションハンドラ
// ============================================================
const path = require("path");
const fs = require("fs");
const { AttachmentBuilder } = require("discord.js");
const sessionManager = require("../services/sessionManager");
const { runClaudeCode } = require("../services/claudeRunner");
const { downloadFile } = require("../services/fileService");
const { sendChunked } = require("../utils/chunker");
const { isAllowed } = require("../utils/permissions");
const { config } = require("../config");
const logger = require("../logger");

/**
 * @param {import('discord.js').Interaction} interaction
 */
async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, member, channel, channelId } = interaction;

  // アクセス制御
  if (!isAllowed(member, user.id)) {
    return interaction.reply({
      content: "❌ このBotを使用する権限がありません。",
      ephemeral: true,
    });
  }

  // ─────────────────────────────────────────────
  // /help
  // ─────────────────────────────────────────────
  if (commandName === "help") {
    const currentDir = sessionManager.getDir(channelId);
    const hasSession = !!sessionManager.getSessionId(channelId);
    const helpText = [
      "**🤖 Claude Code Discord Bot**",
      "スラッシュコマンドまたはメンションで指示できます！",
      "",
      "**スラッシュコマンド:**",
      "`/claude <指示>` — Claude に指示を送る",
      "`/reset` — 会話履歴をリセット（新しいトピックを始める時に）",
      "`/setdir <パス>` — このチャンネルの作業ディレクトリを変更",
      "`/dir` — 現在の作業ディレクトリを表示",
      "`/help` — このヘルプを表示",
      "",
      "**メンション（後方互換）:**",
      "> `@Bot <指示>`",
      "> `@Bot !reset` — 会話リセット",
      "",
      `**現在の作業ディレクトリ:** \`${currentDir}\``,
      `**会話セッション:** ${hasSession ? "✅ 継続中（`/reset` でリセット）" : "🆕 新規"}`,
      `**モード:** ${config.ALLOW_DANGEROUS_MODE ? "⚠️ Dangerous (全ツール許可)" : `🔒 Safe (許可ツール: ${config.ALLOWED_TOOLS})`}`,
    ].join("\n");
    return interaction.reply({ content: helpText, ephemeral: true });
  }

  // ─────────────────────────────────────────────
  // /dir
  // ─────────────────────────────────────────────
  if (commandName === "dir") {
    const currentDir = sessionManager.getDir(channelId);
    return interaction.reply({
      content: `📁 現在の作業ディレクトリ:\n\`${currentDir}\``,
      ephemeral: true,
    });
  }

  // ─────────────────────────────────────────────
  // /setdir
  // ─────────────────────────────────────────────
  if (commandName === "setdir") {
    const newDir = interaction.options.getString("path").trim();
    if (!fs.existsSync(newDir)) {
      return interaction.reply({
        content: `❌ ディレクトリが存在しません:\n\`${newDir}\``,
        ephemeral: true,
      });
    }
    sessionManager.setDir(channelId, newDir);
    return interaction.reply({
      content: `📁 作業ディレクトリを変更しました:\n\`${newDir}\``,
    });
  }

  // ─────────────────────────────────────────────
  // /reset（会話履歴をクリア）
  // ─────────────────────────────────────────────
  if (commandName === "reset") {
    const cleared = sessionManager.clearSession(channelId);
    return interaction.reply({
      content: cleared
        ? "🔄 会話履歴をリセットしました。次のメッセージから新しい会話が始まります。"
        : "ℹ️ このチャンネルにはリセットするセッションがありません。",
      ephemeral: true,
    });
  }

  // ─────────────────────────────────────────────
  // /claude
  // ─────────────────────────────────────────────
  if (commandName === "claude") {
    // 同時実行チェック
    if (sessionManager.isLocked(channelId)) {
      return interaction.reply({
        content: "⏳ このチャンネルでは現在処理中です。完了後に再度お試しください。",
        ephemeral: true,
      });
    }
    if (sessionManager.isFull()) {
      return interaction.reply({
        content: `⚠️ 同時実行数の上限（${config.MAX_CONCURRENT}件）に達しています。しばらくお待ちください。`,
        ephemeral: true,
      });
    }

    // Discord のインタラクションは 3秒以内に応答しないとタイムアウト
    await interaction.deferReply();

    const prompt = interaction.options.getString("prompt");
    const cwd = sessionManager.getDir(channelId);

    logger.info(`[/claude] ${user.tag}`, { prompt, cwd });

    // タイピングインジケーター
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8000);

    // インタラクショントークンの有効期限（15分）を追跡
    const interactionStartedAt = Date.now();
    const INTERACTION_TOKEN_LIFETIME_MS = 14.5 * 60 * 1000;

    const isTokenAlive = () =>
      Date.now() - interactionStartedAt < INTERACTION_TOKEN_LIFETIME_MS;

    const safeEditReply = async (content) => {
      if (isTokenAlive()) {
        try {
          return await interaction.editReply(content);
        } catch {
          // フォールバック
        }
      }
      return channel.send(content);
    };

    const safeFollowUp = async (content) => {
      if (isTokenAlive()) {
        try {
          return await interaction.followUp(content);
        } catch {
          // フォールバック
        }
      }
      return channel.send(typeof content === "string" ? content : content.content ?? "");
    };

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

      if (result) {
        const trimmed = result.trim();
        if (trimmed.length <= 1990) {
          await safeEditReply(trimmed);
        } else {
          // 長い場合はファイル添付で1メッセージにまとめる
          const buf = Buffer.from(trimmed, "utf-8");
          const attachment = new AttachmentBuilder(buf, { name: "result.txt" });
          await safeEditReply({ content: "📄 結果が長いためファイルで添付します。", files: [attachment] });
        }
      } else {
        await safeEditReply("✅ 完了しました（出力なし）。");
      }
    } catch (err) {
      clearInterval(typingInterval);
      logger.error("Claude Code エラー", { message: err.message });
      const errMsg = `❌ エラーが発生しました:\n\`\`\`\n${err.message.slice(0, 800)}\n\`\`\``;
      await safeEditReply(errMsg);
    }
  }
}

module.exports = { handleInteraction };
