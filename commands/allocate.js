'use strict';
// 时间分配：把一组任务的工时按权重拆到子任务，受 240h 上限约束
// 默认只动"指派给自己"的子任务；别人的单跳过（--include-others 才包含）
const jira = require('../lib/jira');
const { api } = require('../lib/netrc');
const cfg = require('../lib/config');

function parse(argv) {
  const a = { weights: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i], next = () => argv[++i];
    if (t === '--total') a.total = Number(next());
    else if (t === '--weights') a.weights = next().split(',').map(Number);
    else if (t === '--round') a.round = Number(next());
    else if (t === '--dry-run') a.dry = true;
    else if (t === '--force') a.force = true;
    else if (t === '--include-others') a.includeOthers = true;
  }
  return a;
}

async function childrenOf(parent) {
  const jql = encodeURIComponent(`parent = ${parent} ORDER BY key ASC`);
  const r = await api('GET', `/rest/api/2/search?jql=${jql}&maxResults=100&fields=summary,timeoriginalestimate,timespent,assignee,status`);
  return r.issues;
}

function split(total, weights, roundTo) {
  const sum = weights.reduce((s, x) => s + x, 0);
  const raw = weights.map(x => (x / sum) * total);
  const step = roundTo || 0.5;
  const rounded = raw.map(x => Math.round(x / step) * step);
  const drift = Math.round((total - rounded.reduce((s, x) => s + x, 0)) / step) * step;
  rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + drift) / step) * step;
  return rounded;
}

module.exports = {
  name: 'allocate',
  help: `allocate <PARENT> --total 120 [--weights 1,1.5,2] [--round 0.5] [--dry-run] [--force]
         [--include-others]
  把 total 小时按权重拆到父单的子任务（按 key 顺序对应权重）。
  --weights 省略时用子任务现有预估比例；全为 0 则平均分。
  默认只改「指派给自己」的子任务，别人的单跳过并在输出里列出。
  受工时上限守卫：拆完超过上限会拒绝（--force 可越过）。`,
  async run(argv) {
    const parent = argv[0];
    if (!parent || parent.startsWith('-')) { console.log(this.help); return; }
    const a = parse(argv.slice(1));
    const c = cfg.load();
    const project = cfg.requireProject(c, null);
    const me = await jira.whoami();
    const all = await childrenOf(parent);
    if (!all.length) throw new Error(`${parent} 没有子任务`);
    if (a.total === undefined) throw new Error('需要 --total（这组子任务的工时总额，例如 --total 120）');

    const mine = all.filter(k => (k.fields.assignee && k.fields.assignee.name) === me);
    const others = all.filter(k => !mine.includes(k));
    const target = a.includeOthers ? all : mine;
    if (!target.length) throw new Error(`${parent} 下没有指派给你的子任务（可加 --include-others 包含他人）`);
    if (others.length && !a.includeOthers) {
      console.log(`跳过 ${others.length} 个非本人的子任务：${others.map(k => k.key).join(', ')}`);
    }

    let weights = a.weights;
    if (!weights) {
      weights = target.map(k => (k.fields.timeoriginalestimate || 0) / 3600);
      if (weights.every(w => w === 0)) weights = target.map(() => 1);
    }
    if (weights.length !== target.length) {
      throw new Error(`权重个数(${weights.length}) 与目标子任务数(${target.length}) 不一致：${target.map(k => k.key).join(', ')}`);
    }

    // 只把 total（若包含他人，则按 myShare 计）落到我的单上
    const myTotal = a.includeOthers ? a.total : a.total;
    const parts = split(myTotal, weights, a.round);

    const before = await jira.totalOriginal(project);
    const oldSum = target.reduce((s, k) => s + (k.fields.timeoriginalestimate || 0) / 3600, 0);
    const after = Math.round((before - oldSum + myTotal) * 10) / 10;
    if (after > c.capHours && !a.force) {
      throw new Error(`工时上限守卫：${project} 合计 ${before}h，本组改为 ${myTotal}h 后为 ${after}h，` +
        `超过上限 ${c.capHours}h（--force 可越过）`);
    }

    console.log(`分配 ${myTotal}h 到 ${target.length} 个子任务（上限 ${c.capHours}h，我的合计 ${before}h -> ${after}h）`);
    for (let i = 0; i < target.length; i++) {
      const k = target[i].key;
      const h = parts[i];
      const spent = (target[i].fields.timespent || 0) / 3600;
      const rem = Math.max(0, Math.round((h - spent) * 10) / 10);
      if (a.dry) { console.log(`  [dry-run] ${k} <- ${h}h (remaining ${rem}h)`); continue; }
      await jira.setEstimate(k, h, rem, { project, force: true });
    }
  },
};
