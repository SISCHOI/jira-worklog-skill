'use strict';
// 每周：汇总一周提交 + 已记工时 -> 周报（默认只发评论，避免与每日 worklog 重复计工时）
const fs = require('fs');
const path = require('path');
const jira = require('../lib/jira');
const report = require('../lib/report');
const cfg = require('../lib/config');

module.exports = {
  name: 'weekly',
  help: `weekly --issue KEY [--week YYYY-MM-DD] [--repo .] [--dry-run] [--post-worklog --hours N] [--force]
  默认行为：把本周（周一起算）的提交汇总成周报，作为 comment 发到该单，并在 <repo>/reports/ 落一份 Markdown。
  默认不写 worklog —— 因为每日 worklog 已经记过，再写会重复计工时。
  只有明确 --post-worklog 时才写一条周工时；若该周已有每日 worklog，会被拒绝（--force 越过）。`,
  async run(argv) {
    const a = { repo: process.cwd() };
    for (let i = 0; i < argv.length; i++) {
      const t = argv[i], next = () => argv[++i];
      if (t === '--issue') a.issue = next();
      else if (t === '--week') a.week = next();
      else if (t === '--repo') a.repo = next();
      else if (t === '--hours') a.hours = Number(next());
      else if (t === '--post-worklog') a.postWorklog = true;
      else if (t === '--worklog') a.postWorklog = true;   // 兼容写法
      else if (t === '--dry-run') a.dry = true;
      else if (t === '--force') a.force = true;
    }
    if (!a.issue) { console.log(this.help); return; }
    const c = cfg.load();
    const { start, end } = report.weekRange(a.week);
    const w = report.weekData(a.repo, start, end);
    const text = report.formatWeek(w);
    console.log(text);

    // 本周已记工时（从 Jira 读回，作为“统计”的一半）
    const wls = (await jira.listWorklogs(a.issue)).filter(x => x.started >= start && x.started <= end);
    const logged = Math.round(wls.reduce((s, x) => s + x.seconds / 3600, 0) * 10) / 10;
    console.log(`\n该单本周已记 worklog：${wls.length} 条，合计 ${logged}h`);
    for (const x of wls) console.log(`  ${x.started}  ${x.seconds / 3600}h`);

    const header = `周报 ${start} ~ ${end}｜提交 ${w.days.reduce((s, d) => s + d.commits.length, 0)} 个｜已记工时 ${logged}h`;

    // 落盘
    const dir = path.join(a.repo, c.reportDir);
    const file = path.join(dir, `week-${start}.md`);
    if (!a.dry) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `# ${header}\n\n${text}\n\n## 已记工时\n\n` +
        (wls.length ? wls.map(x => `- ${x.started} ${x.seconds / 3600}h`).join('\n') : '- 本周暂无') + '\n', 'utf8');
      console.log(`\n周报已落盘：${file}`);
    } else {
      console.log(`\n[dry-run] 将写 ${file}`);
    }

    // 评论（幂等：同周只保留一条，重复跑是更新）
    const marker = `[${c.worklogMarker}:week:${start}]`;
    const body = `${marker}\n${header}\n\n${text}`;
    await jira.commentIdempotent(a.issue, marker, body, a.dry, c);

    // 可选：写周 worklog
    if (a.postWorklog) {
      const hours = a.hours || logged;
      if (!hours) throw new Error('需要 --hours（本周没有可累计的已记工时）');
      const hasDaily = wls.some(x => cfg.hasMarker(x.comment, c, 'day'));
      if (hasDaily && !a.force) {
        throw new Error(`本周已有每日 worklog（${wls.length} 条，合计 ${logged}h），再写周工时会计重复。确需写请加 --force。`);
      }
      const existing = wls.find(x => x.comment.includes(marker));
      if (existing) {
        console.log(`\n已存在本周 worklog（id=${existing.id}）→ 更新为 ${hours}h`);
        await jira.updateWorklog(a.issue, existing.id, hours, body, a.dry);
      } else {
        console.log(`\n写入周 worklog：${hours}h`);
        await jira.addWorklog(a.issue, hours, end, body, a.dry);
      }
    } else {
      console.log('未写 worklog（默认只发周报评论；需要周工时请加 --post-worklog --hours N）');
    }
  },
};
