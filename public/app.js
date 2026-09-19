// 页面交互：规则、文件与扫描三块都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  rules: [],
  files: [],
  ruleSets: [],
  coverage: null,
  levels: [],
  statuses: [],
  fileTypes: [],
  ruleLevels: [],
  ruleStatuses: [],
  ruleFileTypes: [],
  editingRuleId: '',
  editingFileId: '',
  editingSetId: '',
  lastScan: null,
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：规则区与文件区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA'
    ? target
    : target.querySelector('input, select, textarea');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function levelClass(level) {
  if (level === '错误') return 'lv-error';
  if (level === '警告') return 'lv-warn';
  return 'lv-hint';
}

const OPERATOR_KEY = 'check-hits-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadRules() {
  const params = new URLSearchParams();
  const level = el('rule-filter-level').value;
  const status = el('rule-filter-status').value;
  const fileType = el('rule-filter-type').value;
  const keyword = el('rule-filter-keyword').value.trim();
  if (level) params.set('level', level);
  if (status) params.set('status', status);
  if (fileType) params.set('fileType', fileType);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/rules${query ? `?${query}` : ''}`);
  state.rules = payload.rules || [];
  state.levels = payload.levels || [];
  state.statuses = payload.statuses || [];
  state.fileTypes = payload.fileTypes || [];
  renderRuleFilters();
  renderRules();
  renderScanRuleOptions();
}

async function loadFiles() {
  const params = new URLSearchParams();
  const type = el('file-filter-type').value;
  const keyword = el('file-filter-keyword').value.trim();
  if (type) params.set('type', type);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/files${query ? `?${query}` : ''}`);
  state.files = payload.files || [];
  state.ruleFileTypes = payload.fileTypes || [];
  renderFileFilters();
  renderFiles();
  renderScanFileOptions();
}

async function loadRuleSets() {
  const payload = await request('/api/rule-sets');
  state.ruleSets = payload.ruleSets || [];
  renderRuleSets();
  renderSetRuleOptions();
  renderRules();
}

async function loadCoverage() {
  const payload = await request('/api/coverage');
  state.coverage = payload;
  renderCoverage();
  renderConflicts();
}

// 规则编号 → 归进它的规则集名称，规则表与规则集表单都要用
function setNamesByRule() {
  const map = new Map();
  state.ruleSets.forEach((set) => {
    set.ruleIds.forEach((ruleId) => {
      if (!map.has(ruleId)) map.set(ruleId, []);
      map.get(ruleId).push(set.name);
    });
  });
  return map;
}

function renderRuleFilters() {
  const levelSelect = el('rule-filter-level');
  const levelCurrent = levelSelect.value;
  levelSelect.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(levelCurrent)) levelSelect.value = levelCurrent;

  const statusSelect = el('rule-filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const typeSelect = el('rule-filter-type');
  const typeCurrent = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部适用文件类型</option>'
    + state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(typeCurrent)) typeSelect.value = typeCurrent;

  const formLevel = el('rule-level');
  const formLevelCurrent = formLevel.value;
  formLevel.innerHTML = state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(formLevelCurrent)) formLevel.value = formLevelCurrent;

  const formStatus = el('rule-status');
  const formStatusCurrent = formStatus.value;
  formStatus.innerHTML = state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(formStatusCurrent)) formStatus.value = formStatusCurrent;

  const formType = el('rule-file-type');
  const formTypeCurrent = formType.value;
  formType.innerHTML = state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(formTypeCurrent)) formType.value = formTypeCurrent;

  const scanLevel = el('scan-level');
  const scanLevelCurrent = scanLevel.value;
  scanLevel.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(scanLevelCurrent)) scanLevel.value = scanLevelCurrent;
}

function renderFileFilters() {
  const typeSelect = el('file-filter-type');
  const current = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部类型</option>'
    + state.ruleFileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.ruleFileTypes.includes(current)) typeSelect.value = current;
}

function renderScanRuleOptions() {
  const select = el('scan-rule');
  const current = select.value;
  select.innerHTML = '<option value="">全部规则</option>'
    + state.rules.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)} ${escapeHtml(item.name)}</option>`).join('');
  if (state.rules.some((item) => item.id === current)) select.value = current;
}

function renderScanFileOptions() {
  const select = el('scan-file');
  const current = select.value;
  select.innerHTML = '<option value="">全部文件</option>'
    + state.files.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.path)}</option>`).join('');
  if (state.files.some((item) => item.id === current)) select.value = current;
}

function renderRules() {
  const body = el('rule-body');
  const setNames = setNamesByRule();
  body.innerHTML = state.rules.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="tag ${levelClass(item.level)}">${escapeHtml(item.level)}</span></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.fileType)}</td>
      <td class="wrap-cell">${(setNames.get(item.id) || []).map((name) => escapeHtml(name)).join('、') || '<span class="muted">未归组</span>'}</td>
      <td class="mono">${escapeHtml(item.pattern)}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-rule-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-rule-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('rule-empty').classList.toggle('hidden', state.rules.length > 0);
}

function renderRuleSets() {
  const body = el('set-body');
  body.innerHTML = state.ruleSets.map((item) => {
    const prefixes = item.prefixes.map((prefix) => `<span class="prefix-chip">${escapeHtml(prefix)}</span>`).join('');
    const members = item.rules.length
      ? item.rules.map((rule) => escapeHtml(rule.code)).join('、')
      : '<span class="muted">还没有成员</span>';
    return `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td class="wrap-cell">${prefixes}</td>
      <td class="mono wrap-cell" title="${escapeHtml(item.rules.map((rule) => `${rule.code} ${rule.name}`).join('\n'))}">${members}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-set-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-set-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`;
  }).join('');
  el('set-empty').classList.toggle('hidden', state.ruleSets.length > 0);
}

// 规则集表单里的成员勾选清单：重绘时保住已经勾上的项
function renderSetRuleOptions() {
  const box = el('set-rules');
  const checked = new Set(Array.from(box.querySelectorAll('input:checked')).map((node) => node.value));
  box.innerHTML = state.rules.map((rule) => `
    <label class="rule-check" title="${escapeHtml(rule.code)} ${escapeHtml(rule.name)}">
      <input type="checkbox" value="${escapeHtml(rule.id)}"${checked.has(rule.id) ? ' checked' : ''}>
      <span class="mono">${escapeHtml(rule.code)}</span>
      <span class="tag ${levelClass(rule.level)}">${escapeHtml(rule.level)}</span>
      <span>${escapeHtml(rule.name)}</span>
    </label>`).join('');
}

function renderFiles() {
  const body = el('file-body');
  body.innerHTML = state.files.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.path)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${item.lineCount} 行</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-file-view="${escapeHtml(item.id)}">看内容</button>
        <button type="button" class="link" data-file-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-file-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('file-empty').classList.toggle('hidden', state.files.length > 0);
}

function openRuleForm(rule) {
  state.editingRuleId = rule ? rule.id : '';
  el('rule-form-title').textContent = rule ? `编辑规则：${rule.code}` : '新建规则';
  el('rule-code').value = rule ? rule.code : '';
  el('rule-name').value = rule ? rule.name : '';
  el('rule-level').value = rule ? rule.level : (state.levels[0] || '提示');
  el('rule-status').value = rule ? rule.status : (state.statuses[0] || '启用');
  el('rule-file-type').value = rule ? rule.fileType : (state.fileTypes[0] || '全部');
  el('rule-pattern').value = rule ? rule.pattern : '';
  el('rule-note').value = rule ? rule.note : '';
  el('rule-form').classList.remove('hidden');
  el('rule-code').focus();
}

function closeRuleForm() {
  state.editingRuleId = '';
  el('rule-form').classList.add('hidden');
  clearFieldMarks();
}

function openFileForm(file) {
  state.editingFileId = file ? file.id : '';
  el('file-form-title').textContent = file ? `编辑文件：${file.path}` : '收录新文件';
  el('file-path').value = file ? file.path : '';
  el('file-content').value = file ? file.content : '';
  el('file-note').value = file ? file.note : '';
  el('file-form').classList.remove('hidden');
  el('file-path').focus();
}

function closeFileForm() {
  state.editingFileId = '';
  el('file-form').classList.add('hidden');
  clearFieldMarks();
}

function openSetForm(set) {
  state.editingSetId = set ? set.id : '';
  el('set-form-title').textContent = set ? `编辑规则集：${set.name}` : '新建规则集';
  el('set-name').value = set ? set.name : '';
  el('set-prefixes').value = set ? set.prefixes.join('\n') : '';
  el('set-note').value = set ? set.note : '';
  renderSetRuleOptions();
  const wanted = new Set(set ? set.ruleIds : []);
  el('set-rules').querySelectorAll('input').forEach((input) => {
    input.checked = wanted.has(input.value);
  });
  el('set-form').classList.remove('hidden');
  el('set-name').focus();
}

function closeSetForm() {
  state.editingSetId = '';
  el('set-form').classList.add('hidden');
  clearFieldMarks();
}

function renderCoverage() {
  const coverage = state.coverage;
  if (!coverage) return;
  const { totals } = coverage;
  el('coverage-meta').textContent = `清单里共 ${totals.dirs} 个目录，${totals.covered} 个有规则集覆盖，${totals.uncovered} 个没有被任何规则集覆盖`;

  const body = el('coverage-body');
  body.innerHTML = coverage.directories.map((entry) => {
    const sets = entry.sets.map((set) => escapeHtml(set.name)).join('、');
    const rules = entry.rules.map((rule) => {
      const off = rule.status === '停用';
      const title = `${rule.name}｜写法：${rule.pattern}｜适用类型：${rule.fileType}｜来自：${rule.fromSets.join('、')}${off ? '｜当前停用' : ''}`;
      return `<span class="rule-chip${off ? ' chip-off' : ''}" title="${escapeHtml(title)}">`
        + `<span class="mono">${escapeHtml(rule.code)}</span>`
        + `<span class="tag ${levelClass(rule.level)}">${escapeHtml(rule.level)}</span>`
        + `<span class="chip-src">${escapeHtml(rule.fromSets.join('＋'))}${off ? '｜停用' : ''}</span>`
        + '</span>';
    }).join('') || '<span class="muted">覆盖的规则集里没有管到这个目录的规则</span>';
    return `<tr>
      <td class="mono">${escapeHtml(entry.dir || '（根目录）')}</td>
      <td>${entry.fileCount} 个（${escapeHtml(entry.fileTypes.join('、'))}）</td>
      <td class="wrap-cell">${sets}</td>
      <td class="wrap-cell">${rules}</td>
    </tr>`;
  }).join('');
  el('coverage-empty').classList.toggle('hidden', coverage.directories.length > 0 || coverage.uncovered.length > 0);

  const uncoveredBox = el('coverage-uncovered');
  if (coverage.uncovered.length > 0) {
    const chips = coverage.uncovered
      .map((entry) => `<span class="dir-chip">${escapeHtml(entry.dir || '（根目录）')}（${entry.fileCount} 个文件，${escapeHtml(entry.fileTypes.join('、'))}）</span>`)
      .join('');
    uncoveredBox.innerHTML = `<strong>没有被任何规则集覆盖的目录：</strong>${chips}`
      + '<p>这些目录下的文件不归任何规则集管，需要补一个规则集，或把现有规则集的前缀调宽。</p>';
    uncoveredBox.classList.remove('hidden');
  } else {
    uncoveredBox.classList.add('hidden');
    uncoveredBox.innerHTML = '';
  }

  el('coverage-ungrouped').textContent = coverage.ungroupedRules.length > 0
    ? `还没有归进任何规则集的规则：${coverage.ungroupedRules.map((rule) => rule.code).join('、')}`
    : '所有规则都已归进规则集';
}

function renderConflictGroup(boxId, countId, items, renderItem) {
  const box = el(boxId);
  const count = el(countId);
  count.textContent = items.length > 0 ? `${items.length} 处` : '无';
  count.className = `count-badge${items.length > 0 ? '' : ' zero'}`;
  box.innerHTML = items.length > 0
    ? items.map(renderItem).join('')
    : '<p class="conflict-empty">没有这类冲突</p>';
}

function renderConflicts() {
  const coverage = state.coverage;
  if (!coverage) return;
  const { conflicts } = coverage;

  renderConflictGroup('conflict-dup', 'conflict-dup-count', conflicts.ruleDuplicated, (item) => {
    const sets = item.sets.map((set) => `「${escapeHtml(set.name)}」`).join('与');
    const segs = item.segments.map((seg) => `<span class="prefix-chip">${escapeHtml(seg.dir)}</span>`).join('');
    return `<div class="conflict-item">
      <p>规则 <span class="mono">${escapeHtml(item.rule.code)}</span> ${escapeHtml(item.rule.name)} 同时在 ${sets} 里，两个集的范围在 ${segs} 上重叠</p>
      <p class="verdict">判断：${escapeHtml(item.verdict)}</p>
    </div>`;
  });

  renderConflictGroup('conflict-pattern', 'conflict-pattern-count', conflicts.patternLevel, (item) => {
    const [primary, secondary] = item.rules;
    const dirs = item.dirs.map((dir) => `<span class="prefix-chip">${escapeHtml(dir || '（根目录）')}</span>`).join('');
    return `<div class="conflict-item">
      <p><span class="mono">${escapeHtml(primary.code)}</span>（${escapeHtml(primary.level)}，写法 <span class="mono">${escapeHtml(primary.pattern)}</span>）与 <span class="mono">${escapeHtml(secondary.code)}</span>（${escapeHtml(secondary.level)}，写法 <span class="mono">${escapeHtml(secondary.pattern)}</span>）指向同一段文字 <span class="mono">${escapeHtml(item.sharedText)}</span>，在 ${item.dirs.length} 个目录同时生效：${dirs}</p>
      <p class="verdict">判断：${escapeHtml(item.verdict)}</p>
    </div>`;
  });

  renderConflictGroup('conflict-contains', 'conflict-contains-count', conflicts.setContains, (item) => {
    let title;
    if (item.kind === 'identical') {
      const [a, b] = item.sets;
      title = `「${escapeHtml(a.name)}」与「${escapeHtml(b.name)}」的目录范围完全相同（${item.covered.map((prefix) => `<span class="prefix-chip">${escapeHtml(prefix)}</span>`).join('')}）`;
    } else {
      title = `「${escapeHtml(item.container.name)}」（${item.container.prefixes.map((prefix) => `<span class="prefix-chip">${escapeHtml(prefix)}</span>`).join('')}）把「${escapeHtml(item.contained.name)}」（${item.contained.prefixes.map((prefix) => `<span class="prefix-chip">${escapeHtml(prefix)}</span>`).join('')}）整个包住`;
    }
    return `<div class="conflict-item">
      <p>${title}</p>
      <p class="verdict">判断：${escapeHtml(item.verdict)}</p>
    </div>`;
  });
}

async function showFileContent(id) {
  clearNotice();
  try {
    const file = await request(`/api/files/${encodeURIComponent(id)}`);
    const preview = el('file-preview');
    preview.textContent = `${file.path}（${file.lineCount} 行）\n${'─'.repeat(40)}\n${file.content}`;
    preview.classList.remove('hidden');
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function submitRule(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    code: el('rule-code').value,
    name: el('rule-name').value,
    level: el('rule-level').value,
    status: el('rule-status').value,
    fileType: el('rule-file-type').value,
    pattern: el('rule-pattern').value,
    note: el('rule-note').value,
  };
  const editing = state.editingRuleId;
  try {
    if (editing) {
      await request(`/api/rules/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('规则已保存', 'ok');
    } else {
      await request('/api/rules', { method: 'POST', body: JSON.stringify(payload) });
      notify('规则已新增', 'ok');
    }
    closeRuleForm();
    await loadRules();
    await loadRuleSets();
    await loadCoverage();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitFile(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    path: el('file-path').value,
    content: el('file-content').value,
    note: el('file-note').value,
  };
  const editing = state.editingFileId;
  try {
    if (editing) {
      await request(`/api/files/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('文件已保存', 'ok');
    } else {
      await request('/api/files', { method: 'POST', body: JSON.stringify(payload) });
      notify('文件已收录', 'ok');
    }
    closeFileForm();
    await loadFiles();
    await loadCoverage();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitSet(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    name: el('set-name').value,
    prefixes: el('set-prefixes').value.split('\n').map((line) => line.trim()).filter(Boolean),
    ruleIds: Array.from(el('set-rules').querySelectorAll('input:checked')).map((node) => node.value),
    note: el('set-note').value,
  };
  const editing = state.editingSetId;
  try {
    if (editing) {
      await request(`/api/rule-sets/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('规则集已保存', 'ok');
    } else {
      await request('/api/rule-sets', { method: 'POST', body: JSON.stringify(payload) });
      notify('规则集已新增', 'ok');
    }
    closeSetForm();
    await loadRuleSets();
    await loadCoverage();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 扫一遍，把概要与命中清单都画出来
async function runScan() {
  clearNotice();
  const body = {
    ruleId: el('scan-rule').value,
    fileId: el('scan-file').value,
    level: el('scan-level').value,
  };
  try {
    const result = await request('/api/scan', { method: 'POST', body: JSON.stringify(body) });
    state.lastScan = result;
    renderScan(result);
  } catch (err) {
    notify(err.message, 'error');
  }
}

function renderScan(result) {
  el('scan-meta').textContent = `扫描时刻 ${formatTime(result.scannedAt)}　参与比对的规则 ${result.rulesUsed} 条（启用共 ${result.enabledRules} 条）　范围里的文件 ${result.filesInScope} 个（清单共 ${result.filesTotal} 个）`;

  const warningBox = el('scan-warning');
  if (result.warning) {
    warningBox.textContent = result.warning;
    warningBox.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
    warningBox.textContent = '';
  }

  const summaryBox = el('scan-summary');
  const levelText = Object.keys(result.summary.byLevel)
    .map((key) => `${key} ${result.summary.byLevel[key]} 条`)
    .join('　');
  const ruleText = result.summary.byRule
    .map((item) => `${item.code} ${item.count} 条`)
    .join('　') || '没有规则命中';
  const fileText = result.summary.byFile
    .map((item) => `${item.path} ${item.count} 条`)
    .join('　') || '没有文件命中';
  summaryBox.innerHTML = `
    <div class="summary-line"><strong>一共命中 ${result.summary.total} 条</strong>　${escapeHtml(levelText)}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    <div class="summary-line">按文件：${escapeHtml(fileText)}</div>`;
  summaryBox.classList.remove('hidden');

  const body = el('hit-body');
  body.innerHTML = result.hits.map((hit) => `<tr>
      <td class="mono">${escapeHtml(hit.code)}</td>
      <td><span class="tag ${levelClass(hit.level)}">${escapeHtml(hit.level)}</span></td>
      <td>${escapeHtml(hit.ruleName)}</td>
      <td class="mono">${escapeHtml(hit.path)}</td>
      <td class="mono">${hit.lineNo}</td>
      <td class="mono line-cell">${escapeHtml(hit.lineText)}</td>
    </tr>`).join('');
  el('hit-empty').classList.toggle('hidden', result.hits.length > 0);
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  if (node.dataset.ruleEdit) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleEdit);
    if (found) openRuleForm(found);
    return;
  }

  if (node.dataset.ruleDelete) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleDelete);
    if (!window.confirm(`确定删除规则 ${found ? found.code : ''} 吗？`)) return;
    try {
      await request(`/api/rules/${encodeURIComponent(node.dataset.ruleDelete)}`, { method: 'DELETE' });
      if (state.editingRuleId === node.dataset.ruleDelete) closeRuleForm();
      notify('规则已删除', 'ok');
      await loadRules();
      await loadRuleSets();
      await loadCoverage();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.setEdit) {
    clearNotice();
    const found = state.ruleSets.find((item) => item.id === node.dataset.setEdit);
    if (found) openSetForm(found);
    return;
  }

  if (node.dataset.setDelete) {
    clearNotice();
    const found = state.ruleSets.find((item) => item.id === node.dataset.setDelete);
    if (!window.confirm(`确定删除规则集 ${found ? found.name : ''} 吗？规则本身会保留，只是不再归这个集管。`)) return;
    try {
      await request(`/api/rule-sets/${encodeURIComponent(node.dataset.setDelete)}`, { method: 'DELETE' });
      if (state.editingSetId === node.dataset.setDelete) closeSetForm();
      notify('规则集已删除', 'ok');
      await loadRuleSets();
      await loadCoverage();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileView) {
    await showFileContent(node.dataset.fileView);
    return;
  }

  if (node.dataset.fileEdit) {
    clearNotice();
    try {
      const file = await request(`/api/files/${encodeURIComponent(node.dataset.fileEdit)}`);
      openFileForm(file);
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileDelete) {
    clearNotice();
    const found = state.files.find((item) => item.id === node.dataset.fileDelete);
    if (!window.confirm(`确定把 ${found ? found.path : ''} 移出清单吗？`)) return;
    try {
      await request(`/api/files/${encodeURIComponent(node.dataset.fileDelete)}`, { method: 'DELETE' });
      if (state.editingFileId === node.dataset.fileDelete) closeFileForm();
      el('file-preview').classList.add('hidden');
      notify('文件已移出清单', 'ok');
      await loadFiles();
      await loadCoverage();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

el('rule-form').addEventListener('submit', submitRule);
el('file-form').addEventListener('submit', submitFile);
el('set-form').addEventListener('submit', submitSet);
el('rule-new').addEventListener('click', () => {
  clearNotice();
  openRuleForm(null);
});
el('rule-cancel').addEventListener('click', closeRuleForm);
el('file-new').addEventListener('click', () => {
  clearNotice();
  openFileForm(null);
});
el('file-cancel').addEventListener('click', closeFileForm);
el('set-new').addEventListener('click', () => {
  clearNotice();
  openSetForm(null);
});
el('set-cancel').addEventListener('click', closeSetForm);
el('set-refresh').addEventListener('click', () => {
  clearNotice();
  loadRuleSets()
    .then(loadCoverage)
    .catch((err) => notify(err.message, 'error'));
});
el('coverage-refresh').addEventListener('click', () => {
  clearNotice();
  loadCoverage().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-reset').addEventListener('click', () => {
  el('rule-filter-level').value = '';
  el('rule-filter-status').value = '';
  el('rule-filter-type').value = '';
  el('rule-filter-keyword').value = '';
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-refresh').addEventListener('click', () => {
  clearNotice();
  loadRules()
    .then(loadFiles)
    .then(loadRuleSets)
    .then(loadCoverage)
    .catch((err) => notify(err.message, 'error'));
});
el('file-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('file-filter-reset').addEventListener('click', () => {
  el('file-filter-type').value = '';
  el('file-filter-keyword').value = '';
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('scan-run').addEventListener('click', runScan);
el('rule-filter-level').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-status').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把规则、文件、规则集与生效范围都拉一遍，扫描的范围下拉依赖前两份清单
restoreOperator();
loadHealth();
loadRules()
  .then(loadFiles)
  .then(loadRuleSets)
  .then(loadCoverage)
  .catch((err) => notify(err.message, 'error'));
