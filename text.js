// ===========================
// JavaScript から画面に出す文を 1 か所にまとめたもの（HTML に直接書いた文は HTML のまま）
// あとで別の言語の版を作るときは、この TEXT を差し替える。calc.js は文を持たず { code, ... } を返す
// ブラウザでは window.TEXT、Node（テスト）では module.exports で使う
// ===========================
(function (root) {
  'use strict';

  function list(a) { return a.slice(0, 5).join('、') + (a.length > 5 ? ' ほか ' + (a.length - 5) + ' 人' : ''); }
  function gName(g) { return g === 'M' ? '男子' : '女子'; }

  var CAT = {
    avoidNeighbor: '「前回と同じとなりを避ける」',
    avoidSeat: '「前回と同じ席を避ける」',
    gender: '「男女交互」',
    ng: '「隣にしない組」',
    want: '「隣にしたい組」',
    zone: '「前の席・後ろの席の指定」',
  };

  var TEXT = {
    cat: CAT,
    scope: {
      side: 'となり（2 人机は同じ机）',
      cross: '前後左右',
      around: 'まわり（ななめも）',
      partySide: 'となり',
      partyCross: 'となりと真向かい',
      partyAround: 'ななめ向かいまで',
      table: '同じテーブル',
    },
    where: { front: '前から', back: '後ろから' },

    /** 席の呼び名 */
    seatName: function (place) {
      if (!place) return '';
      return place.table !== undefined
        ? place.table + ' の ' + place.n + ' 番'
        : 'No.' + place.no + '（前から ' + place.row + '・左から ' + place.col + '）';
    },
    /** くじ用紙に書く場所 */
    seatWhere: function (place) {
      return place.table !== undefined ? place.table + ' の ' + place.n + ' 番' : '前から ' + place.row + '・左から ' + place.col;
    },
    seatShort: function (place) {
      if (!place) return '';
      return place.table !== undefined ? place.table + '-' + place.n : String(place.no);
    },

    /** うまく決まらなかった理由 */
    reason: function (r) {
      switch (r.code) {
        case 'noPeople': return '名簿が空です。名前を 1 行に 1 人ずつ入れるか、「番号だけ」で人数を入れてください。';
        case 'noSeats': return '使える席がありません。席の並びで、使う席を増やしてください。';
        case 'tooManyPeople': return '人数（' + r.people + ' 人）が席の数（' + r.seats + ' 席）より多いです。席を ' + (r.people - r.seats) + ' 席ふやすか、名簿を見直してください。';
        case 'zoneOver': return (r.where === 'front' ? '前から' : '後ろから') + ' ' + r.n + ' 番目までに入れたい人が ' + r.need + ' 人いますが、そこの席は ' + r.have + ' 席（固定席を除く）しかありません。' +
          (r.where === 'front' ? '「前から」の番目を増やす' : '「後ろから」の番目を増やす') + 'か、指定する人を減らしてください。';
        case 'ngFixed': return '「' + r.a + '」と「' + r.b + '」は隣にしない組ですが、2 人とも固定席（ピン）で、その席どうしが隣です。どちらかの席を変えてください。';
        case 'wantFixed': return '「' + r.a + '」と「' + r.b + '」は隣にしたい組ですが、2 人とも固定席（ピン）で、その席どうしが隣ではありません。どちらかの席を変えるか、組を外してください。';
        case 'wantMany': return '「' + r.name + '」の隣にしたい相手が ' + r.count + ' 人いますが、この席の並びと「隣」の範囲では、隣の席は多くて ' + r.max + ' 席です。組を減らすか、「隣」の範囲を広くしてください。';
        case 'genderOver': return '「男女交互」にするには、' + gName(r.g) + 'は最大 ' + r.max + ' 人までですが、' + r.count + ' 人います。「男女交互」を外すか、席の並び（2 人机・列の数）を変えてください。';
        case 'conflict':
          if (r.pair) {
            var pr = '「' + r.pair[0] + '」と「' + r.pair[1] + '」を' + (r.cat === 'want' ? '隣にしたい' : '隣にしない') + '組';
            return '全部の条件を守る席順が見つかりません。' + pr + 'を外すと決まります（ほかの条件はそのまま）。';
          }
          if (!r.others.length) return CAT[r.cat] + 'を、この席の並びでは全部は守れません。' + (r.cat === 'ng' ? '組を減らすか、「隣」の範囲を狭くしてください。' : r.cat === 'want' ? '組を減らすか、「隣」の範囲を広くしてください。' : '条件を見直してください。');
          return CAT[r.cat] + 'が、ほかの条件（' + r.others.map(function (c) { return CAT[c]; }).join('・') + '）とぶつかって、全部を守る席順が見つかりません。' +
            CAT[r.cat] + 'を外すと決まります。';
        case 'tooStrict': return '条件（' + r.cats.map(function (c) { return CAT[c]; }).join('・') + '）が重なって、全部を守る席順が見つかりません。1 つずつ外して試してください。';
        default: return '席を決められませんでした。条件を見直してください。';
      }
    },

    /** 決まったけれど知らせておくこと */
    note: function (n) {
      switch (n.code) {
        case 'dupNames': return '同じ名前の人がいたので、2 人目から ②③… を付けました（' + list(n.names) + '）。';
        case 'tooManyLines': return '名簿は ' + n.max + ' 人までです。' + n.cut + ' 行を読みませんでした。';
        case 'unknownNames': return '名簿にない名前の条件は使いませんでした（' + list(n.names) + '）。';
        case 'fixedSeatGone': return '「' + n.name + '」を固定した席が、今の席の並びにありません（使わない席にした・列を減らした など）。固定しませんでした。';
        case 'fixedSeatTaken': return '席 No.' + n.seatNo + ' は「' + n.other + '」を固定した席なので、「' + n.name + '」は固定しませんでした。';
        case 'zoneFixed': return '「' + n.name + '」は席を固定しているので、前の席・後ろの席の指定は使いませんでした。';
        case 'zoneClassOnly': return '前の席・後ろの席の指定は、教室の席だけで使えます。';
        case 'prevShapeChanged': return '前回と席の並び（列・行・テーブル）が変わっています。「前回と同じ席」は、同じ位置の席として避けました。';
        case 'genderNoData': return '「男女交互」は、名簿に性別（「名前,男」「名前,女」）が無いので使いませんでした。';
        default: return '';
      }
    },

    /** 手で入れ替えたあとに、守れなくなった条件 */
    violation: function (v) {
      switch (v.code) {
        case 'vFixed': return '「' + v.name + '」が固定した席にいません';
        case 'vZone': return '「' + v.name + '」が指定した前・後ろの席にいません';
        case 'vNg': return '「' + v.a + '」と「' + v.b + '」が隣です';
        case 'vWant': return '「' + v.a + '」と「' + v.b + '」が隣ではありません';
        case 'vGender': return '「' + v.a + '」と「' + v.b + '」が同性でとなりです';
        case 'vPrevNeighbor': return '「' + v.a + '」と「' + v.b + '」が前回と同じとなりです';
        case 'vPrevSeat': return '「' + v.name + '」が前回と同じ席です';
        default: return '';
      }
    },

    backup: function (r) {
      switch (r.code) {
        case 'otherTool': return 'ほかのツール（' + r.tool + '）のファイルです。このツールで書き出したファイルを選んでください。';
        case 'newer': return '新しい版のツールで書き出したファイルのため読み込めません。ページを再読み込みしてから、もう一度お試しください。';
        case 'badFormat': return 'ファイルの形式が正しくないため読み込めません。';
        case 'missing': return 'ファイルの中身が足りないため読み込めません。';
        default: return 'ファイルを読み取れませんでした。このツールの「ファイルに書き出す」で作った .json ファイルを選んでください。';
      }
    },

    ui: {
      groupDefault: function (n) { return 'クラス ' + n; },
      groupNew: '新しいクラス・グループの名前',
      groupRenamePrompt: 'クラス・グループの名前',
      groupDeleteConfirm: function (name) { return '「' + name + '」を削除します。名簿・条件・これまでの席の記録も消えます。よろしいですか？'; },
      groupLimit: 'クラス・グループは 30 個までです。使わないものを削除してください。',
      unnamed: '（名前なし）',
      people: function (n, seats) { return n + ' 人 ／ 席 ' + seats + ' 席' + (n > seats ? '（' + (n - seats) + ' 席たりません）' : n < seats ? '（' + (seats - n) + ' 席あまります）' : ''); },
      genderCount: function (m, f) { return '（男子 ' + m + '・女子 ' + f + '）'; },
      choosePerson: '人をえらぶ',
      remove: '外す',
      front: '前',
      desk: '教卓',
      emptySeat: '空席',
      offSeat: '×',
      prevNone: 'まだ記録がありません。席替えのあと「この席で決定」を押すと、次から前回として使えます。',
      prevOf: function (at) { return '前回: ' + at + ' に決定した席'; },
      seed: function (label) { return 'くじ番号 ' + label; },
      solving: '席を決めています…',
      done: function (n) { return n + ' 人の席が決まりました。'; },
      conflictTitle: '席を決められませんでした',
      reveal: function (i, n) { return i + ' / ' + n + ' 人'; },
      revealNext: '次の人',
      revealAll: '全部出す',
      revealDone: '全員そろいました',
      swapHint: '入れ替える 2 つの席を順にタップしてください。',
      swapPick: function (name) { return '「' + name + '」と入れ替える席をタップしてください。'; },
      swapped: function (a, b) { return '「' + a + '」と「' + b + '」を入れ替えました。'; },
      swapWarn: function (items) { return '入れ替えたので、次の条件が守れていません: ' + items.join('、') + '。'; },
      decided: function (at) { return at + ' の席として記録しました。次の席替えで「前回」として使います。'; },
      decideAgain: 'この席はもう記録してあります。',
      historyDeleteConfirm: 'この記録を削除します。よろしいですか？',
      historyUse: '前回として使う',
      historyNone: 'まだありません。',
      historyItem: function (at, n) { return at + '（' + n + ' 人）'; },
      shareCopied: 'リンクをコピーしました。',
      shareCopyFail: 'コピーできませんでした。下のリンクを長押ししてコピーしてください。',
      shareNamesConfirm: '共有リンクに名前が入ります。リンクを受け取った人（転送された人も）が名前を読めます。児童・生徒の名前は、学校の決まりに合わせてください。名前を入れてリンクを作りますか？',
      shareTooLong: function (n) { return 'リンクがとても長くなりました（' + n + ' 文字）。LINE などで切れるときは「ファイルに書き出す」をお使いください。'; },
      sharedWithNames: '共有されたリンクから開きました（名簿と条件つき）。',
      sharedNoNames: '共有されたリンクから開きました（席の並びとくじ番号だけ。名前は入っていません）。同じ名簿を貼ると、同じくじ番号で同じ席順になります。',
      sharedBroken: '共有リンクを読み取れませんでした。リンクが途中で切れていないか確かめてください。',
      sharedSaved: 'このクラス・グループを、この端末に保存しました。',
      backupDone: 'ファイルに書き出しました。機種変更のときは、このファイルを新しい端末に移して「ファイルから読み込む」を押してください。',
      backupConfirm: 'ファイルの内容で、この端末に保存しているクラス・グループと記録を全部置き換えます。よろしいですか？',
      backupLoaded: function (n) { return 'ファイルから読み込みました（' + n + ' 件のクラス・グループ）。'; },
      backupTooBig: 'ファイルが大きすぎます。このツールで書き出したファイルを選んでください。',
      backupReadFail: 'ファイルを読み取れませんでした。',
      printTitleDefault: '座席表',
      printDate: function (d) { return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'; },
      credit: 'yorozu-craft.com/sekigae/print/ で作成',
            slip: function (label) { return label; },
      at: function (d) { return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },
      soundOn: '効果音 オン',
      soundOff: '効果音 オフ',
      close: '閉じる',
      rotateHint: '横向きにすると大きく見えます',
      tableSeats: function (n) { return n + ' 席'; },
      tableName: 'テーブル名',
      tableSeatsLabel: function (name) { return name + ' の席の数'; },
      tableRemove: function (name) { return name + ' を外す'; },
      offSeatLabel: function (row, col) { return '使わない席（前から ' + row + '・左から ' + col + '）'; },
      hiddenMark: '？',
      seatCount: function (n) { return '使う席 ' + n + ' 席'; },
      notInList: function (name) { return name + '（名簿にない）'; },
      lblZonePerson: '指定する人',
      lblZoneWhere: '前か後ろか',
      lblZoneN: '何番目まで',
      zoneN: function (n) { return n + ' 番目まで'; },
      and: 'と',
      swapStart: '2 人を入れ替える',
      swapEnd: '入れ替えを終える',
      del: '削除',
      historyDelLabel: function (at) { return at + ' の記録を削除'; },
      historyPrevMark: '　← 前回',
      sharedGroupName: '共有された席',

      // 座席表（置く・入れ替える・残りをくじ）
      runFirst: '席替えする',
      runRest: '残りをくじで決める',
      runAgain: 'くじを引き直す',
      pinsOnly: function (pinned, rest) { return '固定 ' + pinned + ' 人' + (rest ? '（残り ' + rest + ' 人はくじで決めます）' : ''); },
      trayHead: function (n) { return 'まだ席のない人 ' + n + ' 人（名前をタップしてから席をタップ）'; },
      armHint: function (name) { return '「' + name + '」を置く席をタップしてください（Esc でやめる）。'; },
      placed: function (name, seat) { return '「' + name + '」を ' + seat + ' に置いて固定しました。'; },
      moved: function (name, seat) { return '「' + name + '」を ' + seat + ' に移しました。'; },
      cleared: function (name) { return '「' + name + '」の席を空けました。'; },
      pinned: function (name, seat) { return '「' + name + '」を ' + seat + ' に固定しました。'; },
      unpinned: function (name) { return '「' + name + '」の固定を外しました。次のくじで席を決め直します。'; },
      pinnedMark: '（固定）',
      noSeat: '席なし',
      seatNo: function (short) { return /^\d+$/.test(short) ? 'No.' + short : short; },
      pinHere: 'この席に固定',
      unpin: '固定を外す',
      pairFor: function (name) { return name ? '「' + name + '」の組の条件' : '組の条件'; },
      seatNow: function (name, pin) { return 'いま: ' + name + (pin ? '（固定）' : '（くじで決まった席）'); },
      seatNowEmpty: 'いま: 空いています',
      swapPickEmpty: 'この席へ移す人の席をタップしてください。',
      pinsClearConfirm: '固定（ピン）をすべて外します。いま出ている席はそのままで、次のくじで全員の席を決め直します。よろしいですか？',
      pinsCleared: '固定をすべて外しました。',
      decideMissing: function (n) { return 'まだ席のない人が ' + n + ' 人います。「残りをくじで決める」を押すか、席に置いてから決定してください。'; },
      pickNone: '見つかりません。',
      pickNoPeople: '名簿に名前を入れると、ここに出ます。',
      pairSel: function (sel, cur) {
        if (!sel.length) return '2 人を選んでください。';
        if (sel.length === 1) return '「' + sel[0] + '」と、もう 1 人を選んでください。';
        return '「' + sel[0] + '」と「' + sel[1] + '」' + (cur ? '（いま: ' + (cur === 'want' ? '隣にしたい' : '隣にしない') + '）' : '');
      },
      pairAdded: function (a, b, type) { return '「' + a + '」と「' + b + '」を' + (type === 'want' ? '隣にしたい' : '隣にしない') + '組にしました。次のくじから使います。'; },
      pairRemove: function (a, b, type) { return a + ' と ' + b + ' の「' + (type === 'want' ? '隣にしたい' : '隣にしない') + '」を外す'; },
      pairNgShort: '隣にしない',
      pairWantShort: '隣にしたい',
      layoutSum: function (L, n) {
        return L.mode === 'class'
          ? '教室 横 ' + L.cls.cols + '×前後 ' + L.cls.rows + (L.cls.pairs ? '・2 人机' : '') + '（' + n + ' 席）'
          : '宴会 ' + L.party.tables.length + ' 卓（' + n + ' 席）';
      },
      sumAvoidSeat: '前回と同じ席を避ける',
      sumAvoidNb: '前回と同じとなりを避ける',
      sumGender: '男女交互',
      sumZone: function (n) { return '前・後ろの席 ' + n + ' 人'; },
      sumNone: 'なし',
      revealSum: function (how, sound) { return '発表: ' + how + (sound ? '・効果音あり' : ''); },
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TEXT;
  else root.TEXT = TEXT;
})(this);
