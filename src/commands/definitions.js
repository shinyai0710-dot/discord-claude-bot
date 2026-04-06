// ============================================================
// Slash Command 定義
// register-commands.js で Discord に登録する
// ============================================================
const { SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("claude")
    .setDescription("Claude Code に指示を送って作業を実行します")
    .addStringOption((opt) =>
      opt
        .setName("prompt")
        .setDescription("Claudeへの指示（日本語可）")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setdir")
    .setDescription("このチャンネルの作業ディレクトリを変更します")
    .addStringOption((opt) =>
      opt
        .setName("path")
        .setDescription("新しい作業ディレクトリのパス")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("dir")
    .setDescription("現在の作業ディレクトリを表示します"),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("会話履歴をリセットして新しいセッションを開始します"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("使い方とコマンド一覧を表示します"),
];

module.exports = commands.map((c) => c.toJSON());
