// ============================================================
// Slash Command を Discord に登録するワンタイムスクリプト
//
// 使用方法:
//   1. .env に CLIENT_ID を設定
//      CLIENT_ID=あなたのBotのクライアントID
//   2. (オプション) GUILD_ID を設定するとそのサーバーにのみ即時反映
//      GUILD_ID=あなたのDiscordサーバーID
//   3. 実行:
//      node scripts/register-commands.js
//
// グローバルコマンドは反映まで最大1時間かかります。
// GUILD_ID 指定時は即時反映されます（開発・テスト推奨）。
// ============================================================
require("dotenv").config();
const { REST, Routes } = require("discord.js");
const commands = require("../src/commands/definitions");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token) {
  console.error("[ERROR] .env に DISCORD_TOKEN が設定されていません");
  process.exit(1);
}
if (!clientId) {
  console.error("[ERROR] .env に CLIENT_ID が設定されていません");
  console.error(
    "  Discord Developer Portal (https://discord.com/developers/applications) で"
  );
  console.error("  アプリケーションを選択 → General Information → APPLICATION ID をコピー"
  );
  process.exit(1);
}

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log(`${commands.length}個のスラッシュコマンドを登録します...`);

    let data;
    if (guildId) {
      // ギルド（サーバー）限定コマンド（即時反映）
      data = await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(
        `✅ ギルドコマンドを登録しました (guild: ${guildId}): ${data.length}個`
      );
    } else {
      // グローバルコマンド（反映まで最大1時間）
      data = await rest.put(Routes.applicationCommands(clientId), {
        body: commands,
      });
      console.log(
        `✅ グローバルコマンドを登録しました: ${data.length}個`
      );
      console.log("  ※ グローバルコマンドは反映まで最大1時間かかります。");
      console.log(
        "  ※ 即時反映するには .env に GUILD_ID を設定して再実行してください。"
      );
    }

    console.log("\n登録されたコマンド:");
    for (const cmd of data) {
      console.log(`  /${cmd.name} — ${cmd.description}`);
    }
  } catch (err) {
    console.error("[ERROR] コマンド登録失敗:", err.message);
    process.exit(1);
  }
})();
