// ============================================================
// Discord 2000文字制限対応メッセージ送信
// 長い場合はファイル添付で1メッセージにまとめる
// ============================================================
const { AttachmentBuilder } = require("discord.js");
const CHUNK_SIZE = 1900;

/**
 * テキストを1メッセージで送信。長い場合はファイル添付にまとめる
 * @param {import('discord.js').TextChannel} channel
 * @param {string} text
 * @param {import('discord.js').Message | import('discord.js').ChatInputCommandInteraction | null} replyTo
 */
async function sendChunked(channel, text, replyTo = null) {
  const trimmed = text ? text.trim() : "";

  if (!trimmed) {
    const msg = "✅ 完了しました（出力なし）。";
    return replyTo
      ? "reply" in replyTo
        ? replyTo.reply(msg)
        : replyTo.followUp(msg)
      : channel.send(msg);
  }

  // 1900文字以内ならそのまま1件で送信
  if (trimmed.length <= CHUNK_SIZE) {
    if (replyTo) {
      if ("reply" in replyTo && typeof replyTo.reply === "function") {
        return replyTo.reply(trimmed);
      } else if ("followUp" in replyTo) {
        return replyTo.followUp(trimmed);
      }
    }
    return channel.send(trimmed);
  }

  // 長い場合はテキストファイルとして添付し1メッセージで送信
  const buf = Buffer.from(trimmed, "utf-8");
  const attachment = new AttachmentBuilder(buf, { name: "result.txt" });
  const payload = { content: "📄 結果が長いためファイルで添付します。", files: [attachment] };

  if (replyTo) {
    if ("reply" in replyTo && typeof replyTo.reply === "function") {
      return replyTo.reply(payload);
    } else if ("followUp" in replyTo) {
      return replyTo.followUp(payload);
    }
  }
  return channel.send(payload);
}

module.exports = { sendChunked };
