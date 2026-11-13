'use strict';
// 创建：任务 / 子任务（只指派给自己）
const jira = require('../lib/jira');

function parse(argv) {
  const a = { labels: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === '--summary') a.summary = next();
    else if (t === '--body') a.description = next();
    else if (t === '--body-file') a.description = require('fs').readFileSync(next(), 'utf8');
    else if (t === '--type') a.type = next();
    else if (t === '--project') a.project = next();
    else if (t === '--parent') a.parent = next();
    else if (t === '--hours') a.hours = Number(next());
    else if (t === '--priority') a.priority = next();
    else if (t === '--labels') a.labels = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (t === '--assign') a.assign = next();
    else if (t === '--force') a.force = true;
    else if (t === '--dry-run') a.dry = true;
    else if (t === '--help' || t === '-h') a.help = true;
  }
  return a;
}

module.exports = {
  name: 'create',
  help: `create --summary "..." [--body 文本 | --body-file f] [--type 任务|子任务]
       [--project PROJ] [--parent KEY] [--hours 8] [--priority High] [--labels a,b] [--dry-run]
  不指定 --parent 建普通单；指定则建子任务。指派固定为自己。`,
  async run(argv) {
    const a = parse(argv);
    if (a.help || !a.summary) { console.log(this.help); return; }
    await jira.createIssue(a);
  },
};
