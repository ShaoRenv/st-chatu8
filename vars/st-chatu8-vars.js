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
// st-chatu8 tag 存储：默认写【消息楼层变量】（酒馆助手 TavernHelper 的 message 域）
// 可选 backend: "chat" 走聊天变量 chatMetadata.variables
// 纯逻辑；注入 index.js 时删掉 export


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
  const backend = cfg.backend || "message";

  function ctx() {
    try {
      if (win.SillyTavern && typeof win.SillyTavern.getContext === "function") return win.SillyTavern.getContext();
      if (typeof win.getContext === "function") return win.getContext();
    } catch (e) { }
    return null;
  }

  function chatVars(c) {
    if (!c) return null;
    if (!isPlainObject(c.chatMetadata)) c.chatMetadata = {};
    if (!isPlainObject(c.chatMetadata.variables)) c.chatMetadata.variables = {};
    return c.chatMetadata.variables;
  }

  function helper() {
    const h = win.TavernHelper;
    if (h && typeof h.getVariables === "function" && typeof h.replaceVariables === "function") return h;
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
    return arr && arr.length ? arr.length - 1 : -1;
  }

  function swipeOf(msg) {
    if (isPlainObject(msg) && typeof msg.swipe_id === "number") return msg.swipe_id;
    return 0;
  }

  function readChat() {
    const c = ctx();
    const vars = chatVars(c);
    if (!vars) return null;
    const mine = vars[ns];
    return isPlainObject(mine) ? mine : null;
  }

  function writeChat(tags) {
    const c = ctx();
    const vars = chatVars(c);
    if (!vars) return false;
    vars[ns] = Object.assign({}, tags || {});
    try { if (c && typeof c.saveMetadata === "function") c.saveMetadata(); } catch (e) { }
    return true;
  }

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
    if (backend === "chat") return readChat();
    const mine = readTable(messageId)[ns];
    return isPlainObject(mine) ? mine : null;
  }

  function writeAt(messageId, tags) {
    if (backend === "chat") return writeChat(tags);
    const table = readTable(messageId);
    const next = Object.assign({}, isPlainObject(table) ? table : {});
    next[ns] = Object.assign({}, tags || {});
    return writeTable(messageId, next);
  }

  function findLatest(fromId) {
    if (backend === "chat") return { messageId: -1, tags: readChat() };
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

  return {
    ns: ns,
    backend: backend,
    usingHelper: function () { return !!helper(); },
    lastMessageId: lastMessageId,
    readTable: readTable,
    writeTable: writeTable,
    readAt: readAt,
    writeAt: writeAt,
    findLatest: findLatest,
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
//
// 模型输出经常不干净（会复述格式模板），实测出现过：
//   <变量更新>json<变量更新></images>
//
//   </images>
//   <变量更新>
//   { ... 真正的 JSON ... }
//   </变量更新>
// 老写法「第一个开标签配第一个闭标签」会把 json<变量更新></images>… 一起抓进来 → JSON.parse 直接失败 → 变量一个字都写不进去。
// 现在改成：列出所有候选片段（最内层优先），逐个尝试解析，谁解析成功用谁；整段垃圾一起从正文里摘掉。

const UPDATE_TAG = "变量更新";

const OPEN_RE = new RegExp("<" + UPDATE_TAG + ">", "gi");
const CLOSE_RE = new RegExp("</" + UPDATE_TAG + ">", "gi");
const ANY_TAG_RE = new RegExp("</?" + UPDATE_TAG + ">", "gi");

function stripFence(s) {
  let t = String(s).trim();
  const m = t.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  if (m) t = m[1].trim();
  return t;
}

// 候选片段里的噪音：代码围栏、"json" 字样（模型把格式说明一起吐出来了）、残留的复述开标签
function stripJsonLabel(s) {
  let t = stripFence(s);
  t = t.replace(/^json\s*/i, "");
  t = t.replace(/^(?:<" + UPDATE_TAG + ">)+\s*/i, "");
  return t.trim();
}

// 宽松解析：去掉 json 标签/代码围栏、去掉尾随逗号再试
function looseJsonParse(s) {
  const t = stripJsonLabel(s).replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(t);
}

// 模型常把 ${"name":"x",...}$ 直接塞进 JSON 字符串里而忘记转义引号 —— 只修 $...$ 内部，不动别处
function repairQuotesInCalls(text) {
  return String(text).replace(/\$[^$]*\$/g, function (m) {
    return m.replace(/\\"/g, "\"").replace(/"/g, "\\\"");
  });
}

// 只把 $...$ 片段逐个交给扩展的展开器，绝不把整段 JSON 喂进去（那会搅烂换行与括号）
function expandSpans(text, expand) {
  if (typeof expand !== "function") return String(text);
  return String(text).replace(/\$[^$]*\$/g, function (m) {
    try { var r = expand(m); return (typeof r === "string" && r) ? r : m; } catch (e) { return m; }
  });
}

// 解析一段更新文本（已展开过预设调用的版本）
function parsePatchText(text) {
  const fixed = repairQuotesInCalls(text);
  const obj = looseJsonParse(fixed);
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) throw new Error("not-object");
  return obj;
}

// 所有 <变量更新>…</变量更新> 候选：每个闭标签先配「它前面最近的开标签」（最内层，最像真 JSON），
// 再补上其它开×闭组合兜底；去重并限量
function updateCandidates(text) {
  const s = String(text == null ? "" : text);
  const opens = [];
  const closes = [];
  for (const m of s.matchAll(OPEN_RE)) opens.push(m.index);
  for (const m of s.matchAll(CLOSE_RE)) closes.push(m.index);
  const out = [];
  const seen = {};
  const add = (o, c) => {
    const start = o + UPDATE_TAG.length + 2;
    if (c <= start) return;
    const key = o + ":" + c;
    if (seen[key]) return;
    seen[key] = 1;
    out.push({ open: o, close: c, start: start, end: c, text: s.slice(start, c) });
  };
  if (!opens.length || !closes.length) return out;
  for (const c of closes) {
    let inner;
    for (const o of opens) { if (o < c) inner = o; else break; }
    if (inner !== undefined) add(inner, c);
  }
  for (const o of opens) for (const c of closes) if (c > o) add(o, c);
  return out.slice(0, 24);
}

// 摘块：把 [第一个开标签 → 最后一个闭标签] 整段（含模型复述的模板垃圾）从正文里去掉，
// 顺手清掉残留的标签本身
function extractUpdateBlock(text) {
  const s = String(text == null ? "" : text);
  const candidates = updateCandidates(s);
  if (!candidates.length) {
    const hasTag = new RegExp("<" + UPDATE_TAG + ">", "i").test(s) || new RegExp("</" + UPDATE_TAG + ">", "i").test(s);
    if (!hasTag) return { clean: s, raw: "", candidates: [] };
    return { clean: s.replace(ANY_TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim(), raw: "", candidates: [] };
  }
  const first = candidates[0];
  const opens = [];
  for (const m of s.matchAll(OPEN_RE)) opens.push(m.index);
  const closes = [];
  for (const m of s.matchAll(CLOSE_RE)) closes.push(m.index);
  const from = Math.min.apply(null, opens);
  const to = Math.max.apply(null, closes) + UPDATE_TAG.length + 3;
  const clean = (s.slice(0, from) + s.slice(to)).replace(ANY_TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  let raw = "";
  if (first) {
    const best = candidates.find((c) => c.text.trim().length > 0);
    raw = best ? best.text : "";
  }
  return { clean: clean, raw: raw, candidates: candidates };
}

// 逐个候选尝试解析，谁先解析成功就用谁
function parseUpdate(text) {
  const got = extractUpdateBlock(text);
  const list = got.candidates || [];
  if (!list.length || !String(got.raw || "").trim()) {
    return { clean: got.clean, raw: "", candidates: list, patch: null, ok: false, error: "no-block" };
  }
  let lastErr = "";
  for (const c of list) {
    const body = String(c && c.text != null ? c.text : "");
    if (!body.trim()) continue;
    try {
      const patch = parsePatchText(body);
      return { clean: got.clean, raw: body, candidates: list, patch: patch, ok: true, error: "" };
    } catch (e) {
      lastErr = String(e && e.message || e);
    }
  }
  return { clean: got.clean, raw: got.raw, candidates: list, patch: null, ok: false, error: lastErr || "no-json" };
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
  if (!__system) __system = createVarSystem({ namespace: "st-chatu8", version: 1, backend: (window.__stChatu8VarsBackend || "message") });
  return __system;
}
function __stLastId() { return __stSys().storage.lastMessageId(); }

window.stChatu8Vars = {
  version: "1.0.5",

  // 生图 LLM 输出：摘掉 <变量更新> 块并写入该楼层，返回摘干净后的提示词
  ingestMessage: function (mes, id, expand) {
    var r = parseUpdate(mes);
    var out = { changed: r.clean !== mes, clean: r.clean, ok: false, wrote: false, error: r.error, raw: "", tried: 0 };
    var list = (r.candidates && r.candidates.length) ? r.candidates : (r.raw ? [{ text: r.raw }] : []);
    if (!list.length) return out; // 没有 <变量更新> 块
    var lastErr = "";
    // 逐个候选试：模型可能把格式模板也复述出来（<变量更新>json<变量更新>），第一个候选往往不是真 JSON
    for (var i = 0; i < list.length; i++) {
      var raw = String(list[i] && list[i].text != null ? list[i].text : "");
      if (!raw.trim()) continue;
      out.tried = out.tried + 1;
      // ① 先展开预设调用（此时还是模型原样写的文本，$...$ 里的引号没转义也能认）
      if (typeof expand === "function" && raw.indexOf("$") >= 0) {
        var uc = window.collectedCharacterNegatives;
        try { raw = expandSpans(raw, expand); } catch (e) { console.warn("[ChatU8 vars] expand patch failed", e); } finally { window.collectedCharacterNegatives = uc; }
      }
      // ② 再把 $...$ 里漏转义的引号补上，然后解析
      var patch;
      try { patch = parsePatchText(raw); }
      catch (e) { lastErr = String(e && e.message || e); continue; }
      var s = __stSys();
      var merged = mergeTags(s.tags(id), patch);
      out.wrote = s.storage.writeAt(id, merged);
      out.ok = true;
      out.error = "";
      out.raw = raw.slice(0, 300);
      console.log("[ChatU8 vars] 写入楼层 " + id + " ok=" + out.wrote + " 后端=" + (window.TavernHelper ? "TavernHelper" : "chat.variables") + " 候选=" + (i + 1) + "/" + list.length);
      return out;
    }
    out.error = "parse: " + lastErr;
    out.raw = "";
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
      if (at) {
        // 已有变量表：只做一次旧版清理（把历史遗留的 _v 去掉），不重建
        if (Object.prototype.hasOwnProperty.call(at, "_v")) {
          var clean = Object.assign({}, at);
          delete clean._v;
          return s.storage.writeAt(id, clean) ? "migrated" : "exists";
        }
        return "exists";
      }
      return s.storage.writeAt(id, { "角色列表": {} }) ? "created" : false;
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
    parsePatchText: parsePatchText,
    expandSpans: expandSpans,
    repairQuotesInCalls: repairQuotesInCalls,
    mergeTags: mergeTags,
    evaluate: evaluate,
    createStorage: createStorage
  }
};
/* ---- debug.js ---- */
// ---- 变量调试：读取 / 写入指定 JSON / 模拟模型回复（build-vars.mjs 拼到 api.js 之后）----
// 全部函数都接受可选的 sys 参数，便于在 node 里单测（不传就用全局 __stSys()）

function __stDbgSys(sys) {
  if (sys) return sys;
  return (typeof __stSys === "function") ? __stSys() : null;
}

// 当前楼层号（没有聊天时返回 -1）
function __stDbgLastId(sys) {
  var s = __stDbgSys(sys);
  if (!s) return -1;
  var id = s.storage.lastMessageId();
  return (id == null) ? -1 : id;
}

// 插件设置对象（进度日志/开关）
function __stDbgSettings(win) {
  var w = win || (typeof window !== "undefined" ? window : null);
  try { return w.SillyTavern.getContext().extensionSettings["st-chatu8"] || {}; } catch (e) { return {}; }
}

function __stDbgLog(n, win) {
  var es = __stDbgSettings(win);
  return String(es.log || "").split("\n").filter(function (x) { return x.indexOf("[变量]") >= 0; }).slice(-(n || 8));
}

// 一、整体状态：一眼看出「加载了没 / 后端是谁 / 楼层几 / 钩子挂上没」
function __stDbgInfo(sys, win) {
  var w = win || (typeof window !== "undefined" ? window : {});
  var s = __stDbgSys(sys);
  var mid = -1, exact = false, err = "";
  try { mid = __stDbgLastId(s); exact = !!(s && s.storage.readAt(mid)); } catch (e) { err = String(e && e.message || e); }
  return {
    varsVersion: (w.stChatu8Vars && w.stChatu8Vars.version) || (typeof window !== "undefined" && window.stChatu8Vars ? window.stChatu8Vars.version : "?"),
    moduleLoaded: !!(w.stChatu8Vars || (typeof window !== "undefined" && window.stChatu8Vars)),
    backend: w.TavernHelper ? "TavernHelper(楼层变量)" : "chat.variables(降级)",
    messageId: mid,
    floorHasStore: exact,
    enabled: __stDbgSettings(w).varsEnabled !== "false",
    hooked: w.__stChatu8VarsLlmHooked || [],
    expandAvailable: typeof w.__stChatu8ExpandPrompt === "function" ? true : false,
    error: err,
    logTail: __stDbgLog(8, w)
  };
}

// 二、读取：楼层变量（命名空间 st-chatu8）+ 同一楼层的整张原始表
function __stDbgRead(id, sys, win) {
  var w = win || (typeof window !== "undefined" ? window : {});
  var s = __stDbgSys(sys);
  var mid = (id == null) ? __stDbgLastId(s) : id;
  var out = { id: mid, exact: false, source: "empty", store: null, fallback: null, rawTable: null, error: "" };
  if (!s) { out.error = "变量系统未初始化"; return out; }
  try {
    var at = s.storage.readAt(mid);
    out.exact = !!at;
    out.store = at || s.tags(mid);
    out.source = at ? "本楼层存储" : "向上继承最近楼层";
    if (!at && mid >= 0) { var f = s.storage.findLatest(mid); out.fallback = { from: f.messageId, tags: f.tags || {} }; }
    if (w.TavernHelper && mid >= 0) {
      var table = w.TavernHelper.getVariables({ type: "message", message_id: mid });
      out.rawTable = table || null;
    }
  } catch (e) { out.error = String(e && e.message || e); }
  return out;
}

// 三、只看不写：把模型回复里的 <变量更新> 逐个候选解析出来，直接暴露是哪一步的问题
function __stDbgAnalyze(text, sys, win) {
  var w = win || (typeof window !== "undefined" ? window : {});
  var out = { hasBlock: false, candidates: [], parsed: false, error: "", patch: null };
  try {
    var r = parseUpdate(String(text == null ? "" : text));
    out.hasBlock = r.clean !== text;
    out.error = r.error || "";
    var list = (r.candidates && r.candidates.length) ? r.candidates : (r.raw ? [{ text: r.raw }] : []);
    for (var i = 0; i < list.length; i++) {
      var raw = String(list[i] && list[i].text != null ? list[i].text : "");
      var item = { index: i, length: raw.length, head: raw.replace(/\s+/g, " ").slice(0, 60), expanded: false, parsed: false, error: "" };
      var body = raw;
      if (typeof w.__stChatu8ExpandPrompt === "function" && body.indexOf("$") >= 0) {
        try { body = expandSpans(body, w.__stChatu8ExpandPrompt); item.expanded = true; } catch (e) { item.error = "expand: " + String(e && e.message || e); }
      }
      try { item.patch = parsePatchText(body); item.parsed = true; out.parsed = true; out.patch = item.patch; }
      catch (e) { item.error = String(e && e.message || e); }
      out.candidates.push(item);
    }
    out.cleanHead = String(r.clean || "").replace(/\s+/g, " ").slice(0, 120);
  } catch (e) { out.error = String(e && e.message || e); }
  return out;
}

// 四、写入：把一段 JSON（字符串或对象）按 合并/覆盖 写进指定楼层
function __stDbgWrite(json, id, mode, sys) {
  var s = __stDbgSys(sys);
  var mid = (id == null) ? __stDbgLastId(s) : id;
  var out = { ok: false, id: mid, mode: mode || "merge", merged: null, error: "" };
  if (!s) { out.error = "变量系统未初始化"; return out; }
  if (mid < 0) { out.error = "没有打开的聊天（楼层号 " + mid + "）"; return out; }
  var patch;
  try { patch = (typeof json === "string") ? JSON.parse(json) : json; }
  catch (e) { out.error = "JSON 解析失败: " + String(e && e.message || e); return out; }
  if (!patch || typeof patch !== "object") { out.error = "需要一个 JSON 对象"; return out; }
  try {
    var next = (out.mode === "replace") ? patch : mergeTags(s.tags(mid), patch);
    out.merged = next;
    out.ok = !!s.storage.writeAt(mid, next);
    if (!out.ok) out.error = "写入被拒绝（storage.writeAt 返回 false）";
  } catch (e) { out.error = String(e && e.message || e); }
  return out;
}

// 五、模拟：把「模型原样回复」当真实生图返回来跑一遍完整管线（展开 -> 补引号 -> 解析 -> 合并 -> 写）
function __stDbgSimulate(text, id, sys, win) {
  var w = win || (typeof window !== "undefined" ? window : {});
  var s = __stDbgSys(sys);
  var mid = (id == null) ? __stDbgLastId(s) : id;
  var before = null;
  try { before = s ? s.storage.readAt(mid) : null; } catch (e) {}
  var vm = w.stChatu8Vars || (typeof window !== "undefined" ? window.stChatu8Vars : null);
  if (!vm || typeof vm.ingestMessage !== "function") return { ok: false, wrote: false, error: "变量模块未加载" };
  var r = vm.ingestMessage(String(text == null ? "" : text), mid, w.__stChatu8ExpandPrompt);
  var after = null;
  try { after = s ? s.storage.readAt(mid) : null; } catch (e) {}
  return { id: mid, ok: !!r.ok, wrote: !!r.wrote, tried: r.tried, error: r.error || "", cleaned: String(r.clean || "").slice(0, 200), before: before, after: after };
}

function __stDbgReadAll(sys) {
  var s = __stDbgSys(sys);
  var out = [];
  if (!s) return out;
  var w = (typeof window !== "undefined") ? window : {};
  var len = 0;
  try { len = w.SillyTavern.getContext().chat.length; } catch (e) { return out; }
  for (var i = 0; i < len; i++) {
    var at = null;
    try { at = s.storage.readAt(i); } catch (e) { continue; }
    if (!at) continue;
    var names = [];
    for (var k in (at["角色列表"] || {})) if (Object.prototype.hasOwnProperty.call(at["角色列表"], k)) names.push(k);
    out.push({ id: i, chars: names, bytes: JSON.stringify(at).length });
  }
  return out;
}

// ---- 悬浮调试面板（纯 DOM，不依赖插件设置页）----
function mountVarsDebugPanel(win) {
  var w = win || (typeof window !== "undefined" ? window : null);
  if (!w || !w.document || w.__stVarsDebugPanelMounted) return false;
  var doc = w.document;
  if (!doc.body) return false;
  w.__stVarsDebugPanelMounted = true;

  var btn = doc.createElement("div");
  btn.textContent = "🧪 变量调试";
  btn.setAttribute("style", "position:fixed;left:10px;bottom:10px;z-index:2147483000;background:#2b2b3c;color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4);opacity:.85");
  var panel = doc.createElement("div");
  panel.setAttribute("style", "position:fixed;left:10px;bottom:44px;z-index:2147483000;width:460px;max-height:70vh;overflow:auto;background:#1e1e2a;color:#ddd;border:1px solid #444;border-radius:10px;padding:10px;font-size:12px;line-height:1.5;display:none;box-shadow:0 6px 24px rgba(0,0,0,.5)");
  var status = doc.createElement("pre");
  status.setAttribute("style", "white-space:pre-wrap;margin:0 0 6px;color:#9fd");
  var store = doc.createElement("textarea");
  store.setAttribute("style", "width:100%;height:110px;background:#12121a;color:#eee;border:1px solid #444;border-radius:6px;font-family:monospace;font-size:11px");
  var llm = doc.createElement("textarea");
  llm.setAttribute("placeholder", "把模型回复原文粘到这里（含 <变量更新> 块）");
  llm.setAttribute("style", "width:100%;height:70px;background:#12121a;color:#eee;border:1px solid #444;border-radius:6px;font-family:monospace;font-size:11px");
  var result = doc.createElement("pre");
  result.setAttribute("style", "white-space:pre-wrap;margin:6px 0 0;color:#fc9;max-height:180px;overflow:auto");

  function mkBtn(label, fn, color) {
    var b = doc.createElement("button");
    b.textContent = label;
    b.setAttribute("style", "margin:2px 4px 2px 0;padding:4px 8px;border-radius:6px;border:1px solid #555;background:" + (color || "#33334a") + ";color:#eee;cursor:pointer;font-size:12px");
    b.addEventListener("click", function () { try { fn(); } catch (e) { result.textContent = "ERROR " + String(e && e.message || e); } });
    return b;
  }
  function dump(o) { result.textContent = typeof o === "string" ? o : JSON.stringify(o, null, 1); }
  function refresh() {
    var info = w.stChatu8VarsDebug.info();
    status.textContent = "版本 " + info.varsVersion + " · 后端 " + info.backend + " · 楼层 " + info.messageId + " · 存储=" + (info.floorHasStore ? "有" : "无(继承)") + " · 开关=" + (info.enabled ? "开" : "关") + "\n钩子 " + (info.hooked.join(", ") || "(无)") + "\n日志:\n" + info.logTail.slice(-4).join("\n");
    return info;
  }

  var bar1 = doc.createElement("div");
  bar1.appendChild(mkBtn("刷新状态", function () { refresh(); dump("已刷新"); }));
  bar1.appendChild(mkBtn("读取当前楼层变量", function () {
    var r = w.stChatu8VarsDebug.read();
    store.value = JSON.stringify(r.store || {}, null, 1);
    dump({ id: r.id, source: r.source, exact: r.exact, rawNamespaceKeys: r.rawTable ? Object.keys(r.rawTable) : null, error: r.error });
  }));
  bar1.appendChild(mkBtn("读全部楼层", function () { dump(w.stChatu8VarsDebug.readAll()); }));
  var bar2 = doc.createElement("div");
  bar2.appendChild(mkBtn("合并写入(上面文本框)", function () { dump(w.stChatu8VarsDebug.merge(store.value)); }, "#2f4a2f"));
  bar2.appendChild(mkBtn("覆盖写入", function () { dump(w.stChatu8VarsDebug.write(store.value, null, "replace")); }, "#4a3a2f"));
  bar2.appendChild(mkBtn("清空本楼层", function () { dump(w.stChatu8VarsDebug.clear()); }, "#4a2f2f"));
  var bar3 = doc.createElement("div");
  bar3.appendChild(mkBtn("解析预览(只读不写)", function () { dump(w.stChatu8VarsDebug.analyze(llm.value)); }));
  bar3.appendChild(mkBtn("按真实流程解析并写入", function () { dump(w.stChatu8VarsDebug.simulate(llm.value)); }, "#2f3f5a"));

  panel.appendChild(doc.createTextNode("变量调试 · 楼层 = 当前聊天最后一楼"));
  panel.appendChild(status);
  panel.appendChild(bar1);
  panel.appendChild(bar2);
  panel.appendChild(store);
  panel.appendChild(doc.createTextNode("模型原文（粘贴后点下面两个按钮）"));
  panel.appendChild(llm);
  panel.appendChild(bar3);
  panel.appendChild(result);
  doc.body.appendChild(btn);
  doc.body.appendChild(panel);
  btn.addEventListener("click", function () { panel.style.display = (panel.style.display === "none") ? "block" : "none"; if (panel.style.display === "block") refresh(); });
  return true;
}

// ---- 对外调试接口：window.stChatu8VarsDebug ----
window.stChatu8VarsDebug = {
  version: "1.0.0",
  show: function () { return mountVarsDebugPanel(); },
  info: function () { return __stDbgInfo(); },
  read: function (id) { return __stDbgRead(id); },
  readAll: function () { return __stDbgReadAll(); },
  analyze: function (text) { return __stDbgAnalyze(text); },
  simulate: function (text, id) { return __stDbgSimulate(text, id); },
  merge: function (json, id) { return __stDbgWrite(json, id, "merge"); },
  write: function (json, id, mode) { return __stDbgWrite(json, id, mode || "replace"); },
  clear: function (id) { return __stDbgWrite({ "角色列表": {} }, id, "replace"); },
  log: function (n) { return __stDbgLog(n); }
};

if (typeof document !== "undefined" && document && document.body) setTimeout(function () { mountVarsDebugPanel(); }, 2500);

})();
