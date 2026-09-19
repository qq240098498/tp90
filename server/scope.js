const { load, LEVELS } = require('./store');

// 目录按收录文件的路径归出来：去掉最后一段文件名，根目录下的文件归到空串
function dirOf(filePath) {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

// 前缀盖不盖得住这个目录：正好相等，或者目录在它的更深层
function prefixCoversDir(prefix, dir) {
  return dir === prefix || dir.startsWith(`${prefix}/`);
}

// 两个前缀之间的关系：相等、outer 包住 inner、inner 包住 outer、互不相干
function prefixRelation(a, b) {
  if (a === b) return 'equal';
  if (b.startsWith(`${a}/`)) return 'contains';
  if (a.startsWith(`${b}/`)) return 'contained';
  return 'disjoint';
}

function levelRank(level) {
  const index = LEVELS.indexOf(level);
  return index === -1 ? -1 : index;
}

function byCode(a, b) {
  return a.code < b.code ? -1 : 1;
}

function setBrief(set) {
  return { id: set.id, code: set.code, name: set.name };
}

function ruleBrief(rule) {
  return {
    id: rule.id,
    code: rule.code,
    name: rule.name,
    level: rule.level,
    status: rule.status,
    fileType: rule.fileType,
    pattern: rule.pattern,
  };
}

// 集子里能盖住 segment 的最长前缀，用来判断这段范围上谁更具体
function longestCoveringPrefix(set, segment) {
  let best = '';
  set.dirPrefixes.forEach((prefix) => {
    if ((segment === prefix || segment.startsWith(`${prefix}/`)) && prefix.length > best.length) {
      best = prefix;
    }
  });
  return best;
}

// 冲突一：同一条规则落在两个规则集里，且两个集子的目录范围有重叠。
// 重叠段上谁为主看谁的目录更具体，一样具体时编码靠前的为主
function findRuleInMultipleSets(data, sets) {
  const entries = [];
  data.rules.forEach((rule) => {
    const owners = sets.filter((set) => set.ruleIds.includes(rule.id));
    for (let i = 0; i < owners.length; i += 1) {
      for (let j = i + 1; j < owners.length; j += 1) {
        const a = owners[i];
        const b = owners[j];
        const segments = new Set();
        a.dirPrefixes.forEach((pa) => {
          b.dirPrefixes.forEach((pb) => {
            if (prefixRelation(pa, pb) !== 'disjoint') {
              segments.add(pa.length >= pb.length ? pa : pb);
            }
          });
        });
        if (segments.size === 0) continue;
        const overlaps = Array.from(segments).sort().map((segment) => {
          const pa = longestCoveringPrefix(a, segment);
          const pb = longestCoveringPrefix(b, segment);
          let primary = a;
          let secondary = b;
          let reason = '两个规则集的目录一样具体，编码靠前的为主';
          if (pa.length > pb.length) {
            reason = `${a.code} 的目录更具体`;
          } else if (pb.length > pa.length) {
            primary = b;
            secondary = a;
            reason = `${b.code} 的目录更具体`;
          }
          return { segment, primary: setBrief(primary), secondary: setBrief(secondary), reason };
        });
        entries.push({
          rule: { id: rule.id, code: rule.code, name: rule.name, status: rule.status },
          sets: [setBrief(a), setBrief(b)],
          overlaps,
        });
      }
    }
  });
  return entries.sort((a, b) => (a.rule.code < b.rule.code ? -1 : 1));
}

// 冲突二：同一个目录下两条规则的匹配写法指向同一段文字（一个含住另一个或完全一样），
// 但级别不同。级别高的为主；两条规则的文件类型要搭得上，同一段文字才真的会被一起盯上
function findSameTextDifferentLevel(directories) {
  const entries = [];
  directories.forEach((dir) => {
    const rules = dir.rules;
    for (let i = 0; i < rules.length; i += 1) {
      for (let j = i + 1; j < rules.length; j += 1) {
        const a = rules[i];
        const b = rules[j];
        if (a.level === b.level) continue;
        if (!a.pattern || !b.pattern) continue;
        if (!(a.pattern === b.pattern || a.pattern.includes(b.pattern) || b.pattern.includes(a.pattern))) continue;
        if (!(a.fileType === '全部' || b.fileType === '全部' || a.fileType === b.fileType)) continue;
        const sharedText = a.pattern.length >= b.pattern.length ? a.pattern : b.pattern;
        const aFirst = levelRank(a.level) >= levelRank(b.level);
        entries.push({
          dir: dir.dir,
          sharedText,
          primary: aFirst ? a : b,
          secondary: aFirst ? b : a,
        });
      }
    }
  });
  return entries.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir < b.dir ? -1 : 1;
    return a.primary.code < b.primary.code ? -1 : 1;
  });
}

// 冲突三：一个规则集的目录范围把另一个整个包住（对方的每个前缀都落在自己的某个前缀下）。
// 被包住的集子范围更具体，在自己的范围内为主；两边范围完全相同时编码靠前的为主
function findSetScopeContains(sets) {
  const coversAll = (outer, inner) => inner.dirPrefixes.every((pb) => outer.dirPrefixes.some((pa) => pa === pb || pb.startsWith(`${pa}/`)));
  const entries = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      const aCoversB = coversAll(a, b);
      const bCoversA = coversAll(b, a);
      if (aCoversB && bCoversA) {
        const aFirst = a.code <= b.code;
        entries.push({
          kind: 'same',
          sets: [
            { ...setBrief(a), dirPrefixes: a.dirPrefixes },
            { ...setBrief(b), dirPrefixes: b.dirPrefixes },
          ],
          primary: setBrief(aFirst ? a : b),
          secondary: setBrief(aFirst ? b : a),
          reason: '两个规则集的目录范围完全相同，编码靠前的为主',
        });
      } else if (aCoversB || bCoversA) {
        const container = aCoversB ? a : b;
        const contained = aCoversB ? b : a;
        entries.push({
          kind: 'contains',
          container: { ...setBrief(container), dirPrefixes: container.dirPrefixes },
          contained: { ...setBrief(contained), dirPrefixes: contained.dirPrefixes },
          primary: setBrief(contained),
          secondary: setBrief(container),
          reason: '被包住的规则集目录更具体，在自己的范围内为主',
        });
      }
    }
  }
  return entries.sort((a, b) => (a.primary.code < b.primary.code ? -1 : 1));
}

// 按目录把生效的规则算出来：盖住目录的集子的成员取并集，每条标明来自哪些集子；
// 没盖住任何目录的集子不管，没被任何集子盖住的目录单独列出来
function computeScope(data) {
  const sets = data.ruleSets.slice().sort(byCode);

  const dirs = [];
  const fileCountByDir = new Map();
  data.files.forEach((file) => {
    const dir = dirOf(file.path);
    if (!fileCountByDir.has(dir)) {
      fileCountByDir.set(dir, 0);
      dirs.push(dir);
    }
    fileCountByDir.set(dir, fileCountByDir.get(dir) + 1);
  });
  dirs.sort();

  const covered = [];
  const uncoveredDirectories = [];
  dirs.forEach((dir) => {
    const covering = sets.filter((set) => set.dirPrefixes.some((prefix) => prefixCoversDir(prefix, dir)));
    const fileCount = fileCountByDir.get(dir);
    if (covering.length === 0) {
      uncoveredDirectories.push({ dir, fileCount });
      return;
    }
    const byRule = new Map();
    covering.forEach((set) => {
      set.ruleIds.forEach((ruleId) => {
        const rule = data.rules.find((item) => item.id === ruleId);
        if (!rule) return;
        if (!byRule.has(rule.id)) byRule.set(rule.id, { rule, fromSets: [] });
        byRule.get(rule.id).fromSets.push(set);
      });
    });
    const rules = Array.from(byRule.values())
      .map((entry) => ({
        ...ruleBrief(entry.rule),
        fromSets: entry.fromSets.sort(byCode).map(setBrief),
      }))
      .sort(byCode);
    covered.push({ dir, fileCount, sets: covering.map(setBrief), rules });
  });

  const groupedRuleIds = new Set();
  sets.forEach((set) => set.ruleIds.forEach((ruleId) => groupedRuleIds.add(ruleId)));
  const ungroupedRules = data.rules
    .filter((rule) => !groupedRuleIds.has(rule.id))
    .map(ruleBrief)
    .sort(byCode);

  return {
    directories: covered,
    uncoveredDirectories,
    ungroupedRules,
    conflicts: {
      ruleInMultipleSets: findRuleInMultipleSets(data, sets),
      sameTextDifferentLevel: findSameTextDifferentLevel(covered),
      setScopeContains: findSetScopeContains(sets),
    },
  };
}

function getScope() {
  const data = load();
  return {
    generatedAt: new Date().toISOString(),
    ...computeScope(data),
  };
}

module.exports = {
  getScope,
  computeScope,
  dirOf,
  prefixCoversDir,
  prefixRelation,
};
