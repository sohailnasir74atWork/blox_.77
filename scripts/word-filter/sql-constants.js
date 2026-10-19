// Prints the SQL string constants of supabase/049_word_filter.sql
// (_wf_spaces_re, _wf_strip_re, _wf_punct_re, _wf_map_from, _wf_map_to and
// the leetspeak translate) from Code/Helper/wordFilterCore.js, as E'' bodies.
// test049.mjs checks the live functions return exactly these.
//   node scripts/word-filter/sql-constants.js
const path = require('path');
const core = require(path.join(__dirname, '../../Code/Helper/wordFilterCore.js'));

const C = core.SQL_CONSTANTS;
const e = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "''");

const sql = {
  SPACES_SQL: e(C.SPACES_SRC),
  STRIP_SQL: e(C.STRIP_SRC),
  PUNCT_SQL: e('[' + C.PUNCT_BMP + '\\U00010000-\\U0010ffff]'),
  MAP_FROM_SQL: e(C.MAP_FROM),
  MAP_TO_SQL: e(C.MAP_TO),
  LEET_FROM: e(C.LEET_FROM),
  LEET_TO: e(C.LEET_TO),
};

module.exports = sql;
if (require.main === module) {
  for (const [k, v] of Object.entries(sql)) console.log(`${k}: E'${v}'`);
}
