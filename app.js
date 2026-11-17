/*
 * app.js — 화면 그리기와 입력 연결.
 *
 * 동작 판단이 들어오는 입구는 하나뿐이다:
 *
 *   Linny.feedJudgment({ label: 'pump', conf: 0.93, source: 'rule' })
 *
 * 지금은 ?debug=1 시험 버튼만 이 입구를 쓴다.
 * IMU 해석 방식(규칙이든 학습 모델이든 외부 IMU 부품이든)이 정해지면
 * 그 코드가 0.5초마다 이 함수를 부르게만 하면 된다. 아래 놀이 쪽은 고칠 필요가 없다.
 *
 * 카드도 마찬가지로 Linny.feedCard('pump' | 'dance' | 'spin' | 'stop') 하나로 들어온다.
 * (블루투스로 카드 번호를 받으면 번호 → 전시 이름으로 바꿔서 이 함수를 부를 예정)
 */
(function () {
  'use strict';

  var C = window.LinnyCore;
  var now = function () { return Date.now(); };
  var game = C.createGame({ now: now() });

  var NAMES = { pump: '물 퐁퐁', dance: '댄스마루', spin: '울끈불끈' };
  var NOTICES = { already: '이미 모았어!', notEnough: '아직 에너지가 모자라!' };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var el = {
    app: $('#app'),
    title: $('#title'),
    cells: $('#cells'),
    cellIs: $$('#cells i'),
    count: $('#count'),
    screens: $$('.screen'),
    cards: $$('.card'),
    notice: $('#notice'),
    water: $('#water'),
    pumpNum: $('#pumpNum'),
    sprout: $('#sproutPlant'),
    bulbs: $$('#bulbs svg'),
    gaugeArc: $('#gaugeArc'),
    needle: $('#needle'),
    spinNum: $('#spinNum'),
    doneSub: $('#doneSub'),
    battery: $('#battery'),
    dbgInfo: $('#dbgInfo')
  };

  // ---- 루프 기록(미션 중 판단 한 번마다 한 줄) ----
  var log = [];
  var LOG_MAX = 20000;

  function feedJudgment(j) {
    var t0 = performance.now();
    var before = game.state();
    var r = game.judgment(j, now());
    if (before.screen === 'mission') {
      if (log.length >= LOG_MAX) log.shift();
      log.push({
        time: new Date().toISOString(),
        screen: before.screen,
        mission: before.mission,
        label: j.label,
        conf: typeof j.conf === 'number' ? j.conf.toFixed(3) : '',
        source: j.source || '',
        applied: r.applied ? 1 : 0,
        reason: r.reason,
        progress: r.progress,
        ms: (performance.now() - t0).toFixed(2)
      });
    }
    render();
    return r;
  }

  function feedCard(ex) {
    var r = game.card(ex, now());
    render();
    return r;
  }

  function downloadLog() {
    var cols = ['time', 'screen', 'mission', 'label', 'conf', 'source', 'applied', 'reason', 'progress', 'ms'];
    var lines = [cols.join(',')];
    log.forEach(function (row) {
      lines.push(cols.map(function (c) { return row[c] == null ? '' : row[c]; }).join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    a.href = URL.createObjectURL(blob);
    a.download = 'loop_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---- 그리기 ----
  function render() {
    var s = game.state();
    var view = s.screen === 'mission' ? s.mission : s.screen;

    el.screens.forEach(function (sec) {
      sec.classList.toggle('on', sec.getAttribute('data-screen') === view);
    });
    el.app.classList.toggle('warm', s.screen === 'done' || s.screen === 'full');

    // 제목
    var title = '펀 에너지 모으기';
    if (s.screen === 'mission' || s.screen === 'done') title = NAMES[s.mission] || title;
    else if (s.screen === 'full') title = '에너지 가득!';
    else if (s.screen === 'sending') title = '에너지 출발!';
    el.title.textContent = title;

    // 에너지 칸(전달 중에는 비워서 보여 준다)
    var shown = s.screen === 'sending' ? 0 : s.count;
    el.cellIs.forEach(function (c, i) { c.classList.toggle('on', i < shown); });
    el.count.textContent = shown + ' / 3';
    el.cells.classList.toggle('empty', s.screen === 'sending');

    // 홈 카드
    el.cards.forEach(function (c) {
      c.classList.toggle('is-done', !!s.done[c.getAttribute('data-ex')]);
    });

    // 미션 그림
    var p = s.screen === 'mission' ? s.progress : 0;
    $$('.bar div').forEach(function (b) { b.style.width = p + '%'; });
    if (s.mission === 'pump') {
      el.water.style.height = p + '%';
      el.pumpNum.textContent = p;
      el.sprout.style.transform = 'scale(' + (0.25 + 0.75 * p / 100) + ')';
    } else if (s.mission === 'dance') {
      var lit = Math.round(p / 20);
      el.bulbs.forEach(function (b, i) { b.classList.toggle('on', i < lit); });
    } else if (s.mission === 'spin') {
      el.gaugeArc.style.strokeDashoffset = 100 - p;
      el.needle.style.transform = 'rotate(' + (-90 + 1.8 * p) + 'deg)';
      el.spinNum.textContent = p;
    }

    el.doneSub.textContent = s.count >= 3 ? '다 모았어!' : '다음 전시로 가 보자';

    // 안내
    if (s.notice) {
      if (el.notice.hidden || el.notice.dataset.kind !== s.notice) {
        el.notice.textContent = NOTICES[s.notice];
        el.notice.dataset.kind = s.notice;
        el.notice.hidden = false;
      }
    } else {
      el.notice.hidden = true;
      el.notice.dataset.kind = '';
    }

    if (el.dbgInfo) {
      el.dbgInfo.textContent = s.screen + (s.mission ? ':' + s.mission : '') +
        ' ' + s.progress + ' | 보드로 ' + C.boardFrame(s) + ' | 기록 ' + log.length;
    }
  }

  // ---- 카드가 안 읽힐 때 대비: 2초 길게 누르기 ----
  function longPress(node, fn) {
    var timer = null;
    function cancel() {
      clearTimeout(timer); timer = null;
      node.classList.remove('holding');
    }
    node.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      cancel();
      node.classList.add('holding');
      timer = setTimeout(function () { cancel(); fn(); }, 2000);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      node.addEventListener(ev, cancel);
    });
    node.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  el.cards.forEach(function (c) {
    longPress(c, function () { feedCard(c.getAttribute('data-ex')); });
  });
  longPress(el.battery, function () { feedCard('stop'); });

  // ---- 시험 버튼 ----
  if (/[?&]debug=1\b/.test(location.search)) {
    $('#debug').hidden = false;
    $$('#debug [data-card]').forEach(function (b) {
      b.addEventListener('click', function () { feedCard(b.getAttribute('data-card')); });
    });
    // 동작 버튼 한 번 = 0.5초 간격 판단 2개(확신 0.9) = 진행도 한 칸
    $$('#debug [data-motion]').forEach(function (b) {
      b.addEventListener('click', function () {
        var j = { label: b.getAttribute('data-motion'), conf: 0.9, source: 'debug' };
        feedJudgment(j);
        setTimeout(function () { feedJudgment(j); }, 500);
      });
    });
    $('#dbgReset').addEventListener('click', function () { game.reset(now()); render(); });
    $('#dbgLog').addEventListener('click', downloadLog);
  } else {
    el.dbgInfo = null;
  }

  setInterval(function () { game.tick(now()); render(); }, 100);
  render();

  // 바깥(나중에 붙일 센서·블루투스 코드)에서 쓰는 입구
  window.Linny = {
    feedJudgment: feedJudgment,
    feedCard: feedCard,
    state: function () { return game.state(); },
    boardFrame: function () { return C.boardFrame(game.state()); },
    log: log,
    downloadLog: downloadLog
  };
})();
