// ===========================
// 席替えのロジック（画面から切り離した純粋関数）
// DOM や localStorage に触らない。tests/*.test.js から node --test で確かめる
// ブラウザでは window.Calc、Node（テスト）では module.exports で使う
//
// 画面に出す文はここに書かない。うまくいかなかった理由などは { code, ... } で返し、
// 文にするのは text.js の TEXT（あとで別の言語にするときに text.js だけ直せばよいように）
//
// 同じ「くじ番号（seed）」・同じ席の並び・同じ名簿・同じ条件からは、いつでも同じ席順になる。
// 乱数は Math.random を使わず、seed から作る
// ===========================
(function (root) {
  'use strict';

  // ---------------------------------------------------------------
  // 乱数（seed つき）。学習プリントメーカーと同じもの
  // ---------------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mixSeed(seed, salt) {
    var h = ((seed >>> 0) ^ Math.imul((salt | 0) + 1, 0x9E3779B1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function makeRng(seed, salt) {
    var r = mulberry32(mixSeed(seed, salt || 0));
    return {
      next: r,
      int: function (lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); },
      shuffle: function (a) {
        a = a.slice();
        for (var i = a.length - 1; i > 0; i--) {
          var j = Math.floor(r() * (i + 1));
          var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
      },
    };
  }
  /** くじ番号（seed を 5 桁-5 桁で。口で伝えやすい形） */
  function seedLabel(seed) {
    var s = String(seed >>> 0).padStart(10, '0');
    return s.slice(0, 5) + '-' + s.slice(5);
  }
  /** "01234-56789" や全角の数字を seed に戻す。読めなければ null */
  function parseSeedLabel(s) {
    var d = String(s == null ? '' : s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[^0-9]/g, '');
    if (!d || d.length > 10) return null;
    var n = Number(d);
    return n <= 4294967295 ? n : null;
  }

  // ---------------------------------------------------------------
  // 正規化の小道具
  // ---------------------------------------------------------------
  function intIn(v, lo, hi, dflt) {
    var n = Math.round(Number(v));
    return isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : dflt;
  }
  function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
  function oneOf(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
  var SEAT_KEY = /^\d{1,3}-\d{1,3}(-\d{1,3})?$/;

  var LIMITS = { cols: 12, rows: 10, tables: 20, tableSeats: 16, people: 300, history: 10, groups: 30, nameLen: 30 };
  var MODES = ['class', 'party'];
  var SCOPES = ['side', 'cross', 'around', 'table'];

  // ---------------------------------------------------------------
  // 席の並び
  //   教室: cols（横＝左右に何席）× rows（縦＝前から後ろへ何席）。r=0 がいちばん前、c=0 が生徒から見て左
  //         off は使わない席のキー（"r-c"）。pairs は 2 人机（左から 2 席ずつ 1 つの机）
  //         desk は画面・印刷で教卓（前）を上に出すか下に出すか（上＝生徒から見た向き、下＝先生から見た向き）
  //   宴会: tables = [{ name, seats }]。1 つのテーブルは向かい合わせの 2 辺（奥の辺に半分を切り上げ、手前に残り）
  // ---------------------------------------------------------------
  function defaultLayout() {
    return {
      mode: 'class',
      cls: { cols: 6, rows: 6, off: [], pairs: true, desk: 'top' },
      party: { tables: [{ name: 'A', seats: 6 }, { name: 'B', seats: 6 }, { name: 'C', seats: 6 }] },
    };
  }
  function normalizeLayout(o) {
    var d = defaultLayout();
    o = o && typeof o === 'object' ? o : {};
    var c = o.cls && typeof o.cls === 'object' ? o.cls : {};
    var cols = intIn(c.cols, 1, LIMITS.cols, d.cls.cols), rows = intIn(c.rows, 1, LIMITS.rows, d.cls.rows);
    var off = [];
    (Array.isArray(c.off) ? c.off : []).forEach(function (k) {
      var m = /^(\d+)-(\d+)$/.exec(String(k));
      if (!m || +m[1] >= rows || +m[2] >= cols) return;
      var key = +m[1] + '-' + +m[2];
      if (off.indexOf(key) < 0) off.push(key);
    });
    off.sort();
    var p = o.party && typeof o.party === 'object' ? o.party : {};
    var tables = (Array.isArray(p.tables) ? p.tables : []).slice(0, LIMITS.tables).map(function (t, i) {
      t = t && typeof t === 'object' ? t : {};
      return { name: str(t.name, 12) || tableNameAt(i), seats: intIn(t.seats, 1, LIMITS.tableSeats, 6) };
    });
    if (!tables.length) tables = d.party.tables;
    return {
      mode: oneOf(o.mode, MODES, 'class'),
      cls: { cols: cols, rows: rows, off: off, pairs: c.pairs === undefined ? d.cls.pairs : !!c.pairs, desk: oneOf(c.desk, ['top', 'bottom'], 'top') },
      party: { tables: tables },
    };
  }
  /** テーブルの既定の名前: A, B, …, Z, 27, 28 … */
  function tableNameAt(i) { return i < 26 ? String.fromCharCode(65 + i) : String(i + 1); }

  /**
   * 席の一覧（使う席だけ）。no は 1 からの席番号（教室は前の左から横へ、宴会はテーブルの順）
   * 教室: { key:"r-c", no, r, c, desk（2 人机の机の番号 or null） }
   * 宴会: { key:"t-s-p", no, t, s（0 奥・1 手前）, p（左からの位置）, n（テーブル内の番号） }
   */
  function buildSeats(layout) {
    var L = normalizeLayout(layout), seats = [];
    if (L.mode === 'class') {
      var c = L.cls;
      for (var r = 0; r < c.rows; r++) {
        for (var x = 0; x < c.cols; x++) {
          var key = r + '-' + x;
          if (c.off.indexOf(key) >= 0) continue;
          seats.push({ key: key, no: seats.length + 1, r: r, c: x, desk: c.pairs ? Math.floor(x / 2) : null });
        }
      }
    } else {
      L.party.tables.forEach(function (t, ti) {
        var top = Math.ceil(t.seats / 2);
        for (var i = 0; i < t.seats; i++) {
          var s = i < top ? 0 : 1, p = i < top ? i : i - top;
          seats.push({ key: ti + '-' + s + '-' + p, no: seats.length + 1, t: ti, s: s, p: p, n: i + 1 });
        }
      });
    }
    return seats;
  }

  /**
   * 「隣」の定義（README と使い方ページにも同じ説明）
   *   side   となり: 教室は同じ横の並びで左右に接する席。2 人机のときは同じ机の相手だけ（通路をはさむと数えない）
   *                  宴会は同じテーブルの同じ辺で左右に接する席
   *   cross  前後左右: 教室は通路をはさんだ左右と、すぐ前・すぐ後ろも。宴会は となり＋真向かい
   *   around まわり: cross ＋ ななめ（教室は周りの 8 席、宴会は ななめ向かいも）
   *   table  同じテーブル（宴会だけ。教室では around と同じ）
   * 使わない席（off）をはさんだ 2 席は、隣ではない
   * @returns {Object<string, string[]>} 席のキー → 隣の席のキー
   */
  function neighbors(layout, scope) {
    var L = normalizeLayout(layout), seats = buildSeats(L), byKey = {}, out = {};
    seats.forEach(function (s) { byKey[s.key] = s; out[s.key] = []; });
    seats.forEach(function (a) {
      if (L.mode === 'class') {
        for (var dr = -1; dr <= 1; dr++) {
          for (var dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            var k = (a.r + dr) + '-' + (a.c + dc), b = byKey[k];
            if (!b) continue;
            var near = !dr ? !(scope === 'side' && L.cls.pairs && a.desk !== b.desk)   // 左右
              : !dc ? scope !== 'side'                                                  // 前後
              : scope === 'around' || scope === 'table';                               // ななめ
            if (near) out[a.key].push(k);
          }
        }
      } else {
        seats.forEach(function (b) {
          if (a === b || a.t !== b.t) return;
          var dp = Math.abs(a.p - b.p);
          var near = (a.s === b.s && dp === 1) ||
            (scope !== 'side' && a.s !== b.s && dp === 0) ||
            (scope === 'around' && a.s !== b.s && dp === 1) ||
            scope === 'table';
          if (near) out[a.key].push(b.key);
        });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------
  // 名簿
  //   1 行 1 人。性別は「名前,男」「名前<TAB>女」「名前（男）」のように書く（男・女・男子・女子・M・F・♂・♀）
  //   同じ名前の人は ② ③ … を付けて区別する（条件で名前を選ぶため）
  // ---------------------------------------------------------------
  var G_MALE = /^(男|男子|男性|m|male|♂)$/i, G_FEMALE = /^(女|女子|女性|f|female|♀)$/i;
  var CIRCLED = '②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  function genderOf(tok) {
    tok = String(tok || '').trim();
    if (G_MALE.test(tok)) return 'M';
    if (G_FEMALE.test(tok)) return 'F';
    return '';
  }
  /**
   * @returns {{ people: {name, g}[], notes: {code, ...}[] }}
   */
  function parsePeople(text) {
    var people = [], notes = [], seen = {}, dup = [], cut = 0;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var raw = line.replace(/　/g, ' ').trim();
      if (!raw) return;
      var name = raw, g = '';
      var m = /^(.*?)\s*[,，、\t/／]\s*([^,，、\t/／]*)$/.exec(raw);
      var p = /^(.*?)\s*[(（]\s*([^)）]*?)\s*[)）]$/.exec(raw);
      if (m && m[1] && genderOf(m[2])) { name = m[1]; g = genderOf(m[2]); }
      else if (p && p[1] && genderOf(p[2])) { name = p[1]; g = genderOf(p[2]); }
      else if (m && m[1] && !m[2]) name = m[1];      // 「名前,」
      name = str(name, LIMITS.nameLen);
      if (!name) return;
      if (people.length >= LIMITS.people) { cut++; return; }
      if (seen[name]) {
        var n = seen[name]++;
        var alt = name + (CIRCLED[n - 1] || '(' + (n + 1) + ')');
        while (seen[alt]) alt += '*';
        seen[alt] = 1;
        if (dup.indexOf(name) < 0) dup.push(name);
        name = alt;
      } else seen[name] = 1;
      people.push({ name: name, g: g });
    });
    if (dup.length) notes.push({ code: 'dupNames', names: dup });
    if (cut) notes.push({ code: 'tooManyLines', max: LIMITS.people, cut: cut });
    return { people: people, notes: notes };
  }
  /** 番号だけの名簿（1, 2, …, n） */
  function numberPeople(n) {
    var out = [];
    for (var i = 1; i <= intIn(n, 0, LIMITS.people, 0); i++) out.push({ name: String(i), g: '' });
    return out;
  }
  /** 名簿を貼り付け欄の文字に戻す（性別つき） */
  function peopleToText(people) {
    return (people || []).map(function (p) { return p.name + (p.g === 'M' ? ',男' : p.g === 'F' ? ',女' : ''); }).join('\n');
  }

  // ---------------------------------------------------------------
  // 条件
  //   pins:  [{ p: 名前, seat: 席のキー }]           この人はこの席（座席表でピンを立てた人。くじで動かさない）
  //   zone:  [{ p: 名前, where: 'front'|'back', n }]   前から（後ろから）n 番目の並びまで（教室だけ）
  //   pairs: [{ a, b, type: 'ng'|'want' }]、ngScope    隣にしない組・隣にしたい組と「隣」の範囲（どちらも同じ範囲）
  //   avoidSeat / avoidNeighbor                         前回と同じ席・同じとなり（side）を避ける
  //   gender                                            男女交互（となり（side）が同性にならない）
  //   emptyBack                                         余った席を後ろにまとめる（教室だけ。切ると余りもくじで決める）
  // 古い形（保存データ・バックアップ・共有リンク）: fixed（= pins と同じ形）と ng（[[名前, 名前]] = type 'ng'）は読み込むときに移す
  // ---------------------------------------------------------------
  var PAIR_TYPES = ['ng', 'want'];
  function defaultCons() {
    return { pins: [], zone: [], pairs: [], ngScope: 'cross', avoidSeat: true, avoidNeighbor: true, gender: false, emptyBack: true };
  }
  function pairKey(a, b) { return a < b ? a + '\n' + b : b + '\n' + a; }
  function normalizeCons(o) {
    var d = defaultCons();
    o = o && typeof o === 'object' ? o : {};
    var pins = [], zone = [], pairs = [], pairAt = {};
    var rawPins = (Array.isArray(o.fixed) ? o.fixed : []).concat(Array.isArray(o.pins) ? o.pins : []);
    rawPins.slice(0, LIMITS.people * 2).forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var p = str(f.p, LIMITS.nameLen), seat = str(f.seat, 12);
      if (!p || !SEAT_KEY.test(seat)) return;
      // 同じ人は後に書いたほう（新しい pins）を使う。同じ席に 2 人のときの扱いは solve が知らせる
      pins = pins.filter(function (x) { return x.p !== p; });
      pins.push({ p: p, seat: seat });
    });
    pins = pins.slice(0, LIMITS.people);
    (Array.isArray(o.zone) ? o.zone : []).slice(0, LIMITS.people).forEach(function (z) {
      if (!z || typeof z !== 'object') return;
      var p = str(z.p, LIMITS.nameLen);
      if (p) zone.push({ p: p, where: oneOf(z.where, ['front', 'back'], 'front'), n: intIn(z.n, 1, LIMITS.rows, 2) });
    });
    function addPair(a, b, type) {
      a = str(a, LIMITS.nameLen); b = str(b, LIMITS.nameLen);
      if (!a || !b || a === b || PAIR_TYPES.indexOf(type) < 0) return;
      var k = pairKey(a, b);
      if (pairAt[k] !== undefined) { pairs[pairAt[k]].type = type; return; }   // 同じ 2 人は後に書いた種類
      if (pairs.length >= 200) return;
      pairAt[k] = pairs.length;
      pairs.push({ a: a, b: b, type: type });
    }
    (Array.isArray(o.ng) ? o.ng : []).forEach(function (pr) { if (Array.isArray(pr)) addPair(pr[0], pr[1], 'ng'); });
    (Array.isArray(o.pairs) ? o.pairs : []).forEach(function (pr) { if (pr && typeof pr === 'object') addPair(pr.a, pr.b, pr.type); });
    return {
      pins: pins, zone: zone, pairs: pairs,
      ngScope: oneOf(o.ngScope, SCOPES, d.ngScope),
      avoidSeat: o.avoidSeat === undefined ? d.avoidSeat : !!o.avoidSeat,
      avoidNeighbor: o.avoidNeighbor === undefined ? d.avoidNeighbor : !!o.avoidNeighbor,
      gender: !!o.gender,
      emptyBack: o.emptyBack === undefined ? d.emptyBack : !!o.emptyBack,
    };
  }
  function pairsOf(cons, type) {
    return cons.pairs.filter(function (x) { return x.type === type; }).map(function (x) { return [x.a, x.b]; });
  }

  /** 前回の結果（{ layout, assign: {名前: 席のキー} }）から、人ごとの前回の席と前回のとなり（side） */
  function previousInfo(prev) {
    var seatOf = {}, nbOf = {};
    if (!prev || !prev.assign || typeof prev.assign !== 'object') return { seatOf: seatOf, nbOf: nbOf };
    var nb = neighbors(prev.layout, 'side'), who = {};
    Object.keys(prev.assign).forEach(function (name) {
      var k = String(prev.assign[name]);
      seatOf[name] = k; who[k] = name;
    });
    Object.keys(seatOf).forEach(function (name) {
      nbOf[name] = (nb[seatOf[name]] || []).map(function (k) { return who[k]; }).filter(Boolean);
    });
    return { seatOf: seatOf, nbOf: nbOf };
  }
  /** 前回と今回で席の形が同じか（違うと「前回と同じ席」は同じ位置の席として比べる。知らせるだけ） */
  function sameShape(a, b) {
    a = normalizeLayout(a); b = normalizeLayout(b);
    if (a.mode !== b.mode) return false;
    return a.mode === 'class' ? a.cls.cols === b.cls.cols && a.cls.rows === b.cls.rows
      : a.party.tables.length === b.party.tables.length && a.party.tables.every(function (t, i) { return t.seats === b.party.tables[i].seats; });
  }

  // ---------------------------------------------------------------
  // 席を決める
  // ---------------------------------------------------------------
  var CATS = ['avoidNeighbor', 'avoidSeat', 'gender', 'want', 'ng', 'zone'];   // ゆるめて試す順（外しやすいもの → 大事なもの）

  /**
   * 余った席（人数 < 席数）を先に決める。固定席は余らせない
   *   教室: emptyBack なら後ろの並びから（同じ並びの中はくじ）。切ると、くじ（全部の席から）
   *   宴会: 人の多いテーブルから 1 席ずつ減らす（テーブルの人数をそろえる）。テーブルの中では右端の席から
   */
  function pickEmpty(L, seats, count, fixedKeys, emptyBack, rng) {
    if (count <= 0) return [];
    var cand = seats.filter(function (s) { return fixedKeys.indexOf(s.key) < 0; });
    if (L.mode === 'class') {
      var order = rng.shuffle(cand);
      if (emptyBack) order.sort(function (a, b) { return b.r - a.r; });     // sort は安定なので、同じ並びの中はくじの順
      return order.slice(0, count).map(function (s) { return s.key; });
    }
    var free = {}, out = [];
    cand.forEach(function (s) { (free[s.t] = free[s.t] || []).push(s); });
    Object.keys(free).forEach(function (t) { free[t].sort(function (a, b) { return b.p - a.p || a.s - b.s; }); });
    var left = L.party.tables.map(function (t) { return t.seats; });
    var tie = rng.shuffle(left.map(function (x, i) { return i; }));
    for (var i = 0; i < count; i++) {
      var best = -1;
      tie.forEach(function (t) {
        if (!free[t] || !free[t].length) return;
        if (best < 0 || left[t] > left[best]) best = t;
      });
      if (best < 0) break;
      out.push(free[best].shift().key);
      left[best]--;
    }
    return out;
  }

  /**
   * @param {object} input { layout, people: [{name, g}], cons, prev: {layout, assign} | null, seed }
   * @returns 成功: { ok: true, assign: {席のキー: 名前}, byName: {名前: 席のキー}, empty: [席のキー], notes }
   *          失敗: { ok: false, reason: { code, ... }, notes }
   *          reason.code と notes[].code の文は text.js（TEXT.reason / TEXT.note）
   */
  function solve(input, opt) {
    opt = opt || {};
    var L = normalizeLayout(input.layout);
    var cons = normalizeCons(input.cons);
    var people = (input.people || []).slice(0, LIMITS.people);
    var seed = (input.seed >>> 0);
    var seats = buildSeats(L), notes = [];
    var seatByKey = {};
    seats.forEach(function (s) { seatByKey[s.key] = s; });
    var idx = {};
    people.forEach(function (p, i) { idx[p.name] = i; });

    if (!people.length) return { ok: false, reason: { code: 'noPeople' }, notes: notes };
    if (!seats.length) return { ok: false, reason: { code: 'noSeats' }, notes: notes };
    if (people.length > seats.length) return { ok: false, reason: { code: 'tooManyPeople', people: people.length, seats: seats.length }, notes: notes };

    // --- 名簿にない名前の条件は外して知らせる ---
    var missing = [];
    function known(n) {
      if (idx[n] !== undefined) return true;
      if (missing.indexOf(n) < 0) missing.push(n);
      return false;
    }
    var fixed = {}, fixedBy = {};
    cons.pins.forEach(function (f) {
      if (!known(f.p)) return;
      if (!seatByKey[f.seat]) { notes.push({ code: 'fixedSeatGone', name: f.p }); return; }
      if (fixedBy[f.seat] && fixedBy[f.seat] !== f.p) {
        notes.push({ code: 'fixedSeatTaken', name: f.p, other: fixedBy[f.seat], seatNo: seatByKey[f.seat].no });
        return;
      }
      if (fixed[f.p]) delete fixedBy[fixed[f.p]];
      fixed[f.p] = f.seat; fixedBy[f.seat] = f.p;
    });
    var zone = {};
    if (L.mode === 'class') {
      cons.zone.forEach(function (z) {
        if (!known(z.p)) return;
        if (fixed[z.p]) { notes.push({ code: 'zoneFixed', name: z.p }); return; }
        zone[z.p] = z;
      });
    } else if (cons.zone.length) notes.push({ code: 'zoneClassOnly' });
    var ngList = [], wantList = [];
    cons.pairs.forEach(function (x) {
      var ka = known(x.a), kb = known(x.b);
      if (ka && kb) (x.type === 'want' ? wantList : ngList).push([x.a, x.b]);
    });
    if (missing.length) notes.push({ code: 'unknownNames', names: missing });

    var usePrev = !!(input.prev && input.prev.assign && (cons.avoidSeat || cons.avoidNeighbor));
    var prevInfo = usePrev ? previousInfo(input.prev) : { seatOf: {}, nbOf: {} };
    if (usePrev && cons.avoidSeat && !sameShape(input.prev.layout, L)) notes.push({ code: 'prevShapeChanged' });

    var active = {
      avoidNeighbor: usePrev && cons.avoidNeighbor,
      avoidSeat: usePrev && cons.avoidSeat,
      gender: cons.gender && people.some(function (p) { return p.g; }),
      ng: ngList.length > 0,
      want: wantList.length > 0,
      zone: Object.keys(zone).length > 0,
    };
    if (cons.gender && !active.gender) notes.push({ code: 'genderNoData' });

    // --- 解く前に数でわかる矛盾 ---
    var pre = precheck(L, seats, people, fixed, zone, ngList, cons, active, wantList);
    if (pre) return { ok: false, reason: pre, notes: notes };

    var ctx = { L: L, seats: seats, people: people, fixed: fixed, zone: zone, ngList: ngList, wantList: wantList, cons: cons, prevInfo: prevInfo, seed: seed, idx: idx };
    var budget = opt.budget || 20000;
    var assign = search(ctx, active, budget);
    if (assign) {
      var byName = {}, empty = [];
      Object.keys(assign).forEach(function (k) { byName[assign[k]] = k; });
      seats.forEach(function (s) { if (!assign[s.key]) empty.push(s.key); });
      return { ok: true, assign: assign, byName: byName, empty: empty, notes: notes };
    }

    // --- 見つからなかった: 条件を 1 種類ずつ外して解けるかを試し、どれがぶつかっているかを示す ---
    var cats = CATS.filter(function (c) { return active[c]; });
    for (var i = 0; i < cats.length; i++) {
      var a2 = Object.assign({}, active);
      a2[cats[i]] = false;
      if (search(ctx, a2, Math.floor(budget / 2))) {
        var reason = { code: 'conflict', cat: cats[i], others: cats.filter(function (c) { return c !== cats[i]; }) };
        // 組の条件なら、どの組を外せば決まるかまで探す（組が多いときは先頭の 30 組まで）
        if (cats[i] === 'want' || cats[i] === 'ng') {
          var listKey = cats[i] === 'want' ? 'wantList' : 'ngList', list = ctx[listKey];
          for (var j = 0; j < list.length && j < 30; j++) {
            var c2 = Object.assign({}, ctx);
            c2[listKey] = list.slice(0, j).concat(list.slice(j + 1));
            var a3 = Object.assign({}, active);
            a3[cats[i]] = c2[listKey].length > 0;
            if (search(c2, a3, Math.floor(budget / 4))) { reason.pair = list[j].slice(); break; }
          }
        }
        return { ok: false, reason: reason, notes: notes };
      }
    }
    return { ok: false, reason: { code: cats.length ? 'tooStrict' : 'unsolvable', cats: cats }, notes: notes };
  }

  /** 解く前に数でわかる矛盾。なければ null */
  function precheck(L, seats, people, fixed, zone, ngList, cons, active, wantList) {
    var fixedKeys = Object.keys(fixed).map(function (n) { return fixed[n]; });
    // 前から（後ろから）n 番目までに入れたい人数が、そこの席数（固定席を除く）を超えていないか。入れ子なので n ごとに累計で見る
    if (L.mode === 'class' && active.zone) {
      var wheres = ['front', 'back'];
      for (var w = 0; w < 2; w++) {
        for (var n = 1; n <= LIMITS.rows; n++) {
          var where = wheres[w];
          var need = Object.keys(zone).filter(function (p) { return zone[p].where === where && zone[p].n <= n; }).length;
          if (!need) continue;
          var have = seats.filter(function (s) {
            var inZone = where === 'front' ? s.r < n : s.r >= L.cls.rows - n;
            return inZone && fixedKeys.indexOf(s.key) < 0;
          }).length;
          if (need > have) return { code: 'zoneOver', where: where, n: n, need: need, have: have };
        }
      }
    }
    // 隣にしない 2 人が、どちらも固定で隣り合っている
    if (active.ng) {
      var nb = neighbors(L, cons.ngScope);
      for (var i = 0; i < ngList.length; i++) {
        var a = fixed[ngList[i][0]], b = fixed[ngList[i][1]];
        if (a && b && nb[a].indexOf(b) >= 0) return { code: 'ngFixed', a: ngList[i][0], b: ngList[i][1] };
      }
    }
    // 隣にしたい 2 人が、どちらも固定で隣り合っていない／1 人の「隣にしたい相手」が、隣の席の数より多い
    if (active.want) {
      var nbw = neighbors(L, cons.ngScope), maxNb = 0, cnt = {};
      seats.forEach(function (s) { maxNb = Math.max(maxNb, nbw[s.key].length); });
      for (var wi = 0; wi < wantList.length; wi++) {
        var wa = fixed[wantList[wi][0]], wb = fixed[wantList[wi][1]];
        if (wa && wb && nbw[wa].indexOf(wb) < 0) return { code: 'wantFixed', a: wantList[wi][0], b: wantList[wi][1] };
        cnt[wantList[wi][0]] = (cnt[wantList[wi][0]] || 0) + 1;
        cnt[wantList[wi][1]] = (cnt[wantList[wi][1]] || 0) + 1;
      }
      for (var who in cnt) if (cnt[who] > maxNb) return { code: 'wantMany', name: who, count: cnt[who], max: maxNb };
    }
    // 男女交互: となりでつながった席のかたまり（横の並び・2 人机・テーブルの 1 辺）ごとに、同じ性別は半分（切り上げ）までしか座れない
    if (active.gender) {
      var side = neighbors(L, 'side'), seen = {}, cap = 0;
      seats.forEach(function (s) {
        if (seen[s.key]) return;
        var stack = [s.key], len = 0;
        seen[s.key] = 1;
        while (stack.length) {
          var k = stack.pop(); len++;
          side[k].forEach(function (x) { if (!seen[x]) { seen[x] = 1; stack.push(x); } });
        }
        cap += Math.ceil(len / 2);
      });
      var cnt = { M: 0, F: 0 };
      people.forEach(function (p) { if (p.g) cnt[p.g]++; });
      for (var g in cnt) if (cnt[g] > cap) return { code: 'genderOver', g: g, count: cnt[g], max: cap };
    }
    return null;
  }

  /**
   * くじ（seed つき）＋ 条件を満たすまで戻りながら探す（座れる席のいちばん少ない人から決める）
   * 乱数の流れを変えて何回かやり直す。見つからなければ null
   */
  function search(ctx, active, budget) {
    var L = ctx.L, seats = ctx.seats, people = ctx.people, cons = ctx.cons;
    var N = people.length, S = seats.length;
    var keyIdx = {};
    seats.forEach(function (s, i) { keyIdx[s.key] = i; });
    var sideNb = neighbors(L, 'side');
    var sideI = seats.map(function (s) { return sideNb[s.key].map(function (k) { return keyIdx[k]; }); });
    var ngSet = null, nbList = null;
    if (active.ng || active.want) {
      var ngNb = neighbors(L, cons.ngScope);
      ngSet = seats.map(function (s) { var o = {}; ngNb[s.key].forEach(function (k) { o[keyIdx[k]] = 1; }); return o; });
      nbList = seats.map(function (s) { return ngNb[s.key].map(function (k) { return keyIdx[k]; }); });
    }
    var ngOf = people.map(function () { return []; });
    if (active.ng) ctx.ngList.forEach(function (pr) { var a = ctx.idx[pr[0]], b = ctx.idx[pr[1]]; ngOf[a].push(b); ngOf[b].push(a); });
    var wantOf = people.map(function () { return []; });
    if (active.want) ctx.wantList.forEach(function (pr) { var a = ctx.idx[pr[0]], b = ctx.idx[pr[1]]; wantOf[a].push(b); wantOf[b].push(a); });
    var prevNb = people.map(function (p) {
      var o = {}, has = false;
      if (active.avoidNeighbor) {
        (ctx.prevInfo.nbOf[p.name] || []).forEach(function (n) { if (ctx.idx[n] !== undefined) { o[ctx.idx[n]] = 1; has = true; } });
      }
      return has ? o : null;
    });
    var gender = people.map(function (p) { return active.gender ? p.g : ''; });
    var fixedSeat = {};
    Object.keys(ctx.fixed).forEach(function (n) { fixedSeat[keyIdx[ctx.fixed[n]]] = 1; });
    var fixedKeys = Object.keys(ctx.fixed).map(function (n) { return ctx.fixed[n]; });

    var ATTEMPTS = 8, perAttempt = Math.max(1000, Math.floor(budget / ATTEMPTS));
    var owner, pos, order, dom, nodes, usableNow;
    for (var attempt = 0; attempt < ATTEMPTS; attempt++) {
      var rng = makeRng(ctx.seed, 7 + attempt);
      var emptyKeys = pickEmpty(L, seats, S - N, fixedKeys, cons.emptyBack, rng);
      var usable = seats.map(function (s) { return emptyKeys.indexOf(s.key) < 0; });
      usableNow = usable;
      var nFree = 0;
      for (var i = 0; i < S; i++) if (usable[i] && !fixedSeat[i]) nFree++;
      // 男女交互: となりでつながった席のかたまりごとに、男・女の席を交互に先に決めておく（行き止まりを作らないため）
      var label = active.gender ? genderLabels(usable, rng) : null;
      if (active.gender && !label) continue;
      // 1 人ずつの、座ってよい席（1 人だけで決まる条件: 固定・前後の指定・前回と同じ席）
      var stuck = false;
      dom = people.map(function (p) {
        if (ctx.fixed[p.name]) return [keyIdx[ctx.fixed[p.name]]];
        var z = active.zone ? ctx.zone[p.name] : null, prevSeat = active.avoidSeat ? ctx.prevInfo.seatOf[p.name] : null;
        var list = [];
        for (var i = 0; i < S; i++) {
          if (!usable[i] || fixedSeat[i]) continue;
          if (label && gender[ctx.idx[p.name]] && label[i] !== gender[ctx.idx[p.name]]) continue;
          if (z && (z.where === 'front' ? seats[i].r >= z.n : seats[i].r < L.cls.rows - z.n)) continue;
          if (prevSeat && seats[i].key === prevSeat) continue;
          list.push(i);
        }
        if (!list.length) stuck = true;
        return rng.shuffle(list);
      });
      if (stuck) continue;   // 余った席の選び方で座れなくなった人がいる → 選び直す

      owner = new Array(S).fill(-1); pos = new Array(N).fill(-1); nodes = 0;
      // 何の条件もない人（性別なし・隣にしない組なし・前回のとなりなし・席の制限なし）は、最後に残りの席へくじで座る
      var free = [], bound = [];
      for (var p = 0; p < N; p++) {
        var isFree = !gender[p] && !ngOf[p].length && !wantOf[p].length && !prevNb[p] && dom[p].length === nFree;
        (isFree ? free : bound).push(p);
      }
      order = rng.shuffle(bound);
      if (!dfs(0)) continue;
      var rest = [];
      for (var j = 0; j < S; j++) if (usable[j] && owner[j] < 0) rest.push(j);
      rest = rng.shuffle(rest);
      free.forEach(function (q, k) { owner[rest[k]] = q; pos[q] = rest[k]; });
      var assign = {};
      for (var q = 0; q < N; q++) assign[seats[pos[q]].key] = people[q].name;
      return assign;
    }
    return null;

    /**
     * 使う席のかたまり（となりでつながった席）ごとに、席を 1 つおきに男・女に分ける。
     * かたまりは 1 本の並び（となりは多くて 2 席）なので、つながりの偶奇で交互になる。
     * 固定席の人の性別で向きが決まるかたまりはそれに合わせ、ほかはくじで向きを決めてから、
     * 男の席・女の席の数が人数に足りるよう、奇数の長さのかたまりの向きを入れかえる。足りなければ null
     */
    function genderLabels(usable, rng) {
      var parity = new Array(S).fill(-1), chains = [];
      for (var i = 0; i < S; i++) {
        if (!usable[i] || parity[i] >= 0) continue;
        var ch = { nodes: [], c: [0, 0], pin: -1, bad: false }, queue = [i];
        parity[i] = 0;
        while (queue.length) {
          var k = queue.shift();
          ch.nodes.push(k); ch.c[parity[k]]++;
          sideI[k].forEach(function (x) { if (usable[x] && parity[x] < 0) { parity[x] = 1 - parity[k]; queue.push(x); } });
        }
        chains.push(ch);
      }
      // 固定席の人の性別で向きを決める（ph: 男の席になる偶奇）
      var need = { M: 0, F: 0 };
      people.forEach(function (p, pi) {
        if (!gender[pi]) return;
        need[gender[pi]]++;
        var f = ctx.fixed[p.name];
        if (!f) return;
        var si = keyIdx[f], want = gender[pi] === 'M' ? parity[si] : 1 - parity[si];
        chains.forEach(function (ch) {
          if (ch.nodes.indexOf(si) < 0) return;
          if (ch.pin >= 0 && ch.pin !== want) ch.bad = true;
          ch.pin = want;
        });
      });
      if (chains.some(function (ch) { return ch.bad; })) return null;
      chains.forEach(function (ch) { ch.ph = ch.pin >= 0 ? ch.pin : (rng.next() < 0.5 ? 0 : 1); });
      function slots(g) { return chains.reduce(function (n, ch) { return n + (g === 'M' ? ch.c[ch.ph] : ch.c[1 - ch.ph]); }, 0); }
      var flips = rng.shuffle(chains.filter(function (ch) { return ch.pin < 0 && ch.c[0] !== ch.c[1]; }));
      for (var guard = 0; guard <= flips.length; guard++) {
        var lackM = slots('M') < need.M, lackF = slots('F') < need.F;
        if (!lackM && !lackF) break;
        if (lackM && lackF) return null;
        var g = lackM ? 'M' : 'F';
        var cand = flips.filter(function (ch) { var mNow = ch.c[ch.ph], mFlip = ch.c[1 - ch.ph]; return g === 'M' ? mFlip > mNow : mFlip < mNow; })[0];
        if (!cand) return null;
        cand.ph = 1 - cand.ph;
      }
      if (slots('M') < need.M || slots('F') < need.F) return null;
      var label = new Array(S).fill('');
      chains.forEach(function (ch) { ch.nodes.forEach(function (k) { label[k] = parity[k] === ch.ph ? 'M' : 'F'; }); });
      return label;
    }
    function fits(p, s) {
      if (owner[s] >= 0) return false;
      var i, q;
      for (i = 0; i < ngOf[p].length; i++) {
        q = pos[ngOf[p][i]];
        if (q >= 0 && ngSet[s][q]) return false;
      }
      // 隣にしたい相手: もう座っている相手は隣の席に、まだの相手の分は隣に空いた席が残っていること
      if (wantOf[p].length) {
        var waiting = 0;
        for (i = 0; i < wantOf[p].length; i++) {
          q = pos[wantOf[p][i]];
          if (q >= 0) { if (!ngSet[s][q]) return false; } else waiting++;
        }
        if (waiting) {
          var room = 0, nl = nbList[s];
          for (i = 0; i < nl.length; i++) if (usableNow[nl[i]] && owner[nl[i]] < 0) room++;
          if (room < waiting) return false;
        }
      }
      var sn = sideI[s];
      for (i = 0; i < sn.length; i++) {
        q = owner[sn[i]];
        if (q < 0) continue;
        if (gender[p] && gender[p] === gender[q]) return false;
        if (prevNb[p] && prevNb[p][q]) return false;
      }
      return true;
    }
    function dfs(depth) {
      if (depth === order.length) return true;
      if (++nodes > perAttempt) return false;
      // まだ決まっていない人のうち、座れる席がいちばん少ない人から
      var best = -1, bestCnt = Infinity, bestPos = -1;
      for (var j = depth; j < order.length; j++) {
        var p = order[j], cnt = 0, d = dom[p];
        for (var k = 0; k < d.length && cnt < bestCnt; k++) if (fits(p, d[k])) cnt++;
        if (cnt < bestCnt) { bestCnt = cnt; best = p; bestPos = j; if (!cnt) return false; }
      }
      order[bestPos] = order[depth]; order[depth] = best;
      var dd = dom[best];
      for (var t = 0; t < dd.length; t++) {
        var s = dd[t];
        if (!fits(best, s)) continue;
        owner[s] = best; pos[best] = s;
        if (dfs(depth + 1)) return true;
        owner[s] = -1; pos[best] = -1;
        if (nodes > perAttempt) break;
      }
      order[depth] = order[bestPos]; order[bestPos] = best;
      return false;
    }
  }

  /**
   * できた席順が条件を守っているかを確かめる（テストと、手で入れ替えたあとの注意に使う）
   * @param {object} assign 席のキー → 名前
   * @returns {{code, ...}[]} 守れていないもの。空なら全部守れている
   */
  function checkAssign(input, assign) {
    var L = normalizeLayout(input.layout), cons = normalizeCons(input.cons), out = [];
    var byName = {};
    Object.keys(assign).forEach(function (k) { byName[assign[k]] = k; });
    var seats = buildSeats(L), seatByKey = {};
    seats.forEach(function (s) { seatByKey[s.key] = s; });
    var fixedNames = [];
    cons.pins.forEach(function (f) {
      if (!byName[f.p] || !seatByKey[f.seat]) return;
      fixedNames.push(f.p);
      if (byName[f.p] !== f.seat) out.push({ code: 'vFixed', name: f.p });
    });
    if (L.mode === 'class') {
      cons.zone.forEach(function (z) {
        var k = byName[z.p];
        if (!k || fixedNames.indexOf(z.p) >= 0) return;
        var r = seatByKey[k].r;
        if (z.where === 'front' ? r >= z.n : r < L.cls.rows - z.n) out.push({ code: 'vZone', name: z.p });
      });
    }
    var ngNb = neighbors(L, cons.ngScope);
    cons.pairs.forEach(function (x) {
      var a = byName[x.a], b = byName[x.b];
      if (!a || !b) return;
      var near = ngNb[a].indexOf(b) >= 0;
      if (x.type === 'ng' && near) out.push({ code: 'vNg', a: x.a, b: x.b });
      if (x.type === 'want' && !near) out.push({ code: 'vWant', a: x.a, b: x.b });
    });
    var side = neighbors(L, 'side'), g = {};
    (input.people || []).forEach(function (p) { g[p.name] = p.g; });
    var prev = input.prev && input.prev.assign ? previousInfo(input.prev) : null;
    Object.keys(assign).forEach(function (k) {
      var name = assign[k];
      (side[k] || []).forEach(function (k2) {
        var other = assign[k2];
        if (!other || k2 < k) return;                      // 1 組 1 回
        if (cons.gender && g[name] && g[name] === g[other]) out.push({ code: 'vGender', a: name, b: other });
        if (prev && cons.avoidNeighbor && (prev.nbOf[name] || []).indexOf(other) >= 0) out.push({ code: 'vPrevNeighbor', a: name, b: other });
      });
      if (prev && cons.avoidSeat && prev.seatOf[name] === k && fixedNames.indexOf(name) < 0) out.push({ code: 'vPrevSeat', name: name });
    });
    return out;
  }

  // ---------------------------------------------------------------
  // 座席表での手の操作（置く・入れ替える・ピンを外す・空ける）
  //   board: {名前: 席のキー}（いま座席表に出ている人。くじの前はピンの人だけ）
  //   pins:  [{ p, seat }]（cons.pins と同じ形）
  //   ピンは人に付いていく: ピンの人を入れ替えると、入れ替えた先の席でピンのまま
  //   board に出ていない人のピン（名簿から消えた人など）はそのまま残す。ただし同じ席に人を置いたら外す
  // @param op { type: 'place', name, seat } この人をこの席に置いてピン。席にいた人は、置いた人の元の席へ（元の席がなければ席なし）
  //           { type: 'swap', a, b }        2 つの席（キー）の人を入れ替える（片方が空席なら移すだけ）
  //           { type: 'pin', name } / { type: 'unpin', name }
  //           { type: 'clear', seat }       席を空ける（その人はピンも外れて、席なしになる）
  // @returns { board, pins }（新しいもの。渡したものは変えない）
  // ---------------------------------------------------------------
  function editBoard(board, pins, op) {
    var by = Object.assign({}, board || {}), who = {}, pinned = {}, order = [], extra = [];
    Object.keys(by).forEach(function (n) { who[by[n]] = n; });
    (pins || []).forEach(function (f) {
      if (by[f.p] === f.seat) { pinned[f.p] = 1; order.push(f.p); } else extra.push({ p: f.p, seat: f.seat });
    });
    function pin(n) { if (!pinned[n]) { pinned[n] = 1; order.push(n); } }
    function unpin(n) { delete pinned[n]; }
    function unseat(n) { delete who[by[n]]; delete by[n]; unpin(n); }
    op = op || {};
    if (op.type === 'place' && op.name && op.seat) {
      var from = by[op.name], other = who[op.seat];
      if (other !== op.name) {
        if (from) delete who[from];
        if (other) {
          if (from) { by[other] = from; who[from] = other; } else unseat(other);
        }
        by[op.name] = op.seat; who[op.seat] = op.name;
      }
      pin(op.name);
      extra = extra.filter(function (f) { return f.seat !== op.seat && f.p !== op.name; });
    } else if (op.type === 'swap' && op.a && op.b && op.a !== op.b) {
      var na = who[op.a], nb = who[op.b];
      delete who[op.a]; delete who[op.b];
      if (na) { by[na] = op.b; who[op.b] = na; }
      if (nb) { by[nb] = op.a; who[op.a] = nb; }
      extra = extra.filter(function (f) { return (!na || f.seat !== op.b) && (!nb || f.seat !== op.a); });
    } else if (op.type === 'pin' && by[op.name]) {
      pin(op.name);
    } else if (op.type === 'unpin') {
      unpin(op.name);
      extra = extra.filter(function (f) { return f.p !== op.name; });
    } else if (op.type === 'clear' && who[op.seat]) {
      unseat(who[op.seat]);
    }
    var out = order.filter(function (n) { return pinned[n] && by[n]; }).map(function (n) { return { p: n, seat: by[n] }; });
    return { board: by, pins: out.concat(extra) };
  }

  // ---------------------------------------------------------------
  // 画面・印刷の並べ方
  // ---------------------------------------------------------------
  /** 席の場所（数だけ。文は text.js の TEXT.seatName）。教室: 前から何番目・左から何番目。宴会: テーブル名と番号 */
  function seatPlace(layout, key) {
    var L = normalizeLayout(layout), s = null;
    buildSeats(L).some(function (x) { if (x.key === key) { s = x; return true; } return false; });
    if (!s) return null;
    return L.mode === 'class' ? { no: s.no, row: s.r + 1, col: s.c + 1 } : { no: s.no, table: L.party.tables[s.t].name, n: s.n };
  }

  /**
   * 教室の席を画面・印刷に並べる順。教卓を下にすると、前後も左右も逆（先生から見た向き）
   * @returns 行の配列。各行は { key, off（使わない席）, aisleBefore（左に通路） } の配列
   */
  function classGrid(layout) {
    var L = normalizeLayout(layout), c = L.cls, rows = [];
    for (var r = 0; r < c.rows; r++) {
      var row = [];
      for (var x = 0; x < c.cols; x++) row.push({ key: r + '-' + x, c: x, off: c.off.indexOf(r + '-' + x) >= 0 });
      rows.push(row);
    }
    if (c.desk === 'bottom') rows = rows.reverse().map(function (row) { return row.slice().reverse(); });
    return rows.map(function (row) {
      return row.map(function (cell, i) {
        return { key: cell.key, off: cell.off, aisleBefore: c.pairs && i > 0 && Math.floor(row[i - 1].c / 2) !== Math.floor(cell.c / 2) };
      });
    });
  }

  /** 1 人ずつ出す順番: random（くじ）/ back（後ろの席から）/ front（前の席から）/ list（名簿の順） */
  function revealOrder(result, layout, people, how, seed) {
    var seats = buildSeats(layout).filter(function (s) { return result.assign[s.key]; });
    if (how === 'front') return seats.map(function (s) { return s.key; });
    if (how === 'back') return seats.slice().reverse().map(function (s) { return s.key; });
    if (how === 'list') return people.map(function (p) { return result.byName[p.name]; }).filter(Boolean);
    return makeRng(seed, 99).shuffle(seats.map(function (s) { return s.key; }));
  }

  // ---------------------------------------------------------------
  // 共有リンク #s=（base64url の JSON）
  //   既定: 席の並び・くじ番号だけ（番号だけの名簿なら人数と条件も。名前が無いので）
  //   withNames: 名簿（名前・性別）と条件も入れる（受け取った人に名前が見える）
  // ---------------------------------------------------------------
  function b64uEncode(s) {
    var bytes = new TextEncoder().encode(s), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(s) {
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  /**
   * @param {object} st { layout, seed, numbers, count, people: [{name,g}], cons, result: {名前: 席のキー} | null }
   *   result（決まった席順。手で入れ替えたあとのもの）は、名簿を入れるときだけ入れる（人の順に席のキー）
   * @returns {string} "#s=" に続ける文字列
   */
  function encodeShare(st, withNames) {
    var o = { v: 1, l: normalizeLayout(st.layout), s: st.seed >>> 0 };
    var withList = st.numbers || withNames;
    if (st.numbers) o.k = intIn(st.count, 1, LIMITS.people, 30);
    else if (withNames) o.p = (st.people || []).map(function (p) { return p.g ? [p.name, p.g] : [p.name]; });
    if (withList) {
      o.c = normalizeCons(st.cons);
      if (st.result) o.r = (st.numbers ? numberPeople(o.k) : st.people || []).map(function (p) { return st.result[p.name] || ''; });
    }
    return b64uEncode(JSON.stringify(o));
  }
  /** "#s=..." を戻す。壊れていれば null。people は名前が入っていないリンクなら null */
  function decodeShare(hash) {
    var m = /^#?s=([A-Za-z0-9_-]+)$/.exec(String(hash || '').trim());
    if (!m) return null;
    try {
      var o = JSON.parse(b64uDecode(m[1]));
      if (!o || o.v !== 1 || !o.l || typeof o.l !== 'object') return null;
      var people = null;
      if (Array.isArray(o.p)) {
        people = o.p.slice(0, LIMITS.people).map(function (x) {
          return { name: str(Array.isArray(x) ? x[0] : x, LIMITS.nameLen), g: Array.isArray(x) && (x[1] === 'M' || x[1] === 'F') ? x[1] : '' };
        }).filter(function (p) { return p.name; });
      }
      var numbers = o.k !== undefined, count = numbers ? intIn(o.k, 1, LIMITS.people, 30) : 0;
      var result = null, list = numbers ? numberPeople(count) : people;
      if (list && Array.isArray(o.r)) {
        var L = normalizeLayout(o.l), valid = {}, used = {};
        buildSeats(L).forEach(function (s) { valid[s.key] = 1; });
        result = {};
        list.forEach(function (p, i) {
          var k = String(o.r[i] || '');
          if (valid[k] && !used[k]) { result[p.name] = k; used[k] = 1; }
        });
        if (!Object.keys(result).length) result = null;
      }
      return {
        layout: normalizeLayout(o.l),
        seed: intIn(o.s, 0, 4294967295, 0),
        result: result,
        numbers: numbers,
        count: count,
        people: people,
        cons: o.c ? normalizeCons(o.c) : null,
      };
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------
  // 保存するデータ（クラス・グループごと）
  //   { current: id, groups: [{ id, name, layout, numbers, count, names, cons, history: [{at, seed, layout, assign}], last（いま出ている席順） }] }
  // ---------------------------------------------------------------
  function newGroup(id, name) {
    return { id: id, name: name, layout: defaultLayout(), numbers: false, count: 30, names: '', cons: defaultCons(), history: [], last: null };
  }
  function normalizeGroup(g, i) {
    g = g && typeof g === 'object' ? g : {};
    // 席順 1 つ分（履歴・最後に決めた席）: { at, seed, layout, assign: {名前: 席のキー} }。同じ席に 2 人は入れない
    function entry(h) {
      if (!h || typeof h !== 'object' || !h.assign || typeof h.assign !== 'object' || Array.isArray(h.assign)) return null;
      var assign = {}, used = {};
      Object.keys(h.assign).slice(0, LIMITS.people).forEach(function (n) {
        var k = str(h.assign[n], 12), name = str(n, LIMITS.nameLen);
        if (name && SEAT_KEY.test(k) && !used[k]) { assign[name] = k; used[k] = 1; }
      });
      return { at: str(h.at, 30), seed: intIn(h.seed, 0, 4294967295, 0), layout: normalizeLayout(h.layout), assign: assign };
    }
    var hist = (Array.isArray(g.history) ? g.history : []).slice(0, LIMITS.history).map(entry).filter(Boolean);
    return {
      id: str(g.id, 20).replace(/[^A-Za-z0-9_-]/g, '') || 'g' + (i || 0),
      name: str(g.name, 30),
      layout: normalizeLayout(g.layout),
      numbers: !!g.numbers,
      count: intIn(g.count, 1, LIMITS.people, 30),
      names: String(g.names == null ? '' : g.names).slice(0, 20000),
      cons: normalizeCons(g.cons),
      history: hist,
      last: entry(g.last),
    };
  }
  function normalizeData(d) {
    d = d && typeof d === 'object' ? d : {};
    var groups = (Array.isArray(d.groups) ? d.groups : []).slice(0, LIMITS.groups).map(normalizeGroup);
    var ids = {};
    groups.forEach(function (g, i) { if (ids[g.id]) g.id = g.id + '_' + i; ids[g.id] = 1; });
    var current = groups.some(function (g) { return g.id === d.current; }) ? d.current : (groups[0] ? groups[0].id : '');
    return { current: current, groups: groups };
  }
  /** 決めた席順を履歴の先頭に入れた、新しい履歴（新しい順・10 件まで） */
  function addHistory(history, entry) {
    var h = [{ at: String(entry.at || ''), seed: entry.seed >>> 0, layout: normalizeLayout(entry.layout), assign: Object.assign({}, entry.byName) }];
    return h.concat(history || []).slice(0, LIMITS.history);
  }

  // ---------------------------------------------------------------
  // バックアップファイル（README「ツールを追加するとき」20。決定 D31）
  // ---------------------------------------------------------------
  var BACKUP_VERSION = 1;
  function backupFileName(tool, date) {
    var d = date || new Date();
    return tool + '-backup-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
  }
  function buildBackup(tool, data, date) {
    return { tool: tool, version: BACKUP_VERSION, exportedAt: (date || new Date()).toISOString(), data: data };
  }
  /**
   * 読み込んだファイルの文字列を確かめる。中身の正規化は normalizeData で行う
   * @returns {{ok: true, data: object} | {ok: false, code: string, tool?: string}} code の文は TEXT.backup
   */
  function parseBackup(text, tool, requiredKeys) {
    var o;
    try { o = JSON.parse(text); } catch (e) { o = null; }
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.tool !== 'string') return { ok: false, code: 'unreadable' };
    if (o.tool !== tool) return { ok: false, code: 'otherTool', tool: o.tool.slice(0, 40) };
    if (o.version !== BACKUP_VERSION) return { ok: false, code: typeof o.version === 'number' && o.version > BACKUP_VERSION ? 'newer' : 'badFormat' };
    var data = o.data;
    var missing = !data || typeof data !== 'object' || Array.isArray(data) ||
      (requiredKeys || []).some(function (k) { return data[k] === undefined || data[k] === null; });
    if (missing) return { ok: false, code: 'missing' };
    return { ok: true, data: data };
  }

  var api = {
    LIMITS: LIMITS, makeRng: makeRng, seedLabel: seedLabel, parseSeedLabel: parseSeedLabel,
    defaultLayout: defaultLayout, normalizeLayout: normalizeLayout, tableNameAt: tableNameAt, buildSeats: buildSeats, neighbors: neighbors,
    parsePeople: parsePeople, numberPeople: numberPeople, peopleToText: peopleToText,
    defaultCons: defaultCons, normalizeCons: normalizeCons, previousInfo: previousInfo, sameShape: sameShape,
    solve: solve, checkAssign: checkAssign, editBoard: editBoard, pairKey: pairKey, seatPlace: seatPlace, classGrid: classGrid, revealOrder: revealOrder,
    encodeShare: encodeShare, decodeShare: decodeShare,
    newGroup: newGroup, normalizeGroup: normalizeGroup, normalizeData: normalizeData, addHistory: addHistory,
    backupFileName: backupFileName, buildBackup: buildBackup, parseBackup: parseBackup,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
