// バックアップファイル（書き出し・読み込み）のテスト: node --test tests/*.test.js
// README「ツールを追加するとき」20（決定 D31）
const test = require('node:test');
const assert = require('node:assert/strict');
const { backupFileName, buildBackup, parseBackup, normalizeData, newGroup, addHistory } = require('../calc.js');
const TEXT = require('../text.js');
// 画面に出す文は text.js（TEXT.backup）。calc.js は code を返す
const msg = (r) => TEXT.backup(r);

const TOOL = 'sekigae';
const DATA = { data: { current: 'g1', groups: [newGroup('g1', '3年2組')] } };
const REQUIRED = ['data'];

test('backupFileName: <ツール名>-backup-YYYYMMDD.json（端末の日付）', () => {
  assert.equal(backupFileName(TOOL, new Date(2026, 8, 24, 23, 59)), TOOL + '-backup-20260924.json');
  assert.equal(backupFileName(TOOL, new Date(2027, 0, 5)), TOOL + '-backup-20270105.json');
});

test('buildBackup: tool・version・exportedAt・data の形', () => {
  const b = buildBackup(TOOL, DATA, new Date('2026-09-24T01:02:03Z'));
  assert.deepEqual(Object.keys(b), ['tool', 'version', 'exportedAt', 'data']);
  assert.equal(b.tool, TOOL);
  assert.equal(b.version, 1);
  assert.equal(b.exportedAt, '2026-09-24T01:02:03.000Z');
  assert.deepEqual(b.data, DATA);
});

test('parseBackup: 書き出したファイルはそのまま読める', () => {
  const r = parseBackup(JSON.stringify(buildBackup(TOOL, DATA)), TOOL, REQUIRED);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, DATA);
});

test('parseBackup: ほかのツールのファイルは断る', () => {
  const r = parseBackup(JSON.stringify(buildBackup('other-tool', DATA)), TOOL, REQUIRED);
  assert.equal(r.ok, false);
  assert.match(msg(r), /ほかのツール（other-tool）/);
});

test('parseBackup: 壊れた JSON・JSON でないものは断る', () => {
  for (const text of ['{"tool": "' + TOOL, '', 'こんにちは', 'null', '[]', '123']) {
    const r = parseBackup(text, TOOL, REQUIRED);
    assert.equal(r.ok, false, text);
    assert.match(msg(r), /読み取れませんでした/);
  }
});

test('parseBackup: 項目が欠けている・形が違うものは断る', () => {
  const ok = buildBackup(TOOL, DATA);
  const cases = [
    Object.assign({}, ok, { tool: undefined }),
    Object.assign({}, ok, { version: undefined }),
    Object.assign({}, ok, { version: '1' }),
    Object.assign({}, ok, { data: undefined }),
    Object.assign({}, ok, { data: [] }),
    Object.assign({}, ok, { data: 'x' }),
  ];
  REQUIRED.forEach((k) => {
    const data = Object.assign({}, DATA);
    delete data[k];
    cases.push(Object.assign({}, ok, { data }));
  });
  cases.forEach((c, i) => {
    const r = parseBackup(JSON.stringify(c), TOOL, REQUIRED);
    assert.equal(r.ok, false, 'case ' + i);
    assert.ok(typeof r.code === 'string' && msg(r).length > 0);
  });
});

test('parseBackup: 新しい版の形式は、その旨を伝えて断る', () => {
  const r = parseBackup(JSON.stringify(Object.assign(buildBackup(TOOL, DATA), { version: 2 })), TOOL, REQUIRED);
  assert.equal(r.ok, false);
  assert.match(msg(r), /新しい版/);
});

test('書き出し → 読み込み → normalizeData で、クラス・名簿・条件・記録が元どおり', () => {
  const g = newGroup('g1', '3年2組');
  g.names = '青木,男\n井上,女\n上田';
  g.cons.fixed = [{ p: '青木', seat: '0-0' }];
  g.cons.ng = [['井上', '上田']];
  g.history = addHistory([], { at: '9/24 10:00', seed: 42, layout: g.layout, byName: { 青木: '0-0', 井上: '0-1', 上田: '1-0' } });
  g.last = { at: '9/24 10:00', seed: 42, layout: g.layout, assign: { 青木: '0-0', 井上: '0-1', 上田: '1-0' } };
  const data = normalizeData({ current: 'g1', groups: [g] });
  const text = JSON.stringify(buildBackup(TOOL, { data }), null, 2);
  const r = parseBackup(text, TOOL, REQUIRED);
  assert.equal(r.ok, true);
  assert.deepEqual(normalizeData(r.data.data), data);
});

test('normalizeData: 壊れた中身は正規化で落とす（同じ席に 2 人・変な席のキー・長すぎる名前）', () => {
  const d = normalizeData({ current: 'nope', groups: [{ id: 'a b<script>', name: 'x'.repeat(100), history: [{ assign: { A: '0-0', B: '0-0', C: 'zzz' } }], last: 'bad' }, null] });
  assert.equal(d.groups.length, 2);
  assert.equal(d.current, d.groups[0].id);
  assert.match(d.groups[0].id, /^[A-Za-z0-9_-]+$/);
  assert.equal(d.groups[0].name.length, 30);
  assert.deepEqual(d.groups[0].history[0].assign, { A: '0-0' });
  assert.equal(d.groups[0].last, null);
  assert.notEqual(d.groups[0].id, d.groups[1].id);
});
