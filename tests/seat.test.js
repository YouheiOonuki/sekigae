// 席替えのロジックのテスト: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');
const TEXT = require('../text.js');

function names(n, withGender) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push('生徒' + i + (withGender ? (i % 2 ? ',男' : ',女') : ''));
  return C.parsePeople(out.join('\n')).people;
}
const CLASS40 = { mode: 'class', cls: { cols: 8, rows: 5, pairs: true, desk: 'top', off: [] } };

// ---------------------------------------------------------------
// 乱数・くじ番号
// ---------------------------------------------------------------
test('乱数: 同じ seed なら同じ並び、違う seed なら違う並び', () => {
  const a = C.makeRng(123).shuffle([...Array(20).keys()]);
  const b = C.makeRng(123).shuffle([...Array(20).keys()]);
  const c = C.makeRng(124).shuffle([...Array(20).keys()]);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual([...a].sort((x, y) => x - y), [...Array(20).keys()]);
});

test('くじ番号: 5 桁-5 桁で表示し、読み戻せる（全角・区切りなしも）', () => {
  assert.equal(C.seedLabel(123), '00000-00123');
  assert.equal(C.seedLabel(4294967295), '42949-67295');
  assert.equal(C.parseSeedLabel('42949-67295'), 4294967295);
  assert.equal(C.parseSeedLabel('００１２３'), 123);
  assert.equal(C.parseSeedLabel('99999-99999'), null);
  assert.equal(C.parseSeedLabel(''), null);
});

// ---------------------------------------------------------------
// 席の並び・隣の定義
// ---------------------------------------------------------------
test('席の並び: 教室は前の左から番号、使わない席は数えない', () => {
  const seats = C.buildSeats({ mode: 'class', cls: { cols: 3, rows: 2, off: ['0-1'] } });
  assert.deepEqual(seats.map((s) => s.key), ['0-0', '0-2', '1-0', '1-1', '1-2']);
  assert.deepEqual(seats.map((s) => s.no), [1, 2, 3, 4, 5]);
});

test('席の並び: 宴会は奥の辺に半分（切り上げ）、手前に残り', () => {
  const seats = C.buildSeats({ mode: 'party', party: { tables: [{ name: 'A', seats: 5 }] } });
  assert.deepEqual(seats.map((s) => s.key), ['0-0-0', '0-0-1', '0-0-2', '0-1-0', '0-1-1']);
  assert.deepEqual(seats.map((s) => s.n), [1, 2, 3, 4, 5]);
});

test('正規化: 範囲外の列・行・テーブル、変な使わない席は直す', () => {
  const L = C.normalizeLayout({ mode: 'x', cls: { cols: 99, rows: -3, off: ['0-0', '0-0', '50-1', 'a-b'] }, party: { tables: [{ seats: 99 }, {}] } });
  assert.equal(L.mode, 'class');
  assert.equal(L.cls.cols, 12);
  assert.equal(L.cls.rows, 1);
  assert.deepEqual(L.cls.off, ['0-0']);
  assert.deepEqual(L.party.tables, [{ name: 'A', seats: 16 }, { name: 'B', seats: 6 }]);
});

test('隣（教室・2 人机）: となり＝同じ机だけ、前後左右＝通路をはさんだ左右と前後、まわり＝ななめも', () => {
  const L = { mode: 'class', cls: { cols: 4, rows: 3, pairs: true } };
  const side = C.neighbors(L, 'side'), cross = C.neighbors(L, 'cross'), around = C.neighbors(L, 'around');
  assert.deepEqual(side['1-1'].sort(), ['1-0']);                       // 1-2 は通路の向こう
  assert.deepEqual(cross['1-1'].sort(), ['0-1', '1-0', '1-2', '2-1']);
  assert.deepEqual(around['1-1'].sort(), ['0-0', '0-1', '0-2', '1-0', '1-2', '2-0', '2-1', '2-2']);
});

test('隣（教室・2 人机なし）: となり＝左右。使わない席をはさむと隣ではない', () => {
  const L = { mode: 'class', cls: { cols: 3, rows: 1, pairs: false, off: ['0-1'] } };
  assert.deepEqual(C.neighbors(L, 'side')['0-0'], []);
  const L2 = { mode: 'class', cls: { cols: 3, rows: 1, pairs: false } };
  assert.deepEqual(C.neighbors(L2, 'side')['0-1'].sort(), ['0-0', '0-2']);
});

test('隣（宴会）: となり＝同じ辺の左右、真向かい、ななめ向かい、同じテーブル', () => {
  const L = { mode: 'party', party: { tables: [{ name: 'A', seats: 6 }, { name: 'B', seats: 4 }] } };
  assert.deepEqual(C.neighbors(L, 'side')['0-0-1'].sort(), ['0-0-0', '0-0-2']);
  assert.deepEqual(C.neighbors(L, 'cross')['0-0-1'].sort(), ['0-0-0', '0-0-2', '0-1-1']);
  assert.deepEqual(C.neighbors(L, 'around')['0-0-1'].sort(), ['0-0-0', '0-0-2', '0-1-0', '0-1-1', '0-1-2']);
  assert.equal(C.neighbors(L, 'table')['0-0-1'].length, 5);
  assert.ok(C.neighbors(L, 'table')['0-0-1'].every((k) => k.startsWith('0-')));
});

test('隣は左右対称（どの範囲・どの並びでも）', () => {
  const layouts = [CLASS40, { mode: 'class', cls: { cols: 5, rows: 4, pairs: false, off: ['1-1', '2-3'] } },
    { mode: 'party', party: { tables: [{ name: 'A', seats: 7 }, { name: 'B', seats: 2 }] } }];
  for (const L of layouts) {
    for (const sc of ['side', 'cross', 'around', 'table']) {
      const nb = C.neighbors(L, sc);
      for (const k of Object.keys(nb)) for (const j of nb[k]) assert.ok(nb[j].includes(k), `${sc} ${k}-${j}`);
    }
  }
});

test('教卓を下にすると、前後も左右も逆（先生から見た向き）。通路の位置も合う', () => {
  const top = C.classGrid({ mode: 'class', cls: { cols: 4, rows: 2, pairs: true, desk: 'top' } });
  const bottom = C.classGrid({ mode: 'class', cls: { cols: 4, rows: 2, pairs: true, desk: 'bottom' } });
  assert.deepEqual(top[0].map((c) => c.key), ['0-0', '0-1', '0-2', '0-3']);
  assert.deepEqual(bottom[0].map((c) => c.key), ['1-3', '1-2', '1-1', '1-0']);
  assert.deepEqual(top[0].map((c) => c.aisleBefore), [false, false, true, false]);
  assert.deepEqual(bottom[0].map((c) => c.aisleBefore), [false, false, true, false]);
});

// ---------------------------------------------------------------
// 名簿
// ---------------------------------------------------------------
test('名簿: 1 行 1 人、性別の書き方いろいろ、空行と前後の空白は無視', () => {
  const r = C.parsePeople('  青木 太郎 ,男\n\n井上\t女\n上田（女子）\n江藤/M\n小川,f\n佐藤 花子\n加藤,\n');
  assert.deepEqual(r.people, [
    { name: '青木 太郎', g: 'M' }, { name: '井上', g: 'F' }, { name: '上田', g: 'F' }, { name: '江藤', g: 'M' },
    { name: '小川', g: 'F' }, { name: '佐藤 花子', g: '' }, { name: '加藤', g: '' },
  ]);
  assert.deepEqual(r.notes, []);
});

test('名簿: 性別でないかっこ書きは名前のまま', () => {
  assert.deepEqual(C.parsePeople('田中（副担任）').people, [{ name: '田中（副担任）', g: '' }]);
});

test('名簿: 同じ名前は ②③ を付けて区別し、知らせる', () => {
  const r = C.parsePeople('佐藤\n佐藤\n佐藤\n鈴木');
  assert.deepEqual(r.people.map((p) => p.name), ['佐藤', '佐藤②', '佐藤③', '鈴木']);
  assert.equal(r.notes[0].code, 'dupNames');
  assert.match(TEXT.note(r.notes[0]), /佐藤/);
});

test('名簿: 300 人を超えた行は読まずに知らせる。番号だけの名簿', () => {
  const r = C.parsePeople(Array.from({ length: 305 }, (_, i) => 'p' + i).join('\n'));
  assert.equal(r.people.length, 300);
  assert.equal(r.notes[0].code, 'tooManyLines');
  assert.deepEqual(C.numberPeople(3), [{ name: '1', g: '' }, { name: '2', g: '' }, { name: '3', g: '' }]);
  assert.equal(C.peopleToText([{ name: 'a', g: 'M' }, { name: 'b', g: '' }]), 'a,男\nb');
});

// ---------------------------------------------------------------
// 席を決める（性質のテスト: たくさんの seed で、条件がいつも守られる）
// ---------------------------------------------------------------
test('同じ入力・同じ seed なら同じ席順、seed が違えば違う席順', () => {
  const input = { layout: CLASS40, people: names(38), cons: {}, seed: 777 };
  const a = C.solve(input), b = C.solve(input), c = C.solve(Object.assign({}, input, { seed: 778 }));
  assert.ok(a.ok);
  assert.deepEqual(a.assign, b.assign);
  assert.notDeepEqual(a.assign, c.assign);
});

test('全員がちょうど 1 席、使わない席には座らない、余った席は後ろの並び', () => {
  const layout = { mode: 'class', cls: { cols: 6, rows: 6, pairs: false, off: ['0-5', '3-3'] } };   // 34 席
  for (let seed = 0; seed < 100; seed++) {
    const r = C.solve({ layout, people: names(30), cons: { emptyBack: true }, seed });
    assert.ok(r.ok, 'seed ' + seed);
    const seats = Object.keys(r.assign);
    assert.equal(seats.length, 30);
    assert.equal(new Set(Object.values(r.assign)).size, 30);
    assert.ok(!seats.includes('0-5') && !seats.includes('3-3'));
    assert.ok(r.empty.every((k) => k.startsWith('5-')), r.empty.join());
  }
});

test('条件（固定・前後の指定・隣にしない・男女交互・前回と同じ席ととなりを避ける）を 40 人 × 300 通りの seed で守る', () => {
  const people = names(40, true);
  const cons = {
    fixed: [{ p: '生徒1', seat: '0-0' }, { p: '生徒2', seat: '4-7' }],
    zone: [{ p: '生徒3', where: 'front', n: 1 }, { p: '生徒4', where: 'front', n: 2 }, { p: '生徒5', where: 'back', n: 1 }],
    ng: [['生徒6', '生徒7'], ['生徒6', '生徒9'], ['生徒11', '生徒12'], ['生徒13', '生徒14']],
    ngScope: 'around', gender: true, avoidSeat: true, avoidNeighbor: true,
  };
  const first = C.solve({ layout: CLASS40, people, cons, seed: 1 });
  assert.ok(first.ok);
  const prev = { layout: CLASS40, assign: first.byName };
  let solved = 0;
  for (let seed = 0; seed < 300; seed++) {
    const input = { layout: CLASS40, people, cons, prev, seed };
    const r = C.solve(input);
    if (!r.ok) continue;
    solved++;
    assert.deepEqual(C.checkAssign(input, r.assign), [], 'seed ' + seed);
    assert.equal(r.byName['生徒1'], '0-0');
    assert.equal(r.byName['生徒2'], '4-7');
  }
  assert.equal(solved, 300);
});

test('宴会: テーブルの人数をそろえ、同じテーブルにしない組を守る', () => {
  const layout = { mode: 'party', party: { tables: [{ name: '松', seats: 8 }, { name: '竹', seats: 8 }, { name: '梅', seats: 8 }] } };
  const people = names(20);
  const cons = { ng: [['生徒1', '生徒2'], ['生徒1', '生徒3'], ['生徒2', '生徒3']], ngScope: 'table', fixed: [{ p: '生徒20', seat: '0-0-0' }] };
  for (let seed = 0; seed < 100; seed++) {
    const input = { layout, people, cons, seed };
    const r = C.solve(input);
    assert.ok(r.ok);
    assert.deepEqual(C.checkAssign(input, r.assign), []);
    const perTable = [0, 0, 0];
    Object.keys(r.assign).forEach((k) => perTable[+k.split('-')[0]]++);
    assert.ok(Math.max(...perTable) - Math.min(...perTable) <= 1, perTable.join());
    const t = ['生徒1', '生徒2', '生徒3'].map((n) => r.byName[n].split('-')[0]);
    assert.equal(new Set(t).size, 3);
  }
});

test('条件がないとき、どの席にも偏りなく入る（1 人の席の分布）', () => {
  const layout = { mode: 'class', cls: { cols: 4, rows: 1, pairs: false } };
  const count = {};
  for (let seed = 0; seed < 4000; seed++) {
    const r = C.solve({ layout, people: names(4), cons: {}, seed });
    count[r.byName['生徒1']] = (count[r.byName['生徒1']] || 0) + 1;
  }
  for (const k of ['0-0', '0-1', '0-2', '0-3']) assert.ok(count[k] > 850 && count[k] < 1150, k + ' ' + count[k]);
});

test('前回と同じ席ととなりを避ける: 決めた席を記録して次に使う', () => {
  const people = names(30);
  const layout = { mode: 'class', cls: { cols: 6, rows: 5, pairs: true } };
  let history = [];
  let prevR = null;
  for (let round = 0; round < 20; round++) {
    const h = history[0];
    const input = { layout, people, cons: { avoidSeat: true, avoidNeighbor: true }, prev: h ? { layout: h.layout, assign: h.assign } : null, seed: 1000 + round };
    const r = C.solve(input);
    assert.ok(r.ok);
    if (prevR) {
      for (const p of people) assert.notEqual(r.byName[p.name], prevR.byName[p.name]);
      const pi = C.previousInfo({ layout, assign: prevR.byName });
      const nb = C.neighbors(layout, 'side');
      for (const p of people) {
        const mate = nb[r.byName[p.name]].map((k) => r.assign[k]).filter(Boolean);
        for (const m of mate) assert.ok(!pi.nbOf[p.name].includes(m), p.name + ' と ' + m);
      }
    }
    history = C.addHistory(history, { at: 'r' + round, seed: r.seed, layout, byName: r.byName });
    prevR = r;
  }
  assert.equal(history.length, 10);
});

test('前回の席の並びが違うと知らせる（同じ位置の席として避ける）', () => {
  const people = names(10);
  const prevLayout = { mode: 'class', cls: { cols: 5, rows: 2 } };
  const first = C.solve({ layout: prevLayout, people, cons: {}, seed: 5 });
  const r = C.solve({ layout: { mode: 'class', cls: { cols: 4, rows: 3 } }, people, cons: {}, prev: { layout: prevLayout, assign: first.byName }, seed: 6 });
  assert.ok(r.ok);
  assert.ok(r.notes.some((n) => n.code === 'prevShapeChanged'));
});

// ---------------------------------------------------------------
// 決められないとき: どの条件がぶつかっているかを示す
// ---------------------------------------------------------------
function reasonOf(input) {
  const r = C.solve(input);
  assert.equal(r.ok, false);
  return r.reason;
}

test('決められない: 名簿が空・席より多い', () => {
  assert.equal(reasonOf({ layout: CLASS40, people: [], cons: {}, seed: 1 }).code, 'noPeople');
  const r = reasonOf({ layout: CLASS40, people: names(41), cons: {}, seed: 1 });
  assert.deepEqual(r, { code: 'tooManyPeople', people: 41, seats: 40 });
  assert.match(TEXT.reason(r), /41 人.*40 席.*1 席ふやす/);
});

test('決められない: 前の席にしたい人が、前の並びの席より多い', () => {
  const people = names(40);
  const zone = people.slice(0, 9).map((p) => ({ p: p.name, where: 'front', n: 1 }));
  const r = reasonOf({ layout: CLASS40, people, cons: { zone }, seed: 1 });
  assert.deepEqual(r, { code: 'zoneOver', where: 'front', n: 1, need: 9, have: 8 });
  assert.match(TEXT.reason(r), /前から 1 番目までに入れたい人が 9 人.*8 席/);
});

test('決められない: 固定席が前の並びをふさいでいる（累計で数える）', () => {
  const people = names(12);
  const layout = { mode: 'class', cls: { cols: 3, rows: 4, pairs: false } };
  const cons = {
    fixed: [{ p: '生徒10', seat: '0-0' }, { p: '生徒11', seat: '1-0' }],
    zone: [{ p: '生徒1', where: 'front', n: 1 }, { p: '生徒2', where: 'front', n: 1 }, { p: '生徒3', where: 'front', n: 2 }, { p: '生徒4', where: 'front', n: 2 }, { p: '生徒5', where: 'front', n: 2 }],
  };
  const r = reasonOf({ layout, people, cons, seed: 1 });
  assert.equal(r.code, 'zoneOver');
  assert.equal(r.n, 2);
});

test('決められない: 隣にしない 2 人が、どちらも隣り合う固定席', () => {
  const people = names(10);
  const r = reasonOf({ layout: CLASS40, people, cons: { fixed: [{ p: '生徒1', seat: '0-0' }, { p: '生徒2', seat: '0-1' }], ng: [['生徒1', '生徒2']] }, seed: 1 });
  assert.equal(r.code, 'ngFixed');
  assert.match(TEXT.reason(r), /生徒1.*生徒2.*固定席/);
});

test('決められない: 男女の人数の差が大きすぎて男女交互にできない', () => {
  const people = C.parsePeople(Array.from({ length: 30 }, (_, i) => 'p' + i + (i < 22 ? ',男' : ',女')).join('\n')).people;
  const layout = { mode: 'class', cls: { cols: 6, rows: 5, pairs: true } };   // 2 人机 15 台 → 同じ性別は 15 人まで
  const r = reasonOf({ layout, people, cons: { gender: true }, seed: 1 });
  assert.deepEqual(r, { code: 'genderOver', g: 'M', count: 22, max: 15 });
  assert.match(TEXT.reason(r), /男子は最大 15 人.*22 人/);
});

test('決められない: 条件どうしがぶつかると、外せば決まる条件を名指しする', () => {
  // 3 席 1 列（2 人机なし）に 3 人。A は前回まん中で、前回と同じ席を避けたい。B と C は隣にしない（左右）
  // → まん中に座れるのは B か C で、そうすると B と C のどちらかと隣になる…ではなく、A が端・B と C が…
  // 端 2 つと まん中 1 つ: A は端。B・C のどちらかがまん中になり、もう 1 人の端と A の間… B と C は隣にならない配置がある
  // そこで「前回と同じとなりを避ける」も加えて、全部は守れないようにする
  const layout = { mode: 'class', cls: { cols: 3, rows: 1, pairs: false } };
  const people = C.parsePeople('A\nB\nC').people;
  const prev = { layout, assign: { B: '0-0', A: '0-1', C: '0-2' } };          // 前回: A のとなりは B と C
  const r = reasonOf({ layout, people, cons: { avoidSeat: true, avoidNeighbor: true }, prev, seed: 1 });
  // A はまん中以外 → 端。となりはまん中の人（B か C）→ 前回と同じとなり。外せば決まるのは「前回と同じとなり」か「前回と同じ席」
  assert.equal(r.code, 'conflict');
  assert.ok(['avoidNeighbor', 'avoidSeat'].includes(r.cat));
  assert.match(TEXT.reason(r), /を外すと決まります/);
});

test('決められない: 隣にしない組だけで席が足りない（ほかの条件なし）', () => {
  const layout = { mode: 'class', cls: { cols: 2, rows: 2, pairs: true } };
  const people = C.parsePeople('a\nb\nc\nd').people;
  const r = reasonOf({ layout, people, cons: { ng: [['a', 'b'], ['a', 'c'], ['a', 'd']], ngScope: 'cross' }, seed: 1 });
  assert.deepEqual([r.code, r.cat, r.others], ['conflict', 'ng', []]);
  assert.match(TEXT.reason(r), /隣にしない組.*全部は守れません/);
});

test('すべての理由・お知らせに文がある（text.js）', () => {
  const reasons = [
    { code: 'noPeople' }, { code: 'noSeats' }, { code: 'tooManyPeople', people: 3, seats: 2 },
    { code: 'zoneOver', where: 'back', n: 1, need: 3, have: 2 }, { code: 'ngFixed', a: 'x', b: 'y' },
    { code: 'genderOver', g: 'F', count: 9, max: 8 }, { code: 'conflict', cat: 'gender', others: ['ng'] },
    { code: 'tooStrict', cats: ['ng', 'zone'] }, { code: 'unsolvable', cats: [] },
  ];
  for (const r of reasons) assert.ok(TEXT.reason(r).length > 10, r.code);
  const notes = ['dupNames', 'tooManyLines', 'unknownNames', 'fixedSeatGone', 'fixedSeatTaken', 'zoneFixed', 'zoneClassOnly', 'prevShapeChanged', 'genderNoData'];
  for (const code of notes) assert.ok(TEXT.note({ code, names: ['x'], name: 'x', other: 'y', seatNo: 1, max: 1, cut: 1 }).length > 5, code);
  const vs = ['vFixed', 'vZone', 'vNg', 'vGender', 'vPrevNeighbor', 'vPrevSeat'];
  for (const code of vs) assert.ok(TEXT.violation({ code, name: 'x', a: 'x', b: 'y' }).length > 3, code);
});

test('お知らせ: 名簿にない名前の条件は外す・固定席が重なる・性別がないのに男女交互', () => {
  const people = names(5);
  const r = C.solve({ layout: CLASS40, people, cons: {
    fixed: [{ p: '生徒1', seat: '0-0' }, { p: '生徒2', seat: '0-0' }, { p: '転校生', seat: '0-1' }],
    ng: [['生徒3', 'いない人']], gender: true,
  }, seed: 3 });
  assert.ok(r.ok);
  const codes = r.notes.map((n) => n.code).sort();
  assert.deepEqual(codes, ['fixedSeatTaken', 'genderNoData', 'unknownNames']);
  assert.equal(r.byName['生徒1'], '0-0');
});

test('手で入れ替えたあとの確かめ（checkAssign）が、守れていない条件を見つける', () => {
  const layout = { mode: 'class', cls: { cols: 2, rows: 2, pairs: true } };
  const people = C.parsePeople('A,男\nB,男\nC,女\nD,女').people;
  const input = { layout, people, cons: { gender: true, ng: [['A', 'D']], ngScope: 'cross', fixed: [{ p: 'C', seat: '1-1' }] } };
  const v = C.checkAssign(input, { '0-0': 'A', '0-1': 'B', '1-0': 'D', '1-1': 'C' });
  const codes = v.map((x) => x.code).sort();
  assert.deepEqual(codes, ['vGender', 'vGender', 'vNg']);
});

test('発表の順番: 後ろから・前から・名簿の順・くじの順（全員 1 回ずつ）', () => {
  const people = names(10);
  const r = C.solve({ layout: CLASS40, people, cons: { emptyBack: false }, seed: 9 });
  const keys = Object.keys(r.assign);
  for (const how of ['random', 'back', 'front', 'list']) {
    const o = C.revealOrder(r, CLASS40, people, how, 9);
    assert.deepEqual([...o].sort(), [...keys].sort(), how);
  }
  const front = C.revealOrder(r, CLASS40, people, 'front', 9);
  assert.deepEqual(C.revealOrder(r, CLASS40, people, 'back', 9), [...front].reverse());
  assert.deepEqual(C.revealOrder(r, CLASS40, people, 'list', 9), people.map((p) => r.byName[p.name]));
});

test('大人数の宴会（300 人）でも時間内に決まる', () => {
  const tables = Array.from({ length: 20 }, (_, i) => ({ name: C.tableNameAt(i), seats: 16 }));
  const layout = { mode: 'party', party: { tables } };
  const t0 = Date.now();
  const r = C.solve({ layout, people: names(300, true), cons: { gender: true, ng: [['生徒1', '生徒2']], ngScope: 'table' }, seed: 1 });
  assert.ok(r.ok);
  assert.ok(Date.now() - t0 < 5000);
  assert.deepEqual(C.checkAssign({ layout, people: names(300, true), cons: { gender: true, ng: [['生徒1', '生徒2']], ngScope: 'table' } }, r.assign), []);
});

// ---------------------------------------------------------------
// 共有リンク
// ---------------------------------------------------------------
test('共有リンク（既定）: 席の並びとくじ番号だけ。名前・条件・結果は入らない', () => {
  const people = C.parsePeople('青木,男\n井上,女').people;
  const hash = C.encodeShare({ layout: CLASS40, seed: 42, numbers: false, count: 30, people, cons: { fixed: [{ p: '青木', seat: '0-0' }] }, result: { 青木: '0-0', 井上: '0-1' } }, false);
  assert.match(hash, /^[A-Za-z0-9_-]+$/);
  const raw = Buffer.from(hash, 'base64url').toString('utf8');
  assert.ok(!raw.includes('青木') && !raw.includes('井上'));
  const s = C.decodeShare('#s=' + hash);
  assert.deepEqual(s.layout, C.normalizeLayout(CLASS40));
  assert.equal(s.seed, 42);
  assert.equal(s.people, null);
  assert.equal(s.cons, null);
  assert.equal(s.result, null);
});

test('共有リンク（名前も入れる）: 名簿・条件・決まった席（入れ替え後）がそのまま戻る', () => {
  const people = C.parsePeople('青木,男\n井上,女\n上田').people;
  const cons = C.normalizeCons({ ng: [['青木', '井上']], avoidSeat: false });
  const result = { 青木: '0-0', 井上: '1-1', 上田: '0-1' };
  const s = C.decodeShare('#s=' + C.encodeShare({ layout: CLASS40, seed: 7, numbers: false, people, cons, result }, true));
  assert.deepEqual(s.people, people);
  assert.deepEqual(s.cons, cons);
  assert.deepEqual(s.result, result);
});

test('共有リンク（番号だけ）: 名前が無いので人数・条件・席は入れる', () => {
  const cons = C.normalizeCons({ zone: [{ p: '3', where: 'front', n: 1 }] });
  const r = C.solve({ layout: CLASS40, people: C.numberPeople(35), cons, seed: 5 });
  const s = C.decodeShare('#s=' + C.encodeShare({ layout: CLASS40, seed: 5, numbers: true, count: 35, cons, result: r.byName }, false));
  assert.equal(s.numbers, true);
  assert.equal(s.count, 35);
  assert.deepEqual(s.result, r.byName);
  assert.deepEqual(s.cons, cons);
});

test('共有リンク: 壊れたもの・ほかの形は null、変な中身は正規化', () => {
  for (const h of ['', '#s=', '#s=!!!', '#x=abc', '#s=' + Buffer.from('{"v":2,"l":{}}').toString('base64url'), '#s=' + Buffer.from('not json').toString('base64url')]) {
    assert.equal(C.decodeShare(h), null, h);
  }
  const bad = Buffer.from(JSON.stringify({ v: 1, l: { cls: { cols: 500 } }, s: -5, p: [['x'.repeat(99), 'Q'], 5], r: ['0-0', '0-0'] })).toString('base64url');
  const s = C.decodeShare('#s=' + bad);
  assert.equal(s.layout.cls.cols, 12);
  assert.equal(s.seed, 0);
  assert.deepEqual(s.people, [{ name: 'x'.repeat(30), g: '' }, { name: '5', g: '' }]);
  assert.deepEqual(s.result, { ['x'.repeat(30)]: '0-0' });           // 同じ席に 2 人は入れない
});

test('共有リンク: 同じ席の並び・名簿・条件・くじ番号なら、受け取った人も同じ席順を出せる', () => {
  const people = names(25);
  const cons = { ng: [['生徒1', '生徒2']] };
  const a = C.solve({ layout: CLASS40, people, cons, seed: 99 });
  const s = C.decodeShare('#s=' + C.encodeShare({ layout: CLASS40, seed: 99, numbers: false, people, cons }, false));
  const b = C.solve({ layout: s.layout, people, cons, seed: s.seed });
  assert.deepEqual(a.assign, b.assign);
});
