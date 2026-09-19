const crypto = require('crypto');
const { load, save, cleanPrefix, MAX_CODE_LENGTH, MAX_SET_NAME_LENGTH, MAX_PREFIX_LENGTH, MAX_PREFIX_COUNT, MAX_NOTE_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');

// 规则集编码与规则编码同一种写法，方便在目录生效视图与冲突清单里引用
const CODE_PATTERN = /^[A-Z]{2,6}-\d{2,4}$/;
// 目录前缀与文件路径同一套字符，但不要求带后缀
const PREFIX_PATTERN = /^[A-Za-z0-9._/-]+$/;

function validateCode(value, data, selfId) {
  const code = pickText(value);
  if (!code) throw new ApiError(400, 'SET_CODE_REQUIRED', '请填写规则集编码', 'setCode');
  if (code.length > MAX_CODE_LENGTH) {
    throw new ApiError(400, 'SET_CODE_TOO_LONG', `规则集编码不能超过 ${MAX_CODE_LENGTH} 个字符`, 'setCode');
  }
  if (!CODE_PATTERN.test(code)) {
    throw new ApiError(400, 'SET_CODE_INVALID', '规则集编码要写成大写字母加短横线加数字，例如 SET-005', 'setCode');
  }
  const hit = data.ruleSets.find((item) => item.id !== selfId && item.code.toLowerCase() === code.toLowerCase());
  if (hit) throw new ApiError(409, 'SET_CODE_DUPLICATED', `编码 ${hit.code} 已经被 ${hit.name} 用了`, 'setCode');
  return code;
}

function validateName(value) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'SET_NAME_REQUIRED', '请填写规则集名称', 'setName');
  if (name.length > MAX_SET_NAME_LENGTH) {
    throw new ApiError(400, 'SET_NAME_TOO_LONG', `规则集名称不能超过 ${MAX_SET_NAME_LENGTH} 个字符`, 'setName');
  }
  return name;
}

// 目录前缀至少留一个，逐个清理去重后再逐个验字符与长度
function validatePrefixes(value) {
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'PREFIXES_INVALID', '目录前缀需要是一组文本，每行一个', 'setPrefixes');
  }
  const prefixes = [];
  value.forEach((raw) => {
    const prefix = cleanPrefix(raw);
    if (prefix && !prefixes.includes(prefix)) prefixes.push(prefix);
  });
  if (prefixes.length === 0) {
    throw new ApiError(400, 'PREFIX_REQUIRED', '至少写清一个目录前缀，例如 src/web', 'setPrefixes');
  }
  if (prefixes.length > MAX_PREFIX_COUNT) {
    throw new ApiError(400, 'PREFIX_TOO_MANY', `一个规则集最多登记 ${MAX_PREFIX_COUNT} 个目录前缀`, 'setPrefixes');
  }
  prefixes.forEach((prefix) => {
    if (prefix.length > MAX_PREFIX_LENGTH) {
      throw new ApiError(400, 'PREFIX_TOO_LONG', `目录前缀不能超过 ${MAX_PREFIX_LENGTH} 个字符`, 'setPrefixes');
    }
    if (!PREFIX_PATTERN.test(prefix) || prefix.includes('..')) {
      throw new ApiError(400, 'PREFIX_INVALID', `目录前缀 ${prefix} 只能用字母数字、点、下划线、短横线与斜线，且不能用相对上级的写法`, 'setPrefixes');
    }
  });
  return prefixes;
}

// 成员规则必须从现有规则里挑，允许一个都不挑（集子先空着）
function validateRuleIds(value, data) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'SET_RULES_INVALID', '成员规则需要是一组规则编号', 'setRules');
  }
  const ids = [];
  value.forEach((raw) => {
    const id = pickText(raw);
    if (id && !ids.includes(id)) ids.push(id);
  });
  const unknown = ids.find((id) => !data.rules.some((rule) => rule.id === id));
  if (unknown) {
    throw new ApiError(400, 'SET_RULE_UNKNOWN', '成员规则里有已经不在清单里的规则，请刷新后重挑', 'setRules');
  }
  return ids;
}

function validateNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'SET_NOTE_INVALID', '说明需要是文本', 'setNote');
  if (value.length > MAX_NOTE_LENGTH) {
    throw new ApiError(400, 'SET_NOTE_TOO_LONG', `说明不能超过 ${MAX_NOTE_LENGTH} 个字符`, 'setNote');
  }
  return value.trim();
}

function sortSets(list) {
  return list.slice().sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

// 把成员编号解成规则本身，页面拿到就能直接画，不用再对照规则清单
function resolveSet(data, set) {
  const rules = set.ruleIds
    .map((id) => data.rules.find((rule) => rule.id === id))
    .filter(Boolean)
    .map((rule) => ({ id: rule.id, code: rule.code, name: rule.name, level: rule.level, status: rule.status }))
    .sort((a, b) => (a.code < b.code ? -1 : 1));
  return { ...set, rules };
}

// 规则集清单：按编码、名称或目录前缀搜索，成员规则一并带出
function listRuleSets(options) {
  const input = options && typeof options === 'object' ? options : {};
  const keyword = pickText(input.keyword).toLowerCase();
  const data = load();

  let list = data.ruleSets;
  if (keyword) {
    list = list.filter((item) => item.code.toLowerCase().includes(keyword)
      || item.name.toLowerCase().includes(keyword)
      || item.dirPrefixes.some((prefix) => prefix.toLowerCase().includes(keyword)));
  }

  return { ruleSets: sortSets(list).map((set) => resolveSet(data, set)) };
}

function getRuleSet(id) {
  const data = load();
  const found = data.ruleSets.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'SET_NOT_FOUND', '这个规则集不存在或已被删除', '');
  return resolveSet(data, found);
}

function createRuleSet(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    code: validateCode(input.code, data, ''),
    name: validateName(input.name),
    dirPrefixes: validatePrefixes(input.dirPrefixes),
    ruleIds: validateRuleIds(input.ruleIds, data),
    note: validateNote(input.note),
    createdAt: now,
    updatedAt: now,
  };
  data.ruleSets.push(created);
  save(data);
  return resolveSet(data, created);
}

function updateRuleSet(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.ruleSets.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'SET_NOT_FOUND', '这个规则集不存在或已被删除', '');

  found.code = input.code === undefined ? found.code : validateCode(input.code, data, found.id);
  found.name = input.name === undefined ? found.name : validateName(input.name);
  found.dirPrefixes = input.dirPrefixes === undefined ? found.dirPrefixes : validatePrefixes(input.dirPrefixes);
  found.ruleIds = input.ruleIds === undefined ? found.ruleIds : validateRuleIds(input.ruleIds, data);
  found.note = input.note === undefined ? found.note : validateNote(input.note);
  found.updatedAt = new Date().toISOString();
  save(data);
  return resolveSet(data, found);
}

function deleteRuleSet(id) {
  const data = load();
  const index = data.ruleSets.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'SET_NOT_FOUND', '这个规则集不存在或已被删除', '');
  const [removed] = data.ruleSets.splice(index, 1);
  save(data);
  return { id: removed.id, code: removed.code, name: removed.name };
}

module.exports = {
  listRuleSets,
  getRuleSet,
  createRuleSet,
  updateRuleSet,
  deleteRuleSet,
};
