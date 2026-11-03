/* ============================================================
   历史人物人格原型 · 引擎
   ============================================================ */
(function () {
  'use strict';

  var AX = {}, order = [];
  AXES.forEach(function (a) { AX[a.key] = a; order.push(a.key); });

  var S = {
    idx: 0,
    maxIdx: 0,            // 已到达的最远题号（进度条用，不因返回而倒退）
    answers: [],          // 每题所选选项的下标
    scores: null,
    result: null
  };

  /* ---------- 计分 ---------- */
  function baseScores() {
    var o = {};
    order.forEach(function (k) { o[k] = 50; });
    return o;
  }

  function computeScores() {
    var sc = baseScores();
    for (var i = 0; i < S.answers.length; i++) {
      var q = QUESTIONS[i];
      var pick = q.opts[S.answers[i]];
      if (!pick) continue;
      for (var j = 0; j < order.length; j++) {
        sc[order[j]] += pick.d[j];
      }
    }
    // 归一到 0-100
    order.forEach(function (k) {
      sc[k] = Math.max(0, Math.min(100, Math.round(sc[k])));
    });
    return sc;
  }

  /* 加权画像匹配 + 相似度百分比
     权重来自离线标定：保证六个原型在随机作答下分布均衡（各约1/6），
     同时每个原型在某个维度上有清晰指纹，不至于互相吞并 */
  var W = { ju: 10, mo: 11, nei: 11, qin: 9, po: 11, yin: 9 };

  function profileScore(sc, vec) {
    var s = 0;
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      s += W[k] * (100 - Math.abs(sc[k] - vec[k]));
    }
    return s;
  }

  function rank(sc) {
    var maxS = 0, minS = 1e9, list = FIGURES.map(function (f) {
      var s = profileScore(sc, f.vec);
      if (s > maxS) maxS = s;
      if (s < minS) minS = s;
      return { f: f, score: s };
    });
    list.sort(function (a, b) { return b.score - a.score; });

    /* 百分比算法：
       绝对匹配度 = 该原型的加权画像分 / 理论满分 → 得到"像不像"；
       第一名的百分比再按它与第二名的差距上浮——匹配得越独占，越高。
       这样分布自然拉开，主副组合只在真的接近时才触发。 */
    var maxPossible = 0;
    for (var i = 0; i < order.length; i++) {
      maxPossible += W[order[i]] * 100;
    }
    var lead = (list[0].score - (list[1] ? list[1].score : 0)) / maxPossible;

    list.forEach(function (x, i) {
      var abs = x.score / maxPossible;                     // 0~1
      var pct;
      if (i === 0) {
        pct = 66 + abs * 18 + lead * 240;                  // 66~96
      } else {
        pct = 58 + abs * 26;                               // 58~84
      }
      x.pct = Math.round(Math.max(55, Math.min(97, pct)));
    });
    return list;
  }

  /* ---------- 结果生成 ---------- */
  function buildResult() {
    var sc = S.scores;
    var list = rank(sc);
    var top = list[0], second = list[1];

    // 找出最像的 2 个维度与最不像的 2 个维度
    var byGap = order.map(function (k) {
      var a = AX[k];
      var fv = top.f.vec[k];
      return {
        k: k, name: a.name,
        mine: sc[k], theirs: fv,
        gap: Math.abs(sc[k] - fv),
        dir: sc[k] > fv ? 'high' : 'low',
        hi: a.hi, lo: a.lo
      };
    });
    var closest = byGap.slice().sort(function (x, y) { return x.gap - y.gap; });
    var far = byGap.slice().sort(function (x, y) { return y.gap - x.gap; });

    var isBlend = (top.pct - second.pct) <= 3 && second.pct >= 55;
    var blendKey = top.f.name + '|' + second.f.name;
    var revKey = second.f.name + '|' + top.f.name;

    return {
      scores: sc,
      rank: list,
      top: top,
      second: second,
      isBlend: isBlend,
      blendNote: BLEND_NOTE[blendKey] || BLEND_NOTE[revKey] || null,
      closest: closest.slice(0, 2),
      farthest: far.slice(0, 2)
    };
  }

  /* ---------- DOM ---------- */
  function $(s) { return document.querySelector(s); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  var stageIntro = $('#stage-intro');
  var stageQuiz = $('#stage-quiz');
  var stageResult = $('#stage-result');

  function show(stage) {
    [stageIntro, stageQuiz, stageResult].forEach(function (s) {
      s.classList.add('hidden');
    });
    stage.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  /* ---------- 开始 ---------- */
  $('#btn-start').addEventListener('click', function () {
    S.idx = 0;
    S.answers = [];
    show(stageQuiz);
    renderQuestion();
  });

  /* ---------- 答题 ---------- */
  function renderQuestion() {
    var q = QUESTIONS[S.idx];
    $('#q-progress-text').textContent = (S.idx + 1) + ' / ' + QUESTIONS.length;
    // 进度条只前进，不因返回而倒退
    var done = Math.min(S.idx, S.maxIdx || 0);
    $('#q-progress-fill').style.width =
      (done / QUESTIONS.length * 100) + '%';
    $('#q-title').textContent = q.q;
    $('#q-body').textContent = '第 ' + (S.idx + 1) + ' 题' +
      (S.answers[S.idx] != null ? ' · 已选，可重新选择' : '');
    if (S.idx > (S.maxIdx || 0)) S.maxIdx = S.idx;

    var opts = $('#q-options');
    opts.innerHTML = '';
    q.opts.forEach(function (o, i) {
      var b = el('button', 'opt');
      b.type = 'button';
      // 从上一题返回时，标出已选项
      if (S.answers[S.idx] === i) b.classList.add('picked');
      b.appendChild(el('span', 'opt-mark', 'ABCD'.charAt(i)));
      b.appendChild(el('span', 'opt-text', o.t));
      b.addEventListener('click', function () { pick(i); });
      opts.appendChild(b);
    });

    $('#btn-back').style.visibility = S.idx === 0 ? 'hidden' : 'visible';
  }

  function pick(i) {
    S.answers[S.idx] = i;
    var btns = document.querySelectorAll('#q-options .opt');
    btns.forEach(function (b, k) {
      b.classList.toggle('picked', k === i);
      b.disabled = true;
    });
    setTimeout(function () {
      S.idx++;
      if (S.idx >= QUESTIONS.length) {
        S.scores = computeScores();
        S.result = buildResult();
        renderResult();
        show(stageResult);
      } else {
        renderQuestion();
      }
    }, 220);
  }

  $('#btn-back').addEventListener('click', function () {
    if (S.idx === 0) return;
    S.idx--;
    renderQuestion();
  });

  /* ---------- 结果 ---------- */
  function renderResult() {
    var R = S.result, f = R.top.f;

    $('#r-alias').textContent = f.dyn;
    $('#r-name').textContent = f.name;
    $('#r-tag').textContent = f.tag;
    $('#r-pct').textContent = R.top.pct;
    $('#r-intro').textContent = f.intro;

    // 主色
    document.documentElement.style.setProperty('--main', f.color);

    // 相似/相异维度条
    var bars = $('#r-bars');
    bars.innerHTML = '';
    var shown = [];
    R.closest.concat(R.farthest).forEach(function (d) {
      if (shown.indexOf(d.k) >= 0) return;
      shown.push(d.k);
      var wrap = el('div', 'bar-row');
      var top2 = el('div', 'bar-top');
      top2.appendChild(el('span', 'bar-name', d.name));
      top2.appendChild(el('span', 'bar-val',
        '你 ' + d.mine + ' · ' + f.name + ' ' + d.theirs));
      var track = el('div', 'bar-track');
      var mine = el('div', 'bar-mine');
      mine.style.width = d.mine + '%';
      var theirs = el('div', 'bar-theirs');
      theirs.style.width = d.theirs + '%';
      track.appendChild(mine);
      track.appendChild(theirs);
      wrap.appendChild(top2);
      wrap.appendChild(track);
      bars.appendChild(wrap);
    });

    // 图例
    var lg = el('div', 'bar-legend');
    lg.innerHTML = '<span><i style="background:var(--main)"></i>你</span>' +
      '<span><i style="background:var(--gold)"></i>' + f.name + '</span>';
    bars.appendChild(lg);

    // 组合提示
    var bn = $('#r-blend');
    if (R.isBlend && R.blendNote) {
      bn.classList.remove('hidden');
      bn.innerHTML = '<div class="blend-tag">主 ' + R.top.f.name +
        ' · 副 ' + R.second.f.name + '（相似度 ' + R.second.pct + '%）</div>' +
        '<p>' + R.blendNote + '</p>';
    } else {
      bn.classList.add('hidden');
    }

    // 像在哪
    var hooks = $('#r-hooks');
    hooks.innerHTML = '';
    f.hooks.forEach(function (h) {
      var item = el('div', 'hook');
      item.appendChild(el('div', 'hook-h', h.h));
      item.appendChild(el('p', 'hook-t', h.t));
      item.appendChild(el('div', 'hook-s', '—— ' + h.s));
      hooks.appendChild(item);
    });

    // 差异
    var diffs = $('#r-diffs');
    diffs.innerHTML = '';
    f.diffs.forEach(function (d) {
      var li = el('li');
      li.textContent = d;
      diffs.appendChild(li);
    });

    // 建议
    var adv = $('#r-advice');
    adv.innerHTML = '';
    f.advice.forEach(function (a, i) {
      var item = el('div', 'adv');
      item.appendChild(el('span', 'adv-n', String(i + 1)));
      item.appendChild(el('span', 'adv-t', a));
      adv.appendChild(item);
    });

    // 引文
    $('#r-quote-t').textContent = '「' + f.quote.t + '」';
    $('#r-quote-s').textContent = '—— ' + f.quote.s;

    // 全部候选
    var cand = $('#r-cands');
    cand.innerHTML = '';
    R.rank.forEach(function (x, i) {
      var row = el('div', 'cand' + (i === 0 ? ' cand-top' : ''));
      row.appendChild(el('span', 'cand-n', x.f.name));
      var t = el('div', 'cand-track');
      var b = el('div', 'cand-fill');
      b.style.width = x.pct + '%';
      b.style.background = x.f.color;
      t.appendChild(b);
      row.appendChild(t);
      row.appendChild(el('span', 'cand-p', x.pct + '%'));
      cand.appendChild(row);
    });

    $('#r-disclaimer').textContent = DISCLAIMER;
    $('#r-date').textContent = formatDate();
  }

  function formatDate() {
    var d = new Date();
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /* ---------- 重测 ---------- */
  $('#btn-again').addEventListener('click', function () {
    S.idx = 0; S.maxIdx = 0; S.answers = []; S.scores = null; S.result = null;
    show(stageIntro);
  });

  /* ---------- 复制结果文案 ---------- */
  $('#btn-copy').addEventListener('click', function () {
    var R = S.result, f = R.top.f;
    var lines = [];
    lines.push('【你像哪个历史人物】');
    lines.push('我的结果是：' + f.name + '（' + f.dyn + '），相似度 ' + R.top.pct + '%');
    lines.push('');
    lines.push(f.intro);
    lines.push('');
    lines.push('像在这里：');
    f.hooks.forEach(function (h) {
      lines.push('· ' + h.h + '——' + h.t + '（' + h.s + '）');
    });
    lines.push('');
    lines.push('给你的三句话：');
    f.advice.forEach(function (a, i) {
      lines.push((i + 1) + '. ' + a);
    });
    lines.push('');
    lines.push('「' + f.quote.t + '」——' + f.quote.s);
    lines.push('');
    lines.push(DISCLAIMER);
    var txt = lines.join('\n');

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flashCopy('已复制'); }
      catch (e) { flashCopy('复制失败，请长按选择'); }
      document.body.removeChild(ta);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { flashCopy('已复制'); },
        fallback);
    } else { fallback(); }
  });

  function flashCopy(msg) {
    var b = $('#btn-copy');
    var old = b.textContent;
    b.textContent = msg;
    setTimeout(function () { b.textContent = old; }, 1600);
  }

  /* ---------- 生成分享卡（canvas，离线可用） ---------- */
  $('#btn-card').addEventListener('click', function () {
    var R = S.result, f = R.top.f;
    var W = 750, H = 1000;
    var cv = document.getElementById('card-canvas');
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');

    // 背景
    c.fillStyle = '#f4efe4';
    c.fillRect(0, 0, W, H);
    // 纸纹
    c.strokeStyle = 'rgba(120,100,70,.10)';
    c.lineWidth = 1;
    for (var i = 0; i < 40; i++) {
      c.beginPath();
      c.moveTo(0, i * 26 + 8);
      c.lineTo(W, i * 26 + 2);
      c.stroke();
    }
    // 边框
    c.strokeStyle = f.color;
    c.lineWidth = 3;
    c.strokeRect(28, 28, W - 56, H - 56);
    c.lineWidth = 1;
    c.strokeRect(40, 40, W - 80, H - 80);

    c.textAlign = 'center';

    // 顶部标签
    c.fillStyle = '#8a7a5c';
    c.font = '24px "Songti SC", serif';
    c.fillText('你 像 哪 个 历 史 人 物', W / 2, 108);

    // 名字
    c.fillStyle = f.color;
    c.font = 'bold 120px "Songti SC", serif';
    c.fillText(f.name, W / 2, 268);

    // 副信息
    c.fillStyle = '#6b5f4a';
    c.font = '28px "Songti SC", serif';
    c.fillText(f.dyn + ' · ' + f.alias, W / 2, 316);

    // 相似度
    c.fillStyle = f.color;
    c.font = 'bold 30px sans-serif';
    c.fillText('相似度', W / 2, 386);
    c.font = 'bold 130px sans-serif';
    c.fillText(R.top.pct + '%', W / 2, 500);

    // 分隔
    c.strokeStyle = 'rgba(120,100,70,.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(120, 546); c.lineTo(W - 120, 546); c.stroke();

    // 标签
    c.fillStyle = '#8a7a5c';
    c.font = '26px "Songti SC", serif';
    c.fillText('· ' + f.tag + ' ·', W / 2, 592);

    // 引文（折行）+ 出处（动态跟随）
    c.fillStyle = '#3a3226';
    c.font = '32px "Songti SC", serif';
    var quoteLines = wrapTextLines(c, '「' + f.quote.t + '」', W - 190);
    var qy = 656;
    quoteLines.forEach(function (ln) {
      c.fillText(ln, W / 2, qy);
      qy += 46;
    });
    c.fillStyle = '#8a7a5c';
    c.font = '22px "Songti SC", serif';
    c.fillText('—— ' + f.quote.s, W / 2, qy + 12);
    qy += 12;

    // 三句建议（取前两条，自动换行）
    c.textAlign = 'left';
    c.fillStyle = '#3a3226';
    c.font = '23px "Songti SC", serif';
    var y = Math.max(qy + 52, 790);
    f.advice.slice(0, 2).forEach(function (a, i) {
      var lines = wrapTextLines(c, (i + 1) + '. ' + a, W - 190);
      lines.forEach(function (ln) {
        if (y > H - 100) return;
        c.fillText(ln, 100, y);
        y += 34;
      });
      y += 4;
    });

    // 页脚
    c.textAlign = 'center';
    c.fillStyle = '#a3937a';
    c.font = '20px "Songti SC", serif';
    c.fillText(formatDate() + ' · 趣味测试，仅供娱乐与自我探索参考', W / 2, H - 62);

    // 显示
    var wrap = $('#card-wrap');
    wrap.classList.remove('hidden');
    $('#card-img').src = cv.toDataURL('image/png');
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  /* 按宽度折行，返回行数组 */
  function wrapTextLines(c, text, maxW) {
    var chars = String(text).split('');
    var lines = [], line = '';
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (c.measureText(test).width > maxW && line.length) {
        lines.push(line);
        line = chars[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function wrapText(c, text, x, y, maxW, lh) {
    wrapTextLines(c, text, maxW).forEach(function (ln, i) {
      c.fillText(ln, x, y + i * lh);
    });
  }

  /* ---------- 图片导出提示 ---------- */
  $('#btn-save').addEventListener('click', function () {
    var a = document.createElement('a');
    a.href = $('#card-img').src;
    a.download = '历史人物原型测试.jpg';
    a.click();
  });

})();
