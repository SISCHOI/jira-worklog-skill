'use strict';
// 每日：统计当天做了什么 -> 写 worklog（幂等：同一天重复跑只更新，不重复记）
// 正文优先用 --note/--note-file 的叙述式内容（干了什么、完成什么、结果如何）；
// 不给时退回 git 提交列表。
const fs = require('fs');
const jira = require('../lib/jira');
const report = require('../lib/report');
const cfg = require('../lib/config');

function inferHours(day) {
  if (!day.commits.length) return 0;
  const times = day.commits.map(c => new Date(c.time.replace(' ', 'T') + ':00'));
  const span = (Math.max(...times) - Math.min(...times)) / 3600000;
  return Math.max(1, Math.min(12, Math.round((span + 0.5) * 2) / 2));
}

// 叙述式正文：--note 内联 / --note-file 读文件（推荐，多行与中文更稳）
function readNote(a) {
  if (a.noteFile !== undefined) {
    if (!fs.existsSync(a.noteFile)) throw new Error(`note 文件不存在：${a.noteFile}`);
    return fs.readFileSync(a.noteFile, 'utf8').replace(/^\uFEFF/, '').trim();
  }
  if (a.note !== undefined) return String(a.note).trim();
  return null;
}

module.exports = {
  name: 'daily',
  help: `daily --issue KEY [--date YYYY-MM-DD] [--hours 8|auto] [--repo .] [--note "..." | --note-file f] [--dry-run]
  统计该仓库当天的提交，写进该单的 worklog。
  --note / --note-file：用叙述式正文（干了什么、完成了什么、结果如何）替代自动生成的提交列表；
    正文写清结论与数字，提交链接作附注即可。推荐 --note-file，多行中文更稳。
  --hours 省略时只打印推断时长并退出；显式写 --hours auto 才接受推断值。
  幂等：同一天同单重复执行只更新那条 worklog（带标记 [jira-worklog:day:DATE]）。`,
  async run(argv) {
    const a = { repo: process.cwd() };
    for (let i = 0; i < argv.length; i++) {
      const t = argv[i], next = () => argv[++i];
      if (t === '--issue') a.issue = next();
      else if (t === '--date') a.date = next();
      else if (t === '--hours') a.hours = next();
      else if (t === '--repo') a.repo = next();
      else if (t === '--note') a.note = next();
      else if (t === '--note-file') a.noteFile = next();
      else if (t === '--dry-run') a.dry = true;
    }
    if (!a.issue) { console.log(this.help); return; }
    const c = cfg.load();
    const date = a.date || report.fmt(new Date());
    const day = report.dayData(a.repo, date);
    const autoText = report.formatDay(day);
    console.log(autoText);

    const inferred = inferHours(day);
    if (a.hours === undefined) {
      console.log(`\n推断时长：${inferred}h（按当天提交时间跨度）。确认请加 --hours ${inferred} 或 --hours auto。`);
      return;
    }
    const hours = a.hours === 'auto' ? inferred : Number(a.hours);
    if (!(hours > 0)) throw new Error(`当天没有可记录的时长（推断 ${inferred}h）；要记录请显式给 --hours`);

    const note = readNote(a);
    const text = note === null ? autoText : note;
    if (!text) throw new Error('--note / --note-file 的正文为空；请写入叙述内容，或去掉该参数');

    const marker = `[${c.worklogMarker}:day:${date}]`;
    const body = `${marker}\n${text}`;
    // 兼容改名前的 [worklog-sync:day:DATE]，避免同一天被记两次
    const existing = (await jira.listWorklogs(a.issue))
      .find(w => w.started === date && cfg.hasMarker(w.comment, c, 'day'));

    if (existing) {
      console.log(`\n已存在 ${date} 的 worklog（id=${existing.id}，${existing.seconds / 3600}h）→ 更新为 ${hours}h`);
      await jira.updateWorklog(a.issue, existing.id, hours, body, a.dry);
    } else {
      console.log(`\n写入 ${a.issue} worklog：${hours}h（${date}）`);
      await jira.addWorklog(a.issue, hours, date, body, a.dry);
    }
    console.log(note === null
      ? '正文：当天提交列表（默认）。要写叙述式内容用 --note 或 --note-file。'
      : '正文：叙述式（--note/--note-file）；提交链接请作附注。');
    if (a.dry) console.log('[dry-run] 未真正提交');
  },
};
