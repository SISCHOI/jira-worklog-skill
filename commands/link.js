'use strict';
// 关联：把当前分支/提交/MR 链接写进工单评论（Jira 的“关联 GitHub/GitLab”）
const jira = require('../lib/jira');
const g = require('../lib/gitlink');

module.exports = {
  name: 'link',
  help: `link <KEY> [--repo .] [--since "7 days ago"] [--until "..."] [--mr URL] [--dry-run]
  把当前分支、最近的提交（带 GitLab 提交链接）、以及 MR 链接作为评论写到该单。
  不给 --mr 时会附一个“查找该分支 MR”的链接。`,
  async run(argv) {
    const key = argv[0];
    if (!key || key.startsWith('-')) { console.log(this.help); return; }
    const a = { repo: process.cwd(), since: '7 days ago' };
    for (let i = 1; i < argv.length; i++) {
      const t = argv[i], next = () => argv[++i];
      if (t === '--repo') a.repo = next();
      else if (t === '--since') a.since = next();
      else if (t === '--until') a.until = next();
      else if (t === '--mr') a.mr = next();
      else if (t === '--dry-run') a.dry = true;
    }
    const info = g.repoInfo(a.repo);
    const cs = g.commits(a.repo, a.since, a.until);
    const mr = a.mr || g.mrSearchUrl(info.web, info.branch);
    const lines = [`关联代码：分支 \`${info.branch}\`（${info.web || info.remote || '未知远端'}）`];
    if (mr) lines.push(`MR：${mr}`);
    if (cs.length) {
      lines.push(`最近提交（${cs.length}）：`);
      for (const c of cs.slice(0, 15)) {
        const u = g.commitUrl(info.web, c.full);
        lines.push(`- ${c.short} ${c.subject}${u ? ` (${u})` : ''}`);
      }
      if (cs.length > 15) lines.push(`- … 另有 ${cs.length - 15} 个`);
    } else {
      lines.push('（该时间窗内无提交）');
    }
    const body = lines.join('\n');
    console.log(body);
    await jira.comment(key, body, a.dry);
  },
};
