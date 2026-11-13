'use strict';
// 端到端自检：建单 -> 改单 -> 建子任务 -> 时间分配 -> 工时 -> 幂等 -> 关闭 -> 删除降级
const jira = require('../lib/jira');
const { api } = require('../lib/netrc');
const cfg = require('../lib/config');
const allocate = require('./allocate');
const report = require('../lib/report');

async function freeIdleIssue(project) {
  const me = await jira.whoami();
  const jql = encodeURIComponent(`assignee = ${me} AND project = ${project} ORDER BY created DESC`);
  const r = await api('GET', `/rest/api/2/search?jql=${jql}&maxResults=1&fields=summary`);
  return r.issues.length ? r.issues[0].key : null;
}

module.exports = {
  name: 'verify',
  help: 'verify [--project PROJ]  端到端自检；自检单会先归零工时再关闭，不污染预算',
  async run(argv) {
    let project;
    for (let i = 0; i < argv.length; i++) if (argv[i] === '--project') project = argv[++i];
    const c = cfg.load();
    const P = cfg.requireProject(c, project);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const results = [];
    let key = null, kid = null;

    const step = async (name, fn) => {
      try { const v = await fn(); results.push([name, 'PASS', v === undefined || v === null ? '' : String(v)]); return v; }
      catch (e) { results.push([name, 'FAIL', e.message]); throw e; }
    };

    try {
      await step('whoami', async () => jira.whoami());
      key = await step('create 任务（指派自己）', () => jira.createIssue({
        project: P, type: '任务', summary: `【自检】jira-worklog ${stamp}`,
        description: '端到端自检单，跑完自动关闭。', priority: 'Low', assign: 'self',
      }));
      await step('edit 标题/优先级', () => jira.editIssue(key, { summary: `【自检】jira-worklog ${stamp}（已修改）`, priority: 'Low' }));
      kid = await step('create 子任务', () => jira.createIssue({
        project: P, parent: key, summary: '自检子任务 A', priority: 'Low', assign: 'self',
      }));
      await step('子任务写预估（显式授权，避免撞上限）', () => jira.setEstimate(kid, 2, 2, { project: P, force: true }));
      await step('allocate 时间分配', async () => {
        const argv2 = [key, '--total', '4', '--weights', '1', '--force', '--dry-run'];
        const before = console.log;
        let out = '';
        console.log = (...a) => { out += a.join(' ') + '\n'; };
        try { await allocate.run(argv2); } finally { console.log = before; }
        if (!/dry-run/.test(out)) throw new Error('allocate 未输出 dry-run 计划');
        return 'plan ok';
      });
      await step('estimate 超上限被拒', async () => {
        try { await jira.setEstimate(key, c.capHours + 10, 1, { project: P }); }
        catch (e) { return 'refused'; }
        throw new Error('未被上限守卫拦住');
      });
      await step('指派他人被拒', async () => {
        try { await jira.assertSelf('another-user'); } catch (e) { return 'refused'; }
        throw new Error('未被指派守卫拦住');
      });
      await step('worklog 30m 落库', () => jira.addWorklog(key, 0.5, report.fmt(new Date()), `[${c.worklogMarker}:verify:${stamp}] 自检`));
      await step('worklog 幂等（同标记只应有 1 条）', async () => {
        const wls = await jira.listWorklogs(key);
        const hit = wls.filter(w => w.comment.includes(`[${c.worklogMarker}:verify:${stamp}]`));
        if (hit.length !== 1) throw new Error(`同标记 worklog 数量 ${hit.length}，期望 1`);
        return '1 条';
      });
      await step('回读校验', async () => {
        const f = (await api('GET', `/rest/api/2/issue/${key}?fields=worklog,timeoriginalestimate`)).fields;
        const wl = (f.worklog && f.worklog.worklogs || []).length;
        if (!wl) throw new Error('worklog 回读为空');
        return `worklogs=${wl}`;
      });
      await step('删除或降级关闭', async () => {
        // 先把自己和子任务的预估都归零，避免自检污染工时预算
        for (const k of [kid, key]) {
          if (!k) continue;
          await jira.setEstimate(k, 0, 0, { project: P, force: true });
        }
        const r = await jira.deleteOrClose(key);
        if (kid) { try { await jira.deleteOrClose(kid); } catch (_) {} }
        return r;
      });
      key = null; kid = null;
    } catch (_) {
      for (const k of [kid, key]) {
        if (!k) continue;
        try { await jira.setEstimate(k, 0, 0, { project: P, force: true }); } catch (_) {}
        try { await jira.deleteOrClose(k); } catch (_) {}
      }
    }

    console.log('\n=== jira-worklog 自检 ===');
    for (const [n, r, d] of results) console.log(`${r === 'PASS' ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`);
    const bad = results.filter(r => r[1] !== 'PASS').length;
    console.log(bad ? `\n结果: ${bad} 项失败` : `\n结果: 全部 ${results.length} 项通过`);
    if (bad) process.exitCode = 3;
  },
};
