// 页面交互：规则、文件与扫描三块都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  rules: [],
  files: [],
  ruleSets: [],
  scope: null,
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
  const params = new URLSearchParams();
  const keyword = el('set-filter-keyword').value.trim();
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/rule-sets${query ? `?${query}` : ''}`);
  state.ruleSets = payload.ruleSets || [];
  renderRuleSets();
}

async function loadScope() {
  const payload = await request('/api/scope');
  state.scope = payload;
  renderScope(payload);
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
  body.innerHTML = state.rules.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="tag ${levelClass(item.level)}">${escapeHtml(item.level)}</span></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.fileType)}</td>
      <td class="wrap">${item.ruleSets && item.ruleSets.length
        ? item.ruleSets.map((set) => `<span class="chip mono">${escapeHtml(set.code)}</span>`).join('')
        : '<span class="dim">未归组</span>'}</td>
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
  body.innerHTML = state.ruleSets.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="wrap">${item.dirPrefixes.map((prefix) => `<span class="chip mono">${escapeHtml(prefix)}/</span>`).join('')}</td>
      <td class="wrap">${item.rules.length
        ? item.rules.map((rule) => `<span class="chip mono" title="${escapeHtml(rule.name)}">${escapeHtml(rule.code)}</span>`).join('')
        : '<span class="dim">还没有成员</span>'}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-set-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-set-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('set-empty').classList.toggle('hidden', state.ruleSets.length > 0);
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

function dirLabel(dir) {
  return dir ? `${dir}/` : '（根目录）';
}

function setLabel(set) {
  return `${set.code} ${set.name}`;
}

// 目录生效一览：每个目录一块，写清覆盖它的规则集与生效的规则
function renderScope(scope) {
  const dirsBox = el('scope-dirs');
  dirsBox.innerHTML = scope.directories.map((dir) => {
    const setsText = dir.sets.map((set) => `<span class="chip mono" title="${escapeHtml(set.name)}">${escapeHtml(set.code)}</span>`).join('');
    const rows = dir.rules.map((rule) => `<tr>
        <td class="mono">${escapeHtml(rule.code)}</td>
        <td>${escapeHtml(rule.name)}</td>
        <td><span class="tag ${levelClass(rule.level)}">${escapeHtml(rule.level)}</span></td>
        <td>${escapeHtml(rule.status)}</td>
        <td>${escapeHtml(rule.fileType)}</td>
        <td class="mono">${escapeHtml(rule.pattern)}</td>
        <td class="wrap">${rule.fromSets.map((set) => `<span class="chip mono" title="${escapeHtml(set.name)}">${escapeHtml(set.code)}</span>`).join('')}</td>
      </tr>`).join('');
    const table = rows
      ? `<div class="table-wrap"><table class="grid dir-grid">
          <thead><tr><th>编码</th><th>名称</th><th>级别</th><th>状态</th><th>适用类型</th><th>匹配写法</th><th>来自规则集</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
      : '<p class="empty-tip">覆盖它的规则集里还没有成员规则，这个目录暂时没有生效的规则</p>';
    return `<div class="dir-block">
      <div class="dir-head">
        <span class="mono dir-name">${escapeHtml(dirLabel(dir.dir))}</span>
        <span class="dir-meta">${dir.fileCount} 个文件　覆盖规则集：${setsText}</span>
      </div>
      ${table}
    </div>`;
  }).join('');
  el('scope-dirs-empty').classList.toggle('hidden', scope.directories.length > 0);

  const uncoveredBox = el('scope-uncovered');
  uncoveredBox.innerHTML = scope.uncoveredDirectories.length
    ? scope.uncoveredDirectories.map((dir) => `<span class="chip mono">${escapeHtml(dirLabel(dir.dir))}（${dir.fileCount} 个文件）</span>`).join('')
    : '<span class="dim">所有目录都有规则集覆盖</span>';

  const ungroupedBox = el('scope-ungrouped');
  ungroupedBox.innerHTML = scope.ungroupedRules.length
    ? scope.ungroupedRules.map((rule) => `<span class="chip" title="${escapeHtml(rule.name)}"><span class="mono">${escapeHtml(rule.code)}</span> ${escapeHtml(rule.name)}（${escapeHtml(rule.status)}）</span>`).join('')
    : '<span class="dim">规则都已归到规则集里</span>';

  renderConflicts(scope.conflicts);
}

// 范围冲突判断：三类重叠各列各的，每条都写清是谁、重叠在哪一段、谁主谁次
function renderConflicts(conflicts) {
  const multiBox = el('conflict-rule-sets');
  multiBox.innerHTML = conflicts.ruleInMultipleSets.length
    ? conflicts.ruleInMultipleSets.map((entry) => `<div class="conflict-item">
        <div>规则 <strong class="mono">${escapeHtml(entry.rule.code)}</strong>「${escapeHtml(entry.rule.name)}」同时在
          <strong class="mono">${escapeHtml(entry.sets[0].code)}</strong>「${escapeHtml(entry.sets[0].name)}」与
          <strong class="mono">${escapeHtml(entry.sets[1].code)}</strong>「${escapeHtml(entry.sets[1].name)}」里，两个规则集的目录范围有重叠：</div>
        <ul>${entry.overlaps.map((overlap) => `<li>重叠段 <code>${escapeHtml(overlap.segment)}/</code>：以
          <strong class="mono">${escapeHtml(overlap.primary.code)}</strong> 为主、${escapeHtml(overlap.secondary.code)} 为次（${escapeHtml(overlap.reason)}）</li>`).join('')}</ul>
      </div>`).join('')
    : '<p class="empty-tip">没有这类重叠</p>';

  const sameTextBox = el('conflict-same-text');
  sameTextBox.innerHTML = conflicts.sameTextDifferentLevel.length
    ? conflicts.sameTextDifferentLevel.map((entry) => `<div class="conflict-item">
        <div>目录 <code>${escapeHtml(dirLabel(entry.dir))}</code>：<strong class="mono">${escapeHtml(entry.primary.code)}</strong>「${escapeHtml(entry.primary.name)}」（${escapeHtml(entry.primary.level)}）与
          <strong class="mono">${escapeHtml(entry.secondary.code)}</strong>「${escapeHtml(entry.secondary.name)}」（${escapeHtml(entry.secondary.level)}）的匹配写法指向同一段文字
          <code>${escapeHtml(entry.sharedText)}</code></div>
        <div class="verdict">以 <strong class="mono">${escapeHtml(entry.primary.code)}</strong>（${escapeHtml(entry.primary.level)}）为主，${escapeHtml(entry.secondary.code)}（${escapeHtml(entry.secondary.level)}）为次（级别高的为主）</div>
      </div>`).join('')
    : '<p class="empty-tip">没有这类重叠</p>';

  const containsBox = el('conflict-contains');
  containsBox.innerHTML = conflicts.setScopeContains.length
    ? conflicts.setScopeContains.map((entry) => {
      if (entry.kind === 'same') {
        const prefixes = entry.sets[0].dirPrefixes.map((prefix) => `<code>${escapeHtml(prefix)}/</code>`).join('、');
        return `<div class="conflict-item">
          <div><strong class="mono">${escapeHtml(entry.sets[0].code)}</strong>「${escapeHtml(entry.sets[0].name)}」与
            <strong class="mono">${escapeHtml(entry.sets[1].code)}</strong>「${escapeHtml(entry.sets[1].name)}」的目录范围完全相同（${prefixes}）</div>
          <div class="verdict">以 <strong class="mono">${escapeHtml(entry.primary.code)}</strong> 为主，${escapeHtml(entry.secondary.code)} 为次（${escapeHtml(entry.reason)}）</div>
        </div>`;
      }
      const containerPrefixes = entry.container.dirPrefixes.map((prefix) => `<code>${escapeHtml(prefix)}/</code>`).join('、');
      const containedPrefixes = entry.contained.dirPrefixes.map((prefix) => `<code>${escapeHtml(prefix)}/</code>`).join('、');
      return `<div class="conflict-item">
        <div><strong class="mono">${escapeHtml(entry.container.code)}</strong>「${escapeHtml(entry.container.name)}」的目录范围（${containerPrefixes}）把
          <strong class="mono">${escapeHtml(entry.contained.code)}</strong>「${escapeHtml(entry.contained.name)}」的范围（${containedPrefixes}）整个包住</div>
        <div class="verdict">在 ${escapeHtml(entry.contained.code)} 的范围内以 <strong class="mono">${escapeHtml(entry.primary.code)}</strong> 为主，${escapeHtml(entry.secondary.code)} 为次（${escapeHtml(entry.reason)}）</div>
      </div>`;
    }).join('')
    : '<p class="empty-tip">没有这类重叠</p>';
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

// 成员挑选要列出全部规则，不能受规则区筛选条件影响，所以单独拉一份未筛选的
async function openSetForm(set) {
  clearNotice();
  try {
    const payload = await request('/api/rules');
    state.allRulesForPicker = payload.rules || [];
  } catch (err) {
    notify(err.message, 'error');
    return;
  }
  state.editingSetId = set ? set.id : '';
  el('set-form-title').textContent = set ? `编辑规则集：${set.code}` : '新建规则集';
  el('set-code').value = set ? set.code : '';
  el('set-name').value = set ? set.name : '';
  el('set-prefixes').value = set ? set.dirPrefixes.join('\n') : '';
  el('set-note').value = set ? set.note : '';
  renderSetRulePicker(set ? set.ruleIds : []);
  el('set-form').classList.remove('hidden');
  el('set-code').focus();
}

function closeSetForm() {
  state.editingSetId = '';
  el('set-form').classList.add('hidden');
  clearFieldMarks();
}

function renderSetRulePicker(selectedIds) {
  const selected = new Set(selectedIds || []);
  const box = el('set-rules');
  const rules = state.allRulesForPicker || [];
  box.innerHTML = rules.length
    ? rules.map((rule) => `<label class="picker-item">
        <input type="checkbox" value="${escapeHtml(rule.id)}" ${selected.has(rule.id) ? 'checked' : ''}>
        <span class="mono">${escapeHtml(rule.code)}</span> ${escapeHtml(rule.name)}（${escapeHtml(rule.status)}）
      </label>`).join('')
    : '<span class="dim">还没有规则可挑，请先到规则区新建</span>';
}

async function submitSet(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    code: el('set-code').value,
    name: el('set-name').value,
    dirPrefixes: el('set-prefixes').value.split('\n').map((line) => line.trim()).filter(Boolean),
    ruleIds: Array.from(el('set-rules').querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value),
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
    await loadRules();
    await loadScope();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
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
    await loadScope();
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
    await loadScope();
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
    if (!window.confirm(`确定删除规则 ${found ? found.code : ''} 吗？它会同时从所有规则集里摘掉。`)) return;
    try {
      await request(`/api/rules/${encodeURIComponent(node.dataset.ruleDelete)}`, { method: 'DELETE' });
      if (state.editingRuleId === node.dataset.ruleDelete) closeRuleForm();
      notify('规则已删除', 'ok');
      await loadRules();
      await loadRuleSets();
      await loadScope();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.setEdit) {
    const found = state.ruleSets.find((item) => item.id === node.dataset.setEdit);
    if (found) await openSetForm(found);
    return;
  }

  if (node.dataset.setDelete) {
    clearNotice();
    const found = state.ruleSets.find((item) => item.id === node.dataset.setDelete);
    if (!window.confirm(`确定删除规则集 ${found ? found.code : ''} 吗？规则本身会保留。`)) return;
    try {
      await request(`/api/rule-sets/${encodeURIComponent(node.dataset.setDelete)}`, { method: 'DELETE' });
      if (state.editingSetId === node.dataset.setDelete) closeSetForm();
      notify('规则集已删除', 'ok');
      await loadRuleSets();
      await loadRules();
      await loadScope();
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
      await loadScope();
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
el('set-new').addEventListener('click', () => openSetForm(null));
el('set-cancel').addEventListener('click', closeSetForm);
el('file-new').addEventListener('click', () => {
  clearNotice();
  openFileForm(null);
});
el('file-cancel').addEventListener('click', closeFileForm);
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
    .then(loadScope)
    .catch((err) => notify(err.message, 'error'));
});
el('set-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadRuleSets().catch((err) => notify(err.message, 'error'));
});
el('set-filter-reset').addEventListener('click', () => {
  el('set-filter-keyword').value = '';
  loadRuleSets().catch((err) => notify(err.message, 'error'));
});
el('scope-refresh').addEventListener('click', () => {
  clearNotice();
  loadScope().catch((err) => notify(err.message, 'error'));
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

// 页面打开时先把规则、文件、规则集与目录范围都拉一遍，扫描的范围下拉依赖前两份清单
restoreOperator();
loadHealth();
loadRules()
  .then(loadFiles)
  .then(loadRuleSets)
  .then(loadScope)
  .catch((err) => notify(err.message, 'error'));
