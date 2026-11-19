/*
 * app.js — 화면 그리기와 입력 연결.
 *
 * 동작 판단이 들어오는 입구는 하나뿐이다:
 *
 *   Linny.feedJudgment({ label: 'fwdback', conf: 0.93, source: 'rule' })
 *
 * 지금은 ?debug=1 시험 버튼(과 키보드)만 이 입구를 쓴다.
 * IMU 해석 방식(규칙이든 학습 모델이든 외부 IMU 부품이든)이 정해지면
 * 그 코드가 0.5초마다 이 함수를 부르게만 하면 된다. 아래 놀이 쪽은 고칠 필요가 없다.
 *
 * 카드도 마찬가지로 Linny.feedCard('car' | 'walnut' | 'water' | 'stop') 하나로 들어온다.
 * (블루투스로 카드 번호를 받으면 번호 → 전시 이름으로 바꿔서 이 함수를 부를 예정)
 *
 * 미션 그림은 전부 임시 SVG다(assets/README.md 목록에 아직 그림이 없음).
 */
(function () {
  'use strict';

  var C = window.LinnyCore;
  var now = function () { return Date.now(); };
  var game = C.createGame({ now: now() });

  var NAMES = { car: '자동차 운전', walnut: '호두과자 굽기', water: '밭에 물주기' };
  var RESULTS = { car: '남산타워 도착!', walnut: '호두과자 20개!', water: '바구니 가득!' };
  var NOTICES = { already: '이미 모았어!', notEnough: '아직 에너지가 모자라!' };
  var SVGNS = 'http://www.w3.org/2000/svg';

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

  function svg(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function replay(node, cls) {           // CSS 애니메이션을 처음부터 다시
    node.classList.remove(cls);
    void node.getBoundingClientRect();
    node.classList.add(cls);
  }

  // ======================================================================
  // 2. 자동차 운전 — 한 번 인정될 때마다 차가 속도를 내서 한 구간 달린다.
  //    5구간을 달리면 남산타워 도착. 움직이지 않으면 차가 서서히 멈춘다.
  // ======================================================================
  var car = (function () {
    var dashG = $('#carDash'), sideG = $('#carSide');
    var needle = $('#carNeedle'), tower = $('#carTower'), marker = $('#carMarker');
    var dots = $$('.route circle');
    var HORIZON = 112, H = 128, N = 7;
    var speed = 0, phase = 0, last = 0, running = false;

    var dashes = [], trees = [];
    for (var i = 0; i < N; i++) dashes.push(svg('polygon', { 'class': 'lane' }, dashG));
    for (i = 0; i < 8; i++) {
      var g = svg('g', {}, sideG);
      svg('rect', { x: -2, y: -16, width: 4, height: 16, 'class': 'tree-trunk' }, g);
      svg('circle', { cx: 0, cy: -22, r: 11, 'class': 'tree-top' }, g);
      trees.push(g);
    }

    function halfW(y) { return 14 + (y - HORIZON) / H * 196; }
    function yAt(t) { return HORIZON + H * t * t; }

    function draw() {
      for (var i = 0; i < N; i++) {
        var t0 = ((i / N + phase) % 1), t1 = Math.min(1, t0 + 0.07);
        var y0 = yAt(t0), y1 = yAt(t1);
        var w0 = halfW(y0) * 0.035, w1 = halfW(y1) * 0.035;
        dashes[i].setAttribute('points',
          (240 - w0) + ',' + y0 + ' ' + (240 + w0) + ',' + y0 + ' ' +
          (240 + w1) + ',' + y1 + ' ' + (240 - w1) + ',' + y1);
      }
      for (i = 0; i < trees.length; i++) {
        var side = i % 2 ? 1 : -1;
        var t = ((Math.floor(i / 2) / 4 + phase * 0.8) % 1);
        var y = yAt(t);
        var x = 240 + side * (halfW(y) + 8 + 30 * t);
        trees[i].setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + (0.15 + 1.3 * t) + ')');
      }
      needle.setAttribute('transform', 'rotate(' + (-90 + 165 * Math.min(1, speed)) + ' 240 236)');
    }

    function frame(ts) {
      if (!running) return;
      var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
      last = ts;
      speed = Math.max(0, speed - dt * 0.38);
      phase = (phase + speed * dt * 1.4) % 1;
      draw();
      requestAnimationFrame(frame);
    }

    return {
      show: function (on) {
        if (on && !running) { running = true; last = 0; requestAnimationFrame(frame); }
        if (!on) running = false;
      },
      reset: function () { speed = 0; phase = 0; draw(); },
      step: function () { speed = 1.05; },
      render: function (st) {
        var k = st.step, n = st.steps || 5;
        dots.forEach(function (d, i) { d.classList.toggle('on', k >= i + 1); });
        marker.setAttribute('transform', 'translate(' + (70 + k * (322 / n)) + ' 20)');
        tower.style.transform = 'scale(' + (0.4 + 0.55 * k / n) + ')';
      }
    };
  })();

  // ======================================================================
  // 3. 호두과자 굽기 — 한 번 돌 때마다 판 두 개가 뒤집히고 한 줄(4개)이 익는다.
  //    5줄 × 4개 = 20개.
  // ======================================================================
  var walnut = (function () {
    var plates = [$('#plateL'), $('#plateR')];
    var crank = $('#crank'), num = $('#walnutNum');
    var rows = [[], [], [], [], []];
    plates.forEach(function (p, pi) {
      var x0 = pi === 0 ? 132 : 248;
      for (var r = 0; r < 5; r++) {
        for (var c = 0; c < 2; c++) {
          var g = svg('g', { 'class': 'cake', transform: 'translate(' + (x0 + 26 + c * 48) + ' ' + (32 + r * 44) + ')' }, p);
          svg('circle', { r: 18 }, g);
          svg('path', { d: 'M0 -13v26M-9 -9c4 5 4 13 0 18M9 -9c-4 5-4 13 0 18' }, g);
          rows[r].push(g);
        }
      }
    });
    return {
      show: function () {},
      reset: function () {},
      step: function () {
        plates.forEach(function (p) { replay(p, 'flip'); });
        replay(crank, 'go');
      },
      render: function (st) {
        var k = st.step;
        rows.forEach(function (row, r) {
          row.forEach(function (g) {
            g.classList.toggle('baked', r < k);
            g.classList.toggle('next', r === k && st.screen === 'mission');
          });
        });
        num.textContent = Math.min(20, k * 4);
      }
    };
  })();

  // ======================================================================
  // 4. 밭에 물주기 — 한 번 흔들 때마다 지금 가리키는 밭에 물을 주고,
  //    물뿌리개가 다음 밭(왼쪽 → 가운데 → 오른쪽)으로 방향을 바꾼다.
  //    밭마다 두 번: 싹 → 다 자람(바구니로 쏙). 6번이면 바구니에 3개.
  // ======================================================================
  var water = (function () {
    var plotsG = $('#plots'), nozzle = $('#nozzle'), spray = $('#spray');
    var aim = $('#aim'), flyer = $('#flyer'), basketIn = $('#basketIn');
    var NX = 240, NY = 232, TIP = 64;
    var PLOTS = [
      { x: 118, y: 176, kind: 'corn' },
      { x: 240, y: 176, kind: 'cabbage' },
      { x: 362, y: 176, kind: 'flower' }
    ];
    var sprayTimer = null, aimTimer = null;

    function grown(kind, g) {
      if (kind === 'corn') {
        svg('path', { d: 'M0 0V-46', 'class': 'stalk' }, g);
        svg('path', { d: 'M0 -18c-10-4-16-12-18-20 8 2 15 8 18 14ZM0 -28c10-4 15-12 16-20-8 2-14 8-16 14Z', 'class': 'leaf2' }, g);
        svg('ellipse', { cx: 6, cy: -36, rx: 5, ry: 11, 'class': 'corn' }, g);
      } else if (kind === 'cabbage') {
        svg('path', { d: 'M-16 -2c-4-12 4-16 10-12M16 -2c4-12-4-16-10-12', 'class': 'leaf2' }, g);
        svg('circle', { cx: 0, cy: -13, r: 13, 'class': 'cabbage' }, g);
      } else {
        svg('path', { d: 'M0 0V-38', 'class': 'stalk' }, g);
        svg('path', { d: 'M0 -14c-9-2-13-9-13-15 7 1 12 6 13 11Z', 'class': 'leaf2' }, g);
        for (var a = 0; a < 5; a++) {
          var ang = a * 72 * Math.PI / 180;
          svg('circle', { cx: Math.cos(ang) * 6, cy: -42 + Math.sin(ang) * 6, r: 5, 'class': 'flower' }, g);
        }
        svg('circle', { cx: 0, cy: -42, r: 3.5, fill: '#FFD84A' }, g);
      }
    }
    function sprout(g) {
      svg('path', { d: 'M0 0V-12', 'class': 'stalk' }, g);
      svg('path', { d: 'M0 -10c-8 0-12-5-12-10 6 0 11 4 12 8ZM0 -10c8 0 12-5 12-10-6 0-11 4-12 8Z', 'class': 'leaf2' }, g);
    }

    var plots = PLOTS.map(function (p, i) {
      var g = svg('g', { 'class': 'plot', 'data-st': '0' }, plotsG);
      svg('ellipse', { cx: p.x, cy: p.y, rx: 56, ry: 22, 'class': 'plot-ring' }, g);
      svg('path', { d: 'M' + (p.x - 50) + ' ' + p.y + 'h100', 'class': 'furrow' }, g);
      // 자라는 애니메이션은 안쪽 g에 건다(바깥 g의 위치 transform과 겹치지 않게)
      [-34, 0, 34].forEach(function (dx) {
        var at = 'translate(' + (p.x + dx) + ' ' + (p.y + 6) + ')';
        var s0 = svg('g', { 'class': 'st0', transform: at }, g);
        svg('ellipse', { cx: 0, cy: 0, rx: 10, ry: 4, 'class': 'mound' }, s0);
        sprout(svg('g', {}, svg('g', { 'class': 'st1', transform: at }, g)));
        grown(p.kind, svg('g', {}, svg('g', { 'class': 'st2', transform: at }, g)));
      });
      return g;
    });

    function angleTo(i) {
      var p = PLOTS[i];
      return Math.atan2(p.x - NX, NY - p.y) * 180 / Math.PI * 0.55;  // 물을 위로 쏘아 올리게 덜 눕힘
    }
    function point(i) {
      var a = angleTo(i);
      nozzle.style.transform = 'translate(' + NX + 'px,' + NY + 'px) rotate(' + a + 'deg)';
      var p = PLOTS[i];
      aim.style.transform = 'translate(' + p.x + 'px,' + (p.y - 44) + 'px)';
      plots.forEach(function (g, j) { g.classList.toggle('target', j === i); });
    }
    function sprayTo(i) {
      var a = angleTo(i) * Math.PI / 180;
      var tx = NX + Math.sin(a) * TIP, ty = NY - Math.cos(a) * TIP;
      var p = PLOTS[i];
      var cx = (tx + p.x) / 2 + Math.sin(a) * 30, cy = Math.min(ty, p.y) - 70;
      spray.setAttribute('d', 'M' + tx + ' ' + ty + 'Q' + cx + ' ' + cy + ' ' + p.x + ' ' + (p.y - 4));
      spray.classList.add('on');
      clearTimeout(sprayTimer);
      sprayTimer = setTimeout(function () { spray.classList.remove('on'); }, 1000);
    }
    function harvest(i) {
      var p = PLOTS[i];
      var g = svg('g', {}, flyer);
      g.style.transform = 'translate(' + p.x + 'px,' + (p.y + 6) + 'px)';
      grown(p.kind, g);
      var slot = basketDrop(i);
      void g.getBoundingClientRect();
      g.style.transform = 'translate(' + slot.x + 'px,' + slot.y + 'px) scale(.8)';
      setTimeout(function () { g.remove(); drawBasket(); }, 950);
    }
    function basketDrop(i) { return { x: 214 + i * 26, y: 42 }; }

    var harvested = 0, drawn = -1;
    function drawBasket() {
      if (drawn === harvested) return;
      drawn = harvested;
      while (basketIn.firstChild) basketIn.removeChild(basketIn.firstChild);
      for (var i = 0; i < harvested; i++) {
        var s = basketDrop(i);
        var g = svg('g', { transform: 'translate(' + s.x + ' ' + s.y + ') scale(.8)' }, basketIn);
        grown(PLOTS[i].kind, g);
      }
    }

    return {
      show: function () {},
      reset: function () {
        clearTimeout(sprayTimer); clearTimeout(aimTimer);
        spray.classList.remove('on');
        while (flyer.firstChild) flyer.removeChild(flyer.firstChild);
        harvested = 0; drawn = -1; drawBasket();
        nozzle.style.transition = aim.style.transition = 'none';   // 처음 자리는 바로
        point(0);
        void nozzle.getBoundingClientRect();
        nozzle.style.transition = aim.style.transition = '';
      },
      step: function (st) {
        var k = st.step, i = (k - 1) % 3;
        clearTimeout(aimTimer);
        point(i);
        sprayTo(i);
        replay(plots[i].querySelector(k > 3 ? '.st2 > g' : '.st1 > g'), 'grow');
        if (k > 3) harvest(i);
        if (k < st.steps) aimTimer = setTimeout(function () { point(k % 3); }, 1000);
      },
      render: function (st) {
        var k = st.step;
        plots.forEach(function (g, i) {
          g.setAttribute('data-st', (k > i ? 1 : 0) + (k > i + 3 ? 1 : 0));
        });
        harvested = Math.max(0, k - 3);
        if (!flyer.firstChild) drawBasket();
      }
    };
  })();

  var SCENES = { car: car, walnut: walnut, water: water };
  var seen = { mission: null, step: 0 };

  function renderScene(s) {
    var m = s.screen === 'mission' ? s.mission : null;
    Object.keys(SCENES).forEach(function (k) { SCENES[k].show(k === m); });
    if (!m) { seen.mission = null; seen.step = 0; return; }
    var sc = SCENES[m];
    if (seen.mission !== m || s.step < seen.step) {
      seen.mission = m; seen.step = 0;
      sc.reset();
    }
    sc.render(s);
    if (s.step > seen.step) { sc.step(s); seen.step = s.step; }
  }

  // ---- 그리기 ----
  var lastScreen = null;
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

    // 미션 그림과 진행 막대
    var p = s.screen === 'mission' ? s.progress : 0;
    $$('.bar div').forEach(function (b) { b.style.width = p + '%'; });
    renderScene(s);

    if (s.screen === 'done' && lastScreen !== 'done') {
      el.doneSub.textContent = (RESULTS[s.mission] || '') + ' ' + (s.count >= 3 ? '다 모았어!' : '다음 전시로 가 보자');
    }
    lastScreen = s.screen;

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
        ' ' + s.step + '/' + s.steps + ' | 보드로 ' + C.boardFrame(s) + ' | 기록 ' + log.length;
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
    // 동작 버튼 한 번 = 0.5초 간격 판단 2개(확신 0.9) = 한 번 인정
    function motion(label) {
      var j = { label: label, conf: 0.9, source: 'debug' };
      feedJudgment(j);
      setTimeout(function () { feedJudgment(j); }, 500);
    }
    function reset() { game.reset(now()); render(); }
    $$('#debug [data-motion]').forEach(function (b) {
      b.addEventListener('click', function () { motion(b.getAttribute('data-motion')); });
    });
    $('#dbgNow').addEventListener('click', function () {
      var s = game.state();
      if (s.screen === 'mission') motion(C.MOTION[s.mission]);
    });
    $('#dbgReset').addEventListener('click', reset);
    $('#dbgLog').addEventListener('click', downloadLog);

    // 컴퓨터 키보드: 1·2·3 전시 카드, 4 정류장, 스페이스 지금 미션 동작, R 처음으로
    var KEYS = { '1': 'car', '2': 'walnut', '3': 'water', '4': 'stop' };
    document.addEventListener('keydown', function (e) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (KEYS[e.key]) { feedCard(KEYS[e.key]); }
      else if (e.key === ' ') { $('#dbgNow').click(); }
      else if (e.key === 'r' || e.key === 'R') { reset(); }
      else return;
      e.preventDefault();
    });
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
