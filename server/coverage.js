const { load, LEVELS, STATUSES } = require('./store');
const { prefixCovers } = require('./rulesets');

// 文件所在目录：取路径最后一段斜线之前的部分，没有斜线就是根目录（用空串表示）
function dirOf(filePath) {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

// 两个前缀有重叠：其中一个把另一个盖住（相等也算）
function prefixesOverlap(a, b) {
  return prefixCovers(a, b) || prefixCovers(b, a);
}

// 重叠段取更具体的那个前缀，也就是更长的那个
function overlapSegment(a, b) {
  return a.length >= b.length ? a : b;
}

// 主次判断里的一样具体：按建立先后定主，先建立的为主；再一样就按编号
function olderOf(setA, setB) {
  if (setA.createdAt !== setB.createdAt) return setA.createdAt < setB.createdAt ? setA : setB;
  return setA.id < setB.id ? setA : setB;
}

function severityOf(level) {
  const index = LEVELS.indexOf(level);
  return index === -1 ? -1 : index;
}

function summarizeSet(set) {
  return { id: set.id, name: set.name, prefixes: set.prefixes.slice() };
}

// 按目录把生效的规则算出来：目录被哪个规则集的前缀盖住，集里的规则就管到这个目录；
// 规则的适用文件类型管不到目录里任何一类文件时，不算这个目录的生效规则
function buildDirectories(data) {
  const dirMap = new Map();
  data.files.forEach((file) => {
    const dir = dirOf(file.path);
    if (!dirMap.has(dir)) dirMap.set(dir, { dir, fileCount: 0, fileTypes: new Set() });
    const entry = dirMap.get(dir);
    entry.fileCount += 1;
    entry.fileTypes.add(file.type);
  });

  const dirs = Array.from(dirMap.values())
    .map((entry) => ({ dir: entry.dir, fileCount: entry.fileCount, fileTypes: Array.from(entry.fileTypes).sort() }))
    .sort((a, b) => (a.dir < b.dir ? -1 : 1));

  return dirs.map((entry) => {
    const sets = data.ruleSets.filter((set) => set.prefixes.some((prefix) => prefixCovers(prefix, entry.dir)));
    const ruleMap = new Map();
    sets.forEach((set) => {
      set.ruleIds.forEach((ruleId) => {
        const rule = data.rules.find((item) => item.id === ruleId);
        if (!rule) return;
        if (rule.fileType !== '全部' && !entry.fileTypes.includes(rule.fileType)) return;
        if (!ruleMap.has(rule.id)) ruleMap.set(rule.id, { rule, fromSets: [] });
        ruleMap.get(rule.id).fromSets.push(set.name);
      });
    });
    const rules = Array.from(ruleMap.values())
      .map(({ rule, fromSets }) => ({
        id: rule.id,
        code: rule.code,
        name: rule.name,
        level: rule.level,
        status: rule.status,
        fileType: rule.fileType,
        pattern: rule.pattern,
        fromSets,
      }))
      .sort((a, b) => (a.code < b.code ? -1 : 1));
    return {
      dir: entry.dir,
      fileCount: entry.fileCount,
      fileTypes: entry.fileTypes,
      sets: sets.map((set) => ({ id: set.id, name: set.name })),
      rules,
    };
  });
}

// 两个规则集的前缀清单逐对比较，有重叠就记下重叠段与这一段的主次：
// 更具体（更长）的前缀所在的集为主；一样具体时先建立的集为主
function overlapSegments(setA, setB) {
  const byDir = new Map();
  setA.prefixes.forEach((p) => {
    setB.prefixes.forEach((q) => {
      if (!prefixesOverlap(p, q)) return;
      const dir = overlapSegment(p, q);
      if (byDir.has(dir)) return;
      let primary;
      let specific;
      if (p.length > q.length) {
        primary = setA;
        specific = true;
      } else if (q.length > p.length) {
        primary = setB;
        specific = true;
      } else {
        primary = olderOf(setA, setB);
        specific = false;
      }
      byDir.set(dir, { dir, primaryName: primary.name, specific });
    });
  });
  return Array.from(byDir.values()).sort((a, b) => (a.dir < b.dir ? -1 : 1));
}

function verdictForSegments(segments) {
  const parts = segments.map((seg) => (seg.specific
    ? `${seg.dir} 以「${seg.primaryName}」为主（前缀更具体）`
    : `${seg.dir} 上两个集的前缀相同，以先建立的「${seg.primaryName}」为主`));
  return `重叠段：${parts.join('；')}。同一条规则建议只留在一个规则集里`;
}

// 冲突一：同一条规则落在两个规则集里，且两个集的目录范围有重叠
function findRuleDuplicated(data) {
  const setsByRule = new Map();
  data.ruleSets.forEach((set) => {
    set.ruleIds.forEach((ruleId) => {
      if (!setsByRule.has(ruleId)) setsByRule.set(ruleId, []);
      setsByRule.get(ruleId).push(set);
    });
  });

  const findings = [];
  setsByRule.forEach((sets, ruleId) => {
    if (sets.length < 2) return;
    const rule = data.rules.find((item) => item.id === ruleId);
    if (!rule) return;
    for (let i = 0; i < sets.length; i += 1) {
      for (let j = i + 1; j < sets.length; j += 1) {
        const segments = overlapSegments(sets[i], sets[j]);
        if (segments.length === 0) continue;
        findings.push({
          rule: { id: rule.id, code: rule.code, name: rule.name },
          sets: [summarizeSet(sets[i]), summarizeSet(sets[j])],
          segments,
          verdict: verdictForSegments(segments),
        });
      }
    }
  });
  return findings.sort((a, b) => (a.rule.code < b.rule.code ? -1 : 1));
}

// 两条规则的写法指向同一段文字：一条写法包含另一条（或完全相同），
// 重叠的那段文字就是更长的写法
function sharedTextOf(patternA, patternB) {
  if (patternA === patternB) return patternA;
  if (patternA.includes(patternB)) return patternA;
  if (patternB.includes(patternA)) return patternB;
  return '';
}

// 冲突二：同一个目录下两条启用规则的写法指向同一段文字，但级别不同。
// 同一对规则在多个目录撞上时并成一条，目录逐个列清；级别高的为主
function findPatternLevel(data, directories) {
  const pairMap = new Map();
  directories.forEach((entry) => {
    const active = entry.rules.filter((rule) => rule.status === STATUSES[0]);
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i];
        const b = active[j];
        if (a.level === b.level) continue;
        if (a.fileType !== '全部' && b.fileType !== '全部' && a.fileType !== b.fileType) continue;
        const shared = sharedTextOf(a.pattern, b.pattern);
        if (!shared) continue;
        const key = [a.id, b.id].sort().join('|');
        if (!pairMap.has(key)) {
          const [primary, secondary] = severityOf(a.level) >= severityOf(b.level) ? [a, b] : [b, a];
          pairMap.set(key, { primary, secondary, shared, dirs: [] });
        }
        pairMap.get(key).dirs.push(entry.dir);
      }
    }
  });

  return Array.from(pairMap.values())
    .map((entry) => ({
      rules: [
        { id: entry.primary.id, code: entry.primary.code, name: entry.primary.name, level: entry.primary.level, pattern: entry.primary.pattern },
        { id: entry.secondary.id, code: entry.secondary.code, name: entry.secondary.name, level: entry.secondary.level, pattern: entry.secondary.pattern },
      ],
      sharedText: entry.shared,
      dirs: entry.dirs.sort(),
      verdict: `两条规则的写法都指向「${entry.shared}」这段文字，以级别更高的 ${entry.primary.code}（${entry.primary.level}）为主，${entry.secondary.code}（${entry.secondary.level}）在这些目录降为参考`,
    }))
    .sort((a, b) => (a.rules[0].code < b.rules[0].code ? -1 : 1));
}

// 冲突三：一个规则集的目录范围把另一个规则集整个包住。
// 被包住的集在比自己更具体的段上为主；前缀相同则按建立先后定主；其余目录归范围宽的集
function containsVerdict(container, contained) {
  const parts = contained.prefixes.map((prefix) => {
    const covering = container.prefixes
      .filter((item) => prefixCovers(item, prefix))
      .sort((a, b) => b.length - a.length)[0];
    if (covering === prefix) {
      const primary = olderOf(container, contained);
      return `${prefix} 上两个集的前缀相同，以先建立的「${primary.name}」为主`;
    }
    return `${prefix} 以「${contained.name}」为主（比「${container.name}」的 ${covering} 更具体）`;
  });
  return `「${contained.name}」的范围整个落在「${container.name}」里：${parts.join('；')}；其余目录以「${container.name}」为主`;
}

function findSetContains(data) {
  const findings = [];
  const sets = data.ruleSets;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      const aCoversB = b.prefixes.every((q) => a.prefixes.some((p) => prefixCovers(p, q)));
      const bCoversA = a.prefixes.every((q) => b.prefixes.some((p) => prefixCovers(p, q)));
      if (aCoversB && bCoversA) {
        const primary = olderOf(a, b);
        const secondary = primary === a ? b : a;
        findings.push({
          kind: 'identical',
          sets: [summarizeSet(a), summarizeSet(b)],
          covered: a.prefixes.slice(),
          verdict: `两个规则集的范围完全相同，以先建立的「${primary.name}」为主，建议把「${secondary.name}」并入或改用更具体的前缀`,
        });
      } else if (aCoversB) {
        findings.push({
          kind: 'contains',
          container: summarizeSet(a),
          contained: summarizeSet(b),
          covered: b.prefixes.slice(),
          verdict: containsVerdict(a, b),
        });
      } else if (bCoversA) {
        findings.push({
          kind: 'contains',
          container: summarizeSet(b),
          contained: summarizeSet(a),
          covered: a.prefixes.slice(),
          verdict: containsVerdict(b, a),
        });
      }
    }
  }
  return findings.sort((x, y) => {
    const nameA = x.container ? x.container.name : x.sets[0].name;
    const nameB = y.container ? y.container.name : y.sets[0].name;
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    const subA = x.contained ? x.contained.name : x.sets[1].name;
    const subB = y.contained ? y.contained.name : y.sets[1].name;
    return subA < subB ? -1 : 1;
  });
}

// 把目录生效范围、没被覆盖的目录、没归组的规则与三类冲突一起算出来
function getCoverage() {
  const data = load();
  const directories = buildDirectories(data);
  const covered = directories.filter((entry) => entry.sets.length > 0);
  const uncovered = directories
    .filter((entry) => entry.sets.length === 0)
    .map((entry) => ({ dir: entry.dir, fileCount: entry.fileCount, fileTypes: entry.fileTypes }));

  const groupedIds = new Set();
  data.ruleSets.forEach((set) => set.ruleIds.forEach((ruleId) => groupedIds.add(ruleId)));
  const ungroupedRules = data.rules
    .filter((rule) => !groupedIds.has(rule.id))
    .map((rule) => ({ id: rule.id, code: rule.code, name: rule.name }))
    .sort((a, b) => (a.code < b.code ? -1 : 1));

  return {
    generatedAt: new Date().toISOString(),
    directories: covered,
    uncovered,
    ungroupedRules,
    conflicts: {
      ruleDuplicated: findRuleDuplicated(data),
      patternLevel: findPatternLevel(data, directories),
      setContains: findSetContains(data),
    },
    totals: {
      dirs: directories.length,
      covered: covered.length,
      uncovered: uncovered.length,
      sets: data.ruleSets.length,
      rules: data.rules.length,
      ungrouped: ungroupedRules.length,
    },
  };
}

module.exports = { getCoverage, dirOf, prefixesOverlap, sharedTextOf };
