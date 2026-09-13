/* ==========================================================================
   209 智能车实验室 · 「调参挑战」小游戏（纳新版）
   --------------------------------------------------------------------------
   拖 Kp（响应力度）/ Ki（消长期偏差）/ Kd（阻尼）三个滑杆，让小车贴住赛道跑完一圈。
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
       L1 过关率约 97%（默认滑杆 15.75 s 干净跑完）
       L2 过关率约 96%（默认滑杆 13.25 s）
       L3 过关率约 92%（默认滑杆 13.83 s，会压线 3 秒左右，所以还是得调）
     而 kp=0、kd=0、ki=0（完全不打方向）在三关都会出局。 */

  var LAP = 1200;                                   // 一圈的长度（抽象单位）
  var OFF_LIMIT = 4.0;                              // 在赛道外累计超过 4 秒 → 出局

  var LEVELS = [
    {
      id: 1, name: 'L1 入门 · 宽赛道慢速', speed: 95, limit: 46, drift: 16,
      y: function (x) { return -40 * Math.cos(x / 160); }
    },
    {
      id: 2, name: 'L2 进阶 · 中速多弯', speed: 115, limit: 42, drift: 14,
      y: function (x) { return -44 * Math.cos(x / 130) - 10 * Math.cos(x / 60); }
    },
    {
      id: 3, name: 'L3 挑战 · 高速连弯', speed: 130, limit: 38, drift: 10,
      y: function (x) { return -50 * Math.cos(x / 100) - 14 * Math.cos(x / 45); }
    }
  ];

  function levelOf(id) {
    if (id === LOOP_ID) return LOOP;                         // 环形赛道（循环赛专用）
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
      drift: 12 + Math.round(r() * 9) * 2,          // 12 ~ 30 的机械跑偏
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

  /* ======================================================================
     循环赛道（环形）—— 「循环赛」模式专用
     ----------------------------------------------------------------------
     · 中线：极坐标谐波拼出来的闭合光滑曲线，天然不自交
     · 按弧长参数化：车沿弧长 s 前进，跑完一圈的长度就是 lapLen
     · 理想走线（蓝色虚线、也就是要贴的那条线）：取中线曲率的低频分量，
       所以弯道处它自然往内侧切一点 —— 跟真比赛的走线一个道理
     · 横向偏差这套物理和竞速模式完全共用：同一套 PID、同一套压边掉速规则；
       区别只是「压到赛道外」不再直接判出局，而是记罚时、拉低成绩（因为要跑好几圈）
     · 多了一圈「护墙」：车被推到墙上就贴着墙走，不会飞出画面外
     ====================================================================== */

  var LOOP_ID = 6;
  var LOOP_LAPS = [1, 2, 3, 5];
  var LOOP_LINE_AMP = 10;          // 理想走线相对路中间的横向摆幅（参数扫描标定过）
  var LOOP_LIMIT = 32;             // 环形赛道半宽（画面上约 84px 宽，看得清）
  var LOOP_SPEED = 95;             // 环形赛道基准车速
  var LOOP_DRIFT = 9;              // 环形赛道的机械跑偏

  function buildLoop(opt) {
    opt = opt || {};
    var R0 = opt.R0 || 170, KX = opt.KX || 1.5, KY = opt.KY || 0.82, M = 1440;
    var m2 = opt.m2 === undefined ? 0.12 : opt.m2;      // 两处鼓包（第二谐波）
    var m3 = opt.m3 === undefined ? 0.04 : opt.m3;      // 一处小折（第三谐波）
    var limit = opt.limit || LOOP_LIMIT;
    var lineAmp = opt.lineAmp === undefined ? LOOP_LINE_AMP : opt.lineAmp;
    var pts = [], i, u, rr;
    /* ① 采样中线：椭圆 + 两处鼓包 + 一处小折，形状像一条真赛道 */
    for (i = 0; i < M; i++) {
      u = i / M * Math.PI * 2;
      rr = R0 * (1 + m2 * Math.cos(2 * u) + m3 * Math.cos(3 * u + 0.9));
      pts.push([rr * KX * Math.cos(u), rr * KY * Math.sin(u)]);
    }
    /* ② 弧长表（cum[i] = 从起点走到第 i 个采样点的弧长） */
    var cum = [0], seg = [];
    for (i = 0; i < M; i++) {
      var a = pts[i], b = pts[(i + 1) % M];
      var d = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
      seg.push(d);
      cum.push(cum[i] + d);
    }
    var len = cum[M];
    /* ③ 切向 / 法向 / 曲率 */
    var tan = [], nor = [], kap = [];
    for (i = 0; i < M; i++) {
      var p0 = pts[(i - 1 + M) % M], p1 = pts[(i + 1) % M];
      var tx = p1[0] - p0[0], ty = p1[1] - p0[1], tl = Math.sqrt(tx * tx + ty * ty) || 1;
      tan.push([tx / tl, ty / tl]);
      nor.push([-ty / tl, tx / tl]);
    }
    for (i = 0; i < M; i++) {
      var t0 = tan[(i - 1 + M) % M], t1 = tan[(i + 1) % M];
      var dth = Math.atan2(t0[0] * t1[1] - t0[1] * t1[0], t0[0] * t1[0] + t0[1] * t1[1]);
      var ds = seg[(i - 1 + M) % M] + seg[i];        // i-1 → i+1 的整段弧长（不能只用一半）
      kap.push(dth / (ds || 1));
    }
    /* ④ 取曲率的 2 / 3 / 4 次谐波 → 平滑、跟得上的理想走线 */
    var HAR = [2, 3, 4], coef = [], h, k;
    for (h = 0; h < HAR.length; h++) {
      k = HAR[h];
      var re = 0, im = 0;
      for (i = 0; i < M; i++) {
        var ph = 2 * Math.PI * k * i / M;
        re += kap[i] * Math.cos(ph);
        im -= kap[i] * Math.sin(ph);
      }
      coef.push({ k: k, a: 2 * re / M, b: 2 * im / M });
    }
    function lineRaw(s) {
      var v = 0;
      for (var j = 0; j < coef.length; j++) {
        var ph2 = 2 * Math.PI * coef[j].k * s / len;
        v += coef[j].a * Math.cos(ph2) + coef[j].b * Math.sin(ph2);
      }
      return v;
    }
    /* ⑤ 归一化到固定摆幅；方向统一成「往弯道内侧切」 */
    var peak = 1e-9, worstK = 0, worstI = 0;
    for (i = 0; i < M; i++) {
      var v0 = Math.abs(lineRaw(cum[i]));
      if (v0 > peak) peak = v0;
      if (Math.abs(kap[i]) > Math.abs(worstK)) { worstK = kap[i]; worstI = i; }
    }
    var cx = 0, cy = 0;
    for (i = 0; i < M; i++) { cx += pts[i][0]; cy += pts[i][1]; }
    cx /= M; cy /= M;
    var probe = lineAmp * lineRaw(cum[worstI]) / peak;
    var px0 = pts[worstI][0], py0 = pts[worstI][1], nx0 = nor[worstI][0], ny0 = nor[worstI][1];
    var dOut = Math.abs(px0 + probe * nx0 - cx) + Math.abs(py0 + probe * ny0 - cy);
    var dMid = Math.abs(px0 - cx) + Math.abs(py0 - cy);
    var sign = dOut <= dMid ? 1 : -1;                       // 探针点离中心更近 → 这就是「内侧」
    var amp = lineAmp * sign / peak;

    function lineAt(s) {                                   // 周期函数，s 取任意实数
      return amp * lineRaw(s);
    }
    /* ⑥ 按弧长取中线上的点和切向（二分查表） */
    function pointAt(s) {
      s = s % len; if (s < 0) s += len;
      var lo = 0, hi = M;
      while (lo + 1 < hi) { var mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
      var f = seg[lo] > 0 ? (s - cum[lo]) / seg[lo] : 0;
      var A = pts[lo], B = pts[(lo + 1) % M];
      var T = tan[lo], N = nor[lo];
      return {
        x: A[0] + (B[0] - A[0]) * f, y: A[1] + (B[1] - A[1]) * f,
        tx: T[0], ty: T[1], nx: N[0], ny: N[1]
      };
    }

    /* 最小曲率半径（给自检用：必须比赛道半宽大，路面才不会自己折起来） */
    var minR = Infinity;
    for (i = 0; i < M; i++) { var r0 = Math.abs(kap[i]) > 1e-9 ? 1 / Math.abs(kap[i]) : Infinity; if (r0 < minR) minR = r0; }

    return {
      id: LOOP_ID,
      name: '🔄 环形赛道 · 看全貌',
      speed: opt.speed || LOOP_SPEED,
      limit: limit,
      drift: opt.drift === undefined ? LOOP_DRIFT : opt.drift,
      lapLen: len,
      guard: 1.35,                                    // 护墙：最多偏到半宽的 1.35 倍
      lineAmp: lineAmp,
      y: function (x) { return lineAt(x); },          // 物理用的参考线（周期性，跑多少圈都行）
      geom: {
        pts: pts, tan: tan, nor: nor, kap: kap, seg: seg, cum: cum, len: len,
        M: M, line: lineAt, pointAt: pointAt, minR: minR, cx: cx, cy: cy
      }
    };
  }

  var LOOP = buildLoop();

  function lapLenOf(id) { var lv = levelOf(id); return lv.lapLen || LAP; }
  /* 循环赛的成绩：平均圈速 + 贴线率 → 综合分与等级。
     界面（逐帧跑）和自检（批量跑）用同一套公式，避免两边算得不一样。 */
  function loopResult(o) {
    var laps = Math.max(1, o.laps || 1);
    var ideal = o.lapLen / Math.max(1, o.speed);                     // 不压边的理想圈速
    var rawAvg = o.elapsed / laps;
    var avg = (o.elapsed + (o.offTime || 0) * 2) / laps;             // 含 2 倍罚时的成绩圈速
    var rate = o.elapsed > 0 ? Math.max(0, Math.min(1, o.coefSum / o.elapsed)) : 0;
    var speedK = avg > 0 ? Math.max(0, Math.min(1.2, ideal / avg)) : 0;
    var final = Math.round(100 * rate * speedK);
    var grade = final >= 90 ? 'S' : (final >= 78 ? 'A' : (final >= 64 ? 'B' : (final >= 48 ? 'C' : 'D')));
    return {
      laps: laps, avgLap: avg, rawAvgLap: rawAvg, idealLap: ideal, rate: rate,
      speedK: speedK, final: final, grade: grade,
      score: Math.round(o.score || 0), scorePerLap: (o.score || 0) / laps,
      offTime: o.offTime || 0,
      bestLap: (o.times && o.times.length) ? Math.min.apply(null, o.times) : 0
    };
  }

  function loopTip(r) {
    if (r.rate < 0.45) {
      return '贴线率太低：车大部分时间不在理想走线上。先按「新手教程」把 Kp / Kd 调顺，再用 Ki 消掉长期偏一边的偏差。';
    }
    if (r.speedK < 0.8) {
      return '贴线不错，但圈速比理想慢太多（压边掉速 + 罚时）。把偏差压小、车速再往上提一点，综合分会明显涨。';
    }
    if (r.final >= 90) return '这已经是 S 级成绩了 —— 换更多圈数继续刷，或者把车速提上去挑战极限。';
    if (r.final >= 78) return 'A 级，很稳。想上 S：把贴线率再压上去一点（微调 Ki / Kd），或者加圈数保持稳定。';
    return '成绩不错。记住那句话：先调稳、再提速、再微调 —— 循环赛跑圈数多，稳定性比拼一把更值钱。';
  }


  /* ------------------------------ 车辆物理 ------------------------------
     err  = 目标位置 - 当前位置（横向偏差）
     舵量 = Kp * err + Ki * (err 的累积) + Kd * (err 的变化率)   ← 就是实验室里用的 PID 控制
     Ki 那一项专门对付「机械跑偏」造成的长期偏差（车总是歪向同一边）。
     横向速度有上限，不然参数一调大就瞬移了                                */

  var MAX_LAT = 260;
  var I_MAX = 150;                                 // 积分项累加上限（防止「积分饱和」把车拽飞）

  function createState(levelId) {
    return {
      level: levelId, x: 0, y: trackY(levelId, 0),
      lastErr: 0, err: 0, steer: 0, off: false, offTime: 0,
      integral: 0, iTerm: 0
    };
  }

  function step(st, cfg, dt) {
    if (!(dt > 0)) return st;                       // 第一帧 dt 可能是 0，否则会算出 0/0 = NaN 把车毁掉
    var lv = levelOf(st.level);
    var err = trackY(st.level, st.x) - st.y;
    var dErr = (err - st.lastErr) / dt;
    st.lastErr = err;

    /* PID 三项：P 看当前偏差，I 看偏差的累积（用来消掉长期偏移），D 看偏差变化率（提前刹车） */
    st.integral += err * dt;
    if (st.integral > I_MAX) st.integral = I_MAX;                       // 抗积分饱和
    else if (st.integral < -I_MAX) st.integral = -I_MAX;
    var ki = cfg.ki || 0;
    st.iTerm = ki * st.integral;

    var steer = cfg.kp * err + st.iTerm + cfg.kd * dErr;
    if (!isFinite(steer)) steer = 0;                // 再兜一层：异常值不许污染车辆状态
    if (steer > MAX_LAT) steer = MAX_LAT;
    else if (steer < -MAX_LAT) steer = -MAX_LAT;

    /* 车本身的机械跑偏（舵机中位不准）也要算进去 */
    st.y += steer * dt + (lv.drift || 0) * dt;

    /* 循环赛有「护墙」：被推到墙上就贴着墙走，不会飞出画面（罚时照记） */
    if (lv.guard) {
      var wall = lv.limit * lv.guard, ref0 = trackY(st.level, st.x);
      if (st.y - ref0 > wall) st.y = ref0 + wall;
      else if (ref0 - st.y > wall) st.y = ref0 - wall;
    }

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
    /* 环形赛道（循环赛） */
    LOOP_ID: LOOP_ID,
    LOOP_LAPS: LOOP_LAPS,
    loop: LOOP,
    buildLoop: buildLoop,
    lapLenOf: lapLenOf,
    loopResult: loopResult,
    loopTip: loopTip,
    /* 循环赛的批量跑法：不判出局，跑满圈数为止，护墙生效 */
    runLaps: function (levelId, cfg, laps, dt) {
      dt = dt || 1 / 60;
      laps = Math.max(1, Math.round(laps || 1));
      var lv = levelOf(levelId), L = lv.lapLen || LAP;
      var st = createState(levelId);
      var t = 0, score = 0, coefSum = 0, times = [], lastAt = 0;
      while (times.length < laps && t < 900) {
        step(st, cfg, dt);
        t += dt;
        var coef = Math.max(0, 1 - Math.abs(st.err) / lv.limit);
        if (coef > 0) {
          score += SCORE_PER_SEC * coef * (coef >= PERFECT_COEF ? PERFECT_MULT : 1) * dt;
          coefSum += coef * dt;
        }
        while (times.length < Math.floor(st.x / L)) { times.push(t - lastAt); lastAt = t; }
      }
      return loopResult({
        laps: laps, elapsed: t, offTime: st.offTime, times: times, score: score,
        coefSum: coefSum, speed: cfg.speed || lv.speed, lapLen: L
      });
    },
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

  /* 新手教程：五步走。每步的参数与文案都是按实测数据写的
     （L1 默认参数 15.75 s；Kp 调足后 13.63 s；kp1.0/kd0.5 加 Ki 后平均偏差 14.4 → 9.2、15.27 s → 14.17 s；
        L3 默认参数 17.93 s 还会压线 3 秒，调好之后 10.95 s） */
  var TUTORIAL = [
    {
      title: '第 1 步 · 先完整跑一圈',
      kp: 0.9, kd: 0.05, ki: 0, speed: 95,
      hint: '先用默认参数跑一圈，什么都不用改。注意两点：车有没有「切弯」（跑到内侧去），以及圈速是多少。',
      watch: '压到赛道边缘会掉速（真车也一样），所以「贴线越紧、成绩越快」—— 这是这个游戏的核心。'
    },
    {
      title: '第 2 步 · 把响应调足',
      kp: 2.6, kd: 0, ki: 0, speed: 95,
      hint: '把 Kd 拉到 0，Kp 提到 2.6，再跑一次。车会明显更贴线：平均偏差从 16.6 掉到 6.2 左右，圈速能快 2 秒。',
      watch: '盯住「偏差」那一栏：数字应该变小了。Kp 的意思就是「偏多少、回多少」。'
    },
    {
      title: '第 3 步 · 加阻尼让它更顺',
      kp: 2.6, kd: 0.8, ki: 0, speed: 95,
      hint: '把 Kd 加到 0.8。在这条又宽又慢的赛道上几乎看不出差别（13.60 s）—— 别急，等下一步提速、或者去 L2 / L3，Kd 的作用就会非常明显。',
      watch: 'Kd 是「提前刹车」：看偏差的变化，车不会猛冲过线再拉回来。'
    },
    {
      title: '第 4 步 · 用 Ki 消掉「一直偏一边」',
      kp: 1.0, kd: 0.5, ki: 0.30, speed: 95,
      hint: '这一步故意把 Kp 调回 1.0：车本身有轻微机械跑偏（舵机中位不准），Kp 小的时候你能一眼看出它整条赛道都贴在同一边 —— 这叫「稳态偏差」，光靠 Kp / Kd 消不掉。' +
        '现在把 Ki 从 0 加到 0.30 再跑一次：平均偏差会从 14.4 掉到 9.2 左右，圈速快 1 秒。',
      watch: '盯住新增的「积分项」那一栏：它会一点点攒起来，然后把车慢慢拉回中线 —— 这就是 I 项在做的事。'
    },
    {
      title: '第 5 步 · 调稳了再提速',
      kp: 2.6, kd: 0.9, ki: 0.30, speed: 150,
      hint: '把 Kp 调回 2.6、Ki 保持 0.30、Kd 加到 0.9，车速提到 150 再跑。如果开始出界，就把 Kd 再加一点、Kp 略降 —— 这就是比赛里的循环。',
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
      scope: document.getElementById('sim-scope'),
      kp: document.getElementById('sim-kp'),
      kpVal: document.getElementById('sim-kp-val'),
      kd: document.getElementById('sim-kd'),
      kdVal: document.getElementById('sim-kd-val'),
      ki: document.getElementById('sim-ki'),
      kiVal: document.getElementById('sim-ki-val'),
      speed: document.getElementById('sim-speed'),
      speedVal: document.getElementById('sim-speed-val'),
      run: document.getElementById('sim-run'),
      random: document.getElementById('sim-random'),
      level: document.getElementById('sim-level'),
      err: document.getElementById('sim-err'),
      errScore: document.getElementById('sim-err-score'),
      steer: document.getElementById('sim-steer'),
      iTerm: document.getElementById('sim-iterm'),
      iTermScore: document.getElementById('sim-iterm-score'),
      time: document.getElementById('sim-time'),
      offTime: document.getElementById('sim-offtime'),
      best: document.getElementById('sim-best'),
      readLap: document.getElementById('sim-read-lap'),
      readScore: document.getElementById('sim-read-score'),
      readLoop: document.getElementById('sim-read-loop'),
      scoreVal: document.getElementById('sim-score'),
      coefVal: document.getElementById('sim-coef'),
      leftVal: document.getElementById('sim-left'),
      perfectVal: document.getElementById('sim-perfect'),
      bestScore: document.getElementById('sim-best-score'),
      modeLap: document.getElementById('sim-mode-lap'),
      modeScore: document.getElementById('sim-mode-score'),
      modeLoop: document.getElementById('sim-mode-loop'),
      durSel: document.getElementById('sim-dur'),
      lapsSel: document.getElementById('sim-laps'),
      loopLapsNow: document.getElementById('sim-loop-laps-now'),
      loopLapTime: document.getElementById('sim-loop-laptime'),
      loopAvg: document.getElementById('sim-loop-avg'),
      loopBestLap: document.getElementById('sim-loop-bestlap'),
      loopRate: document.getElementById('sim-loop-rate'),
      loopScore: document.getElementById('sim-loop-score'),
      loopScorePer: document.getElementById('sim-loop-scoreper'),
      loopFinal: document.getElementById('sim-loop-final'),
      loopGrade: document.getElementById('sim-loop-grade'),
      loopRecord: document.getElementById('sim-loop-record'),
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

    /* 实时波形图那块画布（没有就安静跳过，不影响游戏） */
    var scopeCtx = null, scopeW = 0, scopeH = 0;
    if (el.scope && el.scope.getContext) {
      try {
        scopeCtx = el.scope.getContext('2d');
        if (scopeCtx) { scopeW = el.scope.width; scopeH = el.scope.height; }
      } catch (eS) { scopeCtx = null; }
    }
    if (!scopeCtx) { scopeW = 0; scopeH = 0; }
    var trace = [];                                          // 实时波形数据 {t, e, u}
    var scE = 46, scU = 60;                                  // 两条曲线的显示量程（只会变大）
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
    var mode = 'lap';                                         // 'lap' 计时赛 | 'score' 得分赛 | 'loop' 循环赛
    var dur = 60;                                             // 得分赛时长（秒）
    var loopLaps = 2;                                         // 循环赛圈数
    var lapTimes = [];                                        // 循环赛：每圈用时
    var lastLapAt = 0;
    var score = 0, onTrackTime = 0, coefSum = 0, perfectTime = 0, lapsDone = 0;
    var rafId = 0, looping = false;

    var BEST_KEY = 'lab209-sim-best';
    var SCORE_KEY = 'lab209-sim-score';
    var LOOP_KEY = 'lab209-sim-loop';

    /* 循环赛的最好成绩：按圈数分开记 */
    function bestLoops() {
      try { return JSON.parse(localStorage.getItem(LOOP_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function saveBestLoop(v) {
      try {
        var b = bestLoops();
        if (!b[loopLaps] || v > b[loopLaps]) { b[loopLaps] = v; localStorage.setItem(LOOP_KEY, JSON.stringify(b)); }
      } catch (e) { /* 存不了就算了 */ }
    }
    function showBestLoop() {
      if (!el.loopRecord) return;
      var b = bestLoops();
      el.loopRecord.textContent = b[loopLaps] ? b[loopLaps] + ' 分' : '—';
    }

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
      return {
        kp: Number(el.kp.value),
        kd: Number(el.kd.value),
        ki: el.ki ? Number(el.ki.value) : 0,
        speed: Number(el.speed.value)
      };
    }

    function syncLabels() {
      el.kpVal.textContent = Number(el.kp.value).toFixed(2);
      el.kdVal.textContent = Number(el.kd.value).toFixed(2);
      if (el.kiVal && el.ki) el.kiVal.textContent = Number(el.ki.value).toFixed(2);
      el.speedVal.textContent = String(Math.round(Number(el.speed.value)));
    }

    function setStatus(text) { if (el.status) el.status.textContent = text; }

    /* 程序改了滑杆（教程 / 随机参数）时，通知一下外面的监听者（比如下方的控制理论图） */
    function notifySliders() {
      [el.kp, el.kd, el.ki].forEach(function (s) {
        if (!s || typeof s.dispatchEvent !== 'function' || typeof Event !== 'function') return;
        try { s.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* 老浏览器就算了 */ }
      });
    }

    function reset(autostart) {
      state = createState(level);
      elapsed = 0; wasOff = false; flash = 0;
      runStats = { sumAbs: 0, n: 0, swings: 0, lastSign: 0 };
      score = 0; onTrackTime = 0; coefSum = 0; perfectTime = 0; lapsDone = 0;
      lapTimes = []; lastLapAt = 0;
      scopeReset();
      if (!autostart) stopLoop();                              // 不开跑就把循环彻底停掉
      running = !!autostart;
      last = 0;
      el.run.textContent = running ? '重来'
        : (mode === 'score' ? '开始得分赛' : (mode === 'loop' ? '开始循环赛' : '开始挑战'));
      updateReadouts();
      draw();
      drawScope();
    }

    /* 循环赛当前的成绩快照（逐帧算，和自检用的 loopResult 同一套公式） */
    function loopNow() {
      var lv = levelOf(level);
      return loopResult({
        laps: loopLaps, elapsed: elapsed, offTime: state ? state.offTime : 0, times: lapTimes,
        score: score, coefSum: coefSum, speed: Number(el.speed.value), lapLen: lv.lapLen || LAP
      });
    }

    function updateReadouts() {
      if (!state) return;
      var errTxt = (state.err >= 0 ? '+' : '') + state.err.toFixed(1);
      if (el.err) el.err.textContent = errTxt;
      if (el.errScore) el.errScore.textContent = errTxt;
      if (el.steer) el.steer.textContent = (state.steer >= 0 ? '+' : '') + state.steer.toFixed(0);
      var iTxt = (state.iTerm >= 0 ? '+' : '') + state.iTerm.toFixed(0);
      if (el.iTerm) el.iTerm.textContent = iTxt;
      if (el.iTermScore) el.iTermScore.textContent = iTxt;
      if (el.time) el.time.textContent = elapsed.toFixed(2) + ' s';
      if (el.offTime) el.offTime.textContent = state.offTime.toFixed(1) + ' / ' + OFF_LIMIT.toFixed(1) + ' s';
      if (el.scoreVal) el.scoreVal.textContent = String(Math.round(score));
      if (el.coefVal) el.coefVal.textContent = elapsed > 0.5 ? Math.round(coefSum / elapsed * 100) + '%' : '—';
      if (el.leftVal) el.leftVal.textContent = Math.max(0, dur - elapsed).toFixed(1) + ' s';
      if (el.perfectVal) el.perfectVal.textContent = perfectTime.toFixed(1) + ' s';

      /* 循环赛面板 */
      if (mode === 'loop') {
        var r = loopNow();
        var done = lapTimes.length;
        if (el.loopLapsNow) el.loopLapsNow.textContent = '第 ' + Math.min(done + 1, loopLaps) + ' / ' + loopLaps + ' 圈';
        if (el.loopLapTime) el.loopLapTime.textContent = (elapsed - lastLapAt).toFixed(2) + ' s';
        if (el.loopAvg) el.loopAvg.textContent = done > 0 ? r.rawAvgLap.toFixed(2) + ' s' : '—';
        if (el.loopBestLap) el.loopBestLap.textContent = r.bestLap > 0 ? r.bestLap.toFixed(2) + ' s' : '—';
        if (el.loopRate) el.loopRate.textContent = elapsed > 0.5 ? Math.round(r.rate * 100) + '%' : '—';
        if (el.loopScore) el.loopScore.textContent = String(r.score);
        if (el.loopScorePer) el.loopScorePer.textContent = done > 0 ? Math.round(r.scorePerLap) + ' 分' : '—';
        if (el.loopFinal) el.loopFinal.textContent = String(r.final) + ' 分';
        if (el.loopGrade) el.loopGrade.textContent = r.grade + ' 级';
      }
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
          '所以一路都在掉速。把 Kp 往上调一点（或 Kd 加一点压住摆动），圈速会明显变快。' +
          '如果车是「整条赛道都贴在同一边」而不是左右摆，那就是机械跑偏造成的稳态偏差 —— 加一点 Ki（从 0.1 试起）能补掉它。';
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
      if (el.ki) el.ki.value = (s.ki || 0).toFixed(2);
      el.speed.value = String(s.speed);
      syncLabels();
      reset(false);
      notifySliders();
      setStatus('已按教程设好参数：Kp=' + s.kp.toFixed(2) + '、Ki=' + (s.ki || 0).toFixed(2) +
        '、Kd=' + s.kd.toFixed(2) + '、车速=' + s.speed + '。按「开始挑战」跑一圈看看。');
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
          '（L3 用默认参数要 17 秒多、还会压线 3 秒，调好之后 11 秒以内）；' +
          '想一次看完整条赛道、按圈数算综合成绩，就切到「🔄 循环赛」。想再走一遍就点「新手教程」。');
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

    /* 只负责「界面开关」：哪个读数面板显示、哪个按钮高亮 */
    function syncModeUI() {
      if (el.readLap) el.readLap.hidden = mode !== 'lap';
      if (el.readScore) el.readScore.hidden = mode !== 'score';
      if (el.readLoop) el.readLoop.hidden = mode !== 'loop';
      if (el.durSel) el.durSel.hidden = mode !== 'score';
      if (el.lapsSel) el.lapsSel.hidden = mode !== 'loop';
      if (el.modeLap) {
        el.modeLap.classList.toggle('active', mode === 'lap');
        el.modeScore.classList.toggle('active', mode === 'score');
        if (el.modeLoop) el.modeLoop.classList.toggle('active', mode === 'loop');
      }
      el.run.textContent = mode === 'score' ? '开始得分赛'
        : (mode === 'loop' ? '开始循环赛' : '开始挑战');
    }

    /* 进环形赛道（循环赛专用）：把赛道切过去，滑杆用环形赛道的基准车速 */
    function enterLoopTrack() {
      level = LOOP_ID;
      if (el.level) el.level.value = String(LOOP_ID);
      showSeedRow(false);
      var lv = levelOf(LOOP_ID);
      level = LOOP_ID;
      el.speed.value = String(lv.speed);
      syncLabels();
      reset(false);
    }

    function setMode(m) {
      mode = (m === 'score') ? 'score' : (m === 'loop' ? 'loop' : 'lap');
      syncModeUI();

      if (mode === 'loop') {
        loopLaps = Math.max(1, Number(el.lapsSel && el.lapsSel.value) || loopLaps);
        enterLoopTrack();
        showBestLoop();
        setStatus('循环赛：右侧是整条环形赛道的全貌，一次跑 ' + loopLaps +
          ' 圈，每圈都记时间。跑完按「平均圈速 + 贴线率」给综合成绩（' +
          '综合分 = 贴线率 × 基准圈速 ÷ 你的平均圈速 × 100）。' +
          '压到赛道外不再直接出局，而是记 2 倍罚时、拉低成绩。按「开始循环赛」起步。');
        return;
      }

      /* 从循环赛切回普通赛道 */
      if (level === LOOP_ID) {
        level = 1;
        if (el.level) el.level.value = '1';
        var lv0 = levelOf(1);
        el.speed.value = String(lv0.speed);
        syncLabels();
      }
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

    /* 循环赛的画面：俯视整条环形赛道（静态全貌，不滚动） */
    function drawLoop(lv) {
      var g = lv.geom, M = g.M;
      /* ① 自适应缩放：整条赛道连同路面都要放进画面 */
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, i, p;
      for (i = 0; i < M; i++) {
        p = g.pts[i];
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      var pad = lv.limit * 1.9 + 6;
      minX -= pad; maxX += pad; minY -= pad; maxY += pad;
      var sc = Math.min(W / (maxX - minX), (H - 8) / (maxY - minY));
      var ox = (W - (maxX - minX) * sc) / 2 - minX * sc;
      var oy = (H - (maxY - minY) * sc) / 2 - minY * sc;
      function TX(x) { return ox + x * sc; }
      function TY(y) { return oy + y * sc; }

      ctx.clearRect(0, 0, W, H);
      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b1c3f');
      bg.addColorStop(0.5, '#16306b');
      bg.addColorStop(1, '#0b1c3f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      var step = 4;                                   // 每 4 个采样点画一次，够平滑又省性能
      /* ② 白色路面：外边界顺着走一圈，再沿内边界倒着走回来 */
      ctx.beginPath();
      for (i = 0; i <= M; i += step) {
        var k = i % M, q = g.pts[k], n0 = g.nor[k];
        var x1 = TX(q[0] + n0[0] * lv.limit), y1 = TY(q[1] + n0[1] * lv.limit);
        if (i === 0) ctx.moveTo(x1, y1); else ctx.lineTo(x1, y1);
      }
      for (i = M; i >= 0; i -= step) {
        var k2 = i % M, q2 = g.pts[k2], n2 = g.nor[k2];
        ctx.lineTo(TX(q2[0] - n2[0] * lv.limit), TY(q2[1] - n2[1] * lv.limit));
      }
      ctx.closePath();
      var road = ctx.createLinearGradient(0, 0, 0, H);
      road.addColorStop(0, '#ffffff');
      road.addColorStop(0.5, '#eef6ff');
      road.addColorStop(1, '#ffffff');
      ctx.fillStyle = road;
      ctx.fill();

      /* ③ 两条蓝色边线 */
      ctx.strokeStyle = 'rgba(37,99,235,0.80)';
      ctx.lineWidth = 2;
      [1, -1].forEach(function (sgn) {
        ctx.beginPath();
        for (i = 0; i <= M; i += step) {
          var k3 = i % M, q3 = g.pts[k3], n3 = g.nor[k3];
          var px3 = TX(q3[0] + sgn * n3[0] * lv.limit), py3 = TY(q3[1] + sgn * n3[1] * lv.limit);
          if (i === 0) ctx.moveTo(px3, py3); else ctx.lineTo(px3, py3);
        }
        ctx.stroke();
      });

      /* ④ 路的正中间（淡线，用来看清走线是往内侧切的）+ 理想走线（蓝色虚线 = 要贴的线） */
      ctx.strokeStyle = 'rgba(37,99,235,0.30)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (i = 0; i <= M; i += step) {
        var k4 = i % M, q4 = g.pts[k4];
        var px4 = TX(q4[0]), py4 = TY(q4[1]);
        if (i === 0) ctx.moveTo(px4, py4); else ctx.lineTo(px4, py4);
      }
      ctx.stroke();

      ctx.setLineDash([13, 10]);
      ctx.strokeStyle = 'rgba(29,78,216,0.9)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (i = 0; i <= M; i += step) {
        var k5 = i % M, q5 = g.pts[k5], n5 = g.nor[k5], e5 = lv.y(g.cum[k5]);
        var px5 = TX(q5[0] + n5[0] * e5), py5 = TY(q5[1] + n5[1] * e5);
        if (i === 0) ctx.moveTo(px5, py5); else ctx.lineTo(px5, py5);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      /* ⑤ 起点 / 终点线（深绿，横跨路面） */
      var s0 = g.pointAt(0);
      ctx.strokeStyle = 'rgba(15,122,79,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(TX(s0.x + s0.nx * lv.limit), TY(s0.y + s0.ny * lv.limit));
      ctx.lineTo(TX(s0.x - s0.nx * lv.limit), TY(s0.y - s0.ny * lv.limit));
      ctx.stroke();

      /* ⑥ 车、目标点、偏差连线 */
      if (state) {
        var sx = state.x % g.len; if (sx < 0) sx += g.len;
        var cp = g.pointAt(sx);
        var carX = TX(cp.x + cp.nx * state.y), carY = TY(cp.y + cp.ny * state.y);
        var tgtE = lv.y(sx);
        var tgX = TX(cp.x + cp.nx * tgtE), tgY = TY(cp.y + cp.ny * tgtE);
        var ang = Math.atan2(cp.ty, cp.tx);

        ctx.beginPath();
        ctx.arc(tgX, tgY, 6, 0, Math.PI * 2);
        ctx.fillStyle = flash > 0 ? '#e11d48' : '#0f7a4f';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(carX, carY); ctx.lineTo(tgX, tgY);
        ctx.strokeStyle = 'rgba(217,119,6,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.save();
        ctx.translate(carX, carY);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(13, 0); ctx.lineTo(-8, -7); ctx.lineTo(-4, 0); ctx.lineTo(-8, 7);
        ctx.closePath();
        ctx.fillStyle = flash > 0 ? '#e11d48' : '#0e1c2e';
        ctx.strokeStyle = flash > 0 ? '#ffffff' : '#f59e0b';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      /* ⑦ 进度条 + 深色小牌子（和竞速模式同一套视觉） */
      var total = loopLaps * g.len;
      var prog = state ? Math.max(0, Math.min(1, state.x / total)) : 0;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(0, H - 7, W, 4);
      var grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#fbbf24'); grad.addColorStop(0.5, '#34d399'); grad.addColorStop(1, '#38bdf8');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H - 7, W * prog, 4);

      function chip(x, y, w, h, r) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fillStyle = 'rgba(9,25,52,0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }
      function chipText(text, x, y, color, size) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.fillStyle = color || '#f2f8ff';
        ctx.font = 'bold ' + (size || 13) + 'px ui-monospace, Consolas, monospace';
        ctx.fillText(text, x, y);
        ctx.restore();
      }

      var legend = '白＝赛道　蓝＝赛道外　蓝虚线＝理想走线（要贴这条）';
      ctx.font = 'bold 13px ui-monospace, Consolas, monospace';
      var lw2 = ctx.measureText(legend).width;
      chip(14, H - 48, lw2 + 24, 28, 9);
      chipText(legend, 26, H - 29);

      var done = lapTimes.length;
      var info = '第 ' + Math.min(done + 1, loopLaps) + ' / ' + loopLaps + ' 圈　本圈 ' +
        (elapsed - lastLapAt).toFixed(1) + ' s' +
        (done > 0 ? '　上圈 ' + lapTimes[done - 1].toFixed(2) + ' s' : '');
      ctx.font = 'bold 13px ui-monospace, Consolas, monospace';
      var iw = ctx.measureText(info).width;
      var chipW = iw + 24;
      chip(W - chipW - 14, 14, chipW, 28, 9);
      chipText(info, W - chipW - 2, 33);
    }

    function draw() {
      var lv = levelOf(level);
      if (lv.geom) { drawLoop(lv); return; }          // 环形赛道：俯视全貌
      var camX = state ? state.x : 0;
      var range = 300;
      var x0 = camX - range * 0.3;
      var x1 = camX + range * 0.7;
      var midY = H / 2;
      /* 纵向缩放：让「振幅 + 赛道半宽」刚好铺满画面（上下各留 10px），
         这样每条赛道的白色路面都尽可能大、也不会被画面切掉 */
      var amp = Math.max(1, Math.max(Math.abs(lv.y(0)), Math.abs(lv.y(Math.PI * 160))));
      var scale = Math.min(2.6, Math.max(1.1, (H / 2 - 10) / (amp + lv.limit)));

      /* 配色：白 = 赛道面，蓝 = 赛道外 —— 一眼就能看出哪里能跑 */
      ctx.clearRect(0, 0, W, H);
      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b1c3f');
      bg.addColorStop(0.5, '#16306b');
      bg.addColorStop(1, '#0b1c3f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      /* 赛道外的网格（淡一点，只当背景纹理） */
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (var gx = Math.ceil(x0 / 50) * 50; gx < x1; gx += 50) {
        var gpx = (gx - x0) / (x1 - x0) * W;
        ctx.beginPath(); ctx.moveTo(gpx, 0); ctx.lineTo(gpx, H); ctx.stroke();
      }
      for (var gy = 40; gy < H; gy += 40) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      var N = 180;
      function path(offset) {                       // 沿赛道边界描一条折线
        ctx.beginPath();
        for (var i = 0; i <= N; i++) {
          var bx = x0 + (x1 - x0) * (i / N);
          var by = midY - (lv.y(bx) + offset) * scale;
          if (i === 0) ctx.moveTo(0, by); else ctx.lineTo((i / N) * W, by);
        }
      }
      function band(offset) {                       // 把边界连成一条闭合的带子
        path(offset);
        for (var i = N; i >= 0; i--) {
          var bx = x0 + (x1 - x0) * (i / N);
          ctx.lineTo((i / N) * W, midY - (lv.y(bx) - offset) * scale);
        }
        ctx.closePath();
      }
      function stroke(offset, style, width, dash) {
        path(offset);
        ctx.setLineDash(dash || []);
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      /* ① 赛道面 = 白色（带一点渐变，看起来有立体感） */
      band(lv.limit);
      var road = ctx.createLinearGradient(0, 0, 0, H);
      road.addColorStop(0, '#ffffff');
      road.addColorStop(0.5, '#eef6ff');
      road.addColorStop(1, '#ffffff');
      ctx.fillStyle = road;
      ctx.fill();

      /* ② 得分赛的「完美区」（中线附近 10% 宽）涂成淡橙：贴住它有 1.5 倍奖励 */
      if (mode === 'score') {
        band(lv.limit * (1 - PERFECT_COEF));
        ctx.fillStyle = 'rgba(245,158,11,0.22)';
        ctx.fill();
      }

      /* ③ 两条蓝色边线 + 蓝色中线虚线：白色赛道上非常醒目 */
      stroke(lv.limit, 'rgba(37,99,235,0.80)', 2.5, []);
      stroke(-lv.limit, 'rgba(37,99,235,0.80)', 2.5, []);
      stroke(0, 'rgba(29,78,216,0.85)', 2.2, [12, 10]);

      /* 起点 / 终点线：只画在赛道面里，深绿实线 */
      ctx.strokeStyle = 'rgba(15,122,79,0.85)';
      ctx.lineWidth = 3;
      [0, LAP].forEach(function (lx) {
        var lpx = (lx - x0) / (x1 - x0) * W;
        if (lpx < -4 || lpx > W + 4) return;
        ctx.beginPath();
        ctx.moveTo(lpx, midY - (lv.y(lx) + lv.limit) * scale);
        ctx.lineTo(lpx, midY - (lv.y(lx) - lv.limit) * scale);
        ctx.stroke();
      });

      if (state) {
        var cx = (state.x - x0) / (x1 - x0) * W;
        var cy = midY - state.y * scale;
        var ty = midY - lv.y(state.x) * scale;
        var tilt = Math.atan2(-(lv.y(state.x + 12) - lv.y(state.x)) * scale, (12 / (x1 - x0)) * W);

        /* 目标点（此刻赛道上该在的位置）：深绿圆点 + 白圈，白赛道上很显眼 */
        ctx.beginPath();
        ctx.arc(cx, ty, 6, 0, Math.PI * 2);
        ctx.fillStyle = flash > 0 ? '#e11d48' : '#0f7a4f';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        /* 偏差连线：车离中线偏了多少，一眼可见 */
        ctx.beginPath();
        ctx.moveTo(cx, cy); ctx.lineTo(cx, ty);
        ctx.strokeStyle = 'rgba(217,119,6,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();

        /* 小车：深色车身 + 琥珀描边 —— 白色赛道上和蓝色赛道外都看得清 */
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.beginPath();
        ctx.moveTo(12, 0); ctx.lineTo(-7, -6.5); ctx.lineTo(-3.5, 0); ctx.lineTo(-7, 6.5);
        ctx.closePath();
        ctx.fillStyle = flash > 0 ? '#e11d48' : '#0e1c2e';
        ctx.strokeStyle = flash > 0 ? '#ffffff' : '#f59e0b';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      /* 进度条 */
      var prog = state ? Math.min(1, state.x / lapLenOf(level)) : 0;
      if (mode === 'score') prog = dur > 0 ? Math.min(1, elapsed / dur) : 0;   // 得分赛显示时间进度
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(0, H - 7, W, 4);
      var grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#fbbf24'); grad.addColorStop(0.5, '#34d399'); grad.addColorStop(1, '#38bdf8');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H - 7, W * prog, 4);

      /* 深色小牌子 + 亮字：压在白色赛道上或蓝色赛道外都一样清楚 */
      function chip(x, y, w, h, r) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fillStyle = 'rgba(9,25,52,0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }
      function chipText(text, x, y, color, size) {
        ctx.save();
        ctx.textAlign = 'left';
        ctx.fillStyle = color || '#f2f8ff';
        ctx.font = 'bold ' + (size || 13) + 'px ui-monospace, Consolas, monospace';
        ctx.fillText(text, x, y);
        ctx.restore();
      }

      /* 图例：随时提醒「白的是赛道、蓝的是赛道外」 */
      var legend = mode === 'score' ? '白＝赛道　蓝＝赛道外　橙＝完美区(1.5×)' : '白＝赛道　蓝＝赛道外';
      ctx.font = 'bold 13px ui-monospace, Consolas, monospace';
      var legendW = ctx.measureText(legend).width;
      chip(14, H - 48, legendW + 24, 28, 9);
      chipText(legend, 26, H - 29);

      /* 得分赛：右上角一块牌子显示实时得分、剩余时间；左上角一块显示贴线率 */
      if (mode === 'score') {
        var cw = 210, chH = 68, cx0 = W - cw - 14, cy0 = 14;
        chip(cx0, cy0, cw, chH, 12);
        ctx.save();
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 26px ui-monospace, Consolas, monospace';
        ctx.fillText(String(Math.round(score)), cx0 + cw - 14, cy0 + 32);
        ctx.font = '12px ui-monospace, Consolas, monospace';
        ctx.fillStyle = 'rgba(206,226,250,0.92)';
        ctx.fillText('得分 · 剩余 ' + Math.max(0, dur - elapsed).toFixed(1) + ' s · 第 ' + (lapsDone + 1) + ' 圈',
          cx0 + cw - 14, cy0 + 52);
        ctx.restore();

        var rateTxt = '贴线率 ' + (elapsed > 0.5 ? Math.round(coefSum / elapsed * 100) + '%' : '—');
        ctx.font = 'bold 13px ui-monospace, Consolas, monospace';
        var rateW = ctx.measureText(rateTxt).width;
        chip(14, 14, rateW + 24, 28, 9);
        chipText(rateTxt, 26, 33);
      }
    }

    /* ---------------------- 实时波形图（真实数据的实时反馈） ----------------------
       画的是小车**此刻**的两条曲线（最近 8 秒，跟着车一起滚）：
         · 琥珀色 = 偏差 e（车离理想走线差多少），上下虚线是赛道半宽
         · 青色   = 舵量 u（控制器此刻给出的转向指令）
       这两条就是 PID 真正在算的东西，所以调参的效果不用猜 —— 直接看波形：
         · 上下乱跳、频率很高 → Kp 太大或 Kd 不够
         · 一直朝同一边偏着不回来 → 机械跑偏留下的稳态偏差，要加 Ki
         · 平滑地贴着零线 → 就是调好了
       ★ 只在按下开始、并且画布在视野里时才画（和主画面同一条循环），
         没有画布时整段安静跳过。 */

    var SCOPE_WIN = 8;                     // 窗口长度（秒）

    function scopeReset() {
      trace = [];
      var lv = levelOf(level);
      scE = Math.max(8, lv.limit * 1.2);
      scU = 60;
    }

    function scopePush() {
      if (!state || !scopeCtx) return;
      trace.push({ t: elapsed, e: state.err, u: state.steer });
      while (trace.length && elapsed - trace[0].t > SCOPE_WIN) trace.shift();
      var aE = Math.abs(state.err), aU = Math.abs(state.steer);
      if (isFinite(aE) && aE * 1.06 > scE) scE = aE * 1.06;
      if (isFinite(aU) && aU * 1.06 > scU) scU = Math.min(aU * 1.06, MAX_LAT);
    }

    function drawScope() {
      if (!scopeCtx) return;
      var lv = levelOf(level);
      var c = scopeCtx, W2 = scopeW, H2 = scopeH;
      var L = 16, R = W2 - 16;
      var A0 = 22, A1 = 100, AC = (A0 + A1) / 2;         // 偏差面板
      var B0 = 128, B1 = 206, BC = (B0 + B1) / 2;        // 舵量面板
      var tNow = trace.length ? trace[trace.length - 1].t : 0;
      var t0 = tNow - SCOPE_WIN;
      function X(t) { return L + (t - t0) / SCOPE_WIN * (R - L); }
      function YE(e) { var v = -e / scE; if (v > 1) v = 1; else if (v < -1) v = -1; return AC + v * (A1 - A0) / 2; }
      function YU(u) { var v = -u / scU; if (v > 1) v = 1; else if (v < -1) v = -1; return BC + v * (B1 - B0) / 2; }

      c.clearRect(0, 0, W2, H2);
      var bg = c.createLinearGradient(0, 0, 0, H2);
      bg.addColorStop(0, '#070e1c');
      bg.addColorStop(1, '#0b1729');
      c.fillStyle = bg;
      c.fillRect(0, 0, W2, H2);

      /* 一秒一条时间网格 */
      c.strokeStyle = 'rgba(120,200,255,0.09)';
      c.lineWidth = 1;
      for (var gs = Math.ceil(t0); gs <= tNow; gs += 1) {
        var gx = X(gs);
        c.beginPath(); c.moveTo(gx, A0); c.lineTo(gx, A1); c.stroke();
        c.beginPath(); c.moveTo(gx, B0); c.lineTo(gx, B1); c.stroke();
      }

      /* 面板底色 */
      c.fillStyle = 'rgba(255,255,255,0.025)';
      c.fillRect(L, A0, R - L, A1 - A0);
      c.fillRect(L, B0, R - L, B1 - B0);

      /* 得分赛：标出「完美区」（中线附近 10% 宽，贴住有 1.5 倍奖励） */
      if (mode === 'score') {
        var pe = lv.limit * (1 - PERFECT_COEF);
        c.fillStyle = 'rgba(245,158,11,0.16)';
        c.fillRect(L, YE(pe), R - L, YE(-pe) - YE(pe));
      }

      /* 偏差面板：零线 + 赛道半宽虚线 */
      c.setLineDash([6, 5]);
      c.strokeStyle = 'rgba(255,202,87,0.45)';
      c.lineWidth = 1;
      [lv.limit, -lv.limit].forEach(function (lv2) {
        c.beginPath(); c.moveTo(L, YE(lv2)); c.lineTo(R, YE(lv2)); c.stroke();
      });
      c.setLineDash([]);
      c.strokeStyle = 'rgba(120,200,255,0.35)';
      c.beginPath(); c.moveTo(L, AC); c.lineTo(R, AC); c.stroke();

      /* 舵量面板：零线 */
      c.strokeStyle = 'rgba(120,200,255,0.35)';
      c.beginPath(); c.moveTo(L, BC); c.lineTo(R, BC); c.stroke();

      /* 压线区间：淡红竖条（一眼看出什么时候出界了）—— 整段一次画完，省性能 */
      c.strokeStyle = 'rgba(255,90,130,0.30)';
      c.lineWidth = 2;
      c.beginPath();
      for (var k = 1; k < trace.length; k++) {
        if (Math.abs(trace[k].e) > lv.limit || Math.abs(trace[k - 1].e) > lv.limit) {
          var ox = X(trace[k].t);
          c.moveTo(ox, A0); c.lineTo(ox, B1);
        }
      }
      c.stroke();

      if (trace.length > 1) {
        /* 偏差曲线 */
        var i, xs, ys;
        xs = []; ys = [];
        for (i = 0; i < trace.length; i += 1) { xs.push(X(trace[i].t)); ys.push(YE(trace[i].e)); }
        c.strokeStyle = '#ffca57';
        c.lineWidth = 2.2;
        c.beginPath();
        for (i = 0; i < xs.length; i++) { if (i === 0) c.moveTo(xs[i], ys[i]); else c.lineTo(xs[i], ys[i]); }
        c.stroke();

        /* 舵量曲线 */
        xs = []; ys = [];
        for (i = 0; i < trace.length; i += 1) { xs.push(X(trace[i].t)); ys.push(YU(trace[i].u)); }
        c.strokeStyle = '#27e0ff';
        c.lineWidth = 2;
        c.beginPath();
        for (i = 0; i < xs.length; i++) { if (i === 0) c.moveTo(xs[i], ys[i]); else c.lineTo(xs[i], ys[i]); }
        c.stroke();

        /* 右端当前值（跟着车动的小圆点） */
        var last = trace[trace.length - 1];
        c.fillStyle = '#ffca57';
        c.beginPath(); c.arc(X(last.t), YE(last.e), 4, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#27e0ff';
        c.beginPath(); c.arc(X(last.t), YU(last.u), 4, 0, Math.PI * 2); c.fill();
      }

      /* 面板标签与量程 */
      c.save();
      c.font = 'bold 16px ui-monospace, Consolas, monospace';
      c.textAlign = 'left';
      c.fillStyle = '#ffca57';
      c.fillText('偏差 e  ±' + Math.round(scE) + (mode === 'score' ? '　（橙色带 = 完美区 1.5×）' : ''), L + 10, A0 + 18);
      c.fillStyle = '#27e0ff';
      c.fillText('舵量 u  ±' + Math.round(scU), L + 10, B0 + 18);
      c.fillStyle = 'rgba(142,163,189,0.85)';
      c.font = '14px ui-monospace, Consolas, monospace';
      c.textAlign = 'right';
      c.fillText('现在', R - 4, B1 + 16);
      c.textAlign = 'left';
      c.fillText('−' + SCOPE_WIN + ' s', L, B1 + 16);
      if (trace.length < 2) {
        c.textAlign = 'center';
        c.fillStyle = 'rgba(191,233,255,0.8)';
        c.font = 'bold 17px ui-monospace, Consolas, monospace';
        c.fillText('按下「开始」后，这里会跟着车实时画出偏差和舵量两条曲线', W2 / 2, B0 - 14);
      }
      c.restore();
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
        var LEN = lapLenOf(level);
        lapsDone = Math.floor(state.x / LEN);
        if (mode === 'loop') {
          /* 每跑完一圈记一次时间（多圈成绩要按圈算） */
          while (lapTimes.length < lapsDone) {
            lapTimes.push(elapsed - lastLapAt);
            lastLapAt = elapsed;
          }
        }

        if (state.off && !wasOff) flash = 0.35;
        wasOff = state.off;
        if (flash > 0) flash = Math.max(0, flash - dt);

        updateReadouts();
        scopePush();

        var res = {
          finished: state.x >= LEN && state.offTime <= OFF_LIMIT,
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
        } else if (mode === 'loop') {
          if (lapTimes.length >= loopLaps) {                      // 跑满圈数 → 结算
            running = false;
            el.run.textContent = '再跑一轮';
            var r = loopNow();
            var bL = bestLoops();
            var isBestL = !bL[loopLaps] || r.final > bL[loopLaps];
            saveBestLoop(r.final);
            showBestLoop();
            setStatus('跑完 ' + loopLaps + ' 圈！平均圈速 ' + r.rawAvgLap.toFixed(2) + ' s（最快一圈 ' +
              r.bestLap.toFixed(2) + ' s，理想圈速 ' + r.idealLap.toFixed(2) + ' s）、贴线率 ' +
              Math.round(r.rate * 100) + '%、总得分 ' + r.score + ' 分（平均每圈 ' +
              Math.round(r.scorePerLap) + ' 分），赛道外累计 ' + r.offTime.toFixed(1) + ' s → 综合成绩 ' +
              r.final + ' 分（' + r.grade + ' 级）' + (isBestL ? ' —— 刷新了 ' + loopLaps + ' 圈最好成绩！' : '') +
              ' ' + loopTip(r));
          }
        } else if (state.offTime > OFF_LIMIT) {
          running = false;
          el.run.textContent = '再来一次';
          setStatus(diagnose(res));
        } else if (state.x >= LEN) {
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
      if (visible) { draw(); drawScope(); }     // 滚出屏幕就不画（省 CPU），回来时补一帧
      requestAnimationFrame(loop);
    }

    /* ------------------------------ 事件 ------------------------------ */

    el.run.addEventListener('click', function () {
      reset(true);
      setStatus(mode === 'score'
        ? '计时开始！越贴中线分越高 —— 现在拖 Kp / Ki / Kd 边跑边调。'
        : '跑起来了！现在拖 Kp / Ki / Kd 试试看 —— 抖得厉害就减小 Kp 或加大 Kd，老歪向同一边就加一点 Ki。');
      startLoop();                                             // ★ 用带守卫的启动，避免开第二条循环
    });

    [el.kp, el.kd, el.ki, el.speed].forEach(function (s) {
      if (!s) return;
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
        if (el.ki) el.ki.value = (Math.random() * 0.5).toFixed(2);
        syncLabels();
        notifySliders();
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
      if (id === LOOP_ID) { setMode('loop'); return; }        // 选环形赛道 = 进循环赛
      if (mode === 'loop') { mode = 'lap'; syncModeUI(); }    // 从循环赛换回普通赛道 = 回到计时赛
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
      showBestScore();
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
    if (el.modeLoop) el.modeLoop.addEventListener('click', function () { setMode('loop'); });
    if (el.lapsSel) {
      for (var li = 0; li < LOOP_LAPS.length; li++) {
        var opl = document.createElement('option');
        opl.value = String(LOOP_LAPS[li]);
        opl.textContent = LOOP_LAPS[li] + ' 圈';
        el.lapsSel.appendChild(opl);
      }
      el.lapsSel.value = String(loopLaps);
      el.lapsSel.addEventListener('change', function () {
        loopLaps = Math.max(1, Number(el.lapsSel.value) || 2);
        showBestLoop();
        reset(false);
        setStatus('这次跑 ' + loopLaps + ' 圈 —— 圈数越多越考验稳定性（贴线率会拉低综合分，所以别只顾着快）。');
      });
    }
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

    /* 画布不在视野 / 切标签页 → 暂停运算；回到视野且没在跑时补画一帧 */
    function refreshView() {
      if (running || !visible) return;
      draw();
      drawScope();
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          visible = en.isIntersecting;
          if (!visible) last = 0; else refreshView();
        });
      }, { threshold: 0.05 }).observe(cv);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { visible = false; last = 0; }
      else if (cv.getBoundingClientRect) {
        var r = cv.getBoundingClientRect();
        visible = r.bottom > 0 && r.top < window.innerHeight;
        refreshView();
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
      var opLoop = document.createElement('option');
      opLoop.value = String(LOOP_ID);
      opLoop.textContent = '🔄 环形赛道 · 看全貌（循环赛）';
      el.level.appendChild(opLoop);
      el.level.value = '1';
    }
    el.speed.value = String(levelOf(level).speed);
    syncLabels();
    showBest();
    showBestScore();
    showBestLoop();
    setMode('lap');
    state = createState(level);
    draw();
    drawScope();
    updateReadouts();
    setStatus('新人建议先点「新手教程」——五步带你调出一组能跑完的参数。' +
      '想换赛道就把上面的「赛道」换成「随机赛道」；想比「谁贴得准」切「得分赛」；' +
      '想看整条赛道、按圈数算综合成绩，就切「循环赛」。往下拉还有四张控制理论图，' +
      '会按你现在的参数实时画出来。');

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
