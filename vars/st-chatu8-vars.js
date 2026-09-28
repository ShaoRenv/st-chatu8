/* st-chatu8 变量系统 v1 —— 由 tools/build-vars.mjs 生成，不要直接改这个文件 */
(function () {
  "use strict";
  if (window.stChatu8Vars) return;


/* ---- resolve.js ---- */
// st-chatu8 tag 存储：引用求值（纯函数，无依赖；注入 index.js 时删掉 export 关键字）
// 投影只展开当前层：字符串=tag，数组=tag列表，对象=分组（不自动进图）
// 只有 $...$ 里的路径才是引用（路径指针）；不带 $ 的字符串永远是字面 tag
// 对象可以带一个保留键 key：值写关键词，多个用逗号隔开；命中才展开，没 key 常开

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function splitPath(ref) {
  return String(ref).split(/[./]/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function segsToString(segs) { return "/" + segs.join("/"); }

function readSegs(root, segs) {
  let node = root;
  for (const s of segs) {
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, s)) return undefined;
    node = node[s];
  }
  return node;
}

// 引用查找顺序（路径指针）：
//   1. 相对当前节点的路径   $服装列表.白色睡衣$ / $人物状态$
//   2. 从根开始的路径       $爱莉希雅.人物状态$ / $爱莉希雅$
//   3. 根下 角色/角色列表/人物/人物列表 的同名键
//   以 / 开头 = 强制从根算  $/爱莉希雅.形象$
function readPath(root, baseSegs, ref) {
  const raw = String(ref).trim();
  const segs = splitPath(raw);
  if (!segs.length) return { value: undefined, segs: [] };
  const tries = [];
  if (raw.charAt(0) === "/") {
    tries.push(segs);
  } else {
    if (baseSegs.length) tries.push(baseSegs.concat(segs));
    tries.push(segs);
    // 顶层若带「角色列表」这类包装层，两种都能命中
    for (const a of ["角色", "角色列表", "人物", "人物列表"]) tries.push([a].concat(segs));
  }
  for (const t of tries) {
    const v = readSegs(root, t);
    if (v !== undefined) return { value: v, segs: t };
  }
  return { value: undefined, segs: segs };
}

const REF_RE = /\$([^$]+)\$/g;

// 按逗号分段，但跳过 $...$ 内部（${"name":"x","angle":"y"}$ 里的逗号不算分段）
function splitSegments(text) {
  const out = [];
  let buf = "";
  let inRef = false;
  const str = String(text);
  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i);
    if (ch === "$") { inRef = !inRef; buf += ch; continue; }
    if (ch === "," && !inRef) { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  out.push(buf);
  return out;
}

function makeCtx(triggerText) {
  return { text: triggerText == null ? "" : String(triggerText), gate: triggerText != null, depth: 0, seen: {} };
}

function down(ctx, seen) {
  return { text: ctx.text, gate: ctx.gate, depth: (ctx.depth || 0) + 1, seen: seen || ctx.seen || {} };
}

// key 触发：没 key 常开；有 key 要求关键词出现在触发文本里（逗号分隔，大小写不敏感）
function isTriggered(triggerText, keyValue) {
  if (typeof keyValue !== "string" || !keyValue.trim()) return true;
  const keys = keyValue.split(/[,，]/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (!keys.length) return true;
  const hay = String(triggerText == null ? "" : triggerText).toLowerCase();
  if (!hay) return false;
  for (const k of keys) { if (hay.indexOf(k.toLowerCase()) >= 0) return true; }
  return false;
}

// 激活关键词字段：主名用「激活词」，兼容旧的 key
const GATE_FIELDS = ["激活词", "key"];
const RESERVED = { "激活词": 1, key: 1 };

function readGate(node) {
  if (!isPlainObject(node)) return undefined;
  for (const f of GATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(node, f)) return node[f];
  }
  return undefined;
}

// 投影：只展开这一层（字符串/数组）；下一层的对象是分组，不进去
function project(root, baseSegs, value, ctx) {
  const c = ctx || makeCtx("");
  if ((c.depth || 0) > 8) return "";
  if (typeof value === "string") return evalText(root, baseSegs, value, c);
  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      let s = "";
      if (typeof item === "string") s = evalText(root, baseSegs, item, down(c));
      else if (Array.isArray(item)) s = project(root, baseSegs, item, down(c));
      if (s) parts.push(s);
    }
    return parts.join(", ");
  }
  if (isPlainObject(value)) {
    if (c.gate !== false && !isTriggered(c.text, readGate(value))) return "";
    const parts = [];
    for (const k of Object.keys(value)) {
      if (k.charAt(0) === "_" || RESERVED[k]) continue;
      const child = value[k];
      let s = "";
      if (typeof child === "string") s = evalText(root, baseSegs, child, down(c));
      else if (Array.isArray(child)) s = project(root, baseSegs, child, down(c));
      if (s) parts.push(s);
    }
    return parts.join(", ");
  }
  return "";
}

// 展开一段文本里的 $...$（路径形态取存储，JSON 形态留给预设管线）
function expandRefs(root, baseSegs, text, ctx) {
  const c = ctx;
  return String(text).replace(REF_RE, (match, inner) => {
    const t = String(inner).trim();
    if (!t) return match;
    if (t.charAt(0) === "{") return match;
    const hit = readPath(root, baseSegs, t);
    if (hit.value === undefined) {
      // 查不到就原样保留：不认识的 $...$ 交给原有管线（与扩展原本的行为一致），绝不误删
      return match;
    }
    const key = segsToString(hit.segs);
    if (c.seen && c.seen[key]) return "";
    const nextSeen = Object.assign({}, c.seen || {});
    nextSeen[key] = true;
    const hitBase = (typeof hit.value === "string" && hit.segs.length) ? hit.segs.slice(0, -1) : hit.segs;
    return project(root, hitBase, hit.value, down(c, nextSeen));
  });
}

// 求值一段值：
//   $路径$   取存储
//   -tag     从本段里【所有】引用的结果里减掉这个 tag（位置无关）
//   其它     字面 tag，原样保留
function evalText(root, baseSegs, text, ctx) {
  const c = ctx || makeCtx("");
  if ((c.depth || 0) > 8) return String(text);
  if (typeof text !== "string") return String(text);
  const parts = splitSegments(text);
  const removals = [];
  let hasRef = false;
  for (const p of parts) {
    const q = p.trim();
    if (!q) continue;
    if (q.charAt(0) === "-" && q.length > 1) {
      const body = q.slice(1).trim();
      if (body.indexOf("$") >= 0) {
        // -$引用$：把这个引用产出的所有 tag 都减掉
        const expanded = expandRefs(root, baseSegs, body, c);
        const pieces = expanded.split(",").map((x) => x.trim()).filter(Boolean);
        for (const piece of pieces) removals.push(piece.toLowerCase());
      } else {
        removals.push(body.toLowerCase());
      }
    }
    else if (q.indexOf("$") >= 0 && q.indexOf("${") < 0) hasRef = true;
  }
  if (!hasRef && !removals.length) return text;
  const out = [];
  for (const raw of parts) {
    const seg = raw.trim();
    if (!seg) continue;
    if (seg.charAt(0) === "-" && seg.length > 1) continue;
    const rawExp = expandRefs(root, baseSegs, seg, c);
    const isPreset = rawExp.indexOf("${") >= 0;
    const isVarRef = seg.indexOf("$") >= 0 && seg.indexOf("${") < 0;
    let val;
    if (isPreset) {
      val = rawExp.trim();
    } else if (!isVarRef) {
      val = seg;
    } else {
      let pieces = rawExp.split(",").map((x) => x.trim()).filter(Boolean);
      if (removals.length) pieces = pieces.filter((x) => removals.indexOf(x.toLowerCase()) < 0);
      val = pieces.join(", ");
    }
    if (val) out.push(val);
  }
  return out.filter(Boolean).join(", ");
}

// 快速调用：$角色名$ -> 该角色整棵投影
function renderCharacter(root, name, triggerText) {
  const hit = readPath(root, [], name);
  if (hit.value === undefined) return "";
  return project(root, hit.segs, hit.value, makeCtx(triggerText));
}

// 便捷入口：给一段文本，按存储求值
function evaluate(root, text, triggerText) {
  return evalText(root, [], text, makeCtx(triggerText));
}
/* ---- store.js ---- */
// st-chatu8 tag 存储：酒馆消息楼层变量读写（纯逻辑，无依赖；注入时删掉 export）
// 变量表根下用命名空间隔离：table["st-chatu8"] = { _v: 1, <角色名>: {...} }
// 优先用酒馆助手 window.TavernHelper；没有就直接读写 SillyTavern.chat[i].variables[swipe_id]


// 深合并：对象递归；字符串/数组/数字直接替换；null 或 "" 表示删除该键
function mergeTags(base, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = Object.assign({}, isPlainObject(base) ? base : {});
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv === null || pv === undefined || pv === "") { delete out[k]; continue; }
    if (isPlainObject(pv)) out[k] = mergeTags(out[k], pv);
    else out[k] = pv;
  }
  return out;
}

function createStorage(opts) {
  const cfg = opts || {};
  const win = cfg.win || (typeof window !== "undefined" ? window : {});
  const ns = cfg.namespace || "st-chatu8";
  const version = cfg.version || 1;

  function helper() {
    const h = win.TavernHelper;
    if (!h) return null;
    if (typeof h.getVariables === "function" && typeof h.replaceVariables === "function") return h;
    return null;
  }

  function ctx() {
    try {
      if (win.SillyTavern && typeof win.SillyTavern.getContext === "function") return win.SillyTavern.getContext();
      if (typeof win.getContext === "function") return win.getContext();
    } catch (e) { }
    return null;
  }

  function chatArr() {
    const c = ctx();
    if (!c) return null;
    const arr = c.chat || (win.SillyTavern && win.SillyTavern.chat);
    return Array.isArray(arr) ? arr : null;
  }

  function lastMessageId() {
    const arr = chatArr();
    if (arr && arr.length) return arr.length - 1;
    return -1;
  }

  function swipeOf(msg) {
    if (isPlainObject(msg) && typeof msg.swipe_id === "number") return msg.swipe_id;
    return 0;
  }

  // 读某一楼层的变量表（整表，含别人的键）
  function readTable(messageId) {
    const h = helper();
    if (h) { try { return h.getVariables({ type: "message", message_id: messageId }) || {}; } catch (e) { return {}; } }
    const arr = chatArr();
    if (!arr || messageId < 0 || messageId >= arr.length) return {};
    const msg = arr[messageId];
    const v = isPlainObject(msg) ? msg.variables : null;
    if (!isPlainObject(v)) return {};
    const s = swipeOf(msg);
    if (isPlainObject(v[s])) return v[s];
    return v;
  }

  function writeTable(messageId, table) {
    const h = helper();
    if (h) { try { h.replaceVariables(table, { type: "message", message_id: messageId }); return true; } catch (e) { return false; } }
    const arr = chatArr();
    if (!arr || messageId < 0 || messageId >= arr.length) return false;
    const msg = arr[messageId];
    if (!isPlainObject(msg)) return false;
    if (!isPlainObject(msg.variables)) msg.variables = {};
    msg.variables[swipeOf(msg)] = table;
    try { const c = ctx(); if (c && typeof c.saveChat === "function") c.saveChat(); } catch (e) { }
    return true;
  }

  function readAt(messageId) {
    const table = readTable(messageId);
    const mine = table[ns];
    return isPlainObject(mine) ? mine : null;
  }

  // 从 fromId 往前找第一个有我们命名空间的楼层
  function findLatest(fromId) {
    // 负数 = 酒馆助手的「最新楼层」语义
    if (typeof fromId === "number" && fromId < 0) {
      const mine = readAt(fromId);
      if (mine) return { messageId: fromId, tags: mine };
    }
    let i = typeof fromId === "number" ? fromId : lastMessageId();
    for (; i >= 0; i--) {
      const mine = readAt(i);
      if (mine) return { messageId: i, tags: mine };
    }
    return { messageId: -1, tags: null };
  }

  function writeAt(messageId, tags) {
    const table = readTable(messageId);
    const next = Object.assign({}, isPlainObject(table) ? table : {});
    next[ns] = Object.assign({ _v: version }, tags || {});
    return writeTable(messageId, next);
  }

  return {
    ns: ns, version: version,
    lastMessageId: lastMessageId,
    readTable: readTable, writeTable: writeTable,
    readAt: readAt, writeAt: writeAt, findLatest: findLatest,
    readTags: function (fromId) { try { return findLatest(fromId).tags || {}; } catch (e) { return {}; } },
    applyUpdate: function (messageId, patch) {
      const cur = readAt(messageId) || findLatest(messageId).tags || {};
      const merged = mergeTags(cur, patch);
      const ok = writeAt(messageId, merged);
      return { ok: ok, tags: merged };
    }
  };
}
/* ---- patch.js ---- */
// st-chatu8 更新块：从生图 LLM 的输出里摘出变量更新，并把这段从提示词里去掉
// 更新 = 一棵部分树（不用 op/path）：写值=设置/新增，空串=删除，对象=往库里加条目

const UPDATE_TAG = "变量更新";

function stripFence(s) {
  let t = String(s).trim();
  const m = t.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (m) t = m[1].trim();
  return t;
}

// 宽松解析：去掉尾随逗号再试
function looseJsonParse(s) {
  const t = stripFence(s).replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(t);
}

function extractUpdateBlock(text) {
  const s = String(text == null ? "" : text);
  const re = new RegExp("<" + UPDATE_TAG + ">([\\s\\S]*?)</" + UPDATE_TAG + ">", "i");
  const m = s.match(re);
  if (!m) return { clean: s, raw: "" };
  const clean = s.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  return { clean: clean, raw: m[1] };
}

function parseUpdate(text) {
  const got = extractUpdateBlock(text);
  if (!got.raw.trim()) return { clean: got.clean, patch: null, ok: false, error: "no-block" };
  try {
    const patch = looseJsonParse(got.raw);
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
      return { clean: got.clean, patch: null, ok: false, error: "not-object" };
    }
    return { clean: got.clean, patch: patch, ok: true, error: "" };
  } catch (e) {
    return { clean: got.clean, patch: null, ok: false, error: String(e && e.message || e) };
  }
}

/* ---- glue.js ---- */
// st-chatu8 变量系统粘合层：生图 LLM 输出 -> 摘块 -> 写楼层变量 -> 生图前求值
// 纯逻辑；注入 index.js 时删掉 import/export




function createVarSystem(opts) {
  const cfg = opts || {};
  const st = createStorage(cfg);

  function currentTags(messageId) {
    const at = st.readAt(messageId);
    if (at) return at;
    const latest = st.findLatest(messageId);
    return latest.tags || {};
  }

  return {
    storage: st,
    tags: currentTags,

    // 生图 LLM 输出：摘掉更新块，其余是图片提示词；有更新就写进这一楼
    ingest: function (text, messageId) {
      const r = parseUpdate(text);
      let wrote = false;
      if (r.ok) {
        const merged = mergeTags(currentTags(messageId), r.patch);
        wrote = st.writeAt(messageId, merged);
      }
      return { clean: r.clean, ok: r.ok, wrote: wrote, error: r.error };
    },

    // 生图前：把提示词里的 $路径$ 用当前变量求值
    render: function (text, messageId) {
      return evaluate(currentTags(messageId), text, text);
    },

    // 单个角色的当前投影（面板/调试用）
    char: function (name, messageId) {
      return evaluate(currentTags(messageId), "$" + name + "$", name);
    }
  };
}

// 对外接口（被 build-vars.mjs 拼到 bundle 尾部）
var __system = null;
function __stSys() {
  if (!__system) __system = createVarSystem({ namespace: "st-chatu8", version: 1 });
  return __system;
}
function __stLastId() { return __stSys().storage.lastMessageId(); }

window.stChatu8Vars = {
  version: "1.0.0",

  // 生图 LLM 输出：摘掉 <变量更新> 块并写入该楼层，返回摘干净后的提示词
  ingestMessage: function (mes, id, expand) {
    var r = parseUpdate(mes);
    var out = { changed: r.clean !== mes, clean: r.clean, ok: false, wrote: false, error: r.error };
    if (!r.ok) return out;
    var patch = r.patch;
    // 写入前把 ${...}$ 预设调用展开成 tag（$路径$ 指针由展开器原样放行，保持不变）
    if (typeof expand === "function") {
      try {
        var text = JSON.stringify(patch);
        if (text.indexOf("$") >= 0) {
          var uc = window.collectedCharacterNegatives;
          var expanded;
          try { expanded = expand(text); } finally { window.collectedCharacterNegatives = uc; }
          if (expanded && expanded !== text) {
            var parsed = looseJsonParse(expanded);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) patch = parsed;
          }
        }
      } catch (e) { console.warn("[ChatU8 vars] expand patch failed", e); }
    }
    var s = __stSys();
    var merged = mergeTags(s.tags(id), patch);
    out.wrote = s.storage.writeAt(id, merged);
    out.ok = true;
    console.log("[ChatU8 vars] 写入楼层 " + id + " ok=" + out.wrote + " 后端=" + (window.TavernHelper ? "TavernHelper" : "chat.variables"));
    return out;
  },

  // 生图前：把提示词里的 $路径$ 用当前变量求值（官方 $...$ 调用原样穿过）
  render: function (text, id) {
    try {
      var s = __stSys();
      var root = s.tags(id == null ? __stLastId() : id);
      if (!root || !root["角色列表"]) return text;
      return evaluate(root, text, text);
    } catch (e) {
      console.warn("[ChatU8 vars] render failed", e);
      return text;
    }
  },

  tags: function (id) { return __stSys().tags(id); },

  // 进入聊天时初始化变量表（让结构与命名空间先存在）
  ensureStore: function (id) {
    try {
      var s = __stSys();
      var at = s.storage.readAt(id);
      if (at) return false;
      return s.storage.writeAt(id, { "角色列表": {} });
    } catch (e) { return false; }
  },
  char: function (name, id) { return __stSys().char(name, id); },

  // 注入给模型的当前变量块
  promptBlock: function (id) {
    var t = __stSys().tags(id);
    var body = (t && t["角色列表"]) ? t["角色列表"] : {};
    var view = this.viewText(undefined, id);
    var tail = view ? "\n<当前状态>\n" + view + "\n</当前状态>" : "";
    return "\n<当前变量>\n" + JSON.stringify({ "角色列表": body }) + "\n</当前变量>" + tail;
  },


  // {{绘图变量}} -> 原始存储（给模型改：保留 $路径$ 指针原样）
  rawText: function (id) {
    try {
      var t = __stSys().tags(id == null ? __stLastId() : id);
      var body = (t && t["角色列表"]) ? t["角色列表"] : {};
      return JSON.stringify({ "角色列表": body });
    } catch (e) { return ""; }
  },

  // {{绘图变量视图}} -> 求值后的最终 tag（key 命中的角色才出现，指针展开）
  viewText: function (triggerText, id) {
    try {
      var t = __stSys().tags(id == null ? __stLastId() : id);
      var list = (t && t["角色列表"]) ? t["角色列表"] : {};
      var lines = [];
      for (var name in list) {
        if (!Object.prototype.hasOwnProperty.call(list, name)) continue;
        if (name.charAt(0) === "_") continue;
        var proj = evaluate(t, "$" + name + "$", triggerText);
        if (proj) lines.push(name + ": " + proj);
      }
      return lines.join("\n");
    } catch (e) { return ""; }
  },

  // 调试/测试用
  _internal: {
    createVarSystem: createVarSystem,
    parseUpdate: parseUpdate,
    mergeTags: mergeTags,
    evaluate: evaluate,
    createStorage: createStorage
  }
};
})();
