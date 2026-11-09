#!/usr/bin/env node
/**
 * 捷停车数据库查询 CLI
 *
 * 示例：
 *   node scripts/q-jtc.mjs --stats
 *   node scripts/q-jtc.mjs --city 深圳市 --district 福田区 --slot 夜间 --sort commission --limit 10
 *   node scripts/q-jtc.mjs --province 广东 --type 月卡 --max-price 500 --sort distance
 *   node scripts/q-jtc.mjs --park 中心书城
 *   node scripts/q-jtc.mjs --cities           各城市套餐数排行
 */

import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(resolve(__dirname, '../data/jtc.db'));

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (k) => argv.includes(`--${k}`);

const width = (s) => [...String(s)].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - width(s)));

function printTable(cols, rows) {
  const widths = cols.map((c, i) =>
    Math.min(28, Math.max(width(c), ...rows.map((r) => width(Object.values(r)[i] ?? ''))))
  );
  console.log(cols.map((c, i) => pad(c, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) {
    console.log(
      Object.values(r)
        .map((v, i) => pad(typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : v ?? '', widths[i]))
        .join('  ')
    );
  }
}

const SORTS = {
  distance: 'distance ASC',
  commission: 'max_commission DESC',
  price: 'current_price ASC',
  discount: 'discount_rate ASC',
  duration: 'duration_days DESC',
};

if (has('stats')) {
  const q = (sql) => db.prepare(sql).all();
  console.log('=== 总量 ===');
  console.log(db.prepare('SELECT COUNT(*) 套餐, COUNT(DISTINCT park_code) 停车场, COUNT(DISTINCT province) 省, COUNT(DISTINCT city) 城市, COUNT(DISTINCT district) 区县 FROM packages').get());
  console.log('\n=== 套餐类型 ===');
  printTable(['类型', '数量'], q('SELECT package_type_label 类型, COUNT(*) 数量 FROM packages GROUP BY 1 ORDER BY 2 DESC'));
  console.log('\n=== 时段 ===');
  printTable(['时段', '数量'], q('SELECT time_slot 时段, COUNT(*) 数量 FROM packages GROUP BY 1 ORDER BY 2 DESC'));
  console.log('\n=== 适用日 ===');
  printTable(['适用日', '数量'], q('SELECT time_types 适用日, COUNT(*) 数量 FROM packages GROUP BY 1 ORDER BY 2 DESC'));
  console.log('\n=== 时长 ===');
  printTable(['时长', '数量'], q('SELECT duration_label 时长, COUNT(*) 数量 FROM packages GROUP BY 1 ORDER BY 2 DESC LIMIT 12'));
  console.log('\n=== 状态 / 充电 / 限时 ===');
  printTable(['维度', '取值', '数量'], [
    ...q("SELECT '状态' 维度, status 取值, COUNT(*) 数量 FROM packages GROUP BY status"),
    ...q("SELECT '充电桩' 维度, CASE is_charge WHEN 1 THEN '有' ELSE '无' END 取值, COUNT(*) 数量 FROM packages GROUP BY is_charge"),
    ...q("SELECT '限时特惠' 维度, CASE limit_time_flag WHEN 1 THEN '是' ELSE '否' END 取值, COUNT(*) 数量 FROM packages GROUP BY limit_time_flag"),
  ]);
  console.log('\n=== 省份 TOP10 ===');
  printTable(['省份', '套餐', '停车场'], q('SELECT province 省份, COUNT(*) 套餐, COUNT(DISTINCT park_code) 停车场 FROM packages GROUP BY 1 ORDER BY 2 DESC LIMIT 10'));
  process.exit(0);
}

if (has('cities')) {
  const rows = db.prepare(`
    SELECT city 城市, province 省份, COUNT(*) 套餐, COUNT(DISTINCT park_code) 停车场,
           ROUND(MIN(current_price)/100.0) 最低价, ROUND(MAX(current_price)/100.0) 最高价
    FROM packages GROUP BY city ORDER BY 套餐 DESC LIMIT ${Number(arg('limit', 30))}
  `).all();
  printTable(['城市', '省份', '套餐', '停车场', '最低价', '最高价'], rows);
  process.exit(0);
}

const where = [];
const params = [];
const eq = (col, val) => {
  if (val) {
    where.push(`${col} = ?`);
    params.push(val);
  }
};
eq('province', arg('province'));
eq('city', arg('city'));
eq('district', arg('district'));
eq('package_type_label', arg('type'));
eq('time_slot', arg('slot'));
eq('duration_label', arg('duration'));
if (arg('day')) {
  where.push('time_types LIKE ?');
  params.push(`%${arg('day')}%`);
}
if (arg('park')) {
  where.push('(park_name LIKE ? OR package_name LIKE ?)');
  params.push(`%${arg('park')}%`, `%${arg('park')}%`);
}
if (arg('max-price')) {
  where.push('current_price <= ?');
  params.push(Number(arg('max-price')) * 100);
}
if (arg('min-price')) {
  where.push('current_price >= ?');
  params.push(Number(arg('min-price')) * 100);
}
if (!has('soldout')) {
  where.push("status = 'ENABLE'");
}

const sort = SORTS[arg('sort', 'distance')] || SORTS.distance;
const limit = Math.min(Number(arg('limit', 20)) || 20, 200);
const sql = `
  SELECT park_name 停车场, district 区, simple_name 套餐, time_slot 时段,
         duration_label 时长, ROUND(current_price/100.0, 0) 价格,
         max_commission 佣金, ROUND(discount_rate*10, 1) 折,
         ROUND(distance) 距离米, status 状态
  FROM packages
  ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  ORDER BY ${sort}
  LIMIT ${limit}
`;

const rows = db.prepare(sql).all(...params);
const total = db.prepare(`SELECT COUNT(*) c FROM packages ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...params).c;
console.log(`命中 ${total} 条，显示前 ${rows.length} 条（排序 ${arg('sort', 'distance')}）\n`);
printTable(['停车场', '区', '套餐', '时段', '时长', '价格', '佣金', '折', '距离米', '状态'], rows);
