'use strict';
// 日/周汇总：把 git 历史变成可读的 Markdown 记录
const g = require('./gitlink');

function dayRange(date) { return [`${date} 00:00`, `${date} 23:59`]; }

function dayData(repo, date) {
  const [since, until] = dayRange(date);
  const info = g.repoInfo(repo);
  const cs = g.commits(repo, since, until);
  const st = g.diffstat(repo, since, until);
  return { date, repo, branch: info.branch, web: info.web, commits: cs, diffstat: st };
}

function formatDay(d, opts = {}) {
  const max = opts.maxCommits || 12;
  const ds = d.diffstat ? ` — ${d.diffstat.files} 文件 +${d.diffstat.ins}/-${d.diffstat.del}` : '';
  const out = [`${d.date}（分支 ${d.branch}，${d.commits.length} 个提交${ds}）`];
  for (const c of d.commits.slice(0, max)) {
    const link = g.commitUrl(d.web, c.full);
    out.push(`- ${c.short} ${c.subject}${link ? ` (${link})` : ''}`);
  }
  if (d.commits.length > max) out.push(`- … 另有 ${d.commits.length - max} 个提交`);
  if (!d.commits.length) out.push('- （当天该仓库无提交）');
  return out.join('\n');
}

function fmt(dt) { return dt.toISOString().slice(0, 10); }

// 周一为一周起点
function weekRange(anchor) {
  const d = anchor ? new Date(anchor + 'T00:00:00') : new Date();
  const day = (d.getDay() + 6) % 7;
  const start = new Date(d.getTime() - day * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start: fmt(start), end: fmt(end) };
}

function weekData(repo, startDate, endDate) {
  const days = [];
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  for (let t = s.getTime(); t <= e.getTime(); t += 86400000) {
    const d = dayData(repo, fmt(new Date(t)));
    if (d.commits.length) days.push(d);
  }
  return { start: startDate, end: endDate, repo, days };
}

function formatWeek(w) {
  const total = w.days.reduce((s, d) => s + d.commits.length, 0);
  const out = [`周报 ${w.start} ~ ${w.end}（${total} 个提交，覆盖 ${w.days.length} 天）`, ''];
  for (const d of w.days) {
    out.push(formatDay(d, { maxCommits: 8 }));
    out.push('');
  }
  if (!w.days.length) out.push('（本周该仓库无提交）');
  return out.join('\n');
}

module.exports = { dayRange, dayData, formatDay, weekRange, weekData, formatWeek, fmt };
