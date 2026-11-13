# jira-worklog

Turn "what did I do these days" into Jira worklogs: scan your git history, write a narrative
worklog (idempotently), reconcile hours, and manage tickets — from one command.

把「这几天干了什么」从 git 自动汇总成记录并写进 Jira：每日/每周统计、worklog（幂等，不重复计工时）、
工时分配与上限守卫、建单改单关闭删除，一条命令完成。

It is both a **CLI** and an **agent skill** (works with DeepSeek Harness / Claude Code / Codex).

---

## Why

Most friction in "logging work" is not Jira itself:

| Pain | What this tool does |
|---|---|
| You remember the commits, not the hours | Generates the worklog body from `git log` (branch, commits, diffstat, links) |
| Re-running the same day doubles the hours | Idempotent per day: finds the existing entry by marker and **updates** it |
| Weekly report counts the time again | `weekly` only posts a comment by default; worklog is opt-in |
| Jira field quirks (localized types, transition names, timetracking) | Encoded once: createmeta id lookup, transition aliases, both estimate fields at once |
| Accidentally assigning tickets to others | Only ever assigns to yourself; other names are rejected |

## Features

| Command | What it does |
|---|---|
| `wl daily` | Scan today's git commits, write/update the day's worklog (narrative via `--note-file`) |
| `wl weekly` | Weekly report comment + Markdown file; no double-counted hours by default |
| `wl hours` | Reconcile original / remaining / spent; `--check` exits non-zero when over budget |
| `wl allocate` | Split a total estimate across sub-tasks by weight, with a budget guard |
| `wl link` | Attach branch, commit links and MR URL to an issue |
| `wl create` / `edit` / `close` / `rm` | Ticket lifecycle (sub-task type id, two-step close, delete-or-degrade) |
| `wl verify` | 12-step end-to-end self test against your own Jira |

## Install

```bash
# Linux / macOS
bash install.sh                      # all detected hosts
bash install.sh --target=codex       # only Codex

# Windows (PowerShell)
powershell -File install.ps1                  # all detected hosts
powershell -File install.ps1 -Target dsh -AddToPath
```

Per-host locations:

| Host | Directory |
|---|---|
| DeepSeek Harness | `~/.dsh/skills/jira-worklog/` |
| Claude Code | `~/.claude/skills/jira-worklog/` |
| Codex | `~/.codex/skills/jira-worklog/` |

No host needed either: put `scripts/` on `PATH` and call `wl` directly.

## Configure

Copy the example and edit:

```bash
cp config.example.json ~/.jira-worklog.json
```

```json
{
  "project": "PROJ",
  "capHours": 240,
  "subtaskTypeName": "",
  "defaultTypeName": "Task",
  "gitlabHost": ""
}
```

- `project` — Jira project key (or set `JIRA_PROJECT`, or pass `--project`).
- `subtaskTypeName` — leave empty to auto-pick the single sub-task type from `createmeta`
  (works with localized Jira such as Chinese `子任务`).
- `gitlabHost` — leave empty to infer commit/MR links from `git remote get-url origin`.
- `capHours` — budget guard (default 240; override with `JIRA_CAP_HOURS`).

Credentials: `~/.netrc` (or `%USERPROFILE%\_netrc` on Windows), matching your Jira host:

```
machine jira.example.com
  login you@example.com
  password <personal-access-token>
```

The tool never prints or stores the token.

## Quick start

```bash
wl daily --issue PROJ-101                      # preview: what did I do today, plus inferred hours
wl daily --issue PROJ-101 --hours 8            # write it
wl daily --issue PROJ-101 --hours 8 --note-file today.md   # narrative body (recommended)
wl hours                                       # reconcile
```

## Usage

### Daily worklog

```bash
wl daily --issue PROJ-101                             # preview only (no write)
wl daily --issue PROJ-101 --hours 8                   # body from git commits
wl daily --issue PROJ-101 --hours auto                # infer from commit time span (1–12h)
wl daily --issue PROJ-101 --date 2026-11-05 --hours 6 # backfill
wl daily --issue PROJ-101 --hours 8 --note-file today.md
```

Generated body looks like:

```
2026-11-06（分支 feat/login-refactor，12 个提交 — 31 文件 +2048/-512）
- 03b90fd feat(auth): split the login flow into token and session steps
  (https://gitlab.example.com/group/project/-/commit/03b90fd)
```

Idempotency: the entry is tagged `[jira-worklog:day:2026-11-06]`; re-running updates it.

### Weekly report

```bash
wl weekly --issue PROJ-101                  # comment + reports/week-2026-11-02.md
wl weekly --issue PROJ-101 --post-worklog --hours 40   # only if you really log weekly
```

By default it does **not** write a worklog (your daily entries already did).

### Estimates and allocation

```bash
wl allocate PROJ-100 --total 120                        # proportional to current estimates
wl allocate PROJ-100 --total 120 --weights 1,1.5,2,1     # weighted
wl hours --check                                         # non-zero exit when over budget
```

### Link code to a ticket

```bash
wl link PROJ-101 --since "7 days ago"
wl link PROJ-101 --mr https://github.com/you/repo/pull/1
```

### Tickets

```bash
wl create --summary "Cache the settlement module" --hours 24
wl create --summary "Sub-task A" --parent PROJ-100 --hours 8
wl edit PROJ-102 --summary "New title" --priority High
wl close PROJ-102
wl rm PROJ-103        # delete; degrades to close with a note when not permitted
```

## Design notes

- **Type resolution** goes through `createmeta` ids, never raw names — localized Jira
  (`任务`/`子任务`) is the norm, and name-based creation fails there.
- **Transitions** are matched by aliases (`Done`/`CLOSE`/`Resolved`…) case-insensitively;
  when needed it takes two steps (open → close).
- **Time tracking** writes `originalEstimate` and `remainingEstimate` together: writing only
  remaining silently shrinks the original in some Jira versions.
- **Budget guard** computes "what the project total would become" *before* writing and refuses
  to exceed `capHours`.
- **Idempotency markers** `[jira-worklog:day:...]` / `[jira-worklog:week:...]`; the legacy
  `[worklog-sync:...]` marker is still recognized.

## Tests

```bash
node tests/check-skill.js    # 31 format/compliance checks (no network)
node tests/e2e.js            # 15 end-to-end checks against a mock Jira (no credentials)
wl verify                    # 12-step end-to-end against your real Jira
```

`tests/e2e.js` starts `tests/mock-jira.js` locally and isolates `HOME`, so it runs anywhere.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `选择的问题类型无效` / `invalid issue type` | type name mismatch | leave `subtaskTypeName` empty (auto-detect) or set the exact name |
| `invalid transition state "完成"` | transition names differ per workflow | tool already tries aliases; add your workflow names via config if needed |
| Original estimate shrinks after edit | Jira adjusts original when only remaining is written | the tool always sends both fields |
| 401 / `No API key` | `_netrc` host/login mismatch | host must equal the Jira host, login must match exactly |
| Over budget rejected | `capHours` guard | raise `capHours` or use `--force` where supported |

## License

MIT — see [LICENSE](LICENSE).
