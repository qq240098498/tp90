const crypto = require('crypto');
const { load, save, MAX_SET_NAME_LENGTH, MAX_PREFIX_LENGTH, MAX_PREFIXES_PER_SET, MAX_NOTE_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');

// 目录前缀与文件路径共用一套字符口径，但不带后缀要求；不允许相对上级的写法
const PREFIX_PATTERN = /^[A-Za-z0-9._/-]+$/;

// 前缀 a 盖住前缀 b：b 就是 a，或者在 a 的下一层之下
function prefixCovers(a, b) {
  return b === a || b.startsWith(`${a}/`);
}

// 把用户写的前缀整理成规范形：去掉多余斜线，首尾不留斜线
function cleanPrefix(value) {
  return value.trim().replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

function validateName(value, data, selfId) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'SET_NAME_REQUIRED', '请填写规则集名称', 'setName');
  if (name.length > MAX_SET_NAME_LENGTH) {
    throw new ApiError(400, 'SET_NAME_TOO_LONG', `规则集名称不能超过 ${MAX_SET_NAME_LENGTH} 个字符`, 'setName');
  }
  const hit = data.ruleSets.find((item) => item.id !== selfId && item.name.toLowerCase() === name.toLowerCase());
  if (hit) throw new ApiError(409, 'SET_NAME_DUPLICATED', `名称 ${hit.name} 已经被另一个规则集用了`, 'setName');
  return name;
}

// 前缀可以写成数组，也可以写成一行一个（或逗号隔开）的文本，统一按数组处理
function validatePrefixes(value) {
  let rawList = value;
  if (typeof value === 'string') rawList = value.split(/\r?\n|，|,/);
  if (!Array.isArray(rawList)) {
    throw new ApiError(400, 'SET_PREFIX_INVALID', '目录前缀需要是文本或数组', 'setPrefixes');
  }
  const seen = new Set();
  const prefixes = [];
  rawList.forEach((item) => {
    if (typeof item !== 'string') throw new ApiError(400, 'SET_PREFIX_INVALID', '目录前缀需要是文本', 'setPrefixes');
    const prefix = cleanPrefix(item);
    if (!prefix) return;
    if (prefix.length > MAX_PREFIX_LENGTH) {
      throw new ApiError(400, 'SET_PREFIX_TOO_LONG', `目录前缀不能超过 ${MAX_PREFIX_LENGTH} 个字符`, 'setPrefixes');
    }
    if (!PREFIX_PATTERN.test(prefix) || prefix.includes('..')) {
      throw new ApiError(400, 'SET_PREFIX_INVALID', '目录前缀只能用字母数字、点、下划线、短横线与斜线，且不能用相对上级的写法', 'setPrefixes');
    }
    const lower = prefix.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    prefixes.push(prefix);
  });
  if (prefixes.length === 0) {
    throw new ApiError(400, 'SET_PREFIX_REQUIRED', '请至少填写一个目录前缀', 'setPrefixes');
  }
  if (prefixes.length > MAX_PREFIXES_PER_SET) {
    throw new ApiError(400, 'SET_PREFIX_TOO_MANY', `一个规则集最多写 ${MAX_PREFIXES_PER_SET} 个目录前缀`, 'setPrefixes');
  }
  // 同一个集里一个前缀把另一个整个包住时，留宽的那个没意义，当场指出来
  for (let i = 0; i < prefixes.length; i += 1) {
    for (let j = 0; j < prefixes.length; j += 1) {
      if (i !== j && prefixCovers(prefixes[i], prefixes[j])) {
        throw new ApiError(400, 'SET_PREFIX_NESTED', `前缀 ${prefixes[j]} 已经被 ${prefixes[i]} 包住，同一个规则集里留一个就行`, 'setPrefixes');
      }
    }
  }
  return prefixes;
}

function validateRuleIds(value, data) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'SET_RULES_INVALID', '成员规则需要是规则编号数组', 'setRules');
  }
  const seen = new Set();
  const ruleIds = [];
  value.forEach((ruleId) => {
    if (typeof ruleId !== 'string' || !ruleId) {
      throw new ApiError(400, 'SET_RULES_INVALID', '成员规则需要是规则编号数组', 'setRules');
    }
    const found = data.rules.find((item) => item.id === ruleId);
    if (!found) {
      throw new ApiError(400, 'SET_RULE_UNKNOWN', `编号为 ${ruleId} 的规则不存在或已被删除`, 'setRules');
    }
    if (seen.has(ruleId)) return;
    seen.add(ruleId);
    ruleIds.push(ruleId);
  });
  return ruleIds;
}

function validateNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'NOTE_INVALID', '说明需要是文本', 'setNote');
  if (value.length > MAX_NOTE_LENGTH) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `说明不能超过 ${MAX_NOTE_LENGTH} 个字符`, 'setNote');
  }
  return value.trim();
}

function sortSets(list) {
  return list.slice().sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

// 把成员规则的具体信息带进规则集，页面不用再按编号回去查
function withRules(ruleSet, data) {
  const rules = ruleSet.ruleIds
    .map((ruleId) => data.rules.find((item) => item.id === ruleId))
    .filter(Boolean)
    .map((rule) => ({
      id: rule.id,
      code: rule.code,
      name: rule.name,
      level: rule.level,
      status: rule.status,
      fileType: rule.fileType,
    }))
    .sort((a, b) => (a.code < b.code ? -1 : 1));
  return { ...ruleSet, rules };
}

function listRuleSets() {
  const data = load();
  return { ruleSets: sortSets(data.ruleSets).map((item) => withRules(item, data)) };
}

function getRuleSet(id) {
  const data = load();
  const found = data.ruleSets.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'SET_NOT_FOUND', '这个规则集不存在或已被删除', '');
  return withRules(found, data);
}

function createRuleSet(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    name: validateName(input.name, data, ''),
    prefixes: validatePrefixes(input.prefixes),
    ruleIds: validateRuleIds(input.ruleIds, data),
    note: validateNote(input.note),
    createdAt: now,
    updatedAt: now,
  };
  data.ruleSets.push(created);
  save(data);
  return withRules(created, data);
}

function updateRuleSet(id, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.ruleSets.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'SET_NOT_FOUND', '这个规则集不存在或已被删除', '');

  found.name = input.name === undefined ? found.name : validateName(input.name, data, found.id);
  found.prefixes = input.prefixes === undefined ? found.prefixes : validatePrefixes(input.prefixes);
  found.ruleIds = input.ruleIds === undefined ? found.ruleIds : validateRuleIds(input.ruleIds, data);
  found.note = input.note === undefined ? found.note : validateNote(input.note);
  found.updatedAt = new Date().toISOString();
  save(data);
  return withRules(found, data);
}

function deleteRuleSet(id) {
  const data = load();
  const index = data.ruleSets.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'SET_NOT_FOUND', '这个规则集不存在或已被删除', '');
  const [removed] = data.ruleSets.splice(index, 1);
  save(data);
  return { id: removed.id, name: removed.name };
}

module.exports = {
  listRuleSets,
  getRuleSet,
  createRuleSet,
  updateRuleSet,
  deleteRuleSet,
  prefixCovers,
};
