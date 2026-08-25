// 云函数：getVipStatus —— 查询当前用户的会员（免广告）状态
//
// 数据表：vip_users，一人一条，_id 就是 openid（天然唯一，加人=新增一条，撤销=改 status）
//   {
//     _id:       "oXXXX...",        // = openid
//     openid:    "oXXXX...",        // 冗余一份，方便按字段查询/导出
//     status:    "active",          // active=生效 | 其它任意值（如 revoked/refunded）=失效
//     plan:      "lifetime",        // lifetime=永久 | yearly=年卡（仅作展示与对账，判定看 expireAt）
//     expireAt:  null,              // null/缺省=永久；否则到期时间（Date / 毫秒数 / 日期字符串都认）
//     price:     19.9,              // 实收金额，对账用
//     channel:   "wechat",          // 收款渠道
//     orderNo:   "20260825-001",    // 你自己的流水号
//     nickname:  "小明",             // 便于对人
//     note:      "首发100名",
//     grantedAt: "2026-08-25",      // 开通时间
//     operator:  "zhang"            // 谁开的
//   }
//
// ⚠ 控制台的 JSON 编辑器**不接受空字符串**（会报「Key 或 Value 不能为空」）。
//   没值的字段直接**别写**，不要写成 ""。expireAt 的 null 是允许的。
//   判定只读 status / expireAt / plan 三个字段，其余全是给人看的，缺了不影响功能。
//
// ⚠ 安全：openid **只从 wxContext 取**，绝不接受前端传参——否则任何人填别人的 openid
//   就能白嫖，或者填自己的去查别人。
// ⚠ 权限：vip_users 集合在云开发控制台要设成「仅管理端可读写」。这个函数用管理员权限
//   绕过权限校验，而普通客户端不该能直接读这张表（里面有别人的 openid、金额、流水号）。
//
// 返回给前端的字段是**最小集**：只有判定结果和到期时间，价格/流水号/备注一律不下发。

const cloud = require('wx-server-sdk')

cloud.init({ env: 'cloud1-3gn3wryx716919c6' })

const db = cloud.database()
const COLLECTION = 'vip_users'

/**
 * 把 expireAt 归一成毫秒时间戳。
 * 控制台里手填可能是 Date 类型、数字，也可能是 "2027-08-25" 这种字符串，都得认。
 * @returns {number|null} null = 永久
 */
function normalizeExpireAt(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (raw instanceof Date) {
    const t = raw.getTime()
    return isNaN(t) ? null : t
  }
  if (typeof raw === 'number') return isNaN(raw) ? null : raw
  if (typeof raw === 'string') {
    // "2027-08-25" 在部分环境会被当 UTC 解析，这里统一按当天 23:59:59 收尾，
    // 免得用户填的到期日当天上午就失效了
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())
    const t = Date.parse(dateOnly ? raw.trim() + 'T23:59:59+08:00' : raw)
    return isNaN(t) ? null : t
  }
  return null
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { success: false, isVip: false, reason: 'no_openid' }
  }

  const serverTime = Date.now()

  try {
    const res = await db.collection(COLLECTION).doc(openid).get()
    const doc = res && res.data

    if (!doc) {
      return { success: true, openid, isVip: false, serverTime }
    }

    // status 缺省视为 active：手动加记录时最容易漏填的就是它，
    // 漏填导致「加了但不生效」比「漏填导致误开通」更难排查，所以默认放行。
    const active = doc.status === undefined || doc.status === null || doc.status === 'active'
    const expireAt = normalizeExpireAt(doc.expireAt)
    const expired = expireAt !== null && expireAt <= serverTime

    return {
      success: true,
      openid,
      isVip: active && !expired,
      plan: doc.plan || 'lifetime',
      expireAt,                       // null = 永久
      serverTime,
    }
  } catch (err) {
    // 集合不存在 / 该 doc 不存在，都会抛。这是绝大多数用户的正常路径（他们不是会员），
    // 所以不当错误记，直接返回非会员。
    const msg = (err && (err.errMsg || err.message)) || ''
    const notFound = /not exist|document.*not.*found|-501001|-502005/i.test(msg)
    if (!notFound) {
      console.error('[getVipStatus] 查询失败', msg)
    }
    return { success: true, openid, isVip: false, serverTime, reason: notFound ? 'not_found' : 'error' }
  }
}
