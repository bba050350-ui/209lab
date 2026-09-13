/* ==========================================================================
   209 智能车实验室 · 「调参挑战」小游戏（纳新版）
   --------------------------------------------------------------------------
   拖 Kp（响应力度）/ Kd（阻尼）两个滑杆，让小车贴住赛道跑完一圈。
   这是实验室里最日常的事——调参。赛道故意做得宽，新人第一次就能跑完；
   但「完全不动方向盘」一定会出局，所以还是得调。

   ★ 对网站的影响：为零。
     · 独立文件、独立模块（IIFE），不改 main.js 一个字
     · 页面加载时不做任何运算，只有按下「开始挑战」才开始跑
     · 画布滚出屏幕 / 切到别的标签页 → 自动暂停，回来再继续
     · 不支持 canvas 或找不到画布时，安静退出，不影响页面其它部分
     · 只往 window 上挂一个 SIM（给自检脚本用），其余变量都在闭包里
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------ 赛道模型 ------------------------------
     赛道用「起点平直」的余弦：车静止出发时不会被立刻甩出去。
     每一关的振幅 / 限差 / 基准速度都是参数扫描标定过的，目标是「新人能过、空手必挂」：
       L1 过关率约 99%（零出界 96%）
       L2 过关率约 98%（零出界 91%）
       L3 过关率约 94%（零出界 65%）
     而 kp=0、kd=0（完全不打方向）在三关都会出局。 */

  var LAP = 1200;                                   // 一圈的长度（抽象单位）
  var OFF_LIMIT = 4.0;                              // 在赛道外累计超过 4 秒 → 出局

  var LEVELS = [
    {
      id: 1, name: 'L1 入门 · 宽赛道慢速', speed: 95, limit: 46,
      y: function (x) { return -40 * Math.cos(x / 160); }
    },
    {
      id: 2, name: 'L2 进阶 · 中速多弯', speed: 115, limit: 42,
      y: function (x) { return -44 * Math.cos(x / 130) - 10 * Math.cos(x / 60); }
    },
    {
      id: 3, name: 'L3 挑战 · 高速连弯', speed: 135, limit: 36,
      y: function (x) { return -50 * Math.cos(x / 100) - 14 * Math.cos(x / 45); }
    }
  ];

  function levelOf(id) {
    if (CUSTOM[id]) return CUSTOM[id];
    for (var i = 0; i < LEVELS.length; i++) { if (LEVELS[i].id === id) return LEVELS[i]; }
    return LEVELS[0];
  }

  function trackY(levelId, x) { return levelOf(levelId).y(x); }

  /* ======================================================================
     随机赛道
     ----------------------------------------------------------------------
     随机也要「公平」：每生成一条，先自动跑一遍参数扫描验证，必须同时满足
       ① 完全不打方向会出局（否则调参就没意义）
       ② 参数网格里至少 70% 的组合能跑完（否则新人过不去）
       ③ 一组参考参数（Kp=2.6 / Kd=0.8）能干净跑完
     不满足就换个种子重抽（最多 14 次，还不行就放宽到 60% 门槛）。
     赛道用余弦之和，所以「起点平直」这个特性一直保留。
     ====================================================================== */

  var CUSTOM = {};                       // id -> 临时/随机赛道（4 = 随机，5 = 今日）
  var RANDOM_ID = 4;
  var DAILY_ID = 5;

  function hashSeed(str) {               // 字符串 → 32 位整数种子
    var h = 2166136261, s = String(str);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function rng(seed) {                   // mulberry32：同一颗种子一定得到同一条赛道
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function codeOf(seed) { return (seed >>> 0).toString(36).toUpperCase(); }

  function buildTrack(seed, label) {
    var r = rng(seed);
    var speed = 90 + Math.round(r() * 12) * 5;                       // 90 ~ 150
    var budget = 100;                                                // 可跟随性预算
    var harm = [];
    var n = 2 + (r() < 0.5 ? 1 : 0);                                 // 2 ~ 3 段谐波
    var sumAT = 0;
    for (var i = 0; i < n; i++) {
      var T = 70 + Math.round(r() * 15) * 6;                         // 波长 70 ~ 160
      var A = 10 + Math.round(r() * 9) * 4;                          // 振幅 10 ~ 46
      var s = r() < 0.5 ? -1 : 1;
      var need = (A / T) * speed;
      if (sumAT + need > budget) {
        A = Math.round((budget - sumAT) * T / speed / 2) * 2;        // 压到预算之内
      }
      if (A < 10) continue;
      sumAT += (A / T) * speed;
      harm.push({ A: A, T: T, s: s });
    }
    if (!harm.length) harm.push({ A: 30, T: 120, s: -1 });
    var amp = harm.reduce(function (m, h) { return m + h.A; }, 0);
    var limit = Math.round(amp * (0.88 + r() * 0.3));                // 半宽 = 振幅的 0.88~1.18 倍
    var code = codeOf(seed);
    return {
      id: RANDOM_ID,
      name: (label || '随机赛道') + ' · ' + code,
      speed: speed,
      limit: Math.max(24, limit),
      code: code,
      seed: seed,
      harmonics: harm,
      y: function (x) {
        var v = 0;
        for (var k = 0; k < harm.length; k++) v += harm[k].s * harm[k].A * Math.cos(x / harm[k].T);
        return v;
      },
      amp: amp
    };
  }

  /* 用「不依赖界面」的方式跑一圈指定赛道，用来做公平性校验 */
  function lapOn(track, cfg, dt) {
    CUSTOM[997] = track;                                     // 借一个临时 id 走同一套物理
    var st = createState(997);
    var t = 0, offTime = 0;
    dt = dt || 1 / 60;
    while (st.x < LAP && t < 200 && offTime <= OFF_LIMIT) {
      step(st, cfg, dt);
      t += dt;
      offTime = st.offTime;
    }
    delete CUSTOM[997];
    return { finished: st.x >= LAP && st.offTime <= OFF_LIMIT, time: t, offTime: st.offTime };
  }

  function checkTrack(track, minPassRate) {
    var KP = [0.6, 1.2, 1.8, 2.6, 3.4];
    var KD = [0, 0.4, 0.8, 1.2];
    var pass = 0, total = 0;
    for (var i = 0; i < KP.length; i++) {
      for (var j = 0; j < KD.length; j++) {
        total++;
        var r = lapOn(track, { kp: KP[i], kd: KD[j], speed: track.speed });
        if (r.finished) pass++;
      }
    }
    var empty = lapOn(track, { kp: 0, kd: 0, speed: track.speed });          // 完全不打方向
    var ref = lapOn(track, { kp: 2.6, kd: 0.8, speed: track.speed });        // 参考参数
    return {
      passRate: pass / total,
      noControlOut: !empty.finished,
      refOk: ref.finished && ref.offTime <= 1.0,
      refTime: ref.time,
      ok: (pass / total) >= (minPassRate || 0.7) && !empty.finished && ref.finished && ref.offTime <= 1.0
    };
  }

  /* 抽一条「过关」的随机赛道；同一颗种子结果一定一样 */
  function makeRandomTrack(seedStr) {
    var seed = (typeof seedStr === 'number') ? (seedStr >>> 0) : hashSeed(seedStr);
    var attempt;
    for (var i = 0; i < 14; i++) {
      attempt = buildTrack((seed + i * 2654435761) >>> 0);
      if (checkTrack(attempt, 0.7).ok) return attempt;
    }
    // 兜底：放宽门槛再挑一次，保证一定有赛道玩
    for (var j = 0; j < 20; j++) {
      attempt = buildTrack((seed + j * 40503 + 977) >>> 0);
      if (checkTrack(attempt, 0.55).ok) return attempt;
    }
    return buildTrack(seed);                                  // 实在不行就用第一条（极少发生）
  }

  function dailyTrack(date) {
    var d = date || new Date();
    var key = 'daily-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    var t = makeRandomTrack(hashSeed(key));
    t.id = DAILY_ID;
    t.name = '今日赛道 · ' + t.code;
    return t;
  }

  function setCustomTrack(id, track) { CUSTOM[id] = track; return track; }

  /* ------------------------------ 车辆物理 ------------------------------
     err  = 目标位置 - 当前位置（横向偏差）
     舵量 = Kp * err + Kd * (err 的变化率)      ← 就是实验室里用的 PD 控制
     横向速度有上限，不然参数一调大就瞬移了                                */

  var MAX_LAT = 260;

  function createState(levelId) {
    return {
      level: levelId, x: 0, y: trackY(levelId, 0),
      lastErr: 0, err: 0, steer: 0, off: false, offTime: 0
    };
  }

  function step(st, cfg, dt) {
    if (!(dt > 0)) return st;                       // 第一帧 dt 可能是 0，否则会算出 0/0 = NaN 把车毁掉
    var lv = levelOf(st.level);
    var err = trackY(st.level, st.x) - st.y;
    var dErr = (err - st.lastErr) / dt;
    st.lastErr = err;

    var steer = cfg.kp * err + cfg.kd * dErr;
    if (!isFinite(steer)) steer = 0;                // 再兜一层：异常值不许污染车辆状态
    if (steer > MAX_LAT) steer = MAX_LAT;
    else if (steer < -MAX_LAT) steer = -MAX_LAT;

    st.y += steer * dt;

    /* ★ 关键机制：压到赛道边缘会掉速（真车压边也会打滑/减速）。
       所以「贴线越紧 = 圈速越快」，调参好不好直接影响成绩，而不是只看有没有出界。 */
    var prevErr = trackY(st.level, st.x) - st.y;
    var devRatio = Math.min(1, Math.abs(prevErr) / lv.limit);
    var speedNow = cfg.speed * (1 - devRatio * 0.55);
    st.x += speedNow * dt;
    st.speedNow = speedNow;

    if (!isFinite(st.y)) st.y = trackY(st.level, st.x);
    if (!isFinite(st.x)) st.x = 0;

    var nowErr = trackY(st.level, st.x) - st.y;
    st.err = nowErr;
    st.steer = steer;
    st.off = Math.abs(nowErr) > lv.limit;
    if (st.off) st.offTime += dt;
    return st;
  }

  /* -------------------- 给自检脚本用的接口（页面不用） -------------------- */
  window.SIM = {
    LAP: LAP,
    OFF_LIMIT: OFF_LIMIT,
    LEVELS: LEVELS,
    RANDOM_ID: RANDOM_ID,
    DAILY_ID: DAILY_ID,
    trackY: trackY,
    levelOf: levelOf,
    createState: createState,
    step: step,
    /* 随机赛道相关 */
    hashSeed: hashSeed,
    buildTrack: buildTrack,
    checkTrack: checkTrack,
    makeRandomTrack: makeRandomTrack,
    dailyTrack: dailyTrack,
    setCustomTrack: setCustomTrack,
    lapOn: lapOn,
    /* 按游戏真实规则跑一圈：赛道外累计超 4 秒算出局。供自动测试用 */
    runLap: function (levelId, cfg, dt) {
      dt = dt || 1 / 60;
      var st = createState(levelId);
      var t = 0, outs = 0, wasOff = false, sumAbs = 0, n = 0, swings = 0, lastSign = 0;
      while (st.x < LAP && t < 200 && st.offTime <= OFF_LIMIT) {
        step(st, cfg, dt);
        t += dt;
        sumAbs += Math.abs(st.err); n++;
        var sg = st.err > 0 ? 1 : (st.err < 0 ? -1 : 0);
        if (sg !== 0 && lastSign !== 0 && sg !== lastSign) swings++;
        if (sg !== 0) lastSign = sg;
        if (st.off) { if (!wasOff) outs++; wasOff = true; } else { wasOff = false; }
      }
      var finished = st.x >= LAP && st.offTime <= OFF_LIMIT;
      return {
        finished: finished, time: t, offTime: st.offTime, outs: outs,
        meanAbsErr: n ? sumAbs / n : 0, swings: swings,
        score: finished ? t + st.offTime * 2 : null
      };
    },

    /* 得分赛：跑固定时长，按「贴线系数」累计得分。供自动测试用（和界面同一套公式） */
    runScore: function (levelId, cfg, seconds, dt) {
      dt = dt || 1 / 60;
      var lv = levelOf(levelId);
      var st = createState(levelId);
      var t = 0, score = 0, onTrack = 0, coefSum = 0, perfect = 0;
      while (t < seconds) {
        step(st, cfg, dt);
        t += dt;
        var coef = Math.max(0, 1 - Math.abs(st.err) / lv.limit);
        if (coef > 0) {
          var mult = coef >= PERFECT_COEF ? PERFECT_MULT : 1;
          score += SCORE_PER_SEC * coef * mult * dt;
          onTrack += dt;
          coefSum += coef * dt;
          if (coef >= PERFECT_COEF) perfect += dt;
        }
      }
      return {
        seconds: t, score: Math.round(score), laps: Math.floor(st.x / LAP),
        onTrackTime: onTrack, coefRate: t > 0 ? coefSum / t : 0,   // 按整段时间算（出界算 0 分）
        perfectTime: perfect, offTime: st.offTime
      };
    }
  };

  /* ============================ 下面是界面 ============================ */

  /* 计分方式（两种模式共用一套物理）：
     计时赛：跑完一圈比圈速，赛道外按 2 倍罚时。
     得分赛：跑固定时长比得分 ——
             每帧得分 = 基础分 × 贴线系数 ×（完美奖励）
             贴线系数 = 1 - |偏差| / 半宽     ← 越靠中线越接近 1，压线时接近 0，出界就是 0 分
             完美奖励：贴线系数 ≥ 0.9 时 ×1.5
             所以「越贴中线分越高、坚持越久分越多」，跑得久也能拿高分。 */
  var SCORE_PER_SEC = 100;
  var PERFECT_COEF = 0.9;
  var PERFECT_MULT = 1.5;
  var DURATIONS = [30, 60, 90];

  /* 新手教程：四步走。每步的参数与文案都是按实测数据写的
     （L1 默认参数约 14.6 s，Kp 调足后约 13.4 s；L3 上默认 17.3 s、调好后 10.8 s） */
  var TUTORIAL = [
    {
      title: '第 1 步 · 先完整跑一圈',
      kp: 0.9, kd: 0.05, speed: 95,
      hint: '先用默认参数跑一圈，什么都不用改。注意两点：车有没有「切弯」（跑到内侧去），以及圈速是多少。',
      watch: '压到赛道边缘会掉速（真车也一样），所以「贴线越紧、成绩越快」—— 这是这个游戏的核心。'
    },
    {
      title: '第 2 步 · 把响应调足',
      kp: 2.6, kd: 0, speed: 95,
      hint: '把 Kd 拉到 0，Kp 提到 2.6，再跑一次。车会明显更贴线，圈速大概能快 1 秒以上。',
      watch: '盯住「偏差」那一栏：数字应该变小了。Kp 的意思就是「偏多少、回多少」。'
    },
    {
      title: '第 3 步 · 加阻尼让它更顺',
      kp: 2.6, kd: 0.8, speed: 95,
      hint: '把 Kd 加到 0.8。在这条又宽又慢的赛道上，提升只有一点点 —— 别急，等下一步提速、或者去 L2 / L3，Kd 的作用就会非常明显。',
      watch: 'Kd 是「提前刹车」：看偏差的变化，车不会猛冲过线再拉回来。'
    },
    {
      title: '第 4 步 · 调稳了再提速',
      kp: 2.6, kd: 0.9, speed: 150,
      hint: '参数基本不动，把车速提到 150 再跑。如果开始出界，就把 Kd 再加一点、Kp 略降 —— 这就是比赛里的循环。',
      watch: '记住顺序：先调稳 → 再提速 → 再微调。反过来一定会撞。'
    }
  ];

  function init() {
    var cv = document.getElementById('sim-canvas');
    if (!cv || !cv.getContext) return;                       // 没有画布就安静退出
    var ctx = cv.getContext('2d');
    if (!ctx) return;

    var el = {
      status: document.getElementById('sim-status'),
      kp: document.getElementById('sim-kp'),
      kpVal: document.getElementById('sim-kp-val'),
      kd: document.getElementById('sim-kd'),
      kdVal: document.getElementById('sim-kd-val'),
      speed: document.getElementById('sim-speed'),
      speedVal: document.getElementById('sim-speed-val'),
      run: document.getElementById('sim-run'),
      random: document.getElementById('sim-random'),
      level: document.getElementById('sim-level'),
      err: document.getElementById('sim-err'),
      errScore: document.getElementById('sim-err-score'),
      steer: document.getElementById('sim-steer'),
      time: document.getElementById('sim-time'),
      offTime: document.getElementById('sim-offtime'),
      best: document.getElementById('sim-best'),
      readLap: document.getElementById('sim-read-lap'),
      readScore: document.getElementById('sim-read-score'),
      scoreVal: document.getElementById('sim-score'),
      coefVal: document.getElementById('sim-coef'),
      leftVal: document.getElementById('sim-left'),
      perfectVal: document.getElementById('sim-perfect'),
      bestScore: document.getElementById('sim-best-score'),
      modeLap: document.getElementById('sim-mode-lap'),
      modeScore: document.getElementById('sim-mode-score'),
      durSel: document.getElementById('sim-dur'),
      seedRow: document.getElementById('sim-seed-row'),
      seedCode: document.getElementById('sim-seed-code'),
      seedInput: document.getElementById('sim-seed-input'),
      seedUse: document.getElementById('sim-seed-use'),
      seedNew: document.getElementById('sim-seed-new'),
      tutBtn: document.getElementById('sim-tut-btn'),
      tutBox: document.getElementById('sim-tutorial'),
      tutStep: document.getElementById('sim-tut-step'),
      tutText: document.getElementById('sim-tut-text'),
      tutApply: document.getElementById('sim-tut-apply'),
      tutNext: document.getElementById('sim-tut-next'),
      tutExit: document.getElementById('sim-tut-exit')
    };
    if (!el.run || !el.kp || !el.kd) return;                  // 控件不全也不报错

    var W = cv.width, H = cv.height;
    var state = null;
    var running = false;
    var visible = true;
    var last = 0;
    var elapsed = 0;
    var wasOff = false;
    var flash = 0;
    var level = 1;
    var tutStep = -1;                                         // -1 = 教程未开启
    var runStats = { sumAbs: 0, n: 0, swings: 0, lastSign: 0 };
    var mode = 'lap';                                         // 'lap' 计时赛 | 'score' 得分赛
    var dur = 60;                                             // 得分赛时长（秒）
    var score = 0, onTrackTime = 0, coefSum = 0, perfectTime = 0, lapsDone = 0;
    var rafId = 0, looping = false;

    var BEST_KEY = 'lab209-sim-best';
    var SCORE_KEY = 'lab209-sim-score';

    function scoreKey() { return level + '-' + dur; }
    function bestScores() {
      try { return JSON.parse(localStorage.getItem(SCORE_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function saveBestScore(v) {
      try {
        var b = bestScores();
        if (!b[scoreKey()] || v > b[scoreKey()]) { b[scoreKey()] = v; localStorage.setItem(SCORE_KEY, JSON.stringify(b)); }
      } catch (e) { /* 存不了就算了 */ }
    }
    function showBestScore() {
      var b = bestScores();
      el.bestScore.textContent = b[scoreKey()] ? Math.round(b[scoreKey()]) + ' 分' : '—';
    }

    function bests() {
      try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function saveBest(lv, sec) {
      try {
        var b = bests();
        if (!b[lv] || sec < b[lv]) { b[lv] = sec; localStorage.setItem(BEST_KEY, JSON.stringify(b)); }
      } catch (e) { /* 存不了就算了 */ }
    }
    function showBest() {
      var b = bests();
      el.best.textContent = b[level] ? b[level].toFixed(2) + ' s' : '—';
    }

    function cfg() {
      return { kp: Number(el.kp.value), kd: Number(el.kd.value), speed: Number(el.speed.value) };
    }

    function syncLabels() {
      el.kpVal.textContent = Number(el.kp.value).toFixed(2);
      el.kdVal.textContent = Number(el.kd.value).toFixed(2);
      el.speedVal.textContent = String(Math.round(Number(el.speed.value)));
    }

    function setStatus(text) { if (el.status) el.status.textContent = text; }

    function reset(autostart) {
      state = createState(level);
      elapsed = 0; wasOff = false; flash = 0;
      runStats = { sumAbs: 0, n: 0, swings: 0, lastSign: 0 };
      score = 0; onTrackTime = 0; coefSum = 0; perfectTime = 0; lapsDone = 0;
      if (!autostart) stopLoop();                              // 不开跑就把循环彻底停掉
      running = !!autostart;
      last = 0;
      el.run.textContent = running ? '重来' : (mode === 'score' ? '开始得分赛' : '开始挑战');
      updateReadouts();
      draw();
    }

    function updateReadouts() {
      if (!state) return;
      var errTxt = (state.err >= 0 ? '+' : '') + state.err.toFixed(1);
      if (el.err) el.err.textContent = errTxt;
      if (el.errScore) el.errScore.textContent = errTxt;
      if (el.steer) el.steer.textContent = (state.steer >= 0 ? '+' : '') + state.steer.toFixed(0);
      if (el.time) el.time.textContent = elapsed.toFixed(2) + ' s';
      if (el.offTime) el.offTime.textContent = state.offTime.toFixed(1) + ' / ' + OFF_LIMIT.toFixed(1) + ' s';
      if (el.scoreVal) el.scoreVal.textContent = String(Math.round(score));
      if (el.coefVal) el.coefVal.textContent = elapsed > 0.5 ? Math.round(coefSum / elapsed * 100) + '%' : '—';
      if (el.leftVal) el.leftVal.textContent = Math.max(0, dur - elapsed).toFixed(1) + ' s';
      if (el.perfectVal) el.perfectVal.textContent = perfectTime.toFixed(1) + ' s';
    }

    /* ---------------------------- 跑完之后的「讲解」 ---------------------------- */

    /* 得分赛的点评：告诉他分丢在哪 */
    function scoreTip(rate, perfect, seconds) {
      if (rate >= 85) return '贴得非常准了 —— 想再高分就把车速往上提，让同样时间跑更多圈（分数只看贴线，不看圈数，但速度高时更难贴）。';
      if (rate >= 65) return '不错。想再高：① 把偏差压小（Kp / Kd 再微调）；② 冲进中间那条虚线附近有 1.5 倍奖励。';
      if (rate >= 40) return '贴线还不够紧：车在走外道，系数低。先把 Kp 加大让它跟上，再用 Kd 压住摆动。';
      return '分数偏低 —— 车大部分时间离中线很远，甚至压线（压线＝不得分）。先按「新手教程」走一遍，再回来打这个模式。';
    }

    function diagnose(res) {
      var lv = levelOf(level);
      if (!res.finished) {
        return '出局了。别急，这是最常见的两种情况：① 车跟不上弯 → Kp 太小，往上调；' +
          '② 过弯直接冲出去 → Kd 太小，加一点阻尼。建议先试 Kp = 1.8、Kd = 0.8。';
      }
      if (res.meanAbsErr > lv.limit * 0.45) {
        return '跑完了，但平均偏差偏大（' + res.meanAbsErr.toFixed(1) + '）：车在切弯、老走外道，' +
          '所以一路都在掉速。把 Kp 往上调一点（或 Kd 加一点压住摆动），圈速会明显变快。';
      }
      if (res.swings > 18) {
        return '跑完了，但车在频繁小幅摆动（' + res.swings + ' 次）—— 这是阻尼过大的表现：' +
          'Kd 调小一点，或 Kp 略调大，车会顺很多。';
      }
      if (res.offTime === 0) {
        return '跑得很干净，一次都没出界 —— 这组参数可以记下来。想更快就把车速往上提，提完再微调。';
      }
      return '跑完了，在赛道外待了 ' + res.offTime.toFixed(1) + ' 秒。再微调一下 Kp / Kd，把罚时压下去就更快了。';
    }

    /* ------------------------------ 新手教程 ------------------------------ */

    function showTutorial() {
      if (!el.tutBox) return;
      if (tutStep < 0 || tutStep >= TUTORIAL.length) { el.tutBox.hidden = true; return; }
      var s = TUTORIAL[tutStep];
      el.tutBox.hidden = false;
      if (el.tutStep) el.tutStep.textContent = '新手教程 · ' + (tutStep + 1) + ' / ' + TUTORIAL.length;
      if (el.tutText) el.tutText.textContent = s.hint + ' 要观察什么：' + s.watch;
      if (el.tutNext) el.tutNext.textContent = (tutStep === TUTORIAL.length - 1) ? '完成教程' : '下一步 →';
    }

    function applyTutorialStep() {
      if (tutStep < 0) return;
      var s = TUTORIAL[tutStep];
      el.kp.value = s.kp.toFixed(2);
      el.kd.value = s.kd.toFixed(2);
      el.speed.value = String(s.speed);
      syncLabels();
      reset(false);
      setStatus('已按教程设好参数：Kp=' + s.kp.toFixed(2) + '、Kd=' + s.kd.toFixed(2) +
        '、车速=' + s.speed + '。按「开始挑战」跑一圈看看。');
    }

    function startTutorial() {
      /* 教程固定在 L1 + 计时赛上走，才能保证每步的对比是公平的 */
      level = 1;
      if (el.level) el.level.value = '1';
      showSeedRow(false);
      setMode('lap');
      tutStep = 0;
      applyTutorialStep();
      showTutorial();
    }

    function nextTutorial() {
      tutStep++;
      if (tutStep >= TUTORIAL.length) {
        tutStep = -1;
        if (el.tutBox) el.tutBox.hidden = true;
        setStatus('教程走完了。你已经会调了 —— 现在去 L2 / L3 试试同一组参数：那边差距更明显' +
          '（L3 用默认参数要 17 秒多，调好之后 11 秒以内）。想再走一遍就点「新手教程」。');
        return;
      }
      applyTutorialStep();
      showTutorial();
    }

    function exitTutorial() {
      tutStep = -1;
      if (el.tutBox) el.tutBox.hidden = true;
      setStatus('已退出教程，随便玩玩吧。想重来随时点「新手教程」。');
    }

    /* ------------------------------ 模式切换 ------------------------------ */

    function setMode(m) {
      mode = (m === 'score') ? 'score' : 'lap';
      if (el.readLap) el.readLap.hidden = mode !== 'lap';
      if (el.readScore) el.readScore.hidden = mode !== 'score';
      if (el.durSel) el.durSel.hidden = mode !== 'score';
      if (el.modeLap) {
        el.modeLap.classList.toggle('active', mode === 'lap');
        el.modeScore.classList.toggle('active', mode === 'score');
      }
      el.run.textContent = mode === 'score' ? '开始得分赛' : '开始挑战';
      reset(false);
      if (mode === 'score') {
        showBestScore();
        setStatus('得分赛：跑 ' + dur + ' 秒，越贴中线分越高（压线不得分），贴到中间虚线附近还有 1.5 倍奖励。' +
          '跑得越久分越多 —— 按「开始得分赛」试试。');
      } else {
        showBest();
        setStatus('计时赛：跑完一整圈比圈速，赛道外按 2 倍罚时。按「开始挑战」。');
      }
    }

    /* ------------------------------ 画面 ------------------------------ */

    function draw() {
      var lv = levelOf(level);
      var camX = state ? state.x : 0;
      var range = 300;
      var x0 = camX - range * 0.3;
      var x1 = camX + range * 0.7;
      var midY = H / 2;
      /* 纵向缩放按关卡振幅自适应，保证每条赛道在画面里都一样高 */
      var amp = Math.max(1, Math.max(Math.abs(lv.y(0)), Math.abs(lv.y(Math.PI * 160))));
      var scale = Math.min(2.6, Math.max(1.1, 96 / amp));

      ctx.clearRect(0, 0, W, H);
      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#070d17');
      bg.addColorStop(1, '#0a1322');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(120,200,255,0.07)';
      ctx.lineWidth = 1;
      for (var gx = Math.ceil(x0 / 50) * 50; gx < x1; gx += 50) {
        var px = (gx - x0) / (x1 - x0) * W;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      }

      function drawPath(offset, style, width, dash) {
        ctx.beginPath();
        for (var i = 0; i <= 160; i++) {
          var x = x0 + (x1 - x0) * (i / 160);
          var y = midY - (lv.y(x) + offset) * scale;
          if (i === 0) ctx.moveTo(0, y); else ctx.lineTo((i / 160) * W, y);
        }
        ctx.setLineDash(dash || []);
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawPath(lv.limit, 'rgba(255,255,255,0.12)', 1.4, [7, 7]);
      drawPath(-lv.limit, 'rgba(255,255,255,0.12)', 1.4, [7, 7]);
      drawPath(0, 'rgba(120,200,255,0.38)', 1.6, [5, 7]);

      var sx = (0 - x0) / (x1 - x0) * W;
      var fx = (LAP - x0) / (x1 - x0) * W;
      ctx.strokeStyle = 'rgba(70,240,176,0.55)';
      ctx.lineWidth = 2;
      [sx, fx].forEach(function (px) {
        if (px >= -5 && px <= W + 5) { ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); }
      });

      if (state) {
        var cx = (state.x - x0) / (x1 - x0) * W;
        var cy = midY - state.y * scale;
        var ty = midY - lv.y(state.x) * scale;
        var tilt = Math.atan2(-(lv.y(state.x + 12) - lv.y(state.x)) * scale, (12 / (x1 - x0)) * W);

        ctx.beginPath();
        ctx.arc(cx, ty, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = flash > 0 ? 'rgba(255,107,168,0.9)' : 'rgba(70,240,176,0.9)';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(cx, cy); ctx.lineTo(cx, ty);
        ctx.strokeStyle = 'rgba(255,202,87,0.65)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.beginPath();
        ctx.moveTo(9, 0); ctx.lineTo(-6, -5.5); ctx.lineTo(-3, 0); ctx.lineTo(-6, 5.5);
        ctx.closePath();
        ctx.fillStyle = flash > 0 ? '#ff6ba8' : '#eaf7ff';
        ctx.shadowColor = flash > 0 ? 'rgba(255,107,168,0.9)' : 'rgba(39,224,255,0.9)';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.restore();
      }

      var prog = state ? Math.min(1, state.x / LAP) : 0;
      if (mode === 'score') prog = dur > 0 ? Math.min(1, elapsed / dur) : 0;   // 得分赛显示时间进度
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, H - 8, W, 5);
      var grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#27e0ff'); grad.addColorStop(0.5, '#4a7cff'); grad.addColorStop(1, '#9b6bff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H - 8, W * prog, 5);

      /* 得分赛：画布右上角显示实时得分与剩余时间 */
      if (mode === 'score') {
        ctx.save();
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(191,233,255,0.92)';
        ctx.font = 'bold 30px ui-monospace, Consolas, monospace';
        ctx.fillText(String(Math.round(score)), W - 16, 44);
        ctx.font = '12px ui-monospace, Consolas, monospace';
        ctx.fillStyle = 'rgba(140,163,189,0.9)';
        ctx.fillText('得分', W - 16, 60);
        ctx.fillText('剩余 ' + Math.max(0, dur - elapsed).toFixed(1) + ' s · 第 ' + (lapsDone + 1) + ' 圈', W - 16, 78);
        ctx.textAlign = 'left';
        ctx.fillText('贴线率 ' + (elapsed > 0.5 ? Math.round(coefSum / elapsed * 100) + '%' : '—'), 16, 24);
        ctx.restore();
      }
    }

    /* ------------------------------ 主循环 ------------------------------
       ★ 只允许一条动画循环：连点「开始 / 重来」时如果又开一条，
         车和计时都会按双倍速度跑（这是踩过的坑）。 */

    function startLoop() {
      if (looping) return;
      looping = true;
      last = 0;
      rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
      running = false;
      looping = false;
      if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      rafId = 0;
    }

    function loop(now) {
      if (!running) { looping = false; return; }
      if (!last) last = now;
      var dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;

      if (dt > 0 && visible) {
        elapsed += dt;
        step(state, cfg(), dt);

        runStats.sumAbs += Math.abs(state.err);
        runStats.n++;
        var sg = state.err > 0 ? 1 : (state.err < 0 ? -1 : 0);
        if (sg !== 0 && runStats.lastSign !== 0 && sg !== runStats.lastSign) runStats.swings++;
        if (sg !== 0) runStats.lastSign = sg;

        /* 得分赛计分：越靠中线系数越高，出界（系数<0）记 0 分 */
        var lvl = levelOf(level);
        var coef = Math.max(0, 1 - Math.abs(state.err) / lvl.limit);
        if (coef > 0) {
          var mult = coef >= PERFECT_COEF ? PERFECT_MULT : 1;
          score += SCORE_PER_SEC * coef * mult * dt;
          onTrackTime += dt;
          coefSum += coef * dt;
          if (coef >= PERFECT_COEF) perfectTime += dt;
        }
        lapsDone = Math.floor(state.x / LAP);

        if (state.off && !wasOff) flash = 0.35;
        wasOff = state.off;
        if (flash > 0) flash = Math.max(0, flash - dt);

        updateReadouts();

        var res = {
          finished: state.x >= LAP && state.offTime <= OFF_LIMIT,
          time: elapsed,
          offTime: state.offTime,
          swings: runStats.swings,
          meanAbsErr: runStats.n ? runStats.sumAbs / runStats.n : 0
        };

        if (mode === 'score') {
          if (elapsed >= dur) {                                  // 时间到 → 结算
            running = false;
            el.run.textContent = '再来一轮';
            var finalScore = Math.round(score);
            var bS = bestScores();
            var isBestS = !bS[scoreKey()] || finalScore > bS[scoreKey()];
            saveBestScore(finalScore);
            showBestScore();
            var rate = elapsed > 0 ? Math.round(coefSum / elapsed * 100) : 0;
            setStatus('时间到！本轮得分 ' + finalScore + ' 分（贴线率 ' + rate + '%、完美 ' +
              perfectTime.toFixed(1) + ' s、共跑 ' + lapsDone + ' 圈）' +
              (isBestS ? ' —— 刷新了这条赛道的最好成绩！' : '') + ' ' + scoreTip(rate, perfectTime, dur));
          }
        } else if (state.offTime > OFF_LIMIT) {
          running = false;
          el.run.textContent = '再来一次';
          setStatus(diagnose(res));
        } else if (state.x >= LAP) {
          running = false;
          el.run.textContent = '再挑战一次';
          var lapScore = elapsed + state.offTime * 2;
          var b = bests();
          var isBest = !b[level] || lapScore < b[level];
          saveBest(lapScore >= 0 ? level : level, lapScore);
          showBest();
          setStatus('跑完一圈！成绩 ' + lapScore.toFixed(2) + ' 秒（用时 ' + elapsed.toFixed(2) +
            ' s，赛道外 ' + state.offTime.toFixed(1) + ' s 罚时 ' + (state.offTime * 2).toFixed(1) + ' s）' +
            (isBest ? ' —— 刷新了本关最好成绩！' : '') + ' ' + diagnose(res));
        }
      }
      draw();
      requestAnimationFrame(loop);
    }

    /* ------------------------------ 事件 ------------------------------ */

    el.run.addEventListener('click', function () {
      reset(true);
      setStatus(mode === 'score'
        ? '计时开始！越贴中线分越高 —— 现在拖 Kp / Kd 边跑边调。'
        : '跑起来了！现在拖 Kp / Kd 试试看 —— 抖得厉害就减小 Kp 或加大 Kd。');
      startLoop();                                             // ★ 用带守卫的启动，避免开第二条循环
    });

    [el.kp, el.kd, el.speed].forEach(function (s) {
      s.addEventListener('input', function () {
        syncLabels();
        if (!state) state = createState(level);
        draw();
        if (!running) updateReadouts();
      });
    });

    if (el.random) {
      el.random.addEventListener('click', function () {
        el.kp.value = (0.2 + Math.random() * 3.0).toFixed(2);
        el.kd.value = (Math.random() * 1.2).toFixed(2);
        syncLabels();
        if (!state) state = createState(level);
        draw();
        if (!running) updateReadouts();
        setStatus('换了一组随机参数。猜猜这次能不能跑完？');
      });
    }

    if (el.level) {
      el.level.addEventListener('change', function () {
        switchLevel(Number(el.level.value) || 1);
      });
    }

    /* --------------------------- 随机 / 今日赛道 --------------------------- */

    function showSeedRow(on) {
      if (el.seedRow) el.seedRow.hidden = !on;
    }

    function applyTrack(track) {
      var lv = levelOf(track.id);
      if (el.seedCode) el.seedCode.textContent = lv.code || '—';
      if (el.seedInput) el.seedInput.value = lv.code || '';
      el.speed.value = String(lv.speed);
      syncLabels();
      showBest();
      reset(false);
      var res = null;
      try { res = checkTrack(lv, 0.7); } catch (e) { res = null; }
      var tail = '';
      if (res && !res.ok) {
        tail = res.noControlOut
          ? ' 小提示：这条赛道偏难，把车速调低一点会好跑很多。'
          : ' 小提示：这条赛道有点刁钻，多试几组 Kp / Kd。';
      }
      setStatus('已套用「' + lv.name + '」：半宽 ' + lv.limit + '、基准车速 ' + lv.speed +
        (res ? ('，自动验证过关率约 ' + Math.round(res.passRate * 100) + '%。') : '。') + tail +
        ' 按「开始挑战」试试 —— 调法和固定赛道一样。');
    }

    function switchLevel(id) {
      level = id;
      if (id === RANDOM_ID) {
        showSeedRow(true);
        var t = makeRandomTrack(String(Date.now()) + Math.random());
        setCustomTrack(RANDOM_ID, t);
        applyTrack(t);
        return;
      }
      if (id === DAILY_ID) {
        showSeedRow(true);
        var d = dailyTrack();
        setCustomTrack(DAILY_ID, d);
        applyTrack(d);
        return;
      }
      showSeedRow(false);
      var lv = levelOf(id);
      el.speed.value = String(lv.speed);
      syncLabels();
      showBest();
      reset(false);
      setStatus('切到「' + lv.name + '」：赛道更窄、弯更急，速度基准也高了。按「开始挑战」试试。');
    }

    /* 用指定编号生成赛道：★ 必须原样使用这颗种子，绝不替换成别的赛道，
       否则「同一编号 = 同一条赛道」这个约定就失效了 */
    function useSeed(code) {
      var clean = String(code || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
      if (!clean) { setStatus('赛道编号只能填字母和数字，例如 K7Q2M。'); return false; }
      var seed = parseInt(clean, 36);
      if (!isFinite(seed)) { setStatus('这个编号看不懂，换一个试试。'); return false; }
      level = RANDOM_ID;
      if (el.level) el.level.value = String(RANDOM_ID);
      showSeedRow(true);
      setCustomTrack(RANDOM_ID, buildTrack(seed >>> 0, '编号赛道'));
      applyTrack(levelOf(RANDOM_ID));
      return true;
    }

    if (el.tutBtn) el.tutBtn.addEventListener('click', startTutorial);
    if (el.modeLap) el.modeLap.addEventListener('click', function () { setMode('lap'); });
    if (el.modeScore) el.modeScore.addEventListener('click', function () { setMode('score'); });
    if (el.durSel) {
      for (var di = 0; di < DURATIONS.length; di++) {
        var opd = document.createElement('option');
        opd.value = String(DURATIONS[di]);
        opd.textContent = DURATIONS[di] + ' 秒';
        el.durSel.appendChild(opd);
      }
      el.durSel.value = String(dur);
      el.durSel.addEventListener('change', function () {
        dur = Number(el.durSel.value) || 60;
        showBestScore();
        reset(false);
        setStatus('得分赛时长改成 ' + dur + ' 秒 —— 时间越长分越多，但也越容易失误。');
      });
    }
    if (el.tutApply) el.tutApply.addEventListener('click', function () { applyTutorialStep(); });
    if (el.tutNext) el.tutNext.addEventListener('click', function () { nextTutorial(); });
    if (el.tutExit) el.tutExit.addEventListener('click', function () { exitTutorial(); });
    if (el.seedNew) {
      el.seedNew.addEventListener('click', function () {
        level = RANDOM_ID;
        if (el.level) el.level.value = String(RANDOM_ID);
        showSeedRow(true);
        var t = makeRandomTrack(String(Date.now()) + Math.random());
        setCustomTrack(RANDOM_ID, t);
        applyTrack(t);
      });
    }
    if (el.seedUse) {
      el.seedUse.addEventListener('click', function () { useSeed(el.seedInput ? el.seedInput.value : ''); });
    }
    if (el.seedInput) {
      el.seedInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); useSeed(el.seedInput.value); }
      });
    }

    /* 画布不在视野 / 切标签页 → 暂停运算 */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { visible = en.isIntersecting; if (!visible) last = 0; });
      }, { threshold: 0.05 }).observe(cv);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { visible = false; last = 0; }
      else if (cv.getBoundingClientRect) {
        var r = cv.getBoundingClientRect();
        visible = r.bottom > 0 && r.top < window.innerHeight;
      }
    });

    /* 初始化：静态画一帧，不做任何运算 */
    if (el.level) {
      for (var i = 0; i < LEVELS.length; i++) {
        var opt = document.createElement('option');
        opt.value = String(LEVELS[i].id);
        opt.textContent = LEVELS[i].name;
        el.level.appendChild(opt);
      }
      var opRnd = document.createElement('option');
      opRnd.value = String(RANDOM_ID);
      opRnd.textContent = '🎲 随机赛道（每次不同）';
      el.level.appendChild(opRnd);
      var opDay = document.createElement('option');
      opDay.value = String(DAILY_ID);
      opDay.textContent = '📅 今日赛道（全网同一条）';
      el.level.appendChild(opDay);
      el.level.value = '1';
    }
    el.speed.value = String(levelOf(level).speed);
    syncLabels();
    showBest();
    showBestScore();
    setMode('lap');
    state = createState(level);
    draw();
    updateReadouts();
    setStatus('新人建议先点「新手教程」——四步带你调出一组能跑完的参数。' +
      '想玩新赛道就把上面的「赛道」换成「随机赛道」；想比「谁贴得准」就切到「得分赛」。');

    /* 支持链接带编号：index.html?sim=K7Q2M —— 方便同学之间发同一条赛道 */
    try {
      var m = /[?&]sim=([^&#]+)/.exec(window.location.search || '');
      if (m) {
        var code = '';
        try { code = decodeURIComponent(m[1]); } catch (e2) { code = m[1]; }
        useSeed(code);
      }
    } catch (e3) { /* 拿不到地址也不影响 */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
