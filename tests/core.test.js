// node tests/core.test.js 로 실행
'use strict';
var assert = require('assert');
var C = require('../core.js');

var passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('통과  ' + name); }
  catch (e) { console.error('실패  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

// 0.5초 간격 두 번 = 한 번 인정. 다음에 보낼 시각을 돌려준다(쉬는 1초 뒤).
function hit(g, label, t) {
  g.judgment({ label: label, conf: 0.9 }, t);
  g.judgment({ label: label, conf: 0.9 }, t + 500);
  return t + 1500;
}
// 미션을 끝까지 하고, 끝내는 시간(1.5초)이 지나 완료 화면이 된 시각을 돌려준다.
function finish(g, mission, t) {
  for (var i = 0; i < C.CONFIG.steps[mission]; i++) t = hit(g, C.MOTION[mission], t);
  t += 500;           // 마지막 인정(t-1000) + 1500
  g.tick(t);
  return t;
}

test('미션과 동작의 짝', function () {
  assert.strictEqual(C.MOTION.car, 'fwdback');
  assert.strictEqual(C.MOTION.walnut, 'spin');
  assert.strictEqual(C.MOTION.water, 'wiggle');
});

test('홈 → 미션 3개 → 가득 참 → 전달 → 홈', function () {
  var g = C.createGame({ now: 0 });
  var t = 1000;
  ['car', 'walnut', 'water'].forEach(function (m, i) {
    assert.strictEqual(g.card(m, t), 'start');
    assert.strictEqual(g.state().mission, m);
    t = finish(g, m, t);
    assert.strictEqual(g.state().screen, 'done');
    assert.strictEqual(g.state().count, i + 1);
    g.tick(t + 3000); t += 3000;
    assert.strictEqual(g.state().screen, i < 2 ? 'home' : 'full');
  });
  assert.strictEqual(g.card('stop', t), 'send');
  assert.strictEqual(g.state().screen, 'sending');
  g.tick(t + 9999);
  assert.strictEqual(g.state().screen, 'sending');
  g.tick(t + 10000);
  var s = g.state();
  assert.strictEqual(s.screen, 'home');
  assert.strictEqual(s.count, 0);
});

test('미션마다 필요한 횟수(자동차 5, 호두과자 5, 물주기 6)', function () {
  [['car', 5], ['walnut', 5], ['water', 6]].forEach(function (p) {
    var g = C.createGame({ now: 0 });
    g.card(p[0], 0);
    var t = 0;
    for (var i = 1; i < p[1]; i++) {
      t = hit(g, C.MOTION[p[0]], t);
      assert.strictEqual(g.state().step, i);
      assert.strictEqual(g.state().progress, Math.round(i / p[1] * 100));
    }
    assert.strictEqual(g.state().screen, 'mission');
    hit(g, C.MOTION[p[0]], t);               // 마지막 인정은 t+500
    assert.strictEqual(g.state().progress, 100);
    assert.strictEqual(g.state().done[p[0]], true);
    g.tick(t + 1999);
    assert.strictEqual(g.state().screen, 'mission'); // 1.5초는 미션 화면에 머문다
    g.tick(t + 2000);
    assert.strictEqual(g.state().screen, 'done');
  });
});

test('끝내는 중에는 카드와 동작을 받지 않는다', function () {
  var g = C.createGame({ now: 0 });
  g.card('car', 0);
  var t = 0;
  for (var i = 0; i < 5; i++) t = hit(g, 'fwdback', t);
  assert.strictEqual(g.card('walnut', t), 'ignored');
  assert.strictEqual(g.judgment({ label: 'fwdback', conf: 1 }, t).reason, 'finishing');
  assert.strictEqual(g.state().mission, 'car');
});

test('미션 동작만 진행도를 올린다(다른 동작·이동·정지는 무시)', function () {
  var g = C.createGame({ now: 0 });
  g.card('car', 0);
  var t = 100;
  ['spin', 'wiggle', 'move', 'still'].forEach(function (l) { t = hit(g, l, t); });
  assert.strictEqual(g.state().progress, 0);
  hit(g, 'fwdback', t);
  assert.strictEqual(g.state().step, 1);
  assert.strictEqual(g.state().progress, 20);
});

test('확신 0.8 미만은 세지 않는다', function () {
  var g = C.createGame({ now: 0 });
  g.card('water', 0);
  g.judgment({ label: 'wiggle', conf: 0.79 }, 100);
  g.judgment({ label: 'wiggle', conf: 0.79 }, 600);
  assert.strictEqual(g.state().step, 0);
  g.judgment({ label: 'wiggle', conf: 0.8 }, 1100);
  g.judgment({ label: 'wiggle', conf: 0.8 }, 1600);
  assert.strictEqual(g.state().step, 1);
});

test('2번 연속이어야 한다(사이에 다른 판단이 끼면 처음부터)', function () {
  var g = C.createGame({ now: 0 });
  g.card('walnut', 0);
  g.judgment({ label: 'spin', conf: 0.9 }, 100);
  g.judgment({ label: 'move', conf: 0.9 }, 600);
  g.judgment({ label: 'spin', conf: 0.9 }, 1100);
  assert.strictEqual(g.state().step, 0);
  g.judgment({ label: 'spin', conf: 0.9 }, 1600);
  assert.strictEqual(g.state().step, 1);
  assert.strictEqual(g.state().progress, 20);
});

test('인정 뒤 1초는 쉰다', function () {
  var g = C.createGame({ now: 0 });
  g.card('car', 0);
  hit(g, 'fwdback', 0);                       // 500ms에 인정, 1500ms까지 쉼
  var r1 = g.judgment({ label: 'fwdback', conf: 1 }, 1000);
  var r2 = g.judgment({ label: 'fwdback', conf: 1 }, 1499);
  assert.strictEqual(r1.reason, 'cooldown');
  assert.strictEqual(r2.reason, 'cooldown');
  g.judgment({ label: 'fwdback', conf: 1 }, 1500);
  g.judgment({ label: 'fwdback', conf: 1 }, 2000);
  assert.strictEqual(g.state().step, 2);
});

test('미션 중 다른 전시 카드: 진행도 0으로 새 미션', function () {
  var g = C.createGame({ now: 0 });
  g.card('car', 0);
  hit(g, 'fwdback', 0);
  assert.strictEqual(g.card('walnut', 2000), 'switch');
  var s = g.state();
  assert.strictEqual(s.mission, 'walnut');
  assert.strictEqual(s.step, 0);
  assert.strictEqual(s.progress, 0);
  assert.strictEqual(s.steps, 5);
  assert.strictEqual(s.done.car, false);
  assert.strictEqual(g.card('walnut', 2100), 'same');
});

test('안내: 이미 모은 전시, 에너지가 모자랄 때', function () {
  var g = C.createGame({ now: 0 });
  assert.strictEqual(g.card('stop', 0), 'notEnough');
  assert.strictEqual(g.state().notice, 'notEnough');
  g.tick(2000);
  assert.strictEqual(g.state().notice, null);

  g.card('car', 3000);
  var t = finish(g, 'car', 3000);
  g.tick(t + 3000);
  assert.strictEqual(g.card('car', t + 3100), 'already');
  assert.strictEqual(g.state().screen, 'home');

  g.card('walnut', t + 4000);
  assert.strictEqual(g.card('stop', t + 4100), 'notEnough');
  assert.strictEqual(g.card('car', t + 4200), 'already');
  assert.strictEqual(g.state().mission, 'walnut');
});

test('완료·전달 화면에서는 카드를 무시', function () {
  var g = C.createGame({ now: 0 });
  g.card('car', 0);
  var t = finish(g, 'car', 0);
  assert.strictEqual(g.card('walnut', t), 'ignored');
  assert.strictEqual(g.state().screen, 'done');
});

test('90초 동안 아무 일 없으면 처음으로', function () {
  var g = C.createGame({ now: 0 });
  g.card('car', 0);
  hit(g, 'fwdback', 0);
  g.judgment({ label: 'still', conf: 1 }, 60000); // 정지는 활동으로 치지 않음
  g.tick(90499);
  assert.strictEqual(g.state().screen, 'mission');
  g.tick(90500);
  assert.strictEqual(g.state().screen, 'home');
  assert.strictEqual(g.state().progress, 0);
});

test('검사값과 보드로 보내는 줄', function () {
  assert.strictEqual(C.checksum('1,60,0,1'), '1A');
  var st = { screen: 'mission', mission: 'car', progress: 60, done: { car: true, walnut: false, water: false } };
  assert.strictEqual(C.boardFrame(st), '1,60,0,1*1A');
  var st2 = { screen: 'mission', mission: 'water', progress: 50, done: { car: true, walnut: true, water: false } };
  assert.strictEqual(C.boardFrame(st2), '1,50,2,3*' + C.checksum('1,50,2,3'));
  var home = C.createGame({ now: 0 }).state();
  assert.strictEqual(C.boardFrame(home), '0,0,0,0*' + C.checksum('0,0,0,0'));
});

test('보드에서 오는 줄 해석', function () {
  assert.deepStrictEqual(C.parseBoardLine('T:04a1b2c3\r'), { type: 'tag', id: '04A1B2C3' });
  assert.deepStrictEqual(C.parseBoardLine('H'), { type: 'heartbeat' });
  assert.strictEqual(C.parseBoardLine('zz').type, 'unknown');
});

console.log('\n' + passed + '개 통과');
