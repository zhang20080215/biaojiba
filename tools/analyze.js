// 数据分析主脚本：读 data-raw/ 所有 xlsx + csv，输出 _analysis.json + 控制台关键指标
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const DATA_DIR = path.resolve(__dirname, '..', 'data-raw');
const OUT_FILE = path.join(DATA_DIR, '_analysis.json');

// ===== 工具函数 =====
const f = (n, d = 1) => Number(n).toFixed(d);
const pct = (n, d = 1) => (Number(n) * 100).toFixed(d) + '%';
const sum = arr => arr.reduce((s, v) => s + Number(v || 0), 0);
const avg = arr => arr.length ? sum(arr) / arr.length : 0;
const median = arr => {
    const s = [...arr].map(Number).sort((a, b) => a - b);
    if (!s.length) return 0;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const parseNum = v => Number(String(v).replace(/[%,]/g, '')) || 0;

function readSheet(filename, sheetName = null) {
    const fp = path.join(DATA_DIR, filename);
    const wb = XLSX.readFile(fp, { cellDates: false, raw: false });
    const sn = sheetName || wb.SheetNames[0];
    return XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '', raw: false });
}

// ===== 1. 核心指标趋势 =====
function analyzeCoreTrend() {
    const rows = readSheet('(20260331-20260510)访问核心指标趋势_500000000.xlsx', '数据');
    const days = rows.map(r => ({
        date: r['日期'],
        cumulative_users: parseNum(r['累计用户数']),
        dau: parseNum(r['日访问人数']),
        opens: parseNum(r['日打开次数']),
        page_views: parseNum(r['日访问页面数']),
        new_users: parseNum(r['日新增用户']),
        opens_new_users: parseNum(r['日打开次数(新用户)']),
        active_d1_retention: parseNum(r['活跃日留存']),
        active_users_kept: parseNum(r['留存人数']),
        new_d1_retention: parseNum(r['新增日留存']),
        new_users_kept: parseNum(r['留存人数_1']),
        churned: parseNum(r['流失用户数']),
        returned: parseNum(r['回流用户数'])
    }));

    // 排除最后两天（留存数据未来无法计算）
    const validRet = days.slice(0, -1);

    return {
        days,
        summary: {
            window: `${days[0].date} ~ ${days[days.length - 1].date}`,
            window_days: days.length,
            user_growth: {
                start_cumulative: days[0].cumulative_users,
                end_cumulative: days[days.length - 1].cumulative_users,
                total_new_users: sum(days.map(d => d.new_users)),
                avg_daily_new: f(avg(days.map(d => d.new_users)), 0)
            },
            dau_stats: {
                avg: f(avg(days.map(d => d.dau)), 0),
                median: f(median(days.map(d => d.dau)), 0),
                max: Math.max(...days.map(d => d.dau)),
                max_date: days.find(d => d.dau === Math.max(...days.map(x => x.dau))).date,
                min: Math.min(...days.map(d => d.dau)),
                min_date: days.find(d => d.dau === Math.min(...days.map(x => x.dau))).date
            },
            engagement: {
                avg_opens_per_dau: f(avg(days.map(d => d.dau ? d.opens / d.dau : 0)), 2),
                avg_pages_per_dau: f(avg(days.map(d => d.dau ? d.page_views / d.dau : 0)), 1),
                new_user_share: pct(avg(days.map(d => d.dau ? d.new_users / d.dau : 0)))
            },
            retention: {
                active_d1_avg: pct(avg(validRet.map(d => d.active_d1_retention))),
                active_d1_median: pct(median(validRet.map(d => d.active_d1_retention))),
                new_d1_avg: pct(avg(validRet.map(d => d.new_d1_retention))),
                new_d1_median: pct(median(validRet.map(d => d.new_d1_retention))),
                churn_avg: f(avg(days.map(d => d.churned)), 0),
                return_avg: f(avg(days.map(d => d.returned)), 0)
            }
        }
    };
}

// ===== 2. 场景访问趋势 =====
function analyzeSceneTrend() {
    const rows = readSheet('(20260331-20260510)各级场景访问趋势_500000004.xlsx', '访问人数');
    const days = rows.map(r => ({
        date: r['日期'],
        share_chat: parseNum(r['分享-单聊分享-全部']),
        share_group: parseNum(r['分享-群聊分享-全部']),
        search: parseNum(r['搜索-手机端搜索-全部']),
        jump: parseNum(r['跳转-小程序跳转-全部']),
        taskbar: parseNum(r['固定场景-任务栏-全部']),
        total: parseNum(r['全部-全部-全部'])
    }));

    const tShare = sum(days.map(d => d.share_chat + d.share_group));
    const tSearch = sum(days.map(d => d.search));
    const tJump = sum(days.map(d => d.jump));
    const tTaskbar = sum(days.map(d => d.taskbar));
    const tAll = sum(days.map(d => d.total));

    return {
        days,
        summary: {
            total_visits_by_scene: {
                search: tSearch, search_pct: pct(tSearch / tAll),
                share: tShare, share_pct: pct(tShare / tAll),
                share_chat: sum(days.map(d => d.share_chat)),
                share_group: sum(days.map(d => d.share_group)),
                taskbar: tTaskbar, taskbar_pct: pct(tTaskbar / tAll),
                jump: tJump, jump_pct: pct(tJump / tAll),
                total: tAll
            }
        }
    };
}

// ===== 3. 访问来源数据明细（含人均停留时长，用于看各来源用户质量）=====
function analyzeSourceDetail() {
    const rows = readSheet('(20260331-20260510)访问来源 数据明细表格_500000005.xlsx', '数据');

    // 聚合：按一级场景汇总（全期）
    const byScene = {};
    rows.forEach(r => {
        const scene = r['一级场景'];
        const sub = r['二级场景'];
        const userType = r['用户类型'];
        // 只看「全部用户」+「全部二级」+ 各一级
        if (userType !== '全部用户') return;
        if (sub !== '全部') return;
        if (!byScene[scene]) byScene[scene] = { visits: 0, opens: 0, stays: [], avg_stays: [] };
        byScene[scene].visits += parseNum(r['访问人数']);
        byScene[scene].opens += parseNum(r['打开次数']);
        byScene[scene].avg_stays.push(parseNum(r['人均停留时长']));
    });

    const sceneSummary = Object.entries(byScene).map(([k, v]) => ({
        scene: k,
        total_visits: v.visits,
        total_opens: v.opens,
        avg_opens_per_visit: v.visits ? f(v.opens / v.visits, 2) : '0',
        avg_stay_seconds: f(avg(v.avg_stays), 1)
    })).sort((a, b) => b.total_visits - a.total_visits);

    // 二级场景（仅看分享，区分朋友 vs 群）
    const shareDetail = {};
    rows.forEach(r => {
        if (r['一级场景'] !== '分享') return;
        if (r['用户类型'] !== '全部用户') return;
        if (r['二级场景'] === '全部') return;
        const sub = r['二级场景'];
        if (!shareDetail[sub]) shareDetail[sub] = { visits: 0, stays: [] };
        shareDetail[sub].visits += parseNum(r['访问人数']);
        shareDetail[sub].stays.push(parseNum(r['人均停留时长']));
    });
    const shareSummary = Object.entries(shareDetail).map(([k, v]) => ({
        subtype: k,
        total_visits: v.visits,
        avg_stay_seconds: f(avg(v.stays), 1)
    })).sort((a, b) => b.total_visits - a.total_visits);

    // 新用户 vs 老用户对比
    const byUserType = { 全部用户: {}, 新用户: {}, 老用户: {} };
    rows.forEach(r => {
        const ut = r['用户类型'];
        if (!byUserType[ut]) return;
        if (r['一级场景'] !== '全部') return;
        if (r['二级场景'] !== '全部') return;
        byUserType[ut].visits = (byUserType[ut].visits || 0) + parseNum(r['访问人数']);
        byUserType[ut].opens = (byUserType[ut].opens || 0) + parseNum(r['打开次数']);
        byUserType[ut].stays = byUserType[ut].stays || [];
        byUserType[ut].stays.push(parseNum(r['人均停留时长']));
    });
    const userTypeSummary = Object.entries(byUserType).map(([k, v]) => ({
        user_type: k,
        visits: v.visits || 0,
        opens: v.opens || 0,
        avg_stay_seconds: v.stays ? f(avg(v.stays), 1) : '0'
    }));

    return {
        by_scene: sceneSummary,
        share_breakdown: shareSummary,
        by_user_type: userTypeSummary
    };
}

// ===== 4. 页面访问明细 =====
function analyzePages() {
    const rows = readSheet('(20260331-20260510)页面访问 数据明细表格_500000006.xlsx', '数据');

    // 只看 全部一级场景 / 二级 / 三级 = 全部 的合计行
    const total = rows.filter(r =>
        r['一级场景'] === '全部' && r['二级场景'] === '全部' && r['三级场景'] === '全部'
    );

    // 按页面路径聚合（全期累计）
    const byPage = {};
    total.forEach(r => {
        const p = r['页面路径'];
        if (!byPage[p]) byPage[p] = {
            page: p, visits: 0, opens: 0, page_views: 0,
            entries: 0, exits: 0, stays: [],
            exit_rates: []
        };
        byPage[p].visits += parseNum(r['访问人数']);
        byPage[p].opens += parseNum(r['打开次数']);
        byPage[p].page_views += parseNum(r['访问页面数']);
        byPage[p].entries += parseNum(r['入口页次数']);
        byPage[p].exits += parseNum(r['退出页次数']);
        byPage[p].stays.push(parseNum(r['人均停留时长（秒）']));
        byPage[p].exit_rates.push(parseNum(r['页面退出率（访问人数维度）']));
    });

    const pageList = Object.values(byPage).map(p => ({
        ...p,
        avg_stay: f(avg(p.stays), 1),
        avg_exit_rate: pct(avg(p.exit_rates))
    })).sort((a, b) => b.visits - a.visits);

    // 按主题分组聚合
    const themeMap = {
        'douban': /pages\/douban\//,
        'imdb': /pages\/imdb\//,
        'oscar': /pages\/oscar\//,
        'doubanbook': /pages\/doubanbook\//,
        'weread': /pages\/weread\//,
        'year': /pages\/year\//,
        'box': /pages\/box\//,
        'china': /pages\/china\//,
        'chinaaward': /pages\/chinaaward\//,
        'growth': /pages\/growth\//,
        'category': /pages\/category\//,
        'other': /^(?!pages\/(douban|imdb|oscar|doubanbook|weread|year|box|china|chinaaward|growth|category)\/)/
    };

    const themeAgg = {};
    pageList.forEach(p => {
        for (const [theme, re] of Object.entries(themeMap)) {
            if (re.test(p.page)) {
                if (!themeAgg[theme]) themeAgg[theme] = {
                    theme, visits: 0, opens: 0, entries: 0, exits: 0, page_views: 0, stays: []
                };
                themeAgg[theme].visits += p.visits;
                themeAgg[theme].opens += p.opens;
                themeAgg[theme].entries += p.entries;
                themeAgg[theme].exits += p.exits;
                themeAgg[theme].page_views += p.page_views;
                themeAgg[theme].stays.push(...p.stays);
                break;
            }
        }
    });

    const themeList = Object.values(themeAgg).map(t => ({
        theme: t.theme,
        visits: t.visits,
        opens: t.opens,
        entries: t.entries,
        exits: t.exits,
        page_views: t.page_views,
        avg_stay: f(avg(t.stays), 1)
    })).sort((a, b) => b.visits - a.visits);

    // list → share 转化率（按主题）
    const conversion = {};
    pageList.forEach(p => {
        const m = p.page.match(/pages\/(\w+)\/(list|share|input|result)/);
        if (!m) return;
        const [, theme, kind] = m;
        if (!conversion[theme]) conversion[theme] = {};
        conversion[theme][kind] = p.visits;
    });
    const conversionList = Object.entries(conversion).map(([theme, v]) => {
        const result = { theme, list: v.list || 0, share: v.share || 0, input: v.input || 0, result: v.result || 0 };
        if (result.list && result.share) {
            result.list_to_share_rate = pct(result.share / result.list);
        }
        if (result.input && result.result) {
            result.input_to_result_rate = pct(result.result / result.input);
        }
        return result;
    }).sort((a, b) => (b.list + b.share + b.input) - (a.list + a.share + a.input));

    return {
        top_pages: pageList.slice(0, 30),
        by_theme: themeList,
        conversion_funnels: conversionList
    };
}

// ===== 5. 广告数据 =====
function analyzeAds() {
    const fp = path.join(DATA_DIR, '广告指标明细（细分）20260401-20260510.csv');
    const wb = XLSX.readFile(fp, { raw: false });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });

    const parsed = rows.map(r => ({
        date: r['日期'],
        slot_raw: r['广告位名称'],
        slot: (r['广告位名称'] || '').split('\t')[0].trim() || (r['广告位名称'] || '').trim(),
        slot_id: (r['广告位名称'] || '').split('\t')[1]?.trim() || '',
        mode: r['广告模式'],
        pull: parseNum(r['拉取量']),
        exposure: parseNum(r['曝光量']),
        exposure_rate: parseNum(r['曝光率']) / 100,
        click: parseNum(r['点击量']),
        ctr: parseNum(r['点击率']) / 100,
        ecpm: parseNum(r['eCPM']),
        revenue: parseNum(r['收入'])
    }));

    // 按广告位汇总
    const bySlot = {};
    parsed.forEach(r => {
        const k = r.slot;
        if (!bySlot[k]) bySlot[k] = {
            slot: k, slot_id: r.slot_id,
            pull: 0, exposure: 0, click: 0, revenue: 0,
            days: 0
        };
        bySlot[k].pull += r.pull;
        bySlot[k].exposure += r.exposure;
        bySlot[k].click += r.click;
        bySlot[k].revenue += r.revenue;
        bySlot[k].days++;
    });

    const slotSummary = Object.values(bySlot).map(s => ({
        slot: s.slot,
        slot_id: s.slot_id,
        days_active: s.days,
        pull: s.pull,
        exposure: s.exposure,
        exposure_rate: s.pull ? pct(s.exposure / s.pull) : '0%',
        click: s.click,
        ctr: s.exposure ? pct(s.click / s.exposure) : '0%',
        ecpm: s.exposure ? f(s.revenue * 1000 / s.exposure, 2) : '0',
        revenue: f(s.revenue, 2),
        revenue_per_day: f(s.revenue / s.days, 2)
    })).sort((a, b) => parseFloat(b.revenue) - parseFloat(a.revenue));

    const totalRevenue = sum(parsed.map(r => r.revenue));
    const totalExposure = sum(parsed.map(r => r.exposure));
    const totalClicks = sum(parsed.map(r => r.click));

    return {
        summary: {
            window: '2026-04-01 ~ 2026-05-10',
            total_revenue: f(totalRevenue, 2),
            total_exposure: totalExposure,
            total_clicks: totalClicks,
            avg_ecpm: totalExposure ? f(totalRevenue * 1000 / totalExposure, 2) : '0',
            avg_ctr: totalExposure ? pct(totalClicks / totalExposure) : '0%',
            daily_revenue: f(totalRevenue / 40, 2),
            slot_count: slotSummary.length
        },
        by_slot: slotSummary
    };
}

// ===== 主执行 =====
function main() {
    const result = {
        generated_at: new Date().toISOString(),
        core_trend: analyzeCoreTrend(),
        scene_trend: analyzeSceneTrend(),
        source_detail: analyzeSourceDetail(),
        pages: analyzePages(),
        ads: analyzeAds()
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8');
    console.log(`\n✅ 完整分析结果已写入: ${OUT_FILE}\n`);

    // 控制台打印关键摘要
    const r = result;
    console.log('═══════════════════════════════════════════════════════');
    console.log('📊 核心指标摘要');
    console.log('═══════════════════════════════════════════════════════');
    const c = r.core_trend.summary;
    console.log(`窗口: ${c.window} (${c.window_days} 天)`);
    console.log(`累计用户: ${c.user_growth.start_cumulative} → ${c.user_growth.end_cumulative}（新增 ${c.user_growth.total_new_users}, 日均 ${c.user_growth.avg_daily_new}）`);
    console.log(`DAU: 均值 ${c.dau_stats.avg} / 中位 ${c.dau_stats.median} / 峰值 ${c.dau_stats.max} (${c.dau_stats.max_date}) / 谷值 ${c.dau_stats.min} (${c.dau_stats.min_date})`);
    console.log(`人均: ${c.engagement.avg_opens_per_dau} 次/天，${c.engagement.avg_pages_per_dau} 页/天`);
    console.log(`新用户占 DAU: ${c.engagement.new_user_share}`);
    console.log(`次日留存：活跃用户 ${c.retention.active_d1_avg} | 新用户 ${c.retention.new_d1_avg}`);
    console.log(`日均流失 ${c.retention.churn_avg} / 日均回流 ${c.retention.return_avg}`);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🚪 来源场景占比');
    console.log('═══════════════════════════════════════════════════════');
    const s = r.scene_trend.summary.total_visits_by_scene;
    console.log(`搜索: ${s.search} (${s.search_pct})`);
    console.log(`分享: ${s.share} (${s.share_pct})  ├ 单聊 ${s.share_chat} ┤ 群聊 ${s.share_group}`);
    console.log(`任务栏: ${s.taskbar} (${s.taskbar_pct})`);
    console.log(`跳转: ${s.jump} (${s.jump_pct})`);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📍 来源场景质量（停留时长 = 用户粘性代理）');
    console.log('═══════════════════════════════════════════════════════');
    r.source_detail.by_scene.forEach(s => {
        console.log(`${s.scene.padEnd(8)} | UV ${String(s.total_visits).padStart(6)} | 人均停留 ${s.avg_stay_seconds.padStart(7)}s | 人均 ${s.avg_opens_per_visit} 次`);
    });
    console.log('\n分享子类型:');
    r.source_detail.share_breakdown.forEach(s =>
        console.log(`  ${s.subtype.padEnd(12)} | UV ${s.total_visits} | 停留 ${s.avg_stay_seconds}s`));
    console.log('\n用户类型对比:');
    r.source_detail.by_user_type.forEach(s =>
        console.log(`  ${s.user_type.padEnd(6)} | 访问 ${s.visits} | 打开 ${s.opens} | 停留 ${s.avg_stay_seconds}s`));

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🎬 主题访问排行（按 UV）');
    console.log('═══════════════════════════════════════════════════════');
    r.pages.by_theme.forEach(t =>
        console.log(`${t.theme.padEnd(12)} | UV ${String(t.visits).padStart(7)} | 打开 ${String(t.opens).padStart(7)} | 停留 ${t.avg_stay}s`));

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('🔄 转化漏斗（list → share / input → result）');
    console.log('═══════════════════════════════════════════════════════');
    r.pages.conversion_funnels.forEach(c => {
        if (c.list || c.share) console.log(`${c.theme.padEnd(12)} list=${c.list} share=${c.share} ${c.list_to_share_rate ? '→ ' + c.list_to_share_rate : ''}`);
        if (c.input || c.result) console.log(`${c.theme.padEnd(12)} input=${c.input} result=${c.result} ${c.input_to_result_rate ? '→ ' + c.input_to_result_rate : ''}`);
    });

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('💰 广告位收益排行');
    console.log('═══════════════════════════════════════════════════════');
    const a = r.ads.summary;
    console.log(`窗口: ${a.window} | 总收入 ${a.total_revenue} 元 (日均 ${a.daily_revenue}) | 总曝光 ${a.total_exposure} | 平均 eCPM ${a.avg_ecpm} | 平均 CTR ${a.avg_ctr}`);
    console.log('');
    r.ads.by_slot.forEach(s => {
        const slotName = s.slot.length > 30 ? s.slot.slice(0, 30) : s.slot;
        console.log(`${slotName.padEnd(35)} | 曝光 ${String(s.exposure).padStart(7)} | CTR ${s.ctr.padStart(7)} | eCPM ${s.ecpm.padStart(7)} | 收入 ${s.revenue.padStart(8)} 元`);
    });
}

main();
