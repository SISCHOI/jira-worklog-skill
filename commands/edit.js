'use strict';
// 修改：标题/描述/优先级/标签/父单/指派（仅自己）
const fs = require('fs');
const jira = require('../lib/jira');

module.exports = {
  name: 'edit',
  help: `edit <KEY> [--summary "..."] [--body 文本 | --body-file f] [--priority High]
        [--labels a,b] [--parent KEY] [--dry-run]
  指派只能用 --assign self（或自己），他人一律拒绝。`,
  async run(argv) {
    const key = argv[0];
    if (!key || key.startsWith('-')) { console.log(this.help); return; }
    const ch = {};
    for (let i = 1; i < argv.length; i++) {
      const t = argv[i], next = () => argv[++i];
      if (t === '--summary') ch.summary = next();
      else if (t === '--body') ch.description = next();
      else if (t === '--body-file') ch.description = fs.readFileSync(next(), 'utf8');
      else if (t === '--priority') ch.priority = next();
      else if (t === '--labels') ch.labels = next().split(',').map(s => s.trim()).filter(Boolean);
      else if (t === '--parent') ch.parent = next();
      else if (t === '--assign') ch.assign = next();
      else if (t === '--dry-run') ch.dry = true;
    }
    if (ch.dry) {
      console.log(`[dry-run] edit ${key}: ${Object.keys(ch).filter(k => k !== 'dry').join(', ')}`);
      return;
    }
    const dry = ch.dry; delete ch.dry;
    await jira.editIssue(key, ch, dry);
  },
};
