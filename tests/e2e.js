'use strict';
// 端到端功能测试（对 mock Jira）：覆盖 create/edit/subtask/allocate/worklog 幂等/
// 上限守卫/指派人拒绝/关闭/删除降级/工时对账/周报评论幂等
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.MOCK_PORT || 8099);

function run(args, env) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'wl.js')].concat(args), {
      encoding: 'utf8', env: Object.assign({}, process.env, env || {}),
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// 读 mock 上的 worklog（独立进程 GET，验证正文真的落库而不是只看 stdout）
function fetchWorklogs(key) {
  const script =
    "const http=require('http');" +
    "http.get('http://127.0.0.1:" + PORT + "/rest/api/2/issue/" + key + "/worklog',r=>{" +
    "let x='';r.setEncoding('utf8');r.on('data',d=>x+=d);r.on('end',()=>process.stdout.write(x))})";
  return (JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })).worklogs || [])
    .map(w => Object.assign({}, w, { started: String(w.started || '').slice(0, 10) }));
}

(async () => {
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-jira.js'), String(PORT)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 400));

  // 隔离用户主目录：不读本机 ~/.jira-worklog.json，保证任何机器/CI 上结果一致
  const os = require('os');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-worklog-'));
  const ENV = {
    WL_API_BASE: `http://127.0.0.1:${PORT}`,
    WL_TOKEN: 'mock-token',
    WL_CAP_HOURS: '10',
    JIRA_PROJECT: 'PROJ',
    USERPROFILE: fakeHome,
    HOME: fakeHome,
  };
  const results = [];
  const step = (name, fn) => {
    try { const d = fn(); results.push([name, 'PASS', d || '']); }
    catch (e) { results.push([name, 'FAIL', e.message]); }
  };

  let key = null, kid = null;
  step('create 任务', () => {
    const r = run(['create', '--summary', '测试任务', '--hours', '4'], ENV);
    assert.strictEqual(r.code, 0, r.out);
    key = (r.out.match(/created (\S+)/) || [])[1];
    assert.ok(key, r.out);
    return key;
  });

  step('edit 改标题', () => {
    const r = run(['edit', key, '--summary', '改名后'], ENV);
    assert.strictEqual(r.code, 0, r.out);
    return 'ok';
  });

  step('create 子任务', () => {
    const r = run(['create', '--parent', key, '--summary', '子任务A', '--hours', '2'], ENV);
    assert.strictEqual(r.code, 0, r.out);
    kid = (r.out.match(/created (\S+)/) || [])[1];
    assert.ok(kid, r.out);
    return kid;
  });

  step('create 指派他人被拒', () => {
    const r = run(['create', '--summary', 'x', '--assign', 'someone-else'], ENV);
    assert.notStrictEqual(r.code, 0);
    assert.ok(/指派被拒绝/.test(r.out), r.out);
    return 'refused';
  });

  step('create 超上限被拒', () => {
    // 建单就带 99h，必须被守卫拒绝（不能靠先建单绕过闸门）
    const r = run(['create', '--summary', '超额探测', '--hours', '99'], ENV);
    assert.notStrictEqual(r.code, 0, 'create 应被上限守卫拒绝：' + r.out);
    assert.ok(/工时上限守卫/.test(r.out), r.out);
    return 'refused';
  });

  step('allocate 超上限被拒', () => {
    const r = run(['allocate', key, '--total', '99'], ENV);
    assert.notStrictEqual(r.code, 0, 'allocate 应被上限守卫拒绝：' + r.out);
    assert.ok(/工时上限守卫/.test(r.out), r.out);
    return 'refused';
  });

  step('worklog 写入', () => {
    const r = run(['daily', '--issue', key, '--date', '2026-11-06', '--hours', '2', '--repo', ROOT], ENV);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/worklog ok/.test(r.out), r.out);
    return 'ok';
  });

  step('daily 幂等（重复执行不新增）', () => {
    const r1 = run(['daily', '--issue', key, '--date', '2026-11-06', '--hours', '2', '--repo', ROOT], ENV);
    assert.strictEqual(r1.code, 0, r1.out);
    assert.ok(/worklog updated/.test(r1.out), r1.out);
    return 'updated not duplicated';
  });

  step('daily --note-file 叙述式正文落库', () => {
    const noteFile = path.join(__dirname, 'note-tmp.md');
    fs.writeFileSync(noteFile, '[note-file] 完成登录模块重构；超时 2.1s→0.4s，无回归\n- 提交 abc1234', 'utf8');
    const r = run(['daily', '--issue', key, '--date', '2026-11-06', '--hours', '2', '--repo', ROOT, '--note-file', noteFile], ENV);
    fs.unlinkSync(noteFile);
    assert.strictEqual(r.code, 0, r.out);
    const wl = fetchWorklogs(key).find(w => w.started === '2026-11-06');
    assert.ok(wl, 'worklog missing');
    assert.strictEqual(wl.timeSpentSeconds, 7200);
    assert.ok(wl.comment.includes('[jira-worklog:day:2026-11-06]'), wl.comment);
    assert.ok(wl.comment.includes('完成登录模块重构') && wl.comment.includes('2.1s→0.4s'), wl.comment);
    assert.ok(!wl.comment.includes('\uFFFD'), 'comment contains replacement char');
    return 'narrative stored';
  });

  step('daily --note 内联并更新同一条', () => {
    const r = run(['daily', '--issue', key, '--date', '2026-11-06', '--hours', '2', '--repo', ROOT,
      '--note', 'inline note: done X, result 7'], ENV);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/worklog updated/.test(r.out), r.out);
    const ws = fetchWorklogs(key).filter(w => w.started === '2026-11-06');
    assert.strictEqual(ws.length, 1, 'should not duplicate');
    assert.ok(ws[0].comment.includes('inline note: done X, result 7'), ws[0].comment);
    return 'updated in place';
  });

  step('daily 不给 --hours 不写库', () => {
    const before = fetchWorklogs(key).length;
    const r = run(['daily', '--issue', key, '--date', '2026-11-07', '--repo', ROOT], ENV);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/推断时长/.test(r.out), r.out);
    assert.strictEqual(fetchWorklogs(key).length, before, 'should not write without --hours');
    return 'no write';
  });

  step('close 关闭', () => {
    const r = run(['close', key], ENV);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/closed/.test(r.out), r.out);
    return 'ok';
  });

  step('rm 无权限降级', () => {
    const r = run(['rm', kid], ENV);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/降级为关闭/.test(r.out), r.out);
    return 'degraded';
  });

  step('hours 对账', () => {
    const r = run(['hours', '--check'], ENV);
    assert.ok(/工时合计/.test(r.out), r.out);
    return r.out.trim().split('\n').pop();
  });

  step('weekly 评论幂等', () => {
    const r1 = run(['weekly', '--issue', key, '--week', '2026-11-06', '--repo', ROOT, '--dry-run'], ENV);
    assert.strictEqual(r1.code, 0, r1.out);
    return 'dry-run ok';
  });

  mock.kill();
  console.log('\n=== e2e (mock jira) ===');
  let bad = 0;
  for (const [n, s, d] of results) {
    if (s !== 'PASS') bad++;
    console.log(`${s === 'PASS' ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`);
  }
  console.log(bad ? `\n${bad} 项失败` : `\n全部 ${results.length} 项通过`);
  process.exitCode = bad ? 1 : 0;
})();
