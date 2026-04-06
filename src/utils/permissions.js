// ============================================================
// アクセス制御
// ALLOWED_USER_IDS / ALLOWED_ROLE_IDS が空の場合は全員許可
// ============================================================
const { config } = require("../config");

/**
 * メンバーがBotを使用できるかチェック
 * @param {import('discord.js').GuildMember | null} member
 * @param {string} userId
 * @returns {boolean}
 */
function isAllowed(member, userId) {
  const { ALLOWED_USER_IDS, ALLOWED_ROLE_IDS } = config;

  // 制限なし → 全員許可
  if (ALLOWED_USER_IDS.length === 0 && ALLOWED_ROLE_IDS.length === 0) {
    return true;
  }

  // ユーザーID一致
  if (ALLOWED_USER_IDS.includes(userId)) {
    return true;
  }

  // ロールID一致
  if (member && ALLOWED_ROLE_IDS.length > 0) {
    if (ALLOWED_ROLE_IDS.some((id) => member.roles.cache.has(id))) {
      return true;
    }
  }

  return false;
}

module.exports = { isAllowed };
