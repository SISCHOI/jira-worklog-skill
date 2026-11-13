'use strict';
// 工时对账 + 上限检查
const jira = require('../lib/jira');
const cfg = require('../lib/config');

module.exports = {
  name: 'hours',
  help: `hours [--project PROJ] [--check]
  表格：原估 / 剩余 / 已花；--check 只看是否超上限（超了退出码 2）。`,
  async run(argv) {
    let project, check = false;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--project') project = argv[++i];
      else if (argv[i] === '--check') check = true;
    }
    const c = cfg.load();
    const p = cfg.requireProject(c, project);
    const issues = await jira.myIssues(p);
    const h = v => Math.round((v || 0) / 360) / 10;
    let so = 0, sr = 0, ss = 0;
    if (!check) {
      console.log('key        | status | orig | rem | spent | summary');
      for (const i of issues) {
        const f = i.fields;
        const o = h(f.timeoriginalestimate), r = h(f.timeestimate), s = h(f.timespent);
        so += o; sr += r; ss += s;
        console.log(`${i.key.padEnd(10)} | ${(f.status && f.status.name || '').padEnd(6)} | ${String(o).padStart(4)} | ${String(r).padStart(3)} | ${String(s).padStart(5)} | ${f.summary.slice(0, 40)}`);
      }
      console.log('');
    } else {
      for (const i of issues) so += h(i.fields.timeoriginalestimate);
    }
    const over = so > c.capHours;
    console.log(`工时合计 ${Math.round(so * 10) / 10}h / 上限 ${c.capHours}h` + (over ? ` —— 超出 ${Math.round((so - c.capHours) * 10) / 10}h` : ' —— 未超'));
    if (!check && !over) console.log(`（剩余 ${Math.round(sr * 10) / 10}h，已花 ${Math.round(ss * 10) / 10}h）`);
    if (over) process.exitCode = 2;
  },
};
