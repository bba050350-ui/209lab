/* ==========================================================================
   209 智能车实验室 · 招新站  ·  首页脚本
   --------------------------------------------------------------------------
   职责：把 config.js 的数据渲染成页面区块 + 首页交互（数字滚动 / FAQ 手风琴 /
   赛道小车动画 / 滚动进场 / 导航高亮）。
   全部原生 JS，无依赖；file:// 双击打开也能跑。
   ========================================================================== */

(function () {
  'use strict';

  var CFG = window.CONFIG || {};

  /* ------------------------------ 小工具 ------------------------------ */

  function byId(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setText(id, text) {
    var el = byId(id);
    if (el) el.textContent = String(text == null ? '' : text);
  }

  function setHtml(id, html) {
    var el = byId(id);
    if (el) el.innerHTML = html;
  }

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  /* --------------------------- 顶部文案 / 页脚 --------------------------- */

  function renderStaticText() {
    var site = CFG.site || {};
    var hours = (site.openHours && site.openHours[0]) || {};
    var hoursText = (hours.day && hours.time) ? hours.day + ' ' + hours.time + ' 基本都有人在' : '';

    setText('term-label', site.name || '209 智能车实验室');
    setText('hero-note', [site.room || '', hoursText].filter(Boolean).join(' · '));
    setText('visit-note', site.visitNote || '');
    setText('footer-left', site.name || '209 智能车实验室');
    setText('footer-right', (site.room || '') + ' · ' + (site.slogan || ''));
  }

  /* ---------------------------- 数字滚动 ---------------------------- */

  function renderStats() {
    var list = CFG.stats || [];
    setHtml('stat-band', list.map(function (s) {
      return '<div class="stat"><b><span class="count" data-to="' + esc(s.value) + '">0</span>' +
        (s.suffix ? '<span class="sfx">' + esc(s.suffix) + '</span>' : '') +
        '</b><span>' + esc(s.label) + '</span></div>';
    }).join(''));
  }

  function initCountUp() {
    var nodes = document.querySelectorAll('.count');
    if (!nodes.length) return;

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function run(el) {
      var to = Number(el.getAttribute('data-to')) || 0;
      if (reduce) { el.textContent = String(to); return; }
      var start = performance.now();
      var dur = 900 + Math.random() * 300;
      function step(now) {
        var p = clamp((now - start) / dur, 0, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = String(Math.round(to * eased));
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = String(to);
      }
      requestAnimationFrame(step);
    }

    if (!('IntersectionObserver' in window)) {
      for (var i = 0; i < nodes.length; i++) run(nodes[i]);
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          run(en.target);
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.4 });

    for (var k = 0; k < nodes.length; k++) io.observe(nodes[k]);
  }

  /* ---------------------------- 关键词跑马灯 ---------------------------- */

  function renderMarquee() {
    var words = [];
    (CFG.directions || []).forEach(function (d) {
      words.push({ icon: d.icon, text: d.name });
      (d.stack || []).forEach(function (s) { words.push({ icon: '·', text: s }); });
    });
    if (CFG.site && CFG.site.room) words.push({ icon: '📍', text: CFG.site.room });
    words.push({ icon: '🏁', text: '全国大学生智能汽车竞赛' });
    if (CFG.site && CFG.site.enName) words.push({ icon: '209', text: CFG.site.enName });

    var html = words.map(function (w) {
      return '<span><i>' + esc(w.icon) + '</i> ' + esc(w.text) + '</span>';
    }).join('');

    // 复制一份，配合 translateX(-50%) 形成无缝循环
    setHtml('marquee-track', html + html);
  }

  /* ------------------------------ 特点卡片 ------------------------------ */

  function renderFeatures() {
    setHtml('feature-grid', (CFG.features || []).map(function (f) {
      return '<div class="feature reveal">' +
        '<div class="fi">' + esc(f.icon) + '</div>' +
        '<div><h3>' + esc(f.title) + '</h3><p>' + esc(f.desc) + '</p></div>' +
        '</div>';
    }).join(''));
  }

  /* --------------------------- 对考研 / 找工作的帮助 --------------------------- */

  function renderCareer() {
    setHtml('career-grid', (CFG.career || []).map(function (c) {
      return '<div class="feature reveal">' +
        '<div class="fi">' + esc(c.icon) + '</div>' +
        '<div><h3>' + esc(c.title) + '</h3><p>' + esc(c.desc) + '</p></div>' +
        '</div>';
    }).join(''));
  }

  /* ------------------------------ 技术方向 ------------------------------ */

  function renderDirections() {
    var dirs = CFG.directions || [];
    setHtml('dir-grid', dirs.map(function (d) {
      var tags = (d.stack || []).map(function (s) {
        return '<span class="tag">' + esc(s) + '</span>';
      }).join('');
      var tasks = (d.tasks || []).map(function (t) {
        return '<li>' + esc(t) + '</li>';
      }).join('');
      return '<article class="direction reveal" id="dir-' + esc(d.id) + '" style="--dc:' + esc(d.color || '#27e0ff') + '">' +
        '<div class="d-head">' +
          '<div class="d-icon">' + esc(d.icon) + '</div>' +
          '<div><h3 class="d-name">' + esc(d.name) + '</h3><p class="d-sum">' + esc(d.summary) + '</p></div>' +
        '</div>' +
        '<p class="d-desc">' + esc(d.desc) + '</p>' +
        (tasks ? '<ul class="d-tasks">' + tasks + '</ul>' : '') +
        (tags ? '<div class="taglist">' + tags + '</div>' : '') +
        '<p class="d-need">需要什么基础：' + esc(d.need) + '</p>' +
        '<div class="d-foot">' +
          '<a class="btn btn-ghost btn-sm" href="#visit">来 209 现场聊 →</a>' +
        '</div>' +
        '</article>';
    }).join(''));
  }

  /* ------------------------------ 赛事成果 ------------------------------ */

  function renderAwards() {
    setText('comps-intro', CFG.compsIntro || '');
    setText('projects-line', CFG.projects || '');

    /* 四项国家 A 类竞赛：每张卡一个大数字（国奖数量） */
    setHtml('comp-grid', (CFG.comps || []).map(function (c) {
      return '<article class="comp" style="--dc:' + esc(c.color || '#27e0ff') + '">' +
        '<div class="c-icon">' + esc(c.icon || '🏆') + '</div>' +
        '<h3 class="c-name">' + esc(c.name) + '</h3>' +
        '<div class="c-num"><b class="count" data-to="' + esc(c.national) + '">0</b><span>项国奖</span></div>' +
        '</article>';
    }).join(''));

    /* 累计成果数字 */
    setHtml('total-band', (CFG.totals || []).map(function (t) {
      return '<div class="stat"><b><span class="count" data-to="' + esc(t.value) + '">0</span>' +
        (t.suffix ? '<span class="sfx">' + esc(t.suffix) + '</span>' : '') +
        '</b><span>' + esc(t.label) + '</span></div>';
    }).join(''));
  }

  /* ------------------------------ 考研去向 ------------------------------ */

  function renderGrads() {
    setText('grads-intro', CFG.gradsIntro || '');
    setHtml('grad-grid', (CFG.grads || []).map(function (g) {
      return '<div class="grad">' +
        '<span class="g-year">' + esc(g.year) + '</span>' +
        '<span class="g-body"><b class="g-name">' + esc(g.name) + '</b>' +
        '<span class="g-school">' + esc(g.school) + '</span></span>' +
        '<span class="pill violet g-degree">' + esc(g.degree) + '</span>' +
        '</div>';
    }).join(''));
  }

  /* --------------------------- 联系方式（显眼位置） --------------------------- */
  /* 首屏 hero、联系我们、加入我们 三处共用同一套「点一下复制」的联系方式胶囊 */

  function contactItems() {
    var site = CFG.site || {};
    var c = site.contacts || {};
    var out = [];
    if (c.qq) out.push({ icon: '💬', key: 'QQ', value: c.qq, copy: true });
    if (c.douyin) out.push({ icon: '🎵', key: '抖音', value: c.douyin, copy: true });
    if (c.wechat) out.push({ icon: '🟢', key: '微信', value: c.wechat, copy: true });
    if (c.email) out.push({ icon: '✉️', key: '邮箱', value: c.email, copy: true });
    if (c.qqGroup) {
      out.push({ icon: '👥', key: 'QQ 群', value: c.qqGroup + (c.qqGroupName ? '（' + c.qqGroupName + '）' : ''), copy: true });
    }
    if (site.room) {
      out.push({
        icon: '📍', key: '地址',
        value: site.room + (site.roomAlias ? '（' + site.roomAlias + '）' : ''),
        copy: false, href: '#visit'
      });
    }
    return out;
  }

  function contactPills(items, cls) {
    return items.map(function (it) {
      var body = '<span class="cp-key">' + esc(it.icon + ' ' + it.key) + '</span>' +
        '<span class="cp-val">' + esc(it.value) + '</span>' +
        (it.copy ? '<span class="cp-hint">点击复制</span>' : '');
      if (it.copy) {
        return '<button type="button" class="contact-pill ' + (cls || '') + '" data-copy="' +
          esc(it.value) + '" title="点击复制">' + body + '</button>';
      }
      return '<a class="contact-pill ' + (cls || '') + '" href="' + esc(it.href || '#visit') + '">' + body + '</a>';
    }).join('');
  }

  function renderContacts() {
    var items = contactItems();
    setHtml('hero-contact', contactPills(items, 'pill-hero'));
    setHtml('contact-hero', contactPills(items, 'pill-big'));
    setHtml('join-contacts', contactPills(items, 'pill-cta'));

    /* 「联系我们」右下角的明细表 */
    setHtml('contact-grid', items.map(function (it) {
      return '<div class="contact-item"><div class="c-key">' + esc(it.key) + '</div>' +
        '<div class="c-val">' + esc(it.value) + '</div></div>';
    }).join(''));
  }

  /* --------------------------- 加入我们（CTA） --------------------------- */

  function renderJoinCta() {
    var cta = CFG.joinCta || {};
    var site = CFG.site || {};
    setText('join-title', cta.title || '');
    setText('join-lead', cta.lead || '');
    setText('join-tail', cta.tail || '');
    setText('join-addr', (site.room || '') +
      (site.roomAlias ? '（' + site.roomAlias + '）' : '') + ' · ' + (site.visitNote || ''));

    setHtml('join-actions', (cta.actions || []).map(function (a) {
      /* 目前只有「点击复制」一种；以后要加跳转链接，用 type: 'link' + value 放网址 */
      if (a.type === 'link') {
        return '<a class="btn btn-ghost" href="' + esc(a.value) + '" target="_blank" rel="noopener">' +
          esc(a.label) + '</a>';
      }
      return '<button type="button" class="btn btn-primary" data-copy="' + esc(a.value) + '">' +
        esc(a.label) + '：' + esc(a.value) + '</button>';
    }).join(''));
  }

  /* 页面上任何带 data-copy 的元素，点一下就复制（首屏胶囊 / 加入我们按钮共用一套） */
  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { done(true); },
        function () { done(fallbackCopy(text)); }
      );
      return;
    }
    done(fallbackCopy(text));
  }

  /* 非 HTTPS / 老浏览器：用一个看不见的 textarea + execCommand 兜底 */
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      if (ta.setSelectionRange) ta.setSelectionRange(0, text.length);
      var ok = document.execCommand && document.execCommand('copy');
      if (ta.parentNode) ta.parentNode.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  function initCopyButtons() {
    document.addEventListener('click', function (e) {
      var btn = (e.target && e.target.closest) ? e.target.closest('[data-copy]') : null;
      if (!btn) return;
      var text = btn.getAttribute('data-copy') || '';

      copyText(text, function (ok) {
        if (btn.classList.contains('contact-pill')) {
          /* 胶囊里有结构，不改文字，只临时把「点击复制」那行换成结果 */
          var hint = btn.querySelector ? btn.querySelector('.cp-hint') : null;
          btn.classList.add(ok ? 'copied' : 'copy-failed');
          if (hint) {
            if (!hint.dataset.origin) hint.dataset.origin = hint.textContent;
            hint.textContent = ok ? '已复制 ✓' : '请手动记录：' + text;
            setTimeout(function () {
              hint.textContent = hint.dataset.origin;
              btn.classList.remove('copied', 'copy-failed');
            }, 2200);
          }
        } else {
          flash(btn, ok ? '已复制 ' + text : '请手动记录：' + text);
        }
      });
    });
  }

  function flash(btn, msg) {
    if (!btn) return;
    if (!btn.dataset.origin) btn.dataset.origin = btn.textContent;
    btn.textContent = msg;
    btn.classList.add('is-flash');
    setTimeout(function () {
      btn.textContent = btn.dataset.origin;
      btn.classList.remove('is-flash');
    }, 2000);
  }

  /* --------------------------- 获奖证书墙（瀑布流） --------------------------- */

  function galleryData() {
    return window.GALLERY || {};
  }

  function renderGallery() {
    var g = galleryData();
    var items = g.items || [];
    setText('gallery-sub', g.sub || '');

    var empty = byId('gallery-empty');
    var grid = byId('gallery-grid');
    if (!grid) return;

    if (!items.length) {
      grid.innerHTML = '';
      if (empty) {
        empty.textContent = g.emptyText || '';
        empty.hidden = false;
      }
      return;
    }
    if (empty) empty.hidden = true;

    grid.innerHTML = items.map(function (it, i) {
      var ratio = (it.w && it.h) ? (it.h / it.w) : 1.34;      // 未知比例时按证书常见的竖版估
      var pad = Math.round(ratio * 1000) / 10;                // 用 padding-top 撑出比例，避免加载时跳动
      var cap = [it.title, it.meta].filter(Boolean).map(esc).join(' · ');
      return '<figure class="cert reveal" data-index="' + i + '">' +
        '<div class="cert-shot" style="padding-top:' + pad + '%">' +
          (it.year ? '<span class="cert-year">' + esc(it.year) + '</span>' : '') +
          '<img src="' + esc(it.thumb || it.src || '') + '" alt="' + cap + '" loading="lazy" decoding="async">' +
          '<span class="cert-zoom">点击看大图</span>' +
        '</div>' +
        '<figcaption class="cert-cap">' +
          '<b>' + esc(it.title || '') + '</b>' +
          (it.meta ? '<span>' + esc(it.meta) + '</span>' : '') +
        '</figcaption>' +
        '</figure>';
    }).join('');

    initLightbox(items);
  }

  function initLightbox(items) {
    var grid = byId('gallery-grid');
    if (!grid || grid.dataset.lightboxReady) return;
    grid.dataset.lightboxReady = '1';

    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<button type="button" class="lb-close" aria-label="关闭">✕</button>' +
      '<div class="lb-body"><img alt=""><div class="lb-cap"></div></div>';
    document.body.appendChild(box);

    var img = box.querySelector('img');
    var cap = box.querySelector('.lb-cap');
    var closeBtn = box.querySelector('.lb-close');
    if (!img || !cap || !closeBtn) return;      // 理论上不会发生，防御一下

    function open(i) {
      var it = items[i];
      if (!it) return;
      img.src = it.full || it.thumb || it.src || '';
      img.alt = [it.title, it.meta].filter(Boolean).join(' · ');
      cap.innerHTML = '<b>' + esc(it.title || '') + '</b>' +
        (it.meta ? '<span>' + esc(it.meta) + '</span>' : '') +
        (it.year ? '<span class="dim">' + esc(it.year) + '</span>' : '');
      box.classList.add('show');
      document.body.classList.add('no-scroll');
    }
    function close() {
      box.classList.remove('show');
      document.body.classList.remove('no-scroll');
      img.removeAttribute('src');
    }

    grid.addEventListener('click', function (e) {
      var fig = e.target.closest ? e.target.closest('.cert') : null;
      if (fig) open(Number(fig.getAttribute('data-index')));
    });
    closeBtn.addEventListener('click', close);
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && box.classList.contains('show')) close();
    });
  }

  /* --------------------------- 开放时间 / 联系方式 --------------------------- */

  function renderVisit() {
    var site = CFG.site || {};

    setHtml('hours-list', (site.openHours || []).map(function (h) {
      return '<div class="hours-row">' +
        '<span class="h-day">' + esc(h.day) + '</span>' +
        '<span class="h-time">' + esc(h.time) + '</span>' +
        '<span class="h-note">' + esc(h.note) + '</span>' +
        '</div>';
    }).join(''));
  }

  /* ------------------------------ FAQ ------------------------------ */

  function renderFaqs() {
    setHtml('faq-list', (CFG.faqs || []).map(function (f, i) {
      var aid = 'faq-a-' + i;
      return '<div class="faq-item">' +
        '<button class="faq-q" type="button" aria-expanded="false" aria-controls="' + aid + '">' +
          '<span class="q-mark">Q' + (i + 1) + '</span>' +
          '<span>' + esc(f.q) + '</span>' +
          '<span class="q-arrow" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="faq-a" id="' + aid + '">' + esc(f.a) + '</div>' +
        '</div>';
    }).join(''));
  }

  function initFaq() {
    var list = byId('faq-list');
    if (!list) return;
    list.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.faq-q') : null;
      if (!btn || !list.contains(btn)) return;
      var item = btn.parentNode;
      var isOpen = item.classList.contains('open');

      var opened = list.querySelectorAll('.faq-item.open');
      for (var i = 0; i < opened.length; i++) {
        opened[i].classList.remove('open');
        var b = opened[i].querySelector('.faq-q');
        if (b) b.setAttribute('aria-expanded', 'false');
      }

      if (!isOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  /* --------------------------- 滚动进场动画 --------------------------- */

  function initReveal() {
    var nodes = document.querySelectorAll('.reveal');
    if (!nodes.length) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.add('in');
      return;
    }
    if (!('IntersectionObserver' in window)) {
      for (var j = 0; j < nodes.length; j++) nodes[j].classList.add('in');
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var parent = el.parentNode;
        var idx = 0;
        if (parent && parent.children) {
          for (var k = 0; k < parent.children.length; k++) {
            if (parent.children[k] === el) { idx = k; break; }
          }
        }
        el.style.transitionDelay = Math.min(idx, 5) * 55 + 'ms';
        el.classList.add('in');
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    for (var m = 0; m < nodes.length; m++) io.observe(nodes[m]);
  }

  /* --------------------------- 导航当前区块高亮 --------------------------- */

  function initScrollSpy() {
    var links = document.querySelectorAll('#navlinks a[data-nav]');
    if (!links.length || !('IntersectionObserver' in window)) return;

    var map = {};
    var targets = [];
    for (var i = 0; i < links.length; i++) {
      var id = links[i].getAttribute('data-nav');
      var sec = byId(id);
      if (sec) { map[id] = links[i]; targets.push(sec); }
    }
    if (!targets.length) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.id;
        for (var key in map) {
          if (Object.prototype.hasOwnProperty.call(map, key)) map[key].classList.remove('active');
        }
        if (map[id]) map[id].classList.add('active');
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    targets.forEach(function (t) { io.observe(t); });
  }

  /* --------------------------- 赛道小车动画 --------------------------- */

  function initTrack() {
    var path = byId('track-path');
    var car = byId('track-car');
    var glow = byId('track-car-glow');
    var stage = document.querySelector('.track-stage');
    if (!path || !car || typeof path.getTotalLength !== 'function') return;

    var len = 0;
    try { len = path.getTotalLength(); } catch (e) { len = 0; }
    if (!len) return;

    var speedEl = byId('tm-speed');
    var steerEl = byId('tm-steer');
    var errEl = byId('tm-err');
    var lapEl = byId('tm-lap');
    var lapsEl = byId('tm-laps');

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var LAP_MS = 7200;                 // 一圈基准耗时
    var p = 0.08;                      // 归一化进度 [0,1)
    var laps = 0;
    var lapStart = 0;
    var lastLap = 0;
    var last = 0;
    var lastDom = 0;
    var visible = true;
    var raf = null;

    function pointAt(pp) { return path.getPointAtLength(((pp % 1) + 1) % 1 * len); }

    function headingAt(pp) {
      var a = pointAt(pp);
      var b = path.getPointAtLength(((((pp + 0.02) % 1) + 1) % 1) * len);
      return Math.atan2(b.y - a.y, b.x - a.x);
    }

    function curvatureAt(pp) {
      var h1 = headingAt(pp);
      var h2 = headingAt(pp + 0.05);
      var d = h2 - h1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d);
    }

    function render(p1) {
      var pt = pointAt(p1);
      var deg = headingAt(p1) * 180 / Math.PI;
      car.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ') rotate(' + deg.toFixed(1) + ')');
      if (glow) {
        glow.setAttribute('cx', pt.x.toFixed(1));
        glow.setAttribute('cy', pt.y.toFixed(1));
      }
    }

    function telemetry(p1, dt) {
      var curv = curvatureAt(p1);
      var factor = 1 / (1 + curv * 2.6);                 // 弯道减速
      var speed = 148 + 132 * factor;                    // 展示用车速值
      var h1 = headingAt(p1);
      var h2 = headingAt(p1 + 0.035);
      var d = h2 - h1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      var steer = clamp(d * 260, -100, 100);
      var err = (12 * Math.sin(p1 * len * 0.055) + 5.5 * Math.sin(p1 * len * 0.019 + 1.3)) * (1.6 - factor);

      if (speedEl) speedEl.textContent = Math.round(speed) + ' cm/s';
      if (steerEl) steerEl.textContent = (steer >= 0 ? '+' : '') + steer.toFixed(0);
      if (errEl) errEl.textContent = (err >= 0 ? '+' : '') + err.toFixed(1) + ' px';
      if (lapEl) lapEl.textContent = lastLap > 0 ? lastLap.toFixed(2) + 's' : '测圈中…';
      if (lapsEl) lapsEl.textContent = '已完成 ' + laps + ' 圈';
      return factor;
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!last) { last = now; return; }
      var dt = Math.min(now - last, 80);      // 切标签页回来时不要瞬移
      last = now;
      if (!visible) return;

      var factor = 1 / (1 + curvatureAt(p) * 2.6);
      var prev = p;
      p += (dt / LAP_MS) * factor;
      if (p >= 1) {
        p -= 1;
        laps += 1;
        if (lapStart) lastLap = (now - lapStart) / 1000;
        lapStart = now;
      }
      render(p);

      if (now - lastDom > 110) {
        lastDom = now;
        telemetry(prev, dt);
      }
    }

    render(p);

    if (reduce) {
      if (speedEl) speedEl.textContent = '待机';
      if (steerEl) steerEl.textContent = '0';
      if (errEl) errEl.textContent = '0.0 px';
      if (lapEl) lapEl.textContent = '--';
      if (lapsEl) lapsEl.textContent = '已按「减少动态效果」设置暂停动画';
      return;
    }

    lapStart = performance.now();
    raf = requestAnimationFrame(frame);

    // 离开视野 / 切到后台时暂停，回来再继续
    if (stage && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          visible = en.isIntersecting;
          if (!visible) last = 0;
        });
      }, { threshold: 0.05 }).observe(stage);
      visible = false;
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { visible = false; last = 0; }
      else if (stage) {
        var rect = stage.getBoundingClientRect();
        visible = rect.bottom > 0 && rect.top < window.innerHeight;
      }
    });
  }

  /* ------------------------------ 启动 ------------------------------ */

  function boot() {
    renderStaticText();
    renderStats();
    renderMarquee();
    renderFeatures();
    renderCareer();
    renderDirections();
    renderAwards();
    renderGrads();
    renderGallery();
    renderVisit();
    renderContacts();
    renderJoinCta();
    renderFaqs();

    initCountUp();
    initFaq();
    initReveal();
    initScrollSpy();
    initTrack();
    initCopyButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
