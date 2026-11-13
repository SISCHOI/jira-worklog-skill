'use strict';
// 入口：wl <命令> [参数]
const path = require('path');

const COMMANDS = {
  create: './commands/create',
  edit: './commands/edit',
  allocate: './commands/allocate',
  close: './commands/close',
  rm: './commands/close',
  daily: './commands/daily',
  weekly: './commands/weekly',
  hours: './commands/hours',
  check: './commands/hours',
  link: './commands/link',
  verify: './commands/verify',
};

const USAGE = `wl <命令> [参数]

创建 / 修改
  create    --summary "..." [--body|--body-file] [--parent KEY] [--hours 8] [--type 任务]
  edit      <KEY> [--summary ...] [--body-file f] [--priority High] [--labels a,b]
开放/关闭
  close     <KEY>                关闭（自动处理 Done/CLOSE 等流转名）
  rm        <KEY>                删除；无删权限时降级为关闭并留痕
时间
  allocate  <PARENT> --total 120 [--weights 1,1.5,2] [--dry-run] [--force]
  hours     [--project PROJ] [--check]      对账 / 只看是否超上限
记录
  daily     --issue KEY [--date D] [--hours 8|auto] [--repo .] [--dry-run]
            [--note "..." | --note-file f]           当天统计+worklog（幂等）；--note 写叙述式正文
  weekly    --issue KEY [--week D] [--repo .] [--dry-run] [--post-worklog --hours N]
                                             周报（默认只发评论，不重复计工时）
  link      <KEY> [--since "7 days ago"] [--mr URL]                          分支/提交/MR 关联
自检
  verify    [--project PROJ]

上限：默认 240h，可用 ~/.jira-worklog.json 或 WL_CAP_HOURS 覆盖。`;

(async () => {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') { console.log(USAGE); return; }
  const mod = COMMANDS[cmd];
  if (!mod) { console.error(`未知命令：${cmd}\n`); console.log(USAGE); process.exitCode = 1; return; }
  try {
    const c = require(path.join(__dirname, '..', mod));
    const argv = (cmd === 'rm') ? ['rm'].concat(rest) : (cmd === 'close' ? ['close'].concat(rest) : rest);
    await c.run(argv);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  }
})();
