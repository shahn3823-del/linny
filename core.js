/*
 * core.js — 화면과 무관한 계산만 모아 둔 파일. 브라우저와 node 양쪽에서 돈다.
 *
 * 이 파일은 "동작 판단 결과"를 받은 뒤의 일만 한다.
 * IMU를 어떻게 해석할지(센서 → 동작 이름)는 아직 정하지 않았다.
 * 나중에 무엇으로 판단하든(규칙, 학습 모델, 외부 IMU 부품) 아래 형식으로 넘기기만 하면 된다.
 *
 *   판단 하나 = { label: 'pump'|'dance'|'spin'|'move'|'still', conf: 0~1, source: '아무 이름' }
 *   보통 0.5초마다 하나씩 들어온다고 가정한다(2초 구간을 0.5초마다 판단).
 *
 *   카드 하나 = 'pump' | 'dance' | 'spin' | 'stop'   (stop = 똥버스 정류장)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinnyCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MISSIONS = ['pump', 'dance', 'spin'];
  var LABELS = ['pump', 'dance', 'spin', 'move', 'still'];
  var CARDS = ['pump', 'dance', 'spin', 'stop'];

  // 숫자 규칙은 전부 여기. 현장에서 바꿀 일이 생기면 이것만 고친다.
  var CONFIG = {
    stepPerHit: 20,     // 한 번 인정될 때 진행도 증가
    confMin: 0.8,       // 이 확신 이상이어야 센다
    needInRow: 2,       // 연속 몇 번이어야 인정하나
    cooldownMs: 1000,   // 인정 뒤 쉬는 시간
    doneMs: 3000,       // 미션 완료 화면 시간
    sendingMs: 10000,   // 전달 화면 시간
    idleMs: 90000,      // 이만큼 아무 일 없으면 처음으로
    noticeMs: 2000      // 안내 문구 표시 시간
  };

  function countDone(done) {
    var n = 0;
    for (var i = 0; i < MISSIONS.length; i++) if (done[MISSIONS[i]]) n++;
    return n;
  }

  function createGame(opts) {
    var cfg = {};
    var k;
    for (k in CONFIG) cfg[k] = CONFIG[k];
    if (opts && opts.config) for (k in opts.config) cfg[k] = opts.config[k];

    var s;

    function reset(now) {
      s = {
        screen: 'home',         // home | mission | done | full | sending
        mission: null,          // pump | dance | spin
        progress: 0,            // 0~100
        done: { pump: false, dance: false, spin: false },
        enteredAt: now,         // 지금 화면에 들어온 시각
        lastActivity: now,
        inRow: 0,
        cooldownUntil: 0,
        notice: null,           // 'already' | 'notEnough'
        noticeUntil: 0
      };
    }

    function go(screen, now) {
      s.screen = screen;
      s.enteredAt = now;
    }

    function notify(kind, now) {
      s.notice = kind;
      s.noticeUntil = now + cfg.noticeMs;
    }

    function startMission(ex, now) {
      s.mission = ex;
      s.progress = 0;
      s.inRow = 0;
      s.cooldownUntil = 0;
      go('mission', now);
    }

    // 카드 접촉(또는 화면 길게 누르기). 무슨 일이 일어났는지 문자열로 돌려준다.
    function card(ex, now) {
      if (CARDS.indexOf(ex) < 0) return 'unknown';
      s.lastActivity = now;
      var isMission = ex !== 'stop';

      switch (s.screen) {
        case 'home':
          if (!isMission) { notify('notEnough', now); return 'notEnough'; }
          if (s.done[ex]) { notify('already', now); return 'already'; }
          startMission(ex, now);
          return 'start';

        case 'mission':
          if (!isMission) { notify('notEnough', now); return 'notEnough'; }
          if (ex === s.mission) return 'same';
          if (s.done[ex]) { notify('already', now); return 'already'; }
          startMission(ex, now); // 하던 미션의 진행도는 버린다
          return 'switch';

        case 'full':
          if (!isMission) { go('sending', now); return 'send'; }
          notify('already', now);
          return 'already';

        default: // done, sending 중에는 카드를 무시
          return 'ignored';
      }
    }

    // 동작 판단 하나를 받는다. 결과는 기록용으로 그대로 돌려준다.
    function judgment(j, now) {
      var label = j && j.label;
      var conf = j && typeof j.conf === 'number' ? j.conf : 0;
      var out = { applied: false, reason: '', progress: s.progress };

      if (LABELS.indexOf(label) < 0) { out.reason = 'unknown-label'; return out; }
      if (s.screen !== 'mission') { out.reason = 'not-mission'; return out; }
      if (label !== 'still') s.lastActivity = now;
      if (now < s.cooldownUntil) { out.reason = 'cooldown'; return out; }

      if (label === s.mission && conf >= cfg.confMin) {
        s.inRow++;
      } else {
        s.inRow = 0;
        out.reason = label !== s.mission ? 'other-motion' : 'low-conf';
        return out;
      }

      if (s.inRow < cfg.needInRow) { out.reason = 'need-more'; return out; }

      s.inRow = 0;
      s.cooldownUntil = now + cfg.cooldownMs;
      s.progress = Math.min(100, s.progress + cfg.stepPerHit);
      out.applied = true;
      out.reason = 'step';
      out.progress = s.progress;

      if (s.progress >= 100) {
        s.done[s.mission] = true;
        go('done', now);
      }
      return out;
    }

    // 시간이 흐른 것을 반영한다. 화면 쪽에서 0.1초마다 부른다.
    function tick(now) {
      if (s.notice && now >= s.noticeUntil) s.notice = null;

      if (s.screen === 'done' && now - s.enteredAt >= cfg.doneMs) {
        s.mission = null;
        s.progress = 0;
        go(countDone(s.done) >= MISSIONS.length ? 'full' : 'home', now);
        return;
      }
      if (s.screen === 'sending' && now - s.enteredAt >= cfg.sendingMs) {
        reset(now);
        return;
      }
      var busy = s.screen !== 'home' || countDone(s.done) > 0;
      if (busy && now - s.lastActivity >= cfg.idleMs) reset(now);
    }

    function state() {
      return {
        screen: s.screen,
        mission: s.mission,
        progress: s.progress,
        done: { pump: s.done.pump, dance: s.done.dance, spin: s.done.spin },
        count: countDone(s.done),
        notice: s.notice,
        enteredAt: s.enteredAt
      };
    }

    reset(opts && typeof opts.now === 'number' ? opts.now : 0);

    return {
      card: card,
      judgment: judgment,
      tick: tick,
      state: state,
      reset: function (now) { reset(now); },
      config: cfg
    };
  }

  // ---- 보드와 주고받는 말 ----

  function checksum(body) {
    var x = 0;
    for (var i = 0; i < body.length; i++) x ^= body.charCodeAt(i) & 0xff;
    return (x < 16 ? '0' : '') + x.toString(16).toUpperCase();
  }

  var MODE = { home: 0, mission: 1, done: 2, full: 3, sending: 4 };

  // 휴대폰 → 보드: "<모드>,<진행도>,<미션 번호>,<완료 비트>*<검사값>"
  function boardFrame(st) {
    var b = st.mission ? MISSIONS.indexOf(st.mission) : 0;
    var c = (st.done.pump ? 1 : 0) | (st.done.dance ? 2 : 0) | (st.done.spin ? 4 : 0);
    var body = MODE[st.screen] + ',' + Math.round(st.progress) + ',' + b + ',' + c;
    return body + '*' + checksum(body);
  }

  // 보드 → 휴대폰 한 줄 해석
  function parseBoardLine(line) {
    var t = String(line || '').trim();
    if (t === 'H') return { type: 'heartbeat' };
    var m = /^T:([0-9A-Fa-f]{4,20})$/.exec(t);
    if (m) return { type: 'tag', id: m[1].toUpperCase() };
    return { type: 'unknown', raw: t };
  }

  return {
    MISSIONS: MISSIONS,
    LABELS: LABELS,
    CARDS: CARDS,
    CONFIG: CONFIG,
    createGame: createGame,
    checksum: checksum,
    boardFrame: boardFrame,
    parseBoardLine: parseBoardLine
  };
});
