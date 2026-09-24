// 置いてから、残りをくじ（ピン・隣にしたい組・手の操作・古いデータの読み込み）のテスト: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../calc.js');
const TEXT = require('../text.js');

function names(n, withGender) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push('生徒' + i + (withGender ? (i % 2 ? ',男' : ',女') : ''));
  return C.parsePeople(out.join('\n')).people;
}
const CLASS40 = { mode: 'class', cls: { cols: 8, rows: 5, pairs: true, desk: 'top', off: [] } };
function near(layout, scope, a, b) { return C.neighbors(layout, scope)[a].includes(b); }

// ---------------------------------------------------------------
// ピン（置いた人）は、何度くじを引いても動かない
// ---------------------------------------------------------------
test('ピン: 5 人を置いて残りをくじ × 300 seed。ピンの人はいつも同じ席、ほかの条件も守る', () => {
  const people = names(40, true);
  const pins = [
    { p: '生徒1', seat: '0-0' }, { p: '生徒2', seat: '0-1' }, { p: '生徒8', seat: '2-4' },
    { p: '生徒15', seat: '4-7' }, { p: '生徒20', seat: '3-2' },
  ];
  const cons = {
    pins,
    zone: [{ p: '生徒3', where: 'front', n: 2 }],
    pairs: [{ a: '生徒6', b: '生徒7', type: 'ng' }, { a: '生徒9', b: '生徒10', type: 'want' }, { a: '生徒11', b: '生徒12', type: 'want' }],
    ngScope: 'cross', gender: true, avoidSeat: true, avoidNeighbor: true,
  };
  const first = C.solve({ layout: CLASS40, people, cons: { gender: true }, seed: 1 });
  const prev = { layout: CLASS40, assign: first.byName };
  const others = new Set();
  for (let seed = 0; seed < 300; seed++) {
    const input = { layout: CLASS40, people, cons, prev, seed };
    const r = C.solve(input);
    assert.ok(r.ok, 'seed ' + seed + ' ' + JSON.stringify(r.reason));
    for (const f of pins) assert.equal(r.byName[f.p], f.seat, 'seed ' + seed + ' ' + f.p);
    assert.deepEqual(C.checkAssign(input, r.assign), [], 'seed ' + seed);
    others.add(r.byName['生徒30']);
  }
  assert.ok(others.size > 10, '残りの人はくじで動く');
});

test('ピン 0 人なら、これまでと同じ席順（旧版の 200 seed × 3 通りの指紋と一致）', () => {
  // 指紋は変更前の calc.js（origin/main 32db2ce）で同じ入力から作ったもの
  const CL = CLASS40;
  const cases = [
    ['bde29c90fda8ae45', { layout: CL, people: names(38), cons: {} }],
    ['99b39d0f3963dabb', { layout: CL, people: names(40, true), cons: { zone: [{ p: '生徒3', where: 'front', n: 1 }], ng: [['生徒6', '生徒7'], ['生徒11', '生徒12']], ngScope: 'around', gender: true } }],
    ['43a6bd161bee9454', { layout: { mode: 'party', party: { tables: [{ name: 'A', seats: 8 }, { name: 'B', seats: 8 }, { name: 'C', seats: 6 }] } }, people: names(19), cons: { ng: [['生徒1', '生徒2']], ngScope: 'table' } }],
  ];
  for (const [want, inp] of cases) {
    const h = crypto.createHash('sha256');
    for (let seed = 0; seed < 200; seed++) {
      const r = C.solve(Object.assign({}, inp, { seed }));
      h.update(JSON.stringify(r.ok ? r.assign : r.reason));
    }
    assert.equal(h.digest('hex').slice(0, 16), want);
  }
});

test('ピン 0 人・条件なしのとき、席の分布に偏りがない（4 人 × 4 席 × 4,000 回）', () => {
  const layout = { mode: 'class', cls: { cols: 4, rows: 1, pairs: false } };
  const count = {};
  for (let seed = 0; seed < 4000; seed++) {
    const r = C.solve({ layout, people: names(4), cons: { pins: [], pairs: [] }, seed });
    count[r.byName['生徒2']] = (count[r.byName['生徒2']] || 0) + 1;
  }
  for (const k of ['0-0', '0-1', '0-2', '0-3']) assert.ok(count[k] > 850 && count[k] < 1150, k + ' ' + count[k]);
});

test('ピンの人がいても、残りの人の席は偏らない（1 席をピン、残り 3 席に 3 人 × 3,000 回）', () => {
  const layout = { mode: 'class', cls: { cols: 4, rows: 1, pairs: false } };
  const count = {};
  for (let seed = 0; seed < 3000; seed++) {
    const r = C.solve({ layout, people: names(4), cons: { pins: [{ p: '生徒4', seat: '0-2' }] }, seed });
    assert.equal(r.byName['生徒4'], '0-2');
    count[r.byName['生徒1']] = (count[r.byName['生徒1']] || 0) + 1;
  }
  assert.equal(count['0-2'], undefined);
  for (const k of ['0-0', '0-1', '0-3']) assert.ok(count[k] > 850 && count[k] < 1150, k + ' ' + count[k]);
});

// ---------------------------------------------------------------
// 隣にしたい組
// ---------------------------------------------------------------
test('隣にしたい組: 教室（2 人机・どの範囲でも）と宴会で、いつも隣になる（性質のテスト）', () => {
  const setups = [
    { layout: CLASS40, scope: 'side', n: 36 },
    { layout: CLASS40, scope: 'cross', n: 40 },
    { layout: { mode: 'class', cls: { cols: 6, rows: 6, pairs: false, off: ['0-5', '5-0'] } }, scope: 'around', n: 30 },
    { layout: { mode: 'party', party: { tables: [{ name: 'A', seats: 6 }, { name: 'B', seats: 6 }, { name: 'C', seats: 6 }] } }, scope: 'side', n: 17 },
    { layout: { mode: 'party', party: { tables: [{ name: 'A', seats: 6 }, { name: 'B', seats: 6 }, { name: 'C', seats: 6 }] } }, scope: 'table', n: 18 },
  ];
  for (const st of setups) {
    const people = names(st.n);
    const pairs = [['生徒1', '生徒2'], ['生徒3', '生徒4'], ['生徒5', '生徒6'], ['生徒7', '生徒8']].map(([a, b]) => ({ a, b, type: 'want' }));
    pairs.push({ a: '生徒1', b: '生徒3', type: 'ng' });
    for (let seed = 0; seed < 150; seed++) {
      const input = { layout: st.layout, people, cons: { pairs, ngScope: st.scope }, seed };
      const r = C.solve(input);
      assert.ok(r.ok, st.scope + ' seed ' + seed + ' ' + JSON.stringify(r.reason));
      for (const p of pairs) {
        const isNear = near(st.layout, st.scope, r.byName[p.a], r.byName[p.b]);
        assert.equal(isNear, p.type === 'want', st.scope + ' seed ' + seed + ' ' + p.a + '-' + p.b);
      }
      assert.deepEqual(C.checkAssign(input, r.assign), []);
    }
  }
});

test('隣にしたい組: ピンの人の隣に座る。男女交互・前回を避けると一緒でも守る', () => {
  const people = names(30, true);
  const layout = { mode: 'class', cls: { cols: 6, rows: 5, pairs: true } };
  const first = C.solve({ layout, people, cons: {}, seed: 3 });
  const cons = {
    pins: [{ p: '生徒1', seat: '2-2' }],
    pairs: [{ a: '生徒1', b: '生徒2', type: 'want' }, { a: '生徒5', b: '生徒10', type: 'want' }],
    ngScope: 'side', gender: true, avoidSeat: true, avoidNeighbor: true,
  };
  for (let seed = 0; seed < 200; seed++) {
    const input = { layout, people, cons, prev: { layout, assign: first.byName }, seed };
    const r = C.solve(input);
    if (!r.ok) {   // 前回ととなりだった組なら決まらないことがある。そのときは理由がある
      assert.ok(TEXT.reason(r.reason).length > 10);
      continue;
    }
    assert.equal(r.byName['生徒1'], '2-2');
    assert.equal(r.byName['生徒2'], '2-3');                      // 2 人机で 2-2 のとなりは 2-3 だけ
    assert.deepEqual(C.checkAssign(input, r.assign), []);
  }
});

test('隣にしたい組が決められない: 2 人ともピンで隣でない／相手が隣の席の数より多い', () => {
  const people = C.parsePeople('A\nB\nC\nD').people;
  const layout = { mode: 'class', cls: { cols: 4, rows: 2, pairs: true } };
  let r = C.solve({ layout, people, cons: { pins: [{ p: 'A', seat: '0-0' }, { p: 'B', seat: '1-3' }], pairs: [{ a: 'A', b: 'B', type: 'want' }] }, seed: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reason, { code: 'wantFixed', a: 'A', b: 'B' });
  assert.match(TEXT.reason(r.reason), /「A」と「B」は隣にしたい組.*隣ではありません/);

  r = C.solve({ layout, people, cons: { pairs: [{ a: 'A', b: 'B', type: 'want' }, { a: 'A', b: 'C', type: 'want' }], ngScope: 'side' }, seed: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reason, { code: 'wantMany', name: 'A', count: 2, max: 1 });
  assert.match(TEXT.reason(r.reason), /「A」の隣にしたい相手が 2 人.*多くて 1 席/);
});

test('隣にしたい組が決められない: 外せば決まる組を名指しする', () => {
  // 2 人机 2 列 × 2 行。A と C を同じ机にピン → A の隣は C だけなので、「A と B を隣にしたい」は守れない
  const people = C.parsePeople('A\nB\nC\nD\nE\nF').people;
  const layout = { mode: 'class', cls: { cols: 4, rows: 2, pairs: true } };
  const cons = { pins: [{ p: 'A', seat: '0-0' }, { p: 'C', seat: '0-1' }], pairs: [{ a: 'D', b: 'E', type: 'want' }, { a: 'A', b: 'B', type: 'want' }], ngScope: 'side' };
  const r = C.solve({ layout, people, cons, seed: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reason, { code: 'conflict', cat: 'want', others: [], pair: ['A', 'B'] });
  assert.match(TEXT.reason(r.reason), /「A」と「B」を隣にしたい組を外すと決まります/);
  // 名指しした組を外すと本当に決まる
  const ok = C.solve({ layout, people, cons: Object.assign({}, cons, { pairs: [cons.pairs[0]] }), seed: 1 });
  assert.ok(ok.ok);
});

test('隣にしたい組が決められない: ほかの条件とぶつかると、外せば決まる条件を名指しする', () => {
  // 1 列 3 席（2 人机なし）。A は前回まん中で「前回と同じ席を避ける」、B・C は A の隣にしたい → A はまん中しか無理
  const layout = { mode: 'class', cls: { cols: 3, rows: 1, pairs: false } };
  const people = C.parsePeople('A\nB\nC').people;
  const cons = { avoidSeat: true, avoidNeighbor: false, pairs: [{ a: 'A', b: 'B', type: 'want' }, { a: 'A', b: 'C', type: 'want' }], ngScope: 'side' };
  const r = C.solve({ layout, people, cons, prev: { layout, assign: { B: '0-0', A: '0-1', C: '0-2' } }, seed: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason.code, 'conflict');
  assert.equal(r.reason.cat, 'avoidSeat');
  assert.match(TEXT.reason(r.reason), /「前回と同じ席を避ける」を外すと決まります/);
});

test('手で動かしたあとの確かめ: 隣にしたい組が離れると知らせる', () => {
  const layout = { mode: 'class', cls: { cols: 2, rows: 2, pairs: true } };
  const people = C.parsePeople('A\nB\nC\nD').people;
  const input = { layout, people, cons: { pairs: [{ a: 'A', b: 'B', type: 'want' }], ngScope: 'side' } };
  assert.deepEqual(C.checkAssign(input, { '0-0': 'A', '0-1': 'B', '1-0': 'C', '1-1': 'D' }), []);
  const v = C.checkAssign(input, { '0-0': 'A', '0-1': 'C', '1-0': 'B', '1-1': 'D' });
  assert.deepEqual(v, [{ code: 'vWant', a: 'A', b: 'B' }]);
  assert.match(TEXT.violation(v[0]), /隣ではありません/);
});

// ---------------------------------------------------------------
// 座席表での手の操作（置く・入れ替える・外す・空ける）
// ---------------------------------------------------------------
test('置く: 席をタップして人を選ぶとピン。席にいた人は置いた人の元の席へ（元の席がなければ席なし）', () => {
  let s = C.editBoard({}, [], { type: 'place', name: 'A', seat: '0-0' });
  assert.deepEqual(s, { board: { A: '0-0' }, pins: [{ p: 'A', seat: '0-0' }] });
  // くじのあと: B が 0-1、C が 0-2
  s = C.editBoard({ A: '0-0', B: '0-1', C: '0-2' }, s.pins, { type: 'place', name: 'C', seat: '0-1' });
  assert.deepEqual(s.board, { A: '0-0', B: '0-2', C: '0-1' });
  assert.deepEqual(s.pins, [{ p: 'A', seat: '0-0' }, { p: 'C', seat: '0-1' }]);
  // 席のない D を A の席に置くと、A は席なし（ピンも外れる）
  s = C.editBoard(s.board, s.pins, { type: 'place', name: 'D', seat: '0-0' });
  assert.deepEqual(s.board, { B: '0-2', C: '0-1', D: '0-0' });
  assert.deepEqual(s.pins, [{ p: 'C', seat: '0-1' }, { p: 'D', seat: '0-0' }]);
});

test('入れ替え: ピンの人はピンのまま新しい席へ。ピンでない人はピンにならない。空席へは移すだけ', () => {
  const board = { A: '0-0', B: '0-1', C: '1-0', D: '1-1' };
  const pins = [{ p: 'A', seat: '0-0' }, { p: 'B', seat: '0-1' }];
  let s = C.editBoard(board, pins, { type: 'swap', a: '0-0', b: '0-1' });        // ピンどうし
  assert.deepEqual(s.board, { A: '0-1', B: '0-0', C: '1-0', D: '1-1' });
  assert.deepEqual(s.pins, [{ p: 'A', seat: '0-1' }, { p: 'B', seat: '0-0' }]);
  s = C.editBoard(s.board, s.pins, { type: 'swap', a: '0-1', b: '1-1' });        // ピンとピンでない人
  assert.deepEqual(s.board, { A: '1-1', B: '0-0', C: '1-0', D: '0-1' });
  assert.deepEqual(s.pins, [{ p: 'A', seat: '1-1' }, { p: 'B', seat: '0-0' }]);
  s = C.editBoard(s.board, s.pins, { type: 'swap', a: '1-1', b: '2-0' });        // 空席へ
  assert.deepEqual(s.board, { A: '2-0', B: '0-0', C: '1-0', D: '0-1' });
  assert.deepEqual(s.pins, [{ p: 'A', seat: '2-0' }, { p: 'B', seat: '0-0' }]);
  // 渡したものは変えない
  assert.deepEqual(board, { A: '0-0', B: '0-1', C: '1-0', D: '1-1' });
  // 入れ替えたあとでくじを引き直しても、ピンの人は入れ替えた先の席のまま
  const people = C.parsePeople('A\nB\nC\nD\nE').people;
  const layout = { mode: 'class', cls: { cols: 3, rows: 3, pairs: false } };
  for (let seed = 0; seed < 50; seed++) {
    const r = C.solve({ layout, people, cons: { pins: s.pins }, seed });
    assert.equal(r.byName.A, '2-0');
    assert.equal(r.byName.B, '0-0');
  }
});

test('ピンを外す・付ける・席を空ける', () => {
  const board = { A: '0-0', B: '0-1' };
  let s = C.editBoard(board, [{ p: 'A', seat: '0-0' }], { type: 'unpin', name: 'A' });
  assert.deepEqual(s, { board, pins: [] });
  s = C.editBoard(board, [], { type: 'pin', name: 'B' });
  assert.deepEqual(s.pins, [{ p: 'B', seat: '0-1' }]);
  s = C.editBoard(board, [{ p: 'A', seat: '0-0' }], { type: 'clear', seat: '0-0' });
  assert.deepEqual(s, { board: { B: '0-1' }, pins: [] });
  // 名簿にいない人のピン（座席表に出ていない）は残る。同じ席に人を置いたら外れる
  s = C.editBoard({}, [{ p: '転校した人', seat: '0-0' }], { type: 'place', name: 'A', seat: '0-1' });
  assert.deepEqual(s.pins, [{ p: 'A', seat: '0-1' }, { p: '転校した人', seat: '0-0' }]);
  s = C.editBoard(s.board, s.pins, { type: 'place', name: 'B', seat: '0-0' });
  assert.deepEqual(s.pins, [{ p: 'A', seat: '0-1' }, { p: 'B', seat: '0-0' }]);
});

// ---------------------------------------------------------------
// 古いデータ（固定席の行・隣にしない組の行）を読み込む
// ---------------------------------------------------------------
test('移行: 保存データの fixed はピンに、ng は「隣にしない」組になる。重ねて読んでも変わらない', () => {
  const old = {
    current: 'g1',
    groups: [{
      id: 'g1', name: '3年2組', layout: CLASS40, numbers: false, count: 30, names: '青木,男\n井上,女\n上田\n江藤',
      cons: { fixed: [{ p: '青木', seat: '0-0' }, { p: '上田', seat: 'bad' }], zone: [], ng: [['井上', '上田'], ['上田', '井上'], ['江藤', '江藤']], ngScope: 'side', avoidSeat: true, avoidNeighbor: false, gender: true, emptyBack: true },
      history: [], last: null,
    }],
  };
  const d = C.normalizeData(old);
  const cons = d.groups[0].cons;
  assert.deepEqual(cons.pins, [{ p: '青木', seat: '0-0' }]);
  assert.deepEqual(cons.pairs, [{ a: '井上', b: '上田', type: 'ng' }]);
  assert.equal(cons.fixed, undefined);
  assert.equal(cons.ng, undefined);
  assert.equal(cons.ngScope, 'side');
  assert.equal(cons.gender, true);
  assert.deepEqual(C.normalizeData(JSON.parse(JSON.stringify(d))), d);
  // 移したあとも、同じ条件として席が決まる
  const people = C.parsePeople(d.groups[0].names).people;
  const r = C.solve({ layout: CLASS40, people, cons, seed: 4 });
  assert.equal(r.byName['青木'], '0-0');
});

test('移行: 古い形のまま solve に渡しても、同じ席順になる', () => {
  const people = names(20);
  const oldCons = { fixed: [{ p: '生徒1', seat: '0-0' }], ng: [['生徒2', '生徒3']], ngScope: 'around' };
  const newCons = { pins: [{ p: '生徒1', seat: '0-0' }], pairs: [{ a: '生徒2', b: '生徒3', type: 'ng' }], ngScope: 'around' };
  for (let seed = 0; seed < 30; seed++) {
    assert.deepEqual(C.solve({ layout: CLASS40, people, cons: oldCons, seed }).assign, C.solve({ layout: CLASS40, people, cons: newCons, seed }).assign);
  }
});

test('移行: 古い共有リンク（fixed・ng の形）を開くと、ピンと組になる', () => {
  // 変更前の encodeShare が作った形そのもの
  const oldLink = { v: 1, l: C.normalizeLayout(CLASS40), s: 42, p: [['青木', 'M'], ['井上', 'F'], ['上田']],
    c: { fixed: [{ p: '青木', seat: '0-0' }], zone: [], ng: [['井上', '上田']], ngScope: 'cross', avoidSeat: true, avoidNeighbor: true, gender: false, emptyBack: true },
    r: ['0-0', '0-1', '1-0'] };
  const s = C.decodeShare('#s=' + Buffer.from(JSON.stringify(oldLink)).toString('base64url'));
  assert.deepEqual(s.cons.pins, [{ p: '青木', seat: '0-0' }]);
  assert.deepEqual(s.cons.pairs, [{ a: '井上', b: '上田', type: 'ng' }]);
  assert.deepEqual(s.result, { 青木: '0-0', 井上: '0-1', 上田: '1-0' });
  assert.equal(s.seed, 42);
});

test('共有リンク: ピンと組（隣にしたいも）は、名前を入れるときだけ入る', () => {
  const people = C.parsePeople('青木\n井上\n上田').people;
  const cons = C.normalizeCons({ pins: [{ p: '青木', seat: '0-0' }], pairs: [{ a: '井上', b: '上田', type: 'want' }] });
  const without = C.encodeShare({ layout: CLASS40, seed: 1, numbers: false, people, cons }, false);
  const raw = Buffer.from(without, 'base64url').toString('utf8');
  assert.ok(!raw.includes('青木') && !raw.includes('井上') && !raw.includes('"pins"') && !raw.includes('"c"') && !raw.includes('want'));
  assert.equal(C.decodeShare('#s=' + without).cons, null);
  const withNames = C.decodeShare('#s=' + C.encodeShare({ layout: CLASS40, seed: 1, numbers: false, people, cons }, true));
  assert.deepEqual(withNames.cons, cons);
});

test('組の正規化: 同じ 2 人は 1 組（後に入れた種類）、自分どうし・知らない種類は落とす', () => {
  const c = C.normalizeCons({ pairs: [{ a: 'A', b: 'B', type: 'ng' }, { a: 'B', b: 'A', type: 'want' }, { a: 'C', b: 'C', type: 'ng' }, { a: 'C', b: 'D', type: 'like' }, null, 'x'] });
  assert.deepEqual(c.pairs, [{ a: 'A', b: 'B', type: 'want' }]);
  assert.equal(C.pairKey('B', 'A'), C.pairKey('A', 'B'));
});

test('新しい理由・お知らせにも文がある', () => {
  for (const r of [{ code: 'wantFixed', a: 'x', b: 'y' }, { code: 'wantMany', name: 'x', count: 3, max: 2 },
    { code: 'conflict', cat: 'want', others: [] }, { code: 'conflict', cat: 'want', others: ['gender'] },
    { code: 'conflict', cat: 'ng', others: [], pair: ['x', 'y'] }]) {
    assert.ok(TEXT.reason(r).length > 10, r.code);
  }
  assert.match(TEXT.reason({ code: 'conflict', cat: 'ng', others: [], pair: ['x', 'y'] }), /「x」と「y」を隣にしない組を外すと決まります/);
});
