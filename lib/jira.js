'use strict';
// Jira 领域操作：建单/改单/流转/关闭/删除降级/工时/预估/预算守卫
// 这里集中了所有踩过的坑，调用方不需要知道。
const { api } = require('./netrc');
const cfg = require('./config');

const CLOSE_ALIASES = ['done', 'close', 'closed', 'resolved', '完成', '关闭', '已关闭'];
const OPEN_ALIASES = ['in progress', 'in_progress', '处理中', 'start progress', 'start'];
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function whoami() {
  return (await api('GET', '/rest/api/2/myself')).name;
}

// 类型名 -> id（按名字提交在本地化项目里会报“问题类型无效”）
// 同名类型可能存在多个（如「子任务」既有 subtask=true 也有非子任务变体），用 opts.subtask 精确过滤
async function typeId(project, name, opts = {}) {
  const meta = await api('GET', `/rest/api/2/issue/createmeta?projectKeys=${project}&expand=projects.issuetypes`);
  const p = (meta.projects || [])[0];
  if (!p) throw new Error(`createmeta 里没有项目 ${project}`);
  const types = p.issuetypes || [];
  const pool = types.filter(t => (opts.subtask === true ? t.subtask === true
    : opts.subtask === false ? t.subtask !== true : true));
  let cands = name ? pool.filter(t => norm(t.name) === norm(name)) : [];
  // 名字没匹配上时，子任务回退到唯一子任务类型；普通单回退到唯一的 Task/任务
  if (!cands.length && opts.subtask === true && pool.length === 1) cands = pool;
  if (!cands.length && opts.subtask === false) {
    const t = pool.find(x => /^(task|任务)$/i.test(norm(x.name)));
    if (t) cands = [t];
  }
  if (!cands.length) {
    throw new Error(`${project} 没有${opts.subtask ? '子任务' : ''}类型「${name || '(未配置)'}」；` +
      `可用：${types.map(t => `${t.name}(${t.id}${t.subtask ? ',subtask' : ''})`).join(', ')}\n` +
      `可在 ~/.jira-worklog.json 里设置 ${opts.subtask ? 'subtaskTypeName' : 'defaultTypeName'}。`);
  }
  return cands[0];
}

async function assertSelf(requested) {
  const me = await whoami();
  if (requested && requested !== me && requested !== 'self') {
    throw new Error(`指派被拒绝：只允许指派给自己（${me}）。他人参与请由人工在 Jira 上分配。`);
  }
  return me;
}

async function createIssue(opts) {
  const c = cfg.load();
  const project = cfg.requireProject(c, opts.project);
  const me = await assertSelf(opts.assign);
  // 建单就带工时的，同样受上限守卫（否则可以先建单再超限，绕过闸门）
  if (opts.hours !== undefined) {
    await guardBudget(project, null, opts.hours, opts.force);
  }
  let type, parentKey = opts.parent;
  if (parentKey) {
    type = await typeId(project, opts.type || c.subtaskTypeName, { subtask: true });
  } else {
    type = await typeId(project, opts.type || c.defaultTypeName, { subtask: false });
  }
  const fields = {
    project: { key: project },
    issuetype: { id: type.id },
    summary: opts.summary,
    description: opts.description || '',
    priority: { name: opts.priority || c.defaultPriority },
    assignee: { name: me },
  };
  if (parentKey) fields.parent = { key: parentKey };
  if (opts.labels && opts.labels.length) fields.labels = opts.labels;
  if (opts.hours !== undefined) fields.timetracking = { originalEstimate: `${opts.hours}h` };
  if (opts.dry) {
    console.log(`[dry-run] create ${project} ${type.name} summary=${JSON.stringify(opts.summary)} assignee=${me}` +
      (parentKey ? ` parent=${parentKey}` : '') + (opts.hours !== undefined ? ` hours=${opts.hours}h` : ''));
    return null;
  }
  const j = await api('POST', '/rest/api/2/issue', { fields });
  console.log(`created ${j.key} (${type.name}, assignee=${me}${parentKey ? ', parent=' + parentKey : ''})`);
  return j.key;
}

async function editIssue(key, changes, dry) {
  const fields = {};
  if (changes.summary) fields.summary = changes.summary;
  if (changes.description !== undefined) fields.description = changes.description;
  if (changes.priority) fields.priority = { name: changes.priority };
  if (changes.labels) fields.labels = changes.labels;
  if (changes.assign) fields.assignee = { name: await assertSelf(changes.assign) };
  if (changes.parent) fields.parent = { key: changes.parent };
  if (!Object.keys(fields).length) throw new Error('没有要改的字段');
  if (dry) { console.log(`[dry-run] edit ${key} ${JSON.stringify(Object.keys(fields))}`); return; }
  await api('PUT', `/rest/api/2/issue/${key}`, { fields });
  console.log(`edited ${key} (${Object.keys(fields).join(', ')})`);
}

function pickTransition(list, aliases) {
  return (list || []).find(t => aliases.includes(norm(t.name)));
}

async function closeIssue(key) {
  const t1 = (await api('GET', `/rest/api/2/issue/${key}/transitions`)).transitions || [];
  let done = pickTransition(t1, CLOSE_ALIASES);
  if (!done) {
    const op = pickTransition(t1, OPEN_ALIASES);
    if (!op) throw new Error(`${key}: 找不到关闭/开启流转（有：${t1.map(t => t.name).join(',')}）`);
    await api('POST', `/rest/api/2/issue/${key}/transitions`, { transition: { id: op.id } });
    const t2 = (await api('GET', `/rest/api/2/issue/${key}/transitions`)).transitions || [];
    done = pickTransition(t2, CLOSE_ALIASES);
    if (!done) throw new Error(`${key}: 走完「${op.name}」仍无关闭流转（有：${t2.map(t => t.name).join(',')}）`);
  }
  await api('POST', `/rest/api/2/issue/${key}/transitions`, { transition: { id: done.id } });
  console.log(`closed ${key} (${done.name})`);
}

// 删除；项目未开放 DELETE_ISSUES 时降级为关闭并留痕
async function deleteOrClose(key) {
  try {
    await api('DELETE', `/rest/api/2/issue/${key}?deleteSubtasks=true`);
    console.log(`deleted ${key}`);
    return 'deleted';
  } catch (e) {
    const msg = String(e.message || '');
    if (!/403|400|not allowed|permission|没有删除/i.test(msg)) throw e;
    try {
      await api('POST', `/rest/api/2/issue/${key}/comment`, { body: 'jira-worklog：无删除权限（DELETE_ISSUES=false），降级为关闭。' });
    } catch (_) {}
    await closeIssue(key);
    console.log('delete 不可用（无权限），已降级为关闭');
    return 'closed';
  }
}

// ---------- 工时 ----------
function hoursToJira(h) {
  const n = Number(h);
  return n < 1 ? `${Math.round(n * 60)}m` : `${n}h`;
}

async function addWorklog(key, hours, date, comment, dry) {
  const body = { timeSpent: hoursToJira(hours), started: `${date}T15:00:00.000+0800`, comment };
  if (dry) { console.log(`[dry-run] worklog ${key} ${hoursToJira(hours)} ${date}`); return null; }
  const j = await api('POST', `/rest/api/2/issue/${key}/worklog`, body);
  console.log(`worklog ok: ${key} ${hoursToJira(hours)} ${date}`);
  return j.id;
}

async function listWorklogs(key) {
  const r = await api('GET', `/rest/api/2/issue/${key}/worklog?maxResults=200`);
  return (r.worklogs || []).map(w => ({
    id: w.id,
    started: (w.started || '').slice(0, 10),
    seconds: w.timeSpentSeconds || 0,
    comment: w.comment || '',
  }));
}

async function updateWorklog(key, wlId, hours, comment, dry) {
  if (dry) { console.log(`[dry-run] update worklog ${key}#${wlId} ${hoursToJira(hours)}`); return; }
  await api('PUT', `/rest/api/2/issue/${key}/worklog/${wlId}`, { timeSpent: hoursToJira(hours), comment });
  console.log(`worklog updated: ${key}#${wlId} ${hoursToJira(hours)}`);
}

async function myIssues(project) {
  const me = await whoami();
  const c = cfg.load();
  const p = cfg.requireProject(c, project);
  const jql = encodeURIComponent(`assignee = ${me} AND project = ${p} ORDER BY key ASC`);
  const r = await api('GET', `/rest/api/2/search?jql=${jql}&maxResults=200&fields=summary,status,timeoriginalestimate,timeestimate,timespent,parent`);
  return r.issues;
}

async function totalOriginal(project) {
  const is = await myIssues(project);
  return is.reduce((s, i) => s + (i.fields.timeoriginalestimate || 0) / 3600, 0);
}

// 写之前先算“改成这个值之后合计多少”，超上限直接拒绝
async function guardBudget(project, key, newOrigH, force) {
  const c = cfg.load();
  const is = await myIssues(project);
  const cur = is.find(i => i.key === key);
  const old = cur ? (cur.fields.timeoriginalestimate || 0) / 3600 : 0;
  const tot = is.reduce((s, i) => s + (i.fields.timeoriginalestimate || 0) / 3600, 0);
  const after = Math.round((tot - old + Number(newOrigH)) * 10) / 10;
  if (after > c.capHours && !force) {
    throw new Error(`工时上限守卫：${project} 合计 ${tot}h → 本次改成 ${newOrigH}h 后为 ${after}h，` +
      `超过上限 ${c.capHours}h。确需超过加 --force（或设 WL_CAP_HOURS）。`);
  }
  return { before: Math.round(tot * 10) / 10, after };
}

async function setEstimate(key, origH, remH, opts = {}) {
  const c = cfg.load();
  const project = opts.project || key.split('-')[0];
  const g = await guardBudget(project, key, origH, opts.force);
  const fields = { timetracking: { originalEstimate: `${origH}h` } };
  if (remH !== undefined && remH !== null) fields.timetracking.remainingEstimate = `${remH}h`;
  if (opts.dry) { console.log(`[dry-run] estimate ${key} ${origH}h（合计 ${g.before}h -> ${g.after}h）`); return; }
  await api('PUT', `/rest/api/2/issue/${key}`, { fields });
  console.log(`estimate ok: ${key} original=${origH}h` + (remH !== undefined && remH !== null ? ` remaining=${remH}h` : '') +
    `  （合计 ${g.before}h -> ${g.after}h / 上限 ${c.capHours}h）`);
}

async function comment(key, body, dry) {
  if (dry) { console.log(`[dry-run] comment ${key}: ${body.slice(0, 80)}…`); return; }
  await api('POST', `/rest/api/2/issue/${key}/comment`, { body });
  console.log(`comment ok: ${key}`);
}

// 幂等评论：带 marker 的评论存在就更新，否则新增（周报重复跑不会刷出多条）
// cfg 可选：传入时同时识别改名前的旧标记，避免历史上已发的周报被重复发一条
async function commentIdempotent(key, marker, body, dry, cfg) {
  const r = await api('GET', `/rest/api/2/issue/${key}/comment?maxResults=200`);
  const hit = (r.comments || []).find(c => {
    const t = String(c.body || '');
    if (t.includes(marker)) return true;
    if (!cfg) return false;
    const legacy = (cfg.legacyMarkers || []).map(m => marker.replace(`[${cfg.worklogMarker}:`, `[${m}:`));
    return legacy.some(x => t.includes(x));
  });
  if (dry) {
    console.log(`[dry-run] ${hit ? 'update' : 'create'} comment ${key}（marker ${marker}）`);
    return;
  }
  if (hit) {
    await api('PUT', `/rest/api/2/issue/${key}/comment/${hit.id}`, { body });
    console.log(`comment updated: ${key}#${hit.id}（marker ${marker}）`);
  } else {
    await api('POST', `/rest/api/2/issue/${key}/comment`, { body });
    console.log(`comment ok: ${key}（marker ${marker}）`);
  }
}

module.exports = {
  whoami, typeId, assertSelf, createIssue, editIssue, closeIssue, deleteOrClose,
  addWorklog, listWorklogs, updateWorklog, myIssues, totalOriginal, guardBudget,
  setEstimate, comment, commentIdempotent, hoursToJira,
};
