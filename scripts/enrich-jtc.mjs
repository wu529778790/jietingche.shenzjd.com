#!/usr/bin/env node
/**
 * 捷停车数据维度补全
 *
 * 官方枚举（来自小程序代码原文）：
 *   packageType      {1:"月", 2:"日", 3:"次", 4:"年", 5:"半年", 6:"季"}
 *   packageInterval  {0:"full", 1:"day", 2:"night"}
 *   timeType         WORK_DAY | WEEK_DAY | HOLIDAY | EVERY_DAY
 *
 * 用法：node scripts/enrich-jtc.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitCanton } from './lib/canton.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/jtc.db');

const PACKAGE_TYPE = { 1: '月卡', 2: '日卡', 3: '次卡', 4: '年卡', 5: '半年卡', 6: '季卡' };
const TIME_SLOT = { 0: '全天', 1: '白天', 2: '夜间' };
const TIME_TYPE_LABEL = {
  EVERY_DAY: '每天',
  WORK_DAY: '工作日',
  WEEK_DAY: '周末',
  HOLIDAY: '节假日',
};

const EXTRA_COLS = [
  ['package_type_label', 'TEXT'],
  ['time_slot', 'TEXT'],
  ['use_period', 'INTEGER'],
  ['use_times', 'INTEGER'],
  ['duration_days', 'INTEGER'],
  ['duration_label', 'TEXT'],
  ['sell_begin', 'TEXT'],
  ['sell_end', 'TEXT'],
  ['limit_time_flag', 'INTEGER'],
  ['time_types', 'TEXT'],
  ['rule_summary', 'TEXT'],
  ['discount_rate', 'REAL'],
  ['is_charge', 'INTEGER'],
  ['total_share_space', 'INTEGER'],
  ['left_share_space', 'INTEGER'],
];

function ensureColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(packages)').all().map((r) => r.name));
  for (const [name, type] of EXTRA_COLS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE packages ADD COLUMN ${name} ${type}`);
  }
}

/** 天数 → 统一时长文案（月/季/半年/年优先，否则按天） */
function durationLabel(days) {
  if (!days || days <= 0) return '';
  if (days >= 365 && days % 365 === 0) return `${days / 365}年`;
  if (days === 180) return '半年';
  if (days % 90 === 0 && days >= 90) return `${days / 90}季`;
  if (days % 30 === 0 && days >= 30) return `${days / 30}个月`;
  return `${days}天`;
}

/** 从 usePeriod / 套餐名 推断有效时长（天） */
function inferDuration(type, usePeriod, name = '') {
  const base = { 1: 30, 2: 1, 3: 0, 4: 365, 5: 180, 6: 90 }[type] ?? 30;
  let days = usePeriod > 0 ? usePeriod : base;

  if (!(usePeriod > 0)) {
    const m = name.match(/(\d+)\s*(天|日|夜|周|月|季|年)/);
    if (m) {
      const map = { 天: 1, 日: 1, 夜: 1, 周: 7, 月: 30, 季: 90, 年: 365 };
      days = Number(m[1]) * (map[m[2]] || 1);
    }
  }
  return { days, label: durationLabel(days) };
}

function buildRule(raw) {
  const rules = raw.packageRuleList || [];
  if (!rules.length) return { timeTypes: '', summary: '' };
  const types = [...new Set(rules.map((r) => r.timeType).filter(Boolean))];
  const labelOf = (t) => TIME_TYPE_LABEL[t] || t;
  const periods = rules
    .map((r) => {
      const span = r.timePeriod || `${r.beginTime || ''}-${r.endTime || ''}`.replace(/^-|-$/g, '');
      return `${labelOf(r.timeType)} ${span}`.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
  const uniq = [...new Set(periods)];
  return { timeTypes: types.map(labelOf).join(','), summary: uniq.slice(0, 4).join(' / ') };
}

function main() {
  const db = new DatabaseSync(DB_PATH);
  ensureColumns(db);

  const rows = db.prepare('SELECT package_id, raw FROM packages').all();
  const upd = db.prepare(`
    UPDATE packages SET
      package_type_label = ?, time_slot = ?, use_period = ?, use_times = ?,
      duration_days = ?, duration_label = ?, sell_begin = ?, sell_end = ?,
      limit_time_flag = ?, time_types = ?, rule_summary = ?,
      discount_rate = ?, is_charge = ?, total_share_space = ?, left_share_space = ?
    WHERE package_id = ?
  `);
  // 行政区划统一用 lib/canton 重算，修掉「上海城区嘉定区」这类解析偏差
  const updGeo = db.prepare('UPDATE packages SET province = ?, city = ?, district = ? WHERE package_id = ?');

  let n = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      let o;
      try {
        o = JSON.parse(row.raw);
      } catch {
        continue;
      }
      const type = Number(o.packageType);
      const usePeriod = Number(o.usePeriod) || 0;
      const useTimes = Number(o.useTimes) || 0;
      const { days, label } = inferDuration(type, usePeriod, o.simpleName || o.packageName || '');
      const rule = buildRule(o);
      const cur = Number(o.currentPrice) || 0;
      const ori = Number(o.originPrice) || 0;
      const rate = ori > 0 ? Number((cur / ori).toFixed(3)) : null;

      upd.run(
        PACKAGE_TYPE[type] || String(o.packageType ?? ''),
        TIME_SLOT[Number(o.packageInterval)] || '',
        usePeriod,
        useTimes,
        days,
        label,
        o.packageBeginTime || null,
        o.packageEndTime || null,
        o.limitTimeFlag != null ? Number(o.limitTimeFlag) : null,
        rule.timeTypes,
        rule.summary,
        rate,
        o.isCharge != null ? Number(o.isCharge) : null,
        o.totalShareSpace != null ? Number(o.totalShareSpace) : null,
        o.leftShareSpace != null ? Number(o.leftShareSpace) : null,
        row.package_id
      );
      const geo = splitCanton(o.canton);
      updGeo.run(geo.province || null, geo.city || null, geo.district || null, row.package_id);
      n += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pkg_type     ON packages(package_type_label);
    CREATE INDEX IF NOT EXISTS idx_pkg_slot     ON packages(time_slot);
    CREATE INDEX IF NOT EXISTS idx_pkg_duration ON packages(duration_days);
    CREATE INDEX IF NOT EXISTS idx_pkg_district ON packages(city, district);
  `);

  console.log(`已补全 ${n} 条`);

  const table = (title, rows2) => {
    console.log(`\n--- ${title} ---`);
    for (const r of rows2) console.log(Object.entries(r).map(([k, v]) => `${k}=${v}`).join('  '));
  };

  table('套餐类型', db.prepare('SELECT package_type_label 类型, COUNT(*) 数量 FROM packages GROUP BY package_type_label ORDER BY 数量 DESC').all());
  table('时段', db.prepare("SELECT time_slot 时段, COUNT(*) 数量 FROM packages GROUP BY time_slot ORDER BY 数量 DESC").all());
  table('适用日', db.prepare("SELECT time_types 适用日, COUNT(*) 数量 FROM packages GROUP BY time_types ORDER BY 数量 DESC LIMIT 8").all());
  table('时长', db.prepare('SELECT duration_label 时长, COUNT(*) 数量 FROM packages GROUP BY duration_label ORDER BY 数量 DESC LIMIT 10').all());
  table('状态', db.prepare('SELECT status 状态, COUNT(*) 数量 FROM packages GROUP BY status').all());
  table('限时特惠', db.prepare('SELECT limit_time_flag 限时, COUNT(*) 数量 FROM packages GROUP BY limit_time_flag').all());
  table('城市 TOP10', db.prepare("SELECT city 城市, COUNT(*) 数量 FROM packages WHERE city <> '' GROUP BY city ORDER BY 数量 DESC LIMIT 10").all());

  console.log('\n数据库：', DB_PATH);
  db.close();
}

main();
