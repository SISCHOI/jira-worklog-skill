'use strict';
// 关闭 / 删除（无权限时降级为关闭）
const jira = require('../lib/jira');

module.exports = {
  name: 'close',
  help: `close <KEY>            关闭（自动处理 Done/CLOSE 等不同流转名）
  rm    <KEY>            删除；项目未开放删除权限时降级为关闭并留痕`,
  async run(argv) {
    const sub = argv[0], key = argv[1];
    if (!key) { console.log(this.help); return; }
    if (sub === 'rm') await jira.deleteOrClose(key);
    else if (sub === 'close') await jira.closeIssue(key);
    else console.log(this.help);
  },
};
