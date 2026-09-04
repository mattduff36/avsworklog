/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * Display-only Vitest reporter loaded by child processes.
 * Keep this file free of TypeScript so reporter load cannot fail the suite.
 */
function countTasks(task) {
  if (!task || typeof task !== 'object') return 0;
  if (task.type === 'test' || task.type === 'testcase') return 1;
  const children = Array.isArray(task.tasks) ? task.tasks : [];
  return children.reduce((sum, child) => sum + countTasks(child), 0);
}

function taskIdentity(task) {
  return String((task && (task.id || task.fullName || task.name)) || '');
}

function taskName(task) {
  return String((task && (task.fullName || task.name || task.title)) || '').trim() || 'test';
}

function taskState(task) {
  return task && task.result && task.result.state ? task.result.state : task && task.state;
}

function taskFailed(task) {
  const state = taskState(task);
  return state === 'fail' || state === 'failed';
}

function taskFinished(task) {
  const state = taskState(task);
  return (
    state === 'pass' ||
    state === 'passed' ||
    state === 'fail' ||
    state === 'failed' ||
    state === 'skip' ||
    state === 'skipped' ||
    state === 'todo'
  );
}

class TeeVitestProgressReporter {
  constructor() {
    this.seen = new Set();
    this.names = new Map();
    this.total = null;
    this.completed = 0;
    this.current = null;
    this.failures = [];
  }

  indexTasks(task) {
    const id = taskIdentity(task);
    if (id) this.names.set(id, taskName(task));
    for (const child of task.tasks || []) this.indexTasks(child);
  }

  write() {
    const file = process.env.TEE_VITEST_PROGRESS_FILE;
    if (!file) return;
    const snapshot = {
      completed: this.total === null ? this.completed : Math.min(this.completed, this.total),
      total: this.total,
      current: this.current,
      failures: [...this.failures],
    };
    try {
      require('fs').writeFileSync(file, `${JSON.stringify(snapshot)}\n`, 'utf8');
    } catch {
      /* display-only */
    }
  }

  note(id, name, failed) {
    if (!id || this.seen.has(id)) return;
    this.seen.add(id);
    this.completed += 1;
    this.current = name;
    if (failed) this.failures.push(name);
    this.write();
  }

  onCollected(files) {
    if (!Array.isArray(files)) return;
    for (const file of files) this.indexTasks(file);
    const total = files.reduce((sum, file) => sum + countTasks(file), 0);
    if (total > 0) this.total = total;
    this.write();
  }

  onTaskUpdate(packs) {
    if (!Array.isArray(packs)) return;
    for (const pack of packs) {
      const id = Array.isArray(pack) ? String(pack[0] || '') : '';
      const task = Array.isArray(pack) ? pack[1] : pack;
      if (!task || typeof task !== 'object') continue;
      if (task.type && task.type !== 'test' && task.type !== 'testcase') continue;
      const name =
        taskName(task) !== 'test' ? taskName(task) : this.names.get(task.id || id) || 'test';
      if (!taskFinished(task)) {
        if (name !== 'test') this.current = name;
        continue;
      }
      this.note(task.id || id, name, taskFailed(task));
    }
  }

  onTestCaseResult(testCase) {
    if (!testCase) return;
    this.note(taskIdentity(testCase), taskName(testCase), taskFailed(testCase));
  }
}

module.exports = TeeVitestProgressReporter;
module.exports.default = TeeVitestProgressReporter;
