export const SEARCH = 'search_mcp_tools';
export const SELECT = 'select_mcp_tools';
export const PUBLIC_NAME = /^[A-Za-z0-9_-]{1,64}$/u;
const NAMESPACE = /^[A-Za-z0-9_-]{1,32}$/u;
const MODES = ['visible', 'on-demand', 'blocked'];
const controls = [SEARCH, SELECT];
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
export function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`);
}
export function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return value;
}

function rules(raw, field, fallback) {
  const list = raw ?? fallback;
  if (!Array.isArray(list) || list.length > 512) throw new Error(`${field} rules must be an array of at most 512 entries`);
  const seen = new Set();
  return Object.freeze(list.map((rule) => {
    keys(rule, [field, 'mode'], `${field} rule`);
    const value = rule[field];
    if (typeof value !== 'string' || !PUBLIC_NAME.test(value) || seen.has(value)) throw new Error(`Invalid or duplicate ${field} rule`);
    if (!MODES.includes(rule.mode)) throw new Error('Rule mode must be visible, on-demand, or blocked');
    if (controls.some((name) => field === 'prefix' ? name.startsWith(value) : name === value)) {
      throw new Error('Discovery controls cannot be targeted by policy rules');
    }
    seen.add(value);
    return Object.freeze({ [field]: value, mode: rule.mode });
  }).sort((a, b) => compare(a[field], b[field])));
}

export function resolveConfig(raw = {}) {
  keys(raw, ['servers', 'maxSelectedTools', 'prefixes', 'tools', 'settingsFile'], 'mcp-discovery config');
  const servers = raw.servers ?? ['rea', 'gworkspace'];
  if (!Array.isArray(servers) || servers.length > 32 ||
      servers.some((s) => typeof s !== 'string' || !NAMESPACE.test(s) || s.includes('__')) ||
      new Set(servers).size !== servers.length) {
    throw new Error('servers must contain up to 32 unique MCP namespaces without double underscores');
  }
  if (raw.settingsFile !== undefined && (typeof raw.settingsFile !== 'string' || !raw.settingsFile.trim())) {
    throw new Error('settingsFile must be a nonempty path');
  }
  return Object.freeze({
    servers: Object.freeze([...servers].sort(compare)),
    maxSelectedTools: integer(raw.maxSelectedTools ?? 16, 1, 128, 'maxSelectedTools'),
    prefixes: rules(raw.prefixes, 'prefix', [{ prefix: 'dsh_browser_', mode: 'on-demand' }]),
    tools: rules(raw.tools, 'name', []),
  });
}

export function modeOf(config, name) {
  if (controls.includes(name)) return 'visible';
  const exact = config.tools.find((rule) => rule.name === name);
  if (exact) return exact.mode;
  const prefix = config.prefixes.filter((rule) => name.startsWith(rule.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (prefix) return prefix.mode;
  return config.servers.some((server) => name.startsWith(`mcp__${server}__`)) ? 'on-demand' : 'visible';
}
