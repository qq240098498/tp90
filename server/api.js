// 对外的动作集合：页面只经过这一层，规则、规则集、文件、生效范围与扫描几块各自管好自己的校验
const { ApiError, pickText } = require('./errors');
const rules = require('./rules');
const ruleSets = require('./rulesets');
const files = require('./files');
const { scan } = require('./scan');
const { getCoverage } = require('./coverage');

// 查询参数在页面与接口之间来回传的都是文本，这里统一去掉首尾空白并兜住空值
function readQuery(query, name) {
  return pickText(query && query[name]);
}

module.exports = {
  ApiError,
  readQuery,
  scan,
  getCoverage,
  ...rules,
  ...ruleSets,
  ...files,
};
