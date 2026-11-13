'use strict';
// 内存版 Jira mock：只为测试 CLI 的协议层，不连真服务。
// 启动：node tests/mock-jira.js [port]
const http = require('http');

const state = {
  seq: 1000,
  issues: new Map(),   // key -> { id, fields, transitions, worklogs, comments, deleted }
  nextWorklog: 1,
  nextComment: 1,
};

function newKey() { return `MOCK-${state.seq++}`; }

function issueJSON(key) {
  const it = state.issues.get(key);
  if (!it) return null;
  return {
    id: it.id, key,
    fields: Object.assign({ summary: it.summary || '' }, it.fields),
    _worklogs: it.worklogs, _comments: it.comments,
  };
}

function body(req) {
  return new Promise(res => {
    let x = '';
    req.on('data', c => x += c);
    req.on('end', () => { try { res(x ? JSON.parse(x) : {}); } catch (_) { res({}); } });
  });
}

function send(res, code, obj) {
  const s = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const m = req.method;

  if (p === '/rest/api/2/myself') return send(res, 200, { name: 'mockuser' });

  if (p === '/rest/api/2/issue/createmeta') {
    return send(res, 200, {
      projects: [{
        key: 'MOCK',
        issuetypes: [
          { id: '1', name: '任务', subtask: false },
          { id: '2', name: '子任务', subtask: true },
          { id: '3', name: '子任务', subtask: false },  // 同名的非子任务类型（真实项目里踩过）
        ],
      }],
    });
  }

  if (p === '/rest/api/2/search') {
    const jql = decodeURIComponent(u.searchParams.get('jql') || '');
    const parent = (jql.match(/parent\s*=\s*([A-Z]+-\d+)/) || [])[1];
    const list = [...state.issues.entries()]
      .filter(([k, it]) => !it.deleted)
      .filter(([k, it]) => (parent ? it.parent === parent : true))
      .map(([k, it]) => issueJSON(k));
    return send(res, 200, {
      startAt: 0, maxResults: 200, total: list.length,
      issues: list.map(i => ({ key: i.key, fields: Object.assign({}, i.fields, { parent: i.fields.parent }) })),
    });
  }

  let mm = p.match(/^\/rest\/api\/2\/issue\/([A-Z]+-\d+)(\/.*)?$/);
  if (mm) {
    const key = mm[1], rest = mm[2] || '';
    const it = state.issues.get(key);
    if (m === 'DELETE') {
      return send(res, 403, { errorMessages: ['您没有删除此项目问题的权限。'] });
    }
    if (!it && m !== 'PUT') return send(res, 404, { errorMessages: ['not found'] });

    if (rest === '' && m === 'GET') return send(res, 200, issueJSON(key));
    if (rest === '' && m === 'PUT') {
      const b = await body(req);
      if (!it) return send(res, 404, {});
      if (b.fields) {
        if (b.fields.summary !== undefined) it.summary = b.fields.summary;
        if (b.fields.description !== undefined) it.description = b.fields.description;
        if (b.fields.priority !== undefined) it.fields.priority = b.fields.priority;
        if (b.fields.labels !== undefined) it.fields.labels = b.fields.labels;
        if (b.fields.assignee !== undefined) it.fields.assignee = b.fields.assignee;
        if (b.fields.parent !== undefined) { it.parent = b.fields.parent.key; it.fields.parent = b.fields.parent; }
        if (b.fields.timetracking) {
          const tt = b.fields.timetracking;
          if (tt.originalEstimate !== undefined) it.fields.timeoriginalestimate = parseH(tt.originalEstimate);
          if (tt.remainingEstimate !== undefined) it.fields.timeestimate = parseH(tt.remainingEstimate);
        }
      }
      return send(res, 204);
    }
    if (rest === '/transitions' && m === 'GET') {
      const cur = it.status || '待办';
      const list = cur === '待办'
        ? [{ id: '11', name: 'In Progress' }, { id: '12', name: 'CLOSE' }]
        : [{ id: '13', name: 'CLOSE' }];
      return send(res, 200, { transitions: list });
    }
    if (rest === '/transitions' && m === 'POST') {
      const b = await body(req);
      it.status = (b.transition && b.transition.id === '11') ? '处理中' : '完成';
      return send(res, 204);
    }
    if (rest === '/worklog' && m === 'GET') return send(res, 200, { worklogs: it.worklogs });
    if (rest === '/worklog' && m === 'POST') {
      const b = await body(req);
      const w = { id: String(state.nextWorklog++), started: b.started, timeSpentSeconds: parseH(b.timeSpent), comment: b.comment || '' };
      it.worklogs.push(w);
      return send(res, 201, w);
    }
    let wm = rest.match(/^\/worklog\/(\d+)$/);
    if (wm && m === 'PUT') {
      const b = await body(req);
      const w = it.worklogs.find(x => x.id === wm[1]);
      if (!w) return send(res, 404, {});
      w.timeSpentSeconds = parseH(b.timeSpent);
      w.comment = b.comment || w.comment;
      return send(res, 200, w);
    }
    if (rest === '/comment' && m === 'GET') return send(res, 200, { comments: it.comments });
    if (rest === '/comment' && m === 'POST') {
      const b = await body(req);
      const c = { id: String(state.nextComment++), body: b.body || '' };
      it.comments.push(c);
      return send(res, 201, c);
    }
    let cm = rest.match(/^\/comment\/(\d+)$/);
    if (cm && m === 'PUT') {
      const b = await body(req);
      const c = it.comments.find(x => x.id === cm[1]);
      if (!c) return send(res, 404, {});
      c.body = b.body || c.body;
      return send(res, 200, c);
    }
    return send(res, 400, { errorMessages: ['unsupported ' + m + ' ' + rest] });
  }

  if (p === '/rest/api/2/issue' && m === 'POST') {
    const b = await body(req);
    const f = b.fields || {};
    const key = newKey();
    const it = {
      id: String(state.seq), summary: f.summary || '', parent: f.parent && f.parent.key,
      status: '待办',
      fields: {
        description: f.description || '',
        issuetype: f.issuetype,
        priority: f.priority,
        assignee: f.assignee,
        parent: f.parent,
        labels: f.labels || [],
        timeoriginalestimate: parseH(f.timetracking && f.timetracking.originalEstimate),
        timeestimate: parseH(f.timetracking && f.timetracking.remainingEstimate),
        timespent: 0,
      },
      worklogs: [], comments: [],
    };
    state.issues.set(key, it);
    return send(res, 201, { id: it.id, key, self: 'http://localhost/' + key });
  }

  send(res, 404, { errorMessages: ['no route ' + p] });
});

function parseH(s) {
  if (!s) return 0;
  const m = String(s).trim().match(/^([\d.]+)\s*(h|m)$/i);
  if (!m) return 0;
  return Math.round(Number(m[1]) * (m[2].toLowerCase() === 'h' ? 3600 : 60));
}

const port = Number(process.argv[2] || process.env.MOCK_PORT || 8099);
server.listen(port, '127.0.0.1', () => console.log('mock jira on http://127.0.0.1:' + port));

module.exports = { server, state };
