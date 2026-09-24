// ===========================
// 席替え・席順くじ — 画面の制御
// 席を決めるのは calc.js（純粋関数）、JavaScript から出す文は text.js（TEXT）に置く
// ===========================
(function () {
  'use strict';

  var C = window.Calc, T = window.TEXT, U = T.ui;
  var TOOL = 'sekigae';

  // --- ブラウザへの保存（README「ツールを追加するとき」12）。キーは "sekigae_" で始める ---
  var KEY_PREFIX = 'sekigae_';
  var store = {
    get: function (name, fallback) {
      try {
        var v = localStorage.getItem(KEY_PREFIX + name);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (name, value) {
      try { localStorage.setItem(KEY_PREFIX + name, JSON.stringify(value)); } catch (e) { /* 保存できなくても続ける */ }
    },
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function newSeed() {
    try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch (e) { return Math.floor(Math.random() * 4294967296); }
  }
  function newId() { return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function reducedMotion() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function invert(byName) { var o = {}; Object.keys(byName).forEach(function (n) { o[byName[n]] = n; }); return o; }

  // ---------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------
  var data = C.normalizeData(store.get('data', null));
  if (!data.groups.length) {
    data.groups.push(C.newGroup(newId(), U.groupDefault(1)));
    data.current = data.groups[0].id;
  }
  var sharedGroup = null;          // 共有リンクで開いたとき（「保存する」まで、この端末のデータは書きかえない）
  var reveal = { order: [], shown: 0, anim: false };
  // 座席表の手の操作: arm（席のない人のチップを選んだ）、swapOn（入れ替えモード）、swapFirst（入れ替える 1 つ目の席）、warn（守れなくなった条件）
  var ui = { arm: null, swapOn: false, swapFirst: null, warn: '' };
  var lastSolveError = null;
  var lastNotes = [];
  var pending = { zone: false };

  function group() {
    if (sharedGroup) return sharedGroup;
    for (var i = 0; i < data.groups.length; i++) if (data.groups[i].id === data.current) return data.groups[i];
    return data.groups[0];
  }
  function save() { if (!sharedGroup) store.set('data', data); }

  function currentPeople() {
    var g = group();
    return g.numbers ? { people: C.numberPeople(g.count), notes: [] } : C.parsePeople(g.names);
  }
  function layoutSig(l) { return JSON.stringify(C.normalizeLayout(l)); }
  /** いま出ている席順（席の並びを変えたあとは出さない） */
  function currentResult() {
    var g = group();
    if (!g.last || layoutSig(g.last.layout) !== layoutSig(g.layout)) return null;
    return { seed: g.last.seed, at: g.last.at, byName: g.last.assign, assign: invert(g.last.assign) };
  }
  function prevEntry() {
    var h = group().history[0];
    return h ? { layout: h.layout, assign: h.assign } : null;
  }

  /**
   * いま座席表に出す席順 {名前: 席のキー}: くじの結果（あれば）に、固定（ピン）の人を重ねたもの。
   * 名簿にいない人・今の席の並びにない席は出さない
   */
  function boardByName() {
    var g = group(), res = currentResult(), known = {}, valid = {}, by = {}, who = {};
    currentPeople().people.forEach(function (p) { known[p.name] = 1; });
    C.buildSeats(g.layout).forEach(function (s) { valid[s.key] = 1; });
    if (res) Object.keys(res.byName).forEach(function (n) { var k = res.byName[n]; if (known[n] && valid[k] && !who[k]) { by[n] = k; who[k] = n; } });
    g.cons.pins.forEach(function (f) {
      if (!known[f.p] || !valid[f.seat]) return;
      var other = who[f.seat];
      if (other && other !== f.p) delete by[other];
      if (by[f.p]) delete who[by[f.p]];
      by[f.p] = f.seat; who[f.seat] = f.p;
    });
    return by;
  }
  /** 固定（ピン）の席 {席のキー: true}（座席表に出ている人だけ） */
  function pinnedKeys(by) {
    var o = {};
    group().cons.pins.forEach(function (f) { if (by[f.p] === f.seat) o[f.seat] = true; });
    return o;
  }
  function pinCount() { var by = boardByName(); return Object.keys(pinnedKeys(by)).length; }

  // ---------------------------------------------------------------
  // 席の表（座席表・席の並びの編集・大画面・印刷で共通）
  // ---------------------------------------------------------------
  var PIN_SVG = '<svg class="pin" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10.6 1.4 14.6 5.4 13.2 6.1 10.9 8.4 11.3 11.6 10.2 12.7 7.4 9.9 3.4 13.9 2.1 13.9 2.1 12.6 6.1 8.6 3.3 5.8 4.4 4.7 7.6 5.1 9.9 2.8Z" fill="currentColor"/></svg>';
  /**
   * @param {HTMLElement} box
   * @param {object} o { layout, names: {席のキー: 名前} | null, hidden: {席のキー: true} | null, pinned: {席のキー: true} | null,
   *                     onSeat(key), selected, dropTarget }
   */
  function drawSeats(box, o) {
    var L = C.normalizeLayout(o.layout);
    box.textContent = '';
    box.classList.toggle('party', L.mode === 'party');
    var seats = C.buildSeats(L), byKey = {};
    seats.forEach(function (s) { byKey[s.key] = s; });

    function seatCell(key) {
      var s = byKey[key];
      var cell = el(o.onSeat ? 'button' : 'div', 'seat');
      if (o.onSeat) { cell.type = 'button'; cell.addEventListener('click', function (e) { o.onSeat(key, e); }); }
      cell.dataset.key = key;
      if (!s) {                                   // 使わない席（教室だけ）
        cell.classList.add('off');
        cell.appendChild(el('span', 'nm', U.offSeat));
        if (o.onSeat) {
          var rc = key.split('-');
          cell.setAttribute('aria-label', U.offSeatLabel(+rc[0] + 1, +rc[1] + 1));
          cell.setAttribute('aria-pressed', 'true');
        }
        return cell;
      }
      var place = C.seatPlace(L, key), name = o.names ? o.names[key] : null;
      var hidden = o.names && o.hidden && o.hidden[key], pin = !!(name && o.pinned && o.pinned[key]);
      cell.appendChild(el('span', 'no', T.seatShort(place)));
      if (hidden) {
        cell.classList.add('hidden-seat');
        cell.appendChild(el('span', 'nm', U.hiddenMark));
      } else if (name) {
        var nm = el('span', 'nm', name);
        nm.classList.add(name.length > 6 ? 'len-l' : name.length > 4 ? 'len-m' : 'len-s');
        cell.appendChild(nm);
        cell.classList.add('filled');
        if (pin) { cell.classList.add('pinned'); cell.insertAdjacentHTML('beforeend', PIN_SVG); }
      } else if (o.names) {
        cell.classList.add('empty');
        cell.appendChild(el('span', 'nm', o.emptyText === undefined ? U.emptySeat : o.emptyText));
      } else {
        cell.appendChild(el('span', 'nm', ''));
      }
      if (o.selected === key) cell.classList.add('selected');
      if (o.onSeat) {
        cell.setAttribute('aria-label', T.seatName(place) + (name && !hidden ? '：' + name + (pin ? U.pinnedMark : '') : o.names && !hidden ? '：' + U.emptySeat : ''));
        if (o.editor) cell.setAttribute('aria-pressed', 'false');
        if (o.selected === key) cell.setAttribute('aria-current', 'true');
      }
      return cell;
    }

    if (L.mode === 'class') {
      var rows = C.classGrid(L);
      var front = el('div', 'front-bar', U.front + '（' + U.desk + '）');
      var grid = el('div', 'cgrid');
      var tmpl = [];
      rows[0].forEach(function (cell) { if (cell.aisleBefore) tmpl.push('var(--aisle)'); tmpl.push('minmax(0, 1fr)'); });
      grid.style.gridTemplateColumns = tmpl.join(' ');
      grid.style.gridTemplateRows = 'repeat(' + rows.length + ', 1fr)';
      grid.style.setProperty('--cols', rows[0].length + (L.cls.pairs ? 0.6 : 0));
      rows.forEach(function (row) {
        row.forEach(function (cell) {
          if (cell.aisleBefore) grid.appendChild(el('div', 'aisle'));
          if (cell.off && !o.editor) grid.appendChild(el('div', 'seat void'));
          else grid.appendChild(seatCell(cell.key));
        });
      });
      if (L.cls.desk === 'top') { box.appendChild(front); box.appendChild(grid); }
      else { box.appendChild(grid); box.appendChild(front); front.classList.add('bottom'); }
    } else {
      var wrap = el('div', 'tables');
      L.party.tables.forEach(function (t, ti) {
        var tb = el('div', 'tbl');
        tb.appendChild(el('div', 'tbl-name', t.name));
        var top = el('div', 'tbl-side'), bottom = el('div', 'tbl-side');
        var nTop = Math.ceil(t.seats / 2);
        tb.style.setProperty('--n', nTop);
        seats.filter(function (s) { return s.t === ti; }).forEach(function (s) { (s.s === 0 ? top : bottom).appendChild(seatCell(s.key)); });
        tb.appendChild(top);
        tb.appendChild(el('div', 'tbl-board'));
        tb.appendChild(bottom);
        wrap.appendChild(tb);
      });
      box.appendChild(wrap);
    }
  }

  // ---------------------------------------------------------------
  // クラス・グループ
  // ---------------------------------------------------------------
  function renderGroups() {
    var sel = $('group');
    sel.textContent = '';
    (sharedGroup ? [sharedGroup] : data.groups).forEach(function (g) {
      var op = el('option', null, g.name || U.unnamed);
      op.value = g.id;
      sel.appendChild(op);
    });
    sel.value = group().id;
    sel.disabled = !!sharedGroup;
    $('group-new').disabled = $('group-rename').disabled = $('group-delete').disabled = !!sharedGroup;
  }
  $('group').addEventListener('change', function () {
    data.current = this.value;
    save();
    resetView();
    renderAll();
  });
  $('group-new').addEventListener('click', function () {
    if (data.groups.length >= C.LIMITS.groups) { alert(U.groupLimit); return; }
    var name = prompt(U.groupNew, U.groupDefault(data.groups.length + 1));
    if (name === null) return;
    var g = C.newGroup(newId(), String(name).trim().slice(0, 30) || U.groupDefault(data.groups.length + 1));
    g.layout = C.normalizeLayout(group().layout);     // 席の並びは今のものを引き継ぐ（同じ学校・同じ店のことが多い）
    data.groups.push(g);
    data.current = g.id;
    save();
    resetView();
    renderAll();
  });
  $('group-rename').addEventListener('click', function () {
    var g = group();
    var name = prompt(U.groupRenamePrompt, g.name);
    if (name === null) return;
    g.name = String(name).trim().slice(0, 30);
    save();
    renderGroups();
    renderPrint();
  });
  $('group-delete').addEventListener('click', function () {
    var g = group();
    if (!confirm(U.groupDeleteConfirm(g.name || U.unnamed))) return;
    data.groups = data.groups.filter(function (x) { return x !== g; });
    if (!data.groups.length) data.groups.push(C.newGroup(newId(), U.groupDefault(1)));
    data.current = data.groups[0].id;
    save();
    resetView();
    renderAll();
  });

  // ---------------------------------------------------------------
  // 1. 席の並び
  // ---------------------------------------------------------------
  (function fillSelects() {
    for (var i = 1; i <= C.LIMITS.cols; i++) { var o = el('option', null, String(i)); o.value = i; $('cols').appendChild(o); }
    for (var j = 1; j <= C.LIMITS.rows; j++) { var p = el('option', null, String(j)); p.value = j; $('rows').appendChild(p); }
  })();

  function setLayout(fn) {
    var g = group();
    var L = C.normalizeLayout(g.layout);
    fn(L);
    g.layout = C.normalizeLayout(L);
    save();
    renderLayout();
    renderCons();
    renderPeopleSummary();
    renderResult();
  }

  function renderLayout() {
    var L = C.normalizeLayout(group().layout);
    document.querySelectorAll('input[name="mode"]').forEach(function (r) { r.checked = r.value === L.mode; });
    $('class-panel').hidden = L.mode !== 'class';
    $('party-panel').hidden = L.mode !== 'party';
    $('empty-back-wrap').hidden = L.mode !== 'class';
    $('d-zone').hidden = L.mode !== 'class';
    $('cols').value = L.cls.cols;
    $('rows').value = L.cls.rows;
    $('desk').value = L.cls.desk;
    $('pairs').checked = L.cls.pairs;
    if (L.mode === 'class') {
      drawSeats($('layout-grid'), {
        layout: L, names: null, editor: true,
        onSeat: function (key) {
          setLayout(function (l) {
            var i = l.cls.off.indexOf(key);
            if (i >= 0) l.cls.off.splice(i, 1); else l.cls.off.push(key);
          });
          var b = $('layout-grid').querySelector('[data-key="' + key + '"]');
          if (b) b.focus();
        },
      });
    }
    renderTables(L);
    var nSeats = C.buildSeats(L).length;
    $('seat-count').textContent = U.seatCount(nSeats);
    $('layout-summary').textContent = U.layoutSum(L, nSeats);
  }
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener('change', function () { setLayout(function (l) { l.mode = r.value; }); });
  });
  $('cols').addEventListener('change', function () { var v = +this.value; setLayout(function (l) { l.cls.cols = v; }); });
  $('rows').addEventListener('change', function () { var v = +this.value; setLayout(function (l) { l.cls.rows = v; }); });
  $('desk').addEventListener('change', function () { var v = this.value; setLayout(function (l) { l.cls.desk = v; }); });
  $('pairs').addEventListener('change', function () { var v = this.checked; setLayout(function (l) { l.cls.pairs = v; }); });

  function renderTables(L) {
    var ul = $('tables');
    ul.textContent = '';
    L.party.tables.forEach(function (t, i) {
      var li = el('li', 'table-row');
      var name = el('input');
      name.type = 'text'; name.value = t.name; name.maxLength = 12;
      name.setAttribute('aria-label', U.tableName + ' ' + (i + 1));
      name.addEventListener('change', function () { var v = this.value; setLayout(function (l) { l.party.tables[i].name = v.trim() || C.tableNameAt(i); }); });
      var seats = el('select');
      seats.setAttribute('aria-label', U.tableSeatsLabel(t.name));
      for (var n = 1; n <= C.LIMITS.tableSeats; n++) { var op = el('option', null, U.tableSeats(n)); op.value = n; seats.appendChild(op); }
      seats.value = t.seats;
      seats.addEventListener('change', function () { var v = +this.value; setLayout(function (l) { l.party.tables[i].seats = v; }); });
      var del = el('button', 'btn btn-sub btn-x', '✕');
      del.type = 'button';
      del.setAttribute('aria-label', U.tableRemove(t.name));
      del.disabled = L.party.tables.length <= 1;
      del.addEventListener('click', function () { setLayout(function (l) { l.party.tables.splice(i, 1); }); });
      li.appendChild(name); li.appendChild(seats); li.appendChild(del);
      ul.appendChild(li);
    });
    $('table-add').disabled = L.party.tables.length >= C.LIMITS.tables;
  }
  $('table-add').addEventListener('click', function () {
    setLayout(function (l) {
      var last = l.party.tables[l.party.tables.length - 1];
      l.party.tables.push({ name: C.tableNameAt(l.party.tables.length), seats: last ? last.seats : 6 });
    });
  });

  // ---------------------------------------------------------------
  // 2. 名簿
  // ---------------------------------------------------------------
  function renderPeople() {
    var g = group();
    document.querySelectorAll('input[name="plist"]').forEach(function (r) { r.checked = r.value === (g.numbers ? 'numbers' : 'names'); });
    $('names-panel').hidden = g.numbers;
    $('numbers-panel').hidden = !g.numbers;
    if ($('names').value !== g.names) $('names').value = g.names;
    $('count').value = g.count;
    renderPeopleSummary();
  }
  function renderPeopleSummary() {
    var p = currentPeople(), seats = C.buildSeats(group().layout).length;
    var m = 0, f = 0;
    p.people.forEach(function (x) { if (x.g === 'M') m++; else if (x.g === 'F') f++; });
    var notes = p.notes.map(T.note).filter(Boolean);
    $('people-summary').textContent = U.people(p.people.length, seats) + (m + f ? U.genderCount(m, f) : '') + (notes.length ? ' ' + notes.join(' ') : '');
    $('people-summary').classList.toggle('warn', p.people.length > seats);
  }
  document.querySelectorAll('input[name="plist"]').forEach(function (r) {
    r.addEventListener('change', function () {
      group().numbers = r.value === 'numbers';
      save(); renderPeople(); renderCons(); renderResult();
    });
  });
  var namesTimer = null;
  $('names').addEventListener('input', function () {
    group().names = this.value.slice(0, 20000);
    save();
    renderPeopleSummary();
    clearTimeout(namesTimer);
    namesTimer = setTimeout(function () { renderCons(); renderResult(); }, 400);     // 条件の人の選択肢・座席表を作り直す（打っている間は待つ）
  });
  $('count').addEventListener('change', function () {
    var n = Math.max(1, Math.min(C.LIMITS.people, Math.round(+this.value) || 1));
    this.value = n;
    group().count = n;
    save(); renderPeopleSummary(); renderCons(); renderResult();
  });

  // ---------------------------------------------------------------
  // 3. 条件（前回・男女交互・前後の席）と、組の条件（隣にしない・隣にしたい）
  // ---------------------------------------------------------------
  function setCons(fn, rerender) {
    var g = group();
    fn(g.cons);
    g.cons = C.normalizeCons(g.cons);
    save();
    if (rerender !== false) renderCons(); else renderConsSummary();
  }
  function personSelect(value, names, label, onChange) {
    var s = el('select');
    s.setAttribute('aria-label', label);
    var blank = el('option', null, U.choosePerson); blank.value = ''; s.appendChild(blank);
    names.forEach(function (n) { var o = el('option', null, n); o.value = n; s.appendChild(o); });
    if (value && names.indexOf(value) < 0) { var o2 = el('option', null, U.notInList(value)); o2.value = value; s.appendChild(o2); }
    s.value = value || '';
    s.addEventListener('change', function () { onChange(this.value); });
    return s;
  }
  function removeBtn(label, onClick) {
    var b = el('button', 'btn btn-sub btn-x', '✕');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }
  function renderConsSummary() {
    var g = group(), cons = g.cons, L = C.normalizeLayout(g.layout), on = [];
    if (cons.avoidSeat) on.push(U.sumAvoidSeat);
    if (cons.avoidNeighbor) on.push(U.sumAvoidNb);
    if (cons.gender) on.push(U.sumGender);
    if (L.mode === 'class' && cons.zone.length) on.push(U.sumZone(cons.zone.length));
    $('cons-summary').textContent = on.length ? on.join('・') : U.sumNone;
  }
  function renderCons() {
    var g = group(), cons = g.cons, L = C.normalizeLayout(g.layout);
    var names = currentPeople().people.map(function (p) { return p.name; });
    $('avoid-seat').checked = cons.avoidSeat;
    $('avoid-nb').checked = cons.avoidNeighbor;
    $('gender').checked = cons.gender;
    $('empty-back').checked = cons.emptyBack;
    var h = g.history[0];
    $('prev-info').textContent = h ? U.prevOf(h.at) : U.prevNone;

    // 前の席・後ろの席
    var ul = $('zone-list'); ul.textContent = '';
    cons.zone.forEach(function (z, i) {
      var li = el('li', 'row');
      li.appendChild(personSelect(z.p, names, U.lblZonePerson, function (v) { setCons(function (c) { if (v) c.zone[i].p = v; else c.zone.splice(i, 1); }); }));
      var w = el('select');
      w.setAttribute('aria-label', U.lblZoneWhere);
      ['front', 'back'].forEach(function (k) { var o = el('option', null, T.where[k]); o.value = k; w.appendChild(o); });
      w.value = z.where;
      w.addEventListener('change', function () { var v = this.value; setCons(function (c) { c.zone[i].where = v; }); });
      var n = el('select');
      n.setAttribute('aria-label', U.lblZoneN);
      for (var k = 1; k <= L.cls.rows; k++) { var o = el('option', null, U.zoneN(k)); o.value = k; n.appendChild(o); }
      n.value = Math.min(z.n, L.cls.rows);
      n.addEventListener('change', function () { var v = +this.value; setCons(function (c) { c.zone[i].n = v; }); });
      li.appendChild(w); li.appendChild(n);
      li.appendChild(removeBtn(U.remove, function () { setCons(function (c) { c.zone.splice(i, 1); }); }));
      ul.appendChild(li);
    });
    if (pending.zone) {
      var li = el('li', 'row pending');
      li.appendChild(personSelect('', names, U.lblZonePerson, function (v) {
        if (!v) return;
        pending.zone = false;
        setCons(function (c) { c.zone.push({ p: v, where: 'front', n: Math.min(2, L.cls.rows) }); });
      }));
      li.appendChild(removeBtn(U.remove, function () { pending.zone = false; renderCons(); }));
      ul.appendChild(li);
    }
    $('n-zone').textContent = cons.zone.length ? cons.zone.length : '';

    // 「隣」の範囲（隣にしない・隣にしたいの両方に使う）
    var sc = $('ng-scope'); sc.textContent = '';
    (L.mode === 'class' ? [['side', 'side'], ['cross', 'cross'], ['around', 'around']]
      : [['side', 'partySide'], ['cross', 'partyCross'], ['around', 'partyAround'], ['table', 'table']]).forEach(function (x) {
      var o = el('option', null, T.scope[x[1]]); o.value = x[0]; sc.appendChild(o);
    });
    sc.value = L.mode === 'class' && cons.ngScope === 'table' ? 'around' : cons.ngScope;

    // 組の条件の一覧（1 行 1 組、✕ で外す）
    var known = {};
    names.forEach(function (n) { known[n] = 1; });
    ul = $('pair-list'); ul.textContent = '';
    cons.pairs.forEach(function (x, i) {
      var li = el('li', 'pair ' + x.type);
      var lab = el('span', 'pair-txt');
      lab.appendChild(el('span', 'pair-type', x.type === 'want' ? U.pairWantShort : U.pairNgShort));
      lab.appendChild(document.createTextNode(' ' + (known[x.a] ? x.a : U.notInList(x.a)) + U.and + (known[x.b] ? x.b : U.notInList(x.b))));
      li.appendChild(lab);
      li.appendChild(removeBtn(U.pairRemove(x.a, x.b, x.type), function () {
        setCons(function (c) { c.pairs.splice(i, 1); });
        renderResult();
        var next = $('pair-list').querySelectorAll('button')[Math.min(i, $('pair-list').querySelectorAll('button').length - 1)];
        (next || $('pair-add')).focus();
      }));
      ul.appendChild(li);
    });
    $('n-pairs').textContent = cons.pairs.length ? cons.pairs.length : '';
    $('pair-list').hidden = !cons.pairs.length;
    renderConsSummary();
  }
  $('zone-add').addEventListener('click', function () {
    pending.zone = true;
    renderCons();
    var sel = document.querySelector('#zone-list .pending select');
    if (sel) sel.focus();
  });
  $('ng-scope').addEventListener('change', function () { var v = this.value; setCons(function (c) { c.ngScope = v; }, false); refreshWarn(); });
  $('avoid-seat').addEventListener('change', function () { var v = this.checked; setCons(function (c) { c.avoidSeat = v; }, false); });
  $('avoid-nb').addEventListener('change', function () { var v = this.checked; setCons(function (c) { c.avoidNeighbor = v; }, false); });
  $('gender').addEventListener('change', function () { var v = this.checked; setCons(function (c) { c.gender = v; }, false); });
  $('empty-back').addEventListener('change', function () { var v = this.checked; setCons(function (c) { c.emptyBack = v; }, false); });

  // ---------------------------------------------------------------
  // 4. 座席表: 置く（ピン）・入れ替える・残りをくじで決める・発表
  // ---------------------------------------------------------------
  function resetView() {
    reveal = { order: [], shown: 0, anim: false };
    ui = { arm: null, swapOn: false, swapFirst: null, warn: '', prevIsSelf: false };
    lastSolveError = null;
    lastNotes = [];
    $('decide-msg').textContent = '';
    $('status').textContent = '';
    $('board-msg').textContent = '';
    pending = { zone: false };
  }
  function boardMsg(t) { $('board-msg').textContent = t || ''; }
  function seatLabel(key) { return T.seatName(C.seatPlace(group().layout, key)); }
  function focusSeat(key) {
    var c = $('result-grid').querySelector('[data-key="' + key + '"]');
    if (c) c.focus();
  }

  /** くじを引いて、固定（ピン）していない人の席を決める。うまくいけば true */
  function runLottery() {
    var g = group(), pp = currentPeople(), seed = newSeed();
    var r = C.solve({ layout: g.layout, people: pp.people, cons: g.cons, prev: prevEntry(), seed: seed });
    resetView();
    if (!r.ok) {
      // 決まらなかったときは、いま出ている席順（手で動かしたものも）をそのまま残す
      lastSolveError = { reason: r.reason, notes: pp.notes.concat(r.notes) };
      renderResult();
      return false;
    }
    g.last = { at: U.at(new Date()), seed: seed, layout: C.normalizeLayout(g.layout), assign: r.byName };
    lastNotes = pp.notes.concat(r.notes);
    save();
    var how = $('reveal').value, pinned = pinnedKeys(r.byName);
    if (how !== 'all') {
      // 固定の人は、はじめから出しておく（1 人ずつ出すのは、くじで決まった人だけ）
      reveal.order = C.revealOrder({ assign: r.assign, byName: r.byName }, g.layout, pp.people, how, seed).filter(function (k) { return !pinned[k]; });
      reveal.shown = 0;
    } else {
      reveal.anim = !reducedMotion();
    }
    renderResult();
    if (reveal.anim) shuffleAnimation(); else if (how === 'all') sound.chime();
    return true;
  }

  function hiddenMap() {
    if (!reveal.order.length) return null;
    var h = {};
    reveal.order.slice(reveal.shown).forEach(function (k) { h[k] = true; });
    return h;
  }
  function revealing() { return reveal.order.length > 0 && reveal.shown < reveal.order.length; }

  // 「全員いっせいに」: 1 秒ほど名前がくるくる入れかわってから止まる（動きを減らす設定の端末では出さない）。固定の人は動かさない
  function shuffleAnimation() {
    var by = boardByName(), pinned = pinnedKeys(by);
    var names = Object.keys(by).filter(function (n) { return !pinned[by[n]]; }), t0 = Date.now();
    if (!names.length) { reveal.anim = false; return; }
    var timer = setInterval(function () {
      [$('result-grid'), $('stage-grid')].forEach(function (box) {
        box.querySelectorAll('.seat.filled:not(.pinned) .nm').forEach(function (nm) { nm.textContent = names[Math.floor(Math.random() * names.length)]; });
      });
      sound.tick();
      if (Date.now() - t0 > 1100) {
        clearInterval(timer);
        reveal.anim = false;
        renderResult();
        sound.chime();
      }
    }, 90);
  }

  function revealNext() {
    if (!revealing()) return;
    reveal.shown++;
    sound.chime();
    renderResult();
    var k = reveal.order[reveal.shown - 1];
    [$('result-grid'), $('stage-grid')].forEach(function (box) {
      var c = box.querySelector('[data-key="' + k + '"]');
      if (c) c.classList.add('pop');
    });
  }
  function revealAll() {
    if (!revealing()) return;
    reveal.shown = reveal.order.length;
    sound.chime();
    renderResult();
  }

  /** 手で動かしたあと: 守れていない条件を知らせる（くじの結果が出ているときだけ） */
  function refreshWarn(render) {
    var g = group(), res = currentResult();
    ui.warn = '';
    if (res) {
      var viol = C.checkAssign({ layout: g.layout, people: currentPeople().people, cons: g.cons, prev: ui.prevIsSelf ? null : prevEntry() }, invert(boardByName()));
      ui.warn = viol.length ? U.swapWarn(viol.map(T.violation)) : '';
    }
    if (render !== false) renderResult();
  }
  /** 座席表の手の操作（calc.js の editBoard）。ピンは cons.pins、くじの結果は last.assign に書く */
  function applyEdit(op) {
    var g = group(), res = currentResult();
    // 決定（記録）したばかりの席を動かすときは、その記録を「前回」として比べない（全員が「前回と同じ席」になるため）
    var h0 = g.history[0];
    if (res && h0 && JSON.stringify(h0.assign) === JSON.stringify(g.last.assign)) ui.prevIsSelf = true;
    var s = C.editBoard(boardByName(), g.cons.pins, op);
    g.cons.pins = s.pins;
    g.cons = C.normalizeCons(g.cons);
    if (res) g.last.assign = s.board;
    save();
    refreshWarn(false);
    renderResult();
  }
  function doSwap(a, b) {
    var who = invert(boardByName()), na = who[a], nb = who[b];
    if (!na && !nb) return;
    applyEdit({ type: 'swap', a: a, b: b });
    boardMsg(nb ? U.swapped(na || U.emptySeat, nb) : U.moved(na, seatLabel(b)));
  }

  function onBoardSeat(key) {
    if (revealing()) { revealNext(); return; }
    if (Date.now() - drag.suppress < 400 && drag.suppressKeys.indexOf(key) >= 0) return;      // ドラッグで入れ替えた直後の、その席のクリック
    var who = invert(boardByName());
    if (ui.arm) {
      var n = ui.arm;
      ui.arm = null;
      applyEdit({ type: 'place', name: n, seat: key });
      boardMsg(U.placed(n, seatLabel(key)));
      focusSeat(key);
      return;
    }
    if (ui.swapFirst) {
      var first = ui.swapFirst;
      ui.swapFirst = null;
      if (first === key) { boardMsg(ui.swapOn ? U.swapHint : ''); renderResult(); focusSeat(key); return; }
      doSwap(first, key);
      if (ui.swapOn) $('board-msg').textContent += ' ' + U.swapHint;
      focusSeat(key);
      return;
    }
    if (ui.swapOn) {
      ui.swapFirst = key;
      boardMsg(who[key] ? U.swapPick(who[key]) : U.swapPickEmpty);
      renderResult();
      focusSeat(key);
      return;
    }
    openSeatDialog(key);
  }

  function renderResult() {
    var g = group(), res = currentResult(), people = currentPeople().people;
    var by = boardByName(), assign = invert(by), pinned = pinnedKeys(by), nPin = Object.keys(pinned).length, nOn = Object.keys(by).length;
    var st = $('status');
    st.textContent = '';
    st.classList.remove('error');
    if (lastSolveError) {
      st.classList.add('error');
      st.appendChild(el('strong', null, U.conflictTitle));
      st.appendChild(el('p', null, T.reason(lastSolveError.reason)));
      lastSolveError.notes.map(T.note).filter(Boolean).forEach(function (t) { st.appendChild(el('p', 'small', t)); });
    }

    // 席のない人（チップをタップしてから席をタップで置く）
    var rest = people.filter(function (p) { return !by[p.name]; });
    $('tray-wrap').hidden = !rest.length || revealing();
    $('tray-head').textContent = U.trayHead(rest.length);
    var tray = $('tray');
    tray.textContent = '';
    rest.forEach(function (p) {
      var b = el('button', 'chip', p.name);
      b.type = 'button';
      b.dataset.name = p.name;
      b.setAttribute('aria-pressed', ui.arm === p.name ? 'true' : 'false');
      b.addEventListener('click', function () {
        ui.arm = ui.arm === p.name ? null : p.name;
        ui.swapFirst = null;
        boardMsg(ui.arm ? U.armHint(p.name) : '');
        renderResult();
        var again = [].filter.call($('tray').children, function (c) { return c.dataset.name === p.name; })[0];
        if (again) again.focus();
      });
      tray.appendChild(b);
    });
    if (ui.arm && !rest.some(function (p) { return p.name === ui.arm; })) ui.arm = null;

    drawSeats($('result-grid'), {
      layout: g.layout, names: assign, hidden: hiddenMap(), pinned: pinned, selected: ui.swapFirst,
      onSeat: onBoardSeat, emptyText: res ? U.emptySeat : '',
    });
    $('result-grid').classList.toggle('swapping', ui.swapOn || !!ui.swapFirst);
    $('result-grid').classList.toggle('arming', !!ui.arm);
    $('reveal-ctrl').hidden = !revealing();
    $('reveal-count').textContent = revealing() ? U.reveal(reveal.shown, reveal.order.length) : '';

    var runText = nPin ? U.runRest : res ? U.runAgain : U.runFirst;
    $('run').textContent = runText;
    $('stage-run').textContent = runText;

    $('result-title').textContent = res ? (revealing() ? U.reveal(reveal.shown, reveal.order.length) : U.done(Object.keys(res.byName).length)) : nPin ? U.pinsOnly(nPin, rest.length) : '';
    $('seed-label').textContent = res ? U.seed(C.seedLabel(res.seed)) : '';
    $('result-actions').hidden = revealing() || !nOn;
    $('decide').hidden = !res;
    $('show-stage').hidden = !res;
    $('pins-clear').hidden = !nPin;
    $('swap').hidden = nOn < 1;
    var ul = $('notes'); ul.textContent = '';
    lastNotes.map(T.note).filter(Boolean).forEach(function (t) { ul.appendChild(el('li', null, t)); });
    if (ui.warn) ul.appendChild(el('li', 'warn', ui.warn));
    $('swap').setAttribute('aria-pressed', ui.swapOn ? 'true' : 'false');
    $('swap').textContent = ui.swapOn ? U.swapEnd : U.swapStart;
    $('result').hidden = !res && !nOn && !lastNotes.length;
    // 宴会のときだけ、決まった直後に次にすること（README「ツールを追加するとき」21。値は渡さない）
    $('next-step').hidden = !res || revealing() || C.normalizeLayout(g.layout).mode !== 'party';
    renderStage();
    renderPrint();
  }

  $('run').addEventListener('click', function () { sound.unlock(); runLottery(); });
  $('reveal-next').addEventListener('click', revealNext);
  $('reveal-all').addEventListener('click', revealAll);
  $('swap').addEventListener('click', function () {
    ui.swapOn = !ui.swapOn; ui.swapFirst = null; ui.arm = null;
    boardMsg(ui.swapOn ? U.swapHint : '');
    renderResult();
  });
  $('pins-clear').addEventListener('click', function () {
    if (!confirm(U.pinsClearConfirm)) return;
    var g = group(), by = boardByName();
    g.cons.pins = g.cons.pins.filter(function (f) { return by[f.p] !== f.seat; });     // 座席表に出ていない人（名簿にない人）のピンは残す
    save();
    boardMsg(U.pinsCleared);
    renderResult();
  });
  $('decide').addEventListener('click', function () {
    var g = group(), res = currentResult();
    if (!res) return;
    var by = boardByName(), missing = currentPeople().people.filter(function (p) { return !by[p.name]; });
    if (missing.length) { $('decide-msg').textContent = U.decideMissing(missing.length); return; }
    g.last.assign = by;
    var h0 = g.history[0];
    if (h0 && JSON.stringify(h0.assign) === JSON.stringify(by) && layoutSig(h0.layout) === layoutSig(g.layout)) {
      $('decide-msg').textContent = U.decideAgain;
      return;
    }
    var at = U.at(new Date());
    g.history = C.addHistory(g.history, { at: at, seed: res.seed, layout: g.layout, byName: by });
    save();
    $('decide-msg').textContent = U.decided(at);
    renderCons();
    renderHistory();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !$('stage').hidden || document.querySelector('dialog[open]')) return;
    if (ui.arm || ui.swapFirst || ui.swapOn) { ui.arm = null; ui.swapFirst = null; ui.swapOn = false; boardMsg(''); renderResult(); }
  });

  // --- ドラッグで入れ替える（マウスはそのまま、タッチは長押ししてから動かす。画面のスクロールと分けるため） ---
  var drag = { d: null, suppress: 0, suppressKeys: [] };
  (function dragAndDrop() {
    var grid = $('result-grid');
    function end() {
      var d = drag.d;
      if (!d) return;
      clearTimeout(d.timer);
      if (d.ghost) d.ghost.remove();
      d.cell.classList.remove('dragging');
      grid.querySelectorAll('.drop-target').forEach(function (c) { c.classList.remove('drop-target'); });
      document.body.classList.remove('dragging-seat');
      drag.d = null;
    }
    function move(x, y) {
      var d = drag.d;
      d.ghost.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      var t = document.elementFromPoint(x, y), cell = t && t.closest ? t.closest('#result-grid button.seat') : null;
      var key = cell && !cell.classList.contains('off') ? cell.dataset.key : null;
      if (key !== d.over) {
        grid.querySelectorAll('.drop-target').forEach(function (c) { c.classList.remove('drop-target'); });
        if (key && key !== d.key) cell.classList.add('drop-target');
        d.over = key;
      }
    }
    function start() {
      var d = drag.d;
      d.on = true;
      d.cell.classList.add('dragging');
      document.body.classList.add('dragging-seat');
      d.ghost = el('div', 'drag-ghost', d.name);
      d.ghost.setAttribute('aria-hidden', 'true');
      document.body.appendChild(d.ghost);
      move(d.x, d.y);
    }
    grid.addEventListener('pointerdown', function (e) {
      if (e.button > 0 || revealing() || reveal.anim) return;
      var cell = e.target.closest('button.seat.filled');
      if (!cell) return;
      end();
      var name = invert(boardByName())[cell.dataset.key];
      if (!name) return;
      drag.d = { key: cell.dataset.key, name: name, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse', on: false, timer: null, cell: cell, ghost: null, over: null };
      if (drag.d.touch) drag.d.timer = setTimeout(function () { if (drag.d && !drag.d.on) start(); }, 300);
    });
    // 動き始め: マウスは 8px 動いたらドラッグ開始。タッチは長押しの前に動いたらスクロールとみなしてやめる
    document.addEventListener('pointermove', function (e) {
      var d = drag.d;
      if (!d || e.pointerId !== d.id) return;
      if (!d.on) {
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 8) return;
        if (d.touch) { end(); return; }
        start();
      }
      move(e.clientX, e.clientY);
    });
    document.addEventListener('pointerup', function (e) {
      var d = drag.d;
      if (!d || e.pointerId !== d.id) return;
      if (!d.on) { end(); return; }
      var from = d.key, to = d.over;
      end();
      drag.suppress = Date.now();
      drag.suppressKeys = [from, to];
      if (to && to !== from) { doSwap(from, to); focusSeat(to); }
    });
    document.addEventListener('pointercancel', function (e) { if (drag.d && e.pointerId === drag.d.id) end(); });
    // 長押しでドラッグを始めたあとは、指の動きで画面がスクロールしないようにする
    grid.addEventListener('touchmove', function (e) { if (drag.d && drag.d.on && e.cancelable) e.preventDefault(); }, { passive: false });
    grid.addEventListener('contextmenu', function (e) { if (drag.d) e.preventDefault(); });
  })();

  // --- 名前の一覧（検索つきの listbox。席に置く人・組にする 2 人を選ぶ） ---
  function pickList(list, input, items, selected, onPick) {
    var q = input.value.trim().toLowerCase();
    list.textContent = '';
    list.removeAttribute('aria-activedescendant');
    var shown = items.filter(function (it) { return !q || it.name.toLowerCase().indexOf(q) >= 0; });
    shown.forEach(function (it, i) {
      var o = el('div', 'opt');
      o.id = list.id + '-o' + i;
      o.setAttribute('role', 'option');
      o.setAttribute('aria-selected', selected(it.name) ? 'true' : 'false');
      o.appendChild(el('span', 'opt-name', it.name));
      if (it.sub) { o.appendChild(el('span', 'opt-sub', it.sub)); o.setAttribute('aria-label', it.name + '、' + it.sub); }
      o.addEventListener('click', function () { onPick(it.name); });
      list.appendChild(o);
    });
    if (!shown.length) list.appendChild(el('p', 'opt-none', items.length ? U.pickNone : U.pickNoPeople));
  }
  function setActive(list, opt) {
    list.querySelectorAll('.opt.active').forEach(function (o) { o.classList.remove('active'); });
    if (!opt) { list.removeAttribute('aria-activedescendant'); return; }
    opt.classList.add('active');
    list.setAttribute('aria-activedescendant', opt.id);
    opt.scrollIntoView({ block: 'nearest' });
  }
  function listboxKeys(list, input) {
    list.addEventListener('keydown', function (e) {
      var opts = [].slice.call(list.querySelectorAll('[role="option"]'));
      if (!opts.length) return;
      var i = opts.indexOf(list.querySelector('.opt.active'));
      if (e.key === 'ArrowDown') i = Math.min(opts.length - 1, i + 1);
      else if (e.key === 'ArrowUp') { if (i <= 0) { e.preventDefault(); setActive(list, null); input.focus(); return; } i--; }
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = opts.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) opts[i].click(); return; }
      else return;
      e.preventDefault();
      setActive(list, opts[i]);
    });
    // タップ・クリックで入ったときは先頭を選ばない（一覧が先頭へスクロールして、タップした位置がずれるため）
    var byPointer = false;
    list.addEventListener('pointerdown', function () { byPointer = true; setTimeout(function () { byPointer = false; }, 600); });
    list.addEventListener('focus', function () {
      if (!byPointer && !list.querySelector('.opt.active')) setActive(list, list.querySelector('[role="option"]'));
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); list.focus(); setActive(list, list.querySelector('[role="option"]')); }
      else if (e.key === 'Enter') { e.preventDefault(); var first = list.querySelector('[role="option"]'); if (first) first.click(); }
    });
  }
  function coarse() { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } }
  function openDialog(d, focusEl) {
    if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
    if (focusEl) focusEl.focus();
  }
  function closeDialog(d) { if (d.close) d.close(); else d.removeAttribute('open'); }

  // --- 席をタップしたとき ---
  var seatDlg = { key: null };
  function peopleItems(by, pinned) {
    return currentPeople().people.map(function (p) {
      var k = by[p.name];
      return { name: p.name, sub: k ? U.seatNo(T.seatShort(C.seatPlace(group().layout, k))) + (pinned[k] ? U.pinnedMark : '') : U.noSeat };
    });
  }
  function renderSeatDialog() {
    var key = seatDlg.key, by = boardByName(), who = invert(by), pinned = pinnedKeys(by), name = who[key];
    $('seat-dlg-title').textContent = seatLabel(key);
    $('seat-dlg-now').textContent = name ? U.seatNow(name, !!pinned[key]) : U.seatNowEmpty;
    $('seat-dlg-acts').hidden = !name;
    $('seat-pin').textContent = pinned[key] ? U.unpin : U.pinHere;
    $('seat-pair').textContent = U.pairFor(name || '');
    pickList($('seat-list'), $('seat-q'), peopleItems(by, pinned), function (n) { return n === name; }, function (n) {
      var k = seatDlg.key;
      closeDialog($('seat-dlg'));
      applyEdit({ type: 'place', name: n, seat: k });
      boardMsg(U.placed(n, seatLabel(k)));
      focusSeat(k);
    });
  }
  function openSeatDialog(key) {
    seatDlg.key = key;
    $('seat-q').value = '';
    renderSeatDialog();
    var cell = $('result-grid').querySelector('[data-key="' + key + '"]');
    if (cell) cell.classList.add('selected');      // どの席を開いているか（閉じると描き直しで消える）
    openDialog($('seat-dlg'), coarse() ? $('seat-dlg-close') : $('seat-q'));
  }
  $('seat-q').addEventListener('input', renderSeatDialog);
  listboxKeys($('seat-list'), $('seat-q'));
  $('seat-dlg-close').addEventListener('click', function () { closeDialog($('seat-dlg')); });
  $('seat-dlg').addEventListener('close', function () {
    $('result-grid').querySelectorAll('.seat.selected').forEach(function (c) { if (c.dataset.key !== ui.swapFirst) c.classList.remove('selected'); });
    if (seatDlg.key && !document.querySelector('dialog[open]')) focusSeat(seatDlg.key);
  });
  $('seat-pin').addEventListener('click', function () {
    var key = seatDlg.key, by = boardByName(), name = invert(by)[key], was = !!pinnedKeys(by)[key];
    closeDialog($('seat-dlg'));
    if (!name) return;
    applyEdit({ type: was ? 'unpin' : 'pin', name: name });
    boardMsg(was ? U.unpinned(name) : U.pinned(name, seatLabel(key)));
    focusSeat(key);
  });
  $('seat-swap').addEventListener('click', function () {
    var key = seatDlg.key, name = invert(boardByName())[key];
    closeDialog($('seat-dlg'));
    ui.swapFirst = key; ui.arm = null;
    boardMsg(U.swapPick(name));
    renderResult();
    focusSeat(key);
  });
  $('seat-clear').addEventListener('click', function () {
    var key = seatDlg.key, name = invert(boardByName())[key];
    closeDialog($('seat-dlg'));
    applyEdit({ type: 'clear', seat: key });
    boardMsg(U.cleared(name));
    focusSeat(key);
  });
  $('seat-pair').addEventListener('click', function () {
    var name = invert(boardByName())[seatDlg.key];
    closeDialog($('seat-dlg'));
    openPairDialog(name);
  });

  // --- 組の条件（2 人を選んで「隣にしない」「隣にしたい」） ---
  var pairSel = [];
  function renderPairDialog() {
    var by = boardByName(), pinned = pinnedKeys(by);
    pickList($('pair-list-box'), $('pair-q'), peopleItems(by, pinned), function (n) { return pairSel.indexOf(n) >= 0; }, function (n) {
      var i = pairSel.indexOf(n);
      if (i >= 0) pairSel.splice(i, 1); else { pairSel.push(n); if (pairSel.length > 2) pairSel.shift(); }
      var active = $('pair-list-box').querySelector('.opt.active'), activeName = active ? active.querySelector('.opt-name').textContent : n;
      renderPairDialog();
      var again = [].filter.call($('pair-list-box').querySelectorAll('.opt'), function (o) { return o.querySelector('.opt-name').textContent === activeName; })[0];
      if (again && document.activeElement === $('pair-list-box')) setActive($('pair-list-box'), again);
    });
    var cur = null;
    if (pairSel.length === 2) {
      var k = C.pairKey(pairSel[0], pairSel[1]);
      group().cons.pairs.forEach(function (x) { if (C.pairKey(x.a, x.b) === k) cur = x.type; });
    }
    $('pair-dlg-sel').textContent = U.pairSel(pairSel, cur);
    $('pair-ng').disabled = $('pair-want').disabled = pairSel.length !== 2;
  }
  function openPairDialog(preset) {
    pairSel = preset ? [preset] : [];
    $('pair-q').value = '';
    renderPairDialog();
    openDialog($('pair-dlg'), coarse() ? $('pair-dlg-close') : $('pair-q'));
  }
  function addPair(type) {
    if (pairSel.length !== 2) return;
    var a = pairSel[0], b = pairSel[1];
    closeDialog($('pair-dlg'));
    setCons(function (c) { c.pairs.push({ a: a, b: b, type: type }); });
    refreshWarn();
    boardMsg(U.pairAdded(a, b, type));
    $('pair-add').focus();
  }
  $('pair-q').addEventListener('input', renderPairDialog);
  listboxKeys($('pair-list-box'), $('pair-q'));
  $('pair-add').addEventListener('click', function () { openPairDialog(null); });
  $('pair-ng').addEventListener('click', function () { addPair('ng'); });
  $('pair-want').addEventListener('click', function () { addPair('want'); });
  $('pair-dlg-close').addEventListener('click', function () { closeDialog($('pair-dlg')); });

  // --- 効果音（Web Audio。既定は鳴らさない） ---
  var sound = (function () {
    var ctx = null;
    function on() { return $('sound').checked; }
    function unlock() {
      if (!on() || ctx) return;
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
    }
    function beep(freq, dur, vol, delay) {
      if (!on()) return;
      unlock();
      if (!ctx) return;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      var t = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = freq;
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn); gn.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      unlock: unlock,
      tick: function () { beep(1400, 0.03, 0.05); },
      chime: function () { beep(880, 0.18, 0.12); beep(1320, 0.3, 0.1, 0.09); },
    };
  })();
  $('sound').addEventListener('change', function () { store.set('sound', this.checked); if (this.checked) sound.unlock(); renderStage(); });

  // --- 大画面（プロジェクター・テレビ）。要素の全画面表示なので、ページの広告は重ならない ---
  var stageOpener = null;
  function openStage(runNow, opener) {
    stageOpener = opener || null;
    $('stage').hidden = false;
    document.body.classList.add('stage-open');
    var st = $('stage');
    try {
      if (st.requestFullscreen) st.requestFullscreen().catch(function () {});
      else if (st.webkitRequestFullscreen) st.webkitRequestFullscreen();
    } catch (e) { /* 全画面にできない端末でも、画面いっぱいの表示で続ける */ }
    try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) { /* 横向きに固定できない端末 */ }
    sound.unlock();
    if (runNow) runLottery(); else renderStage();
    st.focus();     // スペースキー・Enter で「次の人」を出せるように、ボタンではなく画面にフォーカス
  }
  function closeStage() {
    $('stage').hidden = true;
    document.body.classList.remove('stage-open');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    if (stageOpener) stageOpener.focus();
  }
  function renderStage() {
    if ($('stage').hidden) return;
    var g = group(), res = currentResult(), by = boardByName();
    $('stage-title').textContent = (g.name || '') + (res ? '　' + U.seed(C.seedLabel(res.seed)) : '');
    $('stage-count').textContent = res && revealing() ? U.reveal(reveal.shown, reveal.order.length) : '';
    $('stage-next').hidden = $('stage-all').hidden = !(res && revealing());
    $('stage-run').hidden = !!(res && revealing());
    $('stage-sound').textContent = $('sound').checked ? U.soundOn : U.soundOff;
    $('stage-sound').setAttribute('aria-pressed', $('sound').checked ? 'true' : 'false');
    var msg = !res && lastSolveError ? T.reason(lastSolveError.reason) : '';
    $('stage-msg').textContent = msg || (window.innerHeight > window.innerWidth ? U.rotateHint : '');
    $('stage-msg').classList.toggle('error', !!msg);
    drawSeats($('stage-grid'), { layout: g.layout, names: invert(by), hidden: res ? hiddenMap() : null, pinned: pinnedKeys(by), emptyText: res ? U.emptySeat : '', onSeat: function () { revealNext(); } });
    fitStage();
  }
  // 大画面の名前の大きさ: 席の大きさと名前の長さから決める
  function fitStage() {
    $('stage-grid').querySelectorAll('.seat').forEach(function (c) {
      var nm = c.querySelector('.nm');
      if (!nm) return;
      var w = c.clientWidth, h = c.clientHeight, len = c.classList.contains('empty') ? 5 : Math.max(2, nm.textContent.length);
      nm.style.fontSize = Math.max(10, Math.min(w * 0.88 / len, h * 0.42, 110)) + 'px';
    });
  }
  $('run-stage').addEventListener('click', function () { sound.unlock(); openStage(true, this); });
  // 発表のしかた（折りたたみの見出しに今の設定を出す）
  function renderRevealSummary() { $('reveal-summary').textContent = U.revealSum($('reveal').options[$('reveal').selectedIndex].text, $('sound').checked); }
  $('show-stage').addEventListener('click', function () { openStage(false, this); });
  $('stage-run').addEventListener('click', function () { sound.unlock(); runLottery(); });
  $('stage-next').addEventListener('click', revealNext);
  $('stage-all').addEventListener('click', revealAll);
  $('stage-close').addEventListener('click', closeStage);
  $('stage-sound').addEventListener('click', function () { $('sound').checked = !$('sound').checked; store.set('sound', $('sound').checked); sound.unlock(); renderStage(); });
  document.addEventListener('keydown', function (e) {
    if ($('stage').hidden) return;
    if (e.key === 'Escape') { closeStage(); return; }
    if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') && e.target.tagName !== 'BUTTON') { e.preventDefault(); revealNext(); }
  });
  document.addEventListener('fullscreenchange', function () { if (!$('stage').hidden) setTimeout(fitStage, 60); });
  addEventListener('resize', function () { if (!$('stage').hidden) renderStage(); });

  // ---------------------------------------------------------------
  // 5. 印刷（A4 横）。#print-area はいつも最新にしておく（ブラウザのメニューから印刷しても白紙にならない）
  // ---------------------------------------------------------------
  function renderPrint() {
    var g = group(), res = currentResult(), L = C.normalizeLayout(g.layout), by = boardByName();
    var area = $('print-area');
    area.textContent = '';
    var kind = $('print-kind').value;
    var title = $('print-title').value.trim() || ((g.name ? g.name + ' ' : '') + U.printTitleDefault);
    var credit = $('print-credit').checked;
    function footer(sheet) { if (credit) sheet.appendChild(el('div', 'p-credit', U.credit)); }
    if (kind === 'slips') {
      var seats = C.buildSeats(L), per = 40;
      for (var i = 0; i < seats.length; i += per) {
        var sheet = el('div', 'sheet slips');
        var grid = el('div', 'slip-grid');
        seats.slice(i, i + per).forEach(function (s) {
          var place = C.seatPlace(L, s.key), slip = el('div', 'slip');
          slip.appendChild(el('span', 'slip-no', T.seatShort(place)));
          slip.appendChild(el('span', 'slip-sub', T.seatWhere(place)));
          grid.appendChild(slip);
        });
        sheet.appendChild(grid);
        footer(sheet);
        area.appendChild(sheet);
      }
      return;
    }
    var sh = el('div', 'sheet chart');
    var head = el('div', 'p-head');
    head.appendChild(el('h1', null, title));
    head.appendChild(el('span', null, U.printDate(new Date())));
    sh.appendChild(head);
    var body = el('div', 'p-body seat-grid print');
    // 決める前は席の番号だけ（固定した人がいれば、その名前も）。決めたあとは全員
    drawSeats(body, { layout: L, names: res || Object.keys(by).length ? invert(by) : null, emptyText: res ? U.emptySeat : '' });
    sh.appendChild(body);
    footer(sh);
    area.appendChild(sh);
    // 名前の大きさ（mm）: 席の幅・高さと名前の長さから
    var cw = L.mode === 'class' ? 265 / L.cls.cols : 29;
    var ch = L.mode === 'class' ? 150 / L.cls.rows : 16;
    body.querySelectorAll('.seat .nm').forEach(function (nm) {
      var len = nm.parentNode.classList.contains('empty') ? 5 : Math.max(2, nm.textContent.length);
      nm.style.fontSize = Math.max(2.6, Math.min(cw * 0.85 / len, ch * 0.42, 12)).toFixed(2) + 'mm';
    });
  }
  function savePrintPrefs() {
    var pr = store.get('print', {}) || {};
    var titles = pr.titles && typeof pr.titles === 'object' ? pr.titles : {};
    if (!sharedGroup) titles[group().id] = $('print-title').value.slice(0, 40);
    store.set('print', { kind: $('print-kind').value, credit: $('print-credit').checked, titles: titles });
  }
  $('print-kind').addEventListener('change', function () { savePrintPrefs(); renderPrint(); });
  $('print-credit').addEventListener('change', function () { savePrintPrefs(); renderPrint(); });
  $('print-title').addEventListener('input', function () { savePrintPrefs(); renderPrint(); });
  function doPrint() { renderPrint(); window.print(); }
  $('print').addEventListener('click', function () { $('print-kind').value = 'chart'; savePrintPrefs(); doPrint(); });
  $('print2').addEventListener('click', doPrint);
  addEventListener('beforeprint', renderPrint);

  // ---------------------------------------------------------------
  // 6. 記録・共有・バックアップ
  // ---------------------------------------------------------------
  function renderHistory() {
    var g = group(), ol = $('history');
    ol.textContent = '';
    if (!g.history.length) { ol.appendChild(el('li', 'small', U.historyNone)); return; }
    g.history.forEach(function (h, i) {
      var li = el('li');
      li.appendChild(el('span', null, U.historyItem(h.at, Object.keys(h.assign).length) + (i === 0 ? U.historyPrevMark : '')));
      if (i > 0) {
        var use = el('button', 'btn btn-sub btn-s', U.historyUse);
        use.type = 'button';
        use.addEventListener('click', function () {
          g.history.splice(i, 1); g.history.unshift(h);
          save(); renderHistory(); renderCons();
        });
        li.appendChild(use);
      }
      var del = el('button', 'btn btn-sub btn-s', U.del);
      del.type = 'button';
      del.setAttribute('aria-label', U.historyDelLabel(h.at));
      del.addEventListener('click', function () {
        if (!confirm(U.historyDeleteConfirm)) return;
        g.history.splice(i, 1);
        save(); renderHistory(); renderCons();
      });
      li.appendChild(del);
      ol.appendChild(li);
    });
  }

  $('share').addEventListener('click', function () {
    var g = group(), res = currentResult(), withNames = $('share-names').checked;
    if (withNames && !g.numbers && !confirm(U.shareNamesConfirm)) return;
    var hash = C.encodeShare({
      layout: g.layout, seed: res ? res.seed : 0, numbers: g.numbers, count: g.count,
      people: currentPeople().people, cons: g.cons, result: res ? res.byName : null,
    }, withNames);
    var url = location.href.split('#')[0] + '#s=' + hash;
    var out = $('share-url'), msg = $('share-msg');
    out.hidden = false;
    out.value = url;
    var tail = url.length > 4000 ? ' ' + U.shareTooLong(url.length) : '';
    msg.textContent = tail;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { msg.textContent = U.shareCopied + tail; },
        function () { msg.textContent = U.shareCopyFail + tail; out.select(); });
    } else { msg.textContent = U.shareCopyFail + tail; out.select(); }
  });

  // 保存しているもの（store の 'data'）と同じ形を書き出す（README「ツールを追加するとき」20）
  $('backup-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(C.buildBackup(TOOL, { data: data }), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = C.backupFileName(TOOL);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    $('backup-msg').textContent = U.backupDone;
  });
  $('backup-import').addEventListener('click', function () { $('backup-file').click(); });
  $('backup-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { $('backup-msg').textContent = U.backupTooBig; return; }
    file.text().then(function (text) {
      var r = C.parseBackup(text, TOOL, ['data']);
      if (!r.ok) { $('backup-msg').textContent = T.backup(r); return; }
      var d = C.normalizeData(r.data.data);
      if (!d.groups.length) { $('backup-msg').textContent = T.backup({ code: 'missing' }); return; }
      if (!confirm(U.backupConfirm)) return;
      data = d;
      sharedGroup = null;
      $('shared-banner').hidden = true;
      save();
      resetView();
      renderAll();
      $('backup-msg').textContent = U.backupLoaded(d.groups.length);
    }, function () { $('backup-msg').textContent = U.backupReadFail; });
  });

  // ---------------------------------------------------------------
  // 共有リンクで開いたとき（GROWTH 2 章: 受け取った画面に「自分のを新しく作る」とできることの 1 行）
  // ---------------------------------------------------------------
  function openShared() {
    if (!/^#s=/.test(location.hash)) return;
    var s = C.decodeShare(location.hash);
    $('shared-banner').hidden = false;
    if (!s) { $('shared-msg').textContent = U.sharedBroken; $('shared-save').hidden = true; return; }
    var g = C.newGroup(newId(), U.sharedGroupName);
    g.layout = s.layout;
    g.numbers = s.numbers;
    if (s.numbers) g.count = s.count;
    if (s.people) g.names = C.peopleToText(s.people);
    if (s.cons) g.cons = s.cons;
    if (s.result) g.last = { at: '', seed: s.seed, layout: s.layout, assign: s.result };
    sharedGroup = C.normalizeGroup(g);
    $('shared-msg').textContent = s.people || s.numbers ? U.sharedWithNames : U.sharedNoNames;
  }
  $('shared-save').addEventListener('click', function () {
    if (!sharedGroup) return;
    if (data.groups.length >= C.LIMITS.groups) { alert(U.groupLimit); return; }
    data.groups.push(sharedGroup);
    data.current = sharedGroup.id;
    sharedGroup = null;
    save();
    history.replaceState(null, '', location.pathname + location.search);
    $('shared-banner').hidden = true;
    renderAll();
    $('status').textContent = U.sharedSaved;
  });

  function renderAll() {
    renderGroups();
    renderLayout();
    renderPeople();
    var pr = store.get('print', {}) || {};
    $('print-title').value = !sharedGroup && pr.titles && typeof pr.titles[group().id] === 'string' ? pr.titles[group().id].slice(0, 40) : '';
    renderCons();
    renderResult();
    renderHistory();
  }

  // 起動
  (function init() {
    var pr = store.get('print', {}) || {};
    if (pr.kind === 'chart' || pr.kind === 'slips') $('print-kind').value = pr.kind;
    if (pr.credit === false) $('print-credit').checked = false;
    $('sound').checked = store.get('sound', false) === true;
    var rv = store.get('reveal', 'all');
    if (['all', 'random', 'back', 'front', 'list'].indexOf(rv) >= 0) $('reveal').value = rv;
    $('reveal').addEventListener('change', function () { store.set('reveal', this.value); renderRevealSummary(); });
    $('sound').addEventListener('change', renderRevealSummary);
    renderRevealSummary();
    openShared();
    renderAll();
    addEventListener('hashchange', function () { if (/^#s=/.test(location.hash)) location.reload(); });
  })();
})();
