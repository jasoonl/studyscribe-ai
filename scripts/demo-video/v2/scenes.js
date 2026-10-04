// Deterministic scene engine: window.renderAt(t) draws the whole frame for time t (seconds),
// so render.mjs can step through the video one frame at a time and screenshot each one.
// Callouts, highlights and clicks are timed to the narration through W(scene, /word/).
(() => {
  const TL = window.__TL, OV = TL.overlap, S = {};
  TL.scenes.forEach((s, i) => { s.i = i; s.end = i < TL.scenes.length - 1 ? TL.scenes[i + 1].start : TL.total; S[s.id] = s; });
  const stage = document.getElementById("stage");
  const E = {
    lin: (u) => u,
    out: (u) => 1 - Math.pow(1 - u, 3),
    inOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    expo: (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
    back: (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); },
  };
  const DEF = { x: 0, y: 0, s: 1, r: 0, rx: 0, ry: 0, op: 1, blur: 0 };
  const tracks = [], ticks = [];
  const val = (f, t) => {
    if (t <= f[0][0]) return f[0][1];
    for (let i = 1; i < f.length; i++) {
      if (t <= f[i][0]) { const u = (t - f[i - 1][0]) / (f[i][0] - f[i - 1][0] || 1e-6); return f[i - 1][1] + (f[i][1] - f[i - 1][1]) * E[f[i][2] || "out"](u); }
    }
    return f[f.length - 1][1];
  };
  const tw = (el, prop, frames) => tracks.push({ el, prop, frames });
  const h = (tag, cls, html, parent = stage) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; parent.appendChild(e); return e; };
  const put = (e, x, y, w, ht) => { e.style.left = x + "px"; e.style.top = y + "px"; if (w != null) e.style.width = w + "px"; if (ht != null) e.style.height = ht + "px"; return e; };
  const at = (s, f) => s.start + s.dur * f;
  // Time (seconds) the narrator says the first word of scene s matching `re` (nth match), minus a small lead so a callout lands with the word.
  const W = (s, re, nth = 0, lead = 0.12) => {
    const rx = new RegExp(re, "i"), m = (s.words || []).filter((w) => rx.test(w.w)), w = m[nth] || m[0];
    return (w ? s.start + s.voiceAt + w.t0 : at(s, 0.5)) - lead;
  };

  // ---- backgrounds ----------------------------------------------------------------------
  const bgDark = h("div", "abs"); bgDark.id = "bgDark";
  const bgLight = h("div", "abs"); bgLight.id = "bgLight";
  const blobs = [];
  [[200, 150, 760, "rgba(47,107,255,.34)"], [1500, 700, 820, "rgba(34,211,238,.26)"], [900, -100, 640, "rgba(120,160,255,.30)"]].forEach(([x, y, d, c], i) => {
    const b = h("div", "blob"); b.style.cssText += `left:${x}px;top:${y}px;width:${d}px;height:${d}px;background:${c};`; blobs.push([b, x, y, i]);
  });
  ticks.push((t) => blobs.forEach(([b, x, y, i]) => { b.style.transform = `translate(${Math.sin(t * 0.22 + i * 2) * 90}px, ${Math.cos(t * 0.18 + i) * 70}px)`; }));
  tw(bgLight, "op", [[S.product.start, 0], [S.product.start + 0.5, 1], [S.steps.end, 1], [S.steps.end + 0.5, 0]]);

  // ---- helpers ----------------------------------------------------------------------------
  const scene = (s) => {
    const g = h("div", "scene");
    const last = s.i === TL.scenes.length - 1;
    const op = s.i === 0 ? [[0, 1]] : [[s.start, 0], [s.start + 0.45, 1]];
    if (!last) op.push([s.end, 1], [s.end + OV - 0.05, 0]);
    tw(g, "op", op);
    if (s.i > 0) tw(g, "s", [[s.start, 0.975], [s.start + 0.6, 1]]);
    if (!last) tw(g, "s", [[s.end, 1], [s.end + OV, 1.03, "lin"]]);
    return g;
  };
  const chip = (p, text, x, y, t, cls = "") => {
    const e = h("div", "chip " + cls, `<i></i>${text}`, p); put(e, x, y);
    tw(e, "op", [[t, 0], [t + 0.2, 1]]); tw(e, "s", [[t, 0.6], [t + 0.55, 1, "back"]]); tw(e, "y", [[t, 20], [t + 0.5, 0]]);
    return e;
  };
  // A row of callouts centred just above the captions; each pops in when its word is spoken.
  const strip = (p, items, y = 866) => {
    const row = h("div", "strip", null, p); row.style.top = y + "px";
    items.forEach(([text, t, cls]) => {
      const e = h("div", "chip " + (cls || ""), `<i></i>${text}`, row);
      tw(e, "op", [[t, 0], [t + 0.2, 1]]); tw(e, "s", [[t, 0.6], [t + 0.55, 1, "back"]]); tw(e, "y", [[t, 20], [t + 0.5, 0]]);
    });
  };
  const screen = (p, img, free = false) => h("div", "screen" + (free ? " free" : ""), `<img src="../frames/${img}.jpg">`, p);
  const camera = (el, base, pivot, keys) => {
    const fx = [], fy = [], fs = [];
    keys.forEach(([t, cx, cy, z, ease]) => {
      const sc = base * z; let px = pivot[0], py = pivot[1];
      if (z >= 1.3) {
        // Zoomed in: keep the screenshot's left/right/top edges off-screen and its bottom edge above the captions.
        px = Math.max(Math.min(px, cx * sc - 30), 1950 - (1600 - cx) * sc); py = Math.min(py, cy * sc - 20); py = Math.max(py, 935 - (896 - cy) * sc);
      }
      fs.push([t, sc, ease]); fx.push([t, px - cx * sc, ease]); fy.push([t, py - cy * sc, ease]);
    });
    tw(el, "x", fx); tw(el, "y", fy); tw(el, "s", fs);
  };
  const rim = (scr, [x, y, w, ht], on, off, soft = false) => {
    const e = h("div", "rim" + (soft ? " soft" : ""), null, scr); put(e, x, y, w, ht); e.style.transformOrigin = "50% 50%";
    tw(e, "op", [[on, 0], [on + 0.2, 1], [off ?? 1e6, 1], [(off ?? 1e6) + 0.3, 0]]); tw(e, "s", [[on, 1.05], [on + 0.35, 1, "back"]]);
    return e;
  };
  const ARROW = '<svg viewBox="0 0 24 24" width="36" height="36"><path d="M3 2l15.5 9.2-6.9 1.6 4 7.4-3 1.6-4-7.4L3 18.5z" fill="#fff" stroke="#111b3c" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const cursor = (scr, pts) => {
    const c = h("div", "cur", ARROW, scr);
    tw(c, "x", pts.map(([t, x], i) => [t, x, i ? "inOut" : "lin"])); tw(c, "y", pts.map(([t, , y], i) => [t, y, i ? "inOut" : "lin"]));
    tw(c, "op", [[pts[0][0], 0], [pts[0][0] + 0.25, 1]]);
    pts.forEach(([t, x, y, click]) => {
      if (!click) return;
      const r = h("div", "ripple", null, scr); put(r, x, y);
      tw(r, "op", [[t, 0.9], [t + 0.55, 0]]); tw(r, "s", [[t, 0.3], [t + 0.55, 1.7]]);
      tw(c, "s", [[t - 0.1, 1], [t, 0.82], [t + 0.12, 1]]);
    });
  };
  const typing = (el, text, t0, cps) => ticks.push((t) => { const n = Math.max(0, Math.min(text.length, Math.floor((t - t0) * cps))); el.textContent = t < t0 ? "" : text.slice(0, n) + (n < text.length ? "|" : ""); });
  const fadeScreen = (el, a) => tw(el, "op", [[a, 0], [a + 0.5, 1]]);
  // Burned-in captions from the narration timing (for viewers watching without sound).
  const captions = (g, s) => {
    if (!s.words || !s.words.length) return;
    const lines = []; let cur = [];
    s.words.forEach((w) => { cur.push(w); if (/[.?!]$/.test(w.raw) || cur.map((x) => x.raw).join(" ").length > 46) { lines.push(cur); cur = []; } });
    if (cur.length) lines.push(cur);
    const spans = lines.map((L) => [s.start + s.voiceAt + L[0].t0 - 0.05, s.start + s.voiceAt + L[L.length - 1].t1 + 0.25]);
    spans.forEach((sp, i) => { if (i + 1 < spans.length) sp[1] = Math.min(sp[1], spans[i + 1][0] - 0.02); });
    lines.forEach((L, i) => {
      const [t0, t1] = spans[i];
      const e = h("div", "cap", `<span>${L.map((x) => x.raw).join(" ")}</span>`, g); put(e, 0, 960, 1920);
      tw(e, "op", [[t0, 0], [t0 + 0.1, 1], [t1 - 0.08, 1], [t1, 0]]); tw(e, "y", [[t0, 10], [t0 + 0.18, 0]]);
    });
  };
  // A screen that eases in and then gets a camera path.
  const tour = (s, g, img, keys) => { const scr = screen(g, img); fadeScreen(scr, s.start); camera(scr, 0.975, [960, 500], keys); return scr; };

  // ================= 1. HOOK (dark, kinetic type) =================
  {
    const s = S.hook, g = scene(s);
    const lines = [
      { w: ["You", "sat", "through", "the", "whole", "lecture."], a: 0.03, b: 0.4 },
      { w: ["You", "even", "took", "notes."], a: 0.42, b: 0.64 },
      { w: ["And", "by", "Friday,", "most", "of", "it", "was", '<span class="gone">gone.</span>'], a: 0.66, b: 1 },
    ];
    lines.forEach((L, li) => {
      const el = h("div", "big", null, g); put(el, 160, 400, 1600);
      L.w.forEach((txt, wi) => {
        const w = h("span", "w", txt + (wi < L.w.length - 1 ? " " : ""), el), t0 = at(s, L.a) + wi * 0.1;
        tw(w, "op", [[t0, 0], [t0 + 0.45, 1]]); tw(w, "y", [[t0, 40], [t0 + 0.6, 0, "expo"]]); tw(w, "blur", [[t0, 14], [t0 + 0.5, 0]]);
        if (li === 2 && wi === L.w.length - 1) { tw(w, "blur", [[t0, 14], [t0 + 0.5, 0], [at(s, 0.9), 0], [at(s, 0.9) + 1.2, 16, "inOut"]]); tw(w, "op", [[t0, 0], [t0 + 0.45, 1], [at(s, 0.9), 1], [at(s, 0.9) + 1.2, 0.12, "inOut"]]); }
      });
      if (li < 2) { tw(el, "op", [[at(s, L.b), 1], [at(s, L.b) + 0.4, 0]]); tw(el, "y", [[at(s, L.b), 0], [at(s, L.b) + 0.4, -40]]); }
    });
  }

  // ================= 2. BRAND (dark) =================
  {
    const s = S.brand, g = scene(s), t = s.start;
    for (let i = 0; i < 3; i++) { const r = h("div", "ring", null, g); put(r, 780, 250); tw(r, "s", [[t + 0.2 + i * 0.4, 0.3], [t + 2.6 + i * 0.4, 3.4, "out"]]); tw(r, "op", [[t + 0.2 + i * 0.4, 0.9], [t + 2.6 + i * 0.4, 0]]); }
    const logo = h("img", "abs", null, g); logo.src = "assets/logo.webp"; put(logo, 865, 280, 190, 190);
    tw(logo, "op", [[t + 0.3, 0], [t + 0.5, 1]]); tw(logo, "s", [[t + 0.3, 0], [t + 1.1, 1, "back"]]);
    const mark = h("div", "abs mark", "StudyScribe AI", g); put(mark, 0, 500, 1920);
    tw(mark, "op", [[t + 1, 0], [t + 1.6, 1]]); tw(mark, "y", [[t + 1, 60], [t + 1.8, 0, "expo"]]); tw(mark, "blur", [[t + 1, 16], [t + 1.6, 0]]);
    const tag = h("div", "abs tag", "Record once. Study smarter.", g); put(tag, 0, 710, 1920);
    tw(tag, "op", [[t + 2.2, 0], [t + 2.9, 1]]); tw(tag, "y", [[t + 2.2, 24], [t + 2.9, 0]]);
  }


  // ================= NEW A. PIPELINE (dark): one recording becomes a whole study set =================
  {
    const s = S.pipeline, g = scene(s), a = s.start;
    const file = h("div", "dcard", '<small>YOUR LECTURE</small><div style="display:flex;align-items:flex-end;gap:7px;height:120px" id="wv"></div><div class="dline" style="margin:22px 0 0;font-size:30px;font-weight:600">Lecture.m4a</div><div class="dline" style="margin:0;color:#8ec1ff;font-size:24px">7:38</div>', g); put(file, 110, 360, 420, 360);
    const bars = file.querySelector("#wv"); const hs = []; for (let i = 0; i < 22; i++) { const b = h("div", "", null, bars); const v = 24 + 90 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)); b.style.cssText = `width:10px;border-radius:5px;background:linear-gradient(#7db4ff,#22d3ee);height:${v}px;`; hs.push([b, v]); }
    ticks.push((t) => hs.forEach(([b, v], i) => { b.style.height = (v * (0.7 + 0.3 * Math.sin(t * 6 + i))) + "px"; }));
    const td = W(s, "^drop", 0, 0.1); tw(file, "op", [[td, 0], [td + 0.3, 1]]); tw(file, "y", [[td - 0.1, -260], [td + 0.55, 0, "back"]]); tw(file, "r", [[td - 0.1, -8], [td + 0.55, 0, "back"]]);
    const tr = h("div", "dcard", "<small>TRANSCRIPT</small>", g); put(tr, 640, 300, 640, 480);
    const lines = [["0:00", "AI is one of the most transformative"], ["0:07", "technologies of our time. It lets"], ["0:14", "computers learn from data, spot"], ["0:21", "patterns, and make decisions."]];
    const tt = W(s, "^transcript", 0, 0.1); tw(tr, "op", [[tt, 0], [tt + 0.3, 1]]); tw(tr, "y", [[tt, 50], [tt + 0.6, 0, "expo"]]);
    lines.forEach(([ts, tx], i) => { const l = h("div", "dline", `<b>${ts}</b><span></span>`, tr); typing(l.querySelector("span"), tx, tt + 0.35 + i * 0.5, 34); });
    const tiles = [["Study notes", "^notes", 300, '<path d="M6 4h9l4 4v12H6zM9 12h7M9 16h7" />'], ["Flashcards", "^flashcards", 440, '<rect x="4" y="7" width="14" height="10" rx="2"/><path d="M8 4h12v10"/>'], ["Practice quiz", "^quiz", 580, '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17v.01"/>']];
    tiles.forEach(([name, w, y, path]) => {
      const e = h("div", "ftile", `<i><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg></i>${name}`, g); put(e, 1410, y);
      const t0 = W(s, w, 0, 0.1); tw(e, "op", [[t0, 0], [t0 + 0.25, 1]]); tw(e, "x", [[t0, -160], [t0 + 0.6, 0, "expo"]]); tw(e, "s", [[t0, 0.8], [t0 + 0.55, 1, "back"]]);
    });
    // light streaming from file to transcript to tiles
    const arrows = [[540, 540, 90, "^drop"], [1290, 540, 110, "^notes"]];
    arrows.forEach(([x, y, w, k]) => { const ar = h("div", "abs", null, g); ar.style.cssText += "height:6px;border-radius:3px;background:linear-gradient(90deg,#2f6bff,#22d3ee);"; put(ar, x, y, w); const t0 = W(s, k === "^drop" ? "^transcript" : "^notes", 0, 0.3); tw(ar, "op", [[t0, 0], [t0 + 0.3, 1]]); });
    captions(g, s);
  }

  // ================= 3. PRODUCT: the library, all three recordings =================
  {
    const s = S.product, g = scene(s), scr = screen(g, "dashboard", true); put(scr, 160, 40);
    tw(scr, "op", [[s.start, 0], [s.start + 0.6, 1]]); tw(scr, "y", [[s.start, 150], [s.start + 1.2, 0, "expo"]]); tw(scr, "rx", [[s.start, 18], [s.start + 1.2, 0, "expo"]]);
    tw(scr, "s", [[s.start, 0.84], [s.start + 1.2, 0.975, "expo"], [s.end, 1.0, "lin"]]);
    chip(g, "Record live", 150, 300, W(s, "^record$")); chip(g, "Upload a file", 1430, 170, W(s, "^upload$")); chip(g, "Paste a link", 1400, 836, W(s, "^paste$"));
    captions(g, s);
  }

  // ================= 4. ADD =================
  {
    const s = S.add, g = scene(s), a = s.start;
    const scr = tour(s, g, "add-recording", [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 1.8, 800, 590, 1.42, "inOut"]]);
    const cards = [[350, 371, 277, 449], [662, 371, 277, 449], [973, 371, 277, 449]];
    rim(scr, cards[0], a + 1.9, a + 2.7); rim(scr, cards[1], a + 2.7, a + 3.5); rim(scr, cards[2], a + 3.5, s.end - 0.4);
    const ck = s.clickTimes[0];
    cursor(scr, [[a + 1.5, 760, 330], [a + 2.2, 511, 746], [a + 3.0, 800, 722], [ck - 0.25, 1089, 746], [ck, 1089, 746, true]]);
    chip(g, "27 languages", 1330, 170, W(s, "^twenty-seven")); chip(g, "Starts automatically", 190, 170, W(s, "^starts"));
    captions(g, s);
  }

  // ================= 5. TRANSCRIPT (a prayer): speaker label, timestamps, click a line =================
  {
    const s = S.transcript, g = scene(s), a = s.start;
    const scr = tour(s, g, "transcript", [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 2.0, 560, 800, 1.6, "inOut"]]);
    const ck = s.clickTimes[0], line = [86, 731, 923, 110];
    rim(scr, line, ck + 0.1, null, true);
    cursor(scr, [[W(s, "^labeled") - 0.2, 900, 650], [ck - 0.3, 520, 790], [ck, 520, 790, true]]);
    strip(g, [["Timestamps", W(s, "^timestamped")], ["Speaker labels", W(s, "^speaker")], ["Jump to any moment", W(s, "^click")]]);
    captions(g, s);
  }

  // ================= 6. NOTES (1min AI) =================
  {
    const s = S.notes, g = scene(s), a = s.start;
    const scr = tour(s, g, "study-notes", [[a, 800, 448, 0.94], [a + 0.9, 570, 600, 1.45, "inOut"], [s.end, 570, 700, 1.45, "inOut"]]);
    rim(scr, [70, 528, 740, 112], W(s, "^organized"), W(s, "^ideas"), true); rim(scr, [70, 655, 740, 185], W(s, "^ideas"), null, true);
    strip(g, [["Study notes", W(s, "^study")], ["Organized by idea", W(s, "^organized")]]);
    captions(g, s);
  }

  // ================= 7. CARDS (1min AI) =================
  {
    const s = S.cards, g = scene(s), a = s.start;
    const scr = screen(g, "flashcards", true); put(scr, 1380 - 800, 470 - 448);
    tw(scr, "op", [[a, 0], [a + 0.6, 1]]); tw(scr, "x", [[a, 160], [a + 1, 0, "expo"]]); tw(scr, "s", [[a, 0.55], [a + 1, 0.62]]); tw(scr, "ry", [[a, -22], [a + 1.1, -9, "expo"]]);
    [[-5, 14], [4, 28]].forEach(([deg, off], i) => {
      const back = h("div", "card", null, g); back.style.cssText += "height:400px;width:640px;"; put(back, 300 + off * 0.6, 270 + off);
      back.style.display = "block"; tw(back, "r", [[a, deg]]); tw(back, "op", [[a + 0.2 + i * 0.1, 0], [a + 0.7 + i * 0.1, 0.85]]);
    });
    const mk = (q, ans, x, y, small) => {
      const c = h("div", "fc", null, g); put(c, x, y);
      h("div", "face", `<small>QUESTION</small><p>${q}</p>`, c); h("div", "face back", `<small>ANSWER</small><p style="${small ? "font-size:46px;line-height:1.15" : ""}">${ans}</p>`, c); return c;
    };
    const A = mk("What does AI stand for?", "Artificial intelligence", 300, 270), B = mk("What are three capabilities AI enables computers to do?", "Learn from data, recognize patterns, and make decisions.", 300, 270, true);
    const f1 = W(s, "^write", 0, 0.05), swap = W(s, "^export", 0, 0.1);
    tw(A, "op", [[a + 0.3, 0], [a + 0.8, 1], [swap, 1], [swap + 0.5, 0]]); tw(A, "s", [[a + 0.3, 0.8], [a + 0.9, 1, "back"]]); tw(A, "ry", [[f1, 0], [f1 + 0.7, 180, "inOut"]]);
    tw(A, "x", [[swap, 0], [swap + 0.55, -1000, "inOut"]]); tw(A, "r", [[swap, 0], [swap + 0.55, -14, "inOut"]]);
    tw(B, "op", [[swap, 0], [swap + 0.45, 1]]); tw(B, "s", [[swap, 0.9], [swap + 0.55, 1, "back"]]); tw(B, "ry", [[W(s, "^anki", 0, -0.2), 0], [W(s, "^anki", 0, -0.2) + 0.8, 180, "inOut"]]);
    chip(g, "Quizlet", 960, 800, W(s, "^quizlet")); chip(g, "Anki", 1180, 800, W(s, "^anki")); chip(g, "Notion", 1340, 800, W(s, "^notion"));
    captions(g, s);
  }


  // ================= NEW B. FLIP (light): try a flashcard yourself =================
  {
    const s = S.flip, g = scene(s), a = s.start;
    const t0 = W(s, "^let", 0, 0.1), tt = W(s, "^second", 0, 0.1), tf = W(s, "^artificial", 0, 0.15);
    const hd = h("div", "abs", "Your turn", g); hd.style.cssText += "font-size:84px;font-weight:700;letter-spacing:-0.04em;color:#0b1f55;text-align:center;width:1920px;"; put(hd, 0, 70);
    tw(hd, "op", [[a + 0.2, 0], [a + 0.7, 1]]); tw(hd, "y", [[a + 0.2, 40], [a + 0.8, 0, "expo"]]);
    const c = h("div", "fc", null, g); put(c, 640, 250); c.style.width = "640px"; c.style.height = "400px";
    h("div", "face", "<small>QUESTION</small><p>What does AI stand for?</p>", c); h("div", "face back", "<small>ANSWER</small><p>Artificial intelligence</p>", c);
    c.querySelector(".back p").style.fontSize = "62px";
    tw(c, "op", [[a + 0.3, 0], [a + 0.8, 1]]); tw(c, "s", [[a + 0.3, 0.7], [a + 1.0, 1.35, "back"]]); tw(c, "y", [[a + 0.3, 80], [a + 1.0, 0, "expo"]]); tw(c, "ry", [[tf, 0], [tf + 0.8, 180, "inOut"]]);
    const cd = h("div", "abs", "3", g); cd.style.cssText += "width:150px;height:150px;border-radius:50%;display:grid;place-items:center;font-size:84px;font-weight:700;color:#2f6bff;background:#fff;box-shadow:0 0 0 6px #cfe0ff,0 20px 50px rgba(37,79,200,.28);"; put(cd, 885, 780);
    tw(cd, "op", [[tt, 0], [tt + 0.2, 1], [tf - 0.05, 1], [tf + 0.2, 0]]); tw(cd, "s", [[tt, 0.6], [tt + 0.4, 1, "back"]]);
    ticks.push((t) => { const u = Math.max(0, Math.min(0.999, (t - tt) / Math.max(0.3, tf - tt))); cd.textContent = String(3 - Math.floor(u * 3)); });
    chip(g, "Recall beats re-reading", 1130, 820, W(s, "^recall", 0, 0.05), "ok");
    // confetti burst when the card turns
    for (let i = 0; i < 18; i++) { const d = h("div", "dot", null, g); d.style.background = ["#2f6bff", "#22d3ee", "#7db4ff", "#ffffff"][i % 4]; put(d, 960, 450); const ang = (i / 18) * 6.283, r = 300 + (i % 3) * 90; tw(d, "x", [[tf + 0.4, 0], [tf + 1.3, Math.cos(ang) * r, "expo"]]); tw(d, "y", [[tf + 0.4, 0], [tf + 1.3, Math.sin(ang) * r * 0.8, "expo"]]); tw(d, "op", [[tf + 0.39, 0], [tf + 0.4, 1], [tf + 1.3, 0]]); }
    captions(g, s);
  }

  // ================= 8. LEARN (1min AI): written recall =================
  {
    const s = S.learn, g = scene(s), a = s.start;
    const scr = tour(s, g, "learn-mode", [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 1.6, 500, 760, 1.5, "inOut"]]);
    const tt = W(s, "^graduate", 0, -0.1), box = h("div", "abs typed", "", scr); put(box, 98, 730, 880, 46); box.style.cssText += "background:#fff;padding:9px 14px;box-sizing:border-box;border-radius:8px;";
    tw(box, "op", [[tt - 0.02, 0], [tt, 1]]); typing(box, "Healthcare and virtual assistants", tt, 15);
    rim(scr, [90, 723, 915, 112], W(s, "^written", 0, 0.25), null, false);
    strip(g, [["Recognition", W(s, "^recognition")], ["Written recall", W(s, "^written")]]);
    captions(g, s);
  }

  // ================= 9. TEST (1min AI): practice exam =================
  {
    const s = S.test, g = scene(s), a = s.start;
    const scr = tour(s, g, "test-mode", [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 1.5, 500, 700, 1.45, "inOut"]]);
    const ck = s.clickTimes[0];
    rim(scr, [86, 618, 458, 46], ck + 0.05); cursor(scr, [[a + 1.2, 800, 600], [ck - 0.3, 330, 641], [ck, 330, 641, true]]);
    strip(g, [["Answers shown after you submit", W(s, "^exam", 0, 0.2)]]);
    captions(g, s);
  }

  // ================= 10. QUIZ (1min AI) =================
  {
    const s = S.quiz, g = scene(s), a = s.start;
    const scr = tour(s, g, "quiz", [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 1.5, 800, 380, 1.4, "inOut"]]);
    const ck = s.clickTimes[0];
    rim(scr, [455, 345, 690, 42], ck + 0.05); cursor(scr, [[a + 1.0, 1000, 520], [ck - 0.3, 700, 366], [ck, 700, 366, true]]);
    strip(g, [["10 questions", W(s, "^ten")], ["Instant feedback", W(s, "^instant")]]);
    captions(g, s);
  }


  // ================= NEW C. CHALLENGE (light): a real quiz question with a timer =================
  {
    const s = S.challenge, g = scene(s), a = s.start, ck = s.clickTimes[0];
    const tp = W(s, "^pick", 0, 0.1);
    const q = h("div", "qcard", '<small>QUESTION 1 OF 10 &nbsp;·&nbsp; MULTIPLE CHOICE</small><h3>What is AI described as in the transcript?</h3>', g); put(q, 380, 150);
    const opts = ["A futuristic concept that is yet to be developed.", "A simple computer program for basic tasks.", "One of the most transformative technologies of our time.", "A technology primarily used for entertainment."].map((tx, i) => h("div", "opt" + (i === 2 ? " right" : ""), `<u></u>${tx}`, q));
    tw(q, "op", [[a + 0.2, 0], [a + 0.7, 1]]); tw(q, "y", [[a + 0.2, 70], [a + 0.9, 0, "expo"]]);
    opts.forEach((o, i) => { if (i === 2) { o.classList.remove("right"); ticks.push((t) => o.classList.toggle("right", t >= ck)); } else tw(o, "op", [[ck, 1], [ck + 0.4, 0.35]]); });
    const bar = h("div", "abs", null, g); bar.style.cssText += "height:14px;border-radius:7px;background:linear-gradient(90deg,#2f6bff,#22d3ee);"; put(bar, 380, 112, 1160);
    tw(bar, "op", [[tp - 0.1, 0], [tp, 1], [ck, 1], [ck + 0.3, 0]]);
    ticks.push((t) => { const u = Math.max(0, Math.min(1, (t - tp) / Math.max(0.5, ck - tp))); bar.style.width = (1160 * (1 - u)) + "px"; });
    const cur = h("div", "cur", ARROW, g);
    tw(cur, "x", [[a + 1.2, 1500, "lin"], [ck - 0.25, 760, "inOut"]]); tw(cur, "y", [[a + 1.2, 800, "lin"], [ck - 0.25, 700, "inOut"]]); tw(cur, "op", [[a + 1.2, 0], [a + 1.5, 1]]);
    const rp = h("div", "ripple", null, g); put(rp, 760, 700); tw(rp, "op", [[ck, 0.9], [ck + 0.55, 0]]); tw(rp, "s", [[ck, 0.3], [ck + 0.55, 1.7]]); tw(cur, "s", [[ck - 0.1, 1], [ck, 0.82], [ck + 0.12, 1]]);
    chip(g, "Correct!", 1560, 560, ck + 0.1, "ok"); chip(g, "Instant feedback", 820, 880, W(s, "^instant", 0, 0.05));
    captions(g, s);
  }

  // ================= 11. GUIDE (1min AI) =================
  {
    const s = S.guide, g = scene(s), a = s.start;
    const scr = tour(s, g, "study-guide", [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 1.6, 960, 400, 1.5, "inOut"]]);
    rim(scr, [576, 183, 763, 235], W(s, "^structured", 0, 0.1), null, true);
    strip(g, [["Structured guide", W(s, "^structured")], ["From your lecture", W(s, "^lecture")]]);
    captions(g, s);
  }

  // ================= 12. TUTOR (a prayer) =================
  {
    const s = S.tutor, g = scene(s), a = s.start;
    const scr = tour(s, g, "ai-tutor", [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 1.6, 620, 640, 1.5, "inOut"], [s.end, 620, 740, 1.5, "inOut"]]);
    strip(g, [["Answers from your lecture", W(s, "^answers")]]);
    const th = h("div", "think", `<span class="lat">${"<u></u>".repeat(9)}</span>Thinking`, g); put(th, 1380, 120);
    tw(th, "op", [[W(s, "^ask") - 0.1, 0], [W(s, "^ask") + 0.1, 1], [W(s, "^answers"), 1], [W(s, "^answers") + 0.2, 0]]); tw(th, "s", [[W(s, "^ask") - 0.1, 0.7], [W(s, "^ask") + 0.4, 1, "back"]]);
    const cells = th.querySelectorAll("u"), ring = [0, 1, 2, 5, 8, 7, 6, 3];
    ticks.push((t) => cells.forEach((c, i) => { const k = ring.indexOf(i); c.style.opacity = k < 0 ? 0.07 : Math.max(0.15, 1 - ((((t * 7 - k) % 8) + 8) % 8) / 3.2); }));
    captions(g, s);
  }

  // ================= 13. PRO: meetings (1min AI email draft) =================
  {
    const s = S.pro, g = scene(s), a = s.start;
    const scr = tour(s, g, "email-drafts", [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 2.0, 950, 330, 1.55, "inOut"]]);
    const ck = s.clickTimes[0];
    rim(scr, [1250, 104, 96, 46], ck + 0.05); cursor(scr, [[W(s, "^follow-up") - 0.2, 1000, 420], [ck - 0.35, 1298, 127], [ck, 1298, 127, true]]);
    strip(g, [["Summary email", W(s, "^summaries")], ["Follow-up emails", W(s, "^follow-up")], ["Tone: Formal", W(s, "^tone")]]); chip(g, "Copied", 1400, 40, ck + 0.1, "ok");
    captions(g, s);
  }


  // ================= NEW D. WHO IT IS FOR (light) =================
  {
    const s = S.who, g = scene(s), a = s.start;
    const hd = h("div", "abs", "Made for the way you work", g); hd.style.cssText += "font-size:80px;font-weight:700;letter-spacing:-0.04em;color:#0b1f55;text-align:center;width:1920px;"; put(hd, 0, 140);
    tw(hd, "op", [[a + 0.2, 0], [a + 0.7, 1]]); tw(hd, "y", [[a + 0.2, 40], [a + 0.8, 0, "expo"]]);
    const ic = (p) => `<svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    [["Students", "Cram smarter for finals", "^students", 110, '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>'],
     ["Professionals", "Meetings into follow-ups", "^professionals", 700, '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>'],
     ["Language learners", "27 languages supported", "^another", 1290, '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>']].forEach(([t, sub, w, x, p]) => {
      const e = h("div", "pcard", `<em>${ic(p)}</em><b>${t}</b><span>${sub}</span>`, g); put(e, x, 330);
      const t0 = W(s, w, 0, 0.15); tw(e, "op", [[t0, 0], [t0 + 0.25, 1]]); tw(e, "y", [[t0, 90], [t0 + 0.7, 0, "expo"]]); tw(e, "s", [[t0, 0.85], [t0 + 0.6, 1, "back"]]);
    });
    captions(g, s);
  }

  // ================= 14. LIBRARY (analytics): all three recordings =================
  {
    const s = S.library, g = scene(s), a = s.start;
    const scr = tour(s, g, "analytics", [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 1.8, 640, 690, 1.65, "inOut"]]);
    const rows = [585, 648, 711].map((y) => [309, y, 520, 63]);
    rim(scr, rows[0], W(s, "^forty-second"), W(s, "^seven-minute", 0, 0.1), true); rim(scr, rows[1], W(s, "^seven-minute"), W(s, "^one-minute", 0, 0.1), true); rim(scr, rows[2], W(s, "^one-minute"), null, true);
    strip(g, [["a prayer: 39s", W(s, "^forty-second")], ["cancet: 7m 38s", W(s, "^seven-minute")], ["1min AI: 1m 13s", W(s, "^one-minute")], ["One library", W(s, "^library")]]);
    captions(g, s);
  }

  // ================= 15. TRUST =================
  {
    const s = S.trust, g = scene(s), a = s.start;
    const shield = h("div", "abs", '<svg viewBox="0 0 64 64" width="150" height="150"><defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1b8fe0"/></linearGradient></defs><path d="M32 4l22 8v16c0 14-9 26-22 32C19 54 10 42 10 28V12z" fill="url(#sg)"/><path d="M22 32l7 7 14-15" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>', g);
    put(shield, 885, 140); tw(shield, "op", [[a + 0.2, 0], [a + 0.5, 1]]); tw(shield, "s", [[a + 0.2, 0], [a + 0.9, 1, "back"]]);
    const hl = h("div", "abs", "Your data. Your call.", g); hl.style.cssText += "font-size:96px;font-weight:700;letter-spacing:-0.04em;color:#0b1f55;text-align:center;width:1920px;"; put(hl, 0, 320);
    tw(hl, "op", [[a + 0.6, 0], [a + 1.1, 1]]); tw(hl, "y", [[a + 0.6, 40], [a + 1.2, 0, "expo"]]);
    const ex = h("div", "card", '<em><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="#2f6bff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M5 20h14"/></svg></em>Export my data', g);
    const dl = h("div", "card del", '<em><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="#e11d48" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></em>Delete my account', g);
    put(ex, 330, 560); put(dl, 1030, 560);
    [[ex, 0.3], [dl, 0.42]].forEach(([el, d]) => { tw(el, "op", [[a + 0.9 + d, 0], [a + 1.4 + d, 1]]); tw(el, "y", [[a + 0.9 + d, 60], [a + 1.6 + d, 0, "expo"]]); });
    const [c1, c2] = s.clickTimes;
    tw(ex, "s", [[c1, 1], [c1 + 0.12, 0.95], [c1 + 0.4, 1, "back"]]); tw(dl, "s", [[c2, 1], [c2 + 0.12, 0.95], [c2 + 0.4, 1, "back"]]);
    const cur = h("div", "cur", ARROW, g);
    tw(cur, "x", [[a + 1.2, 1000, "lin"], [c1 - 0.2, 640, "inOut"], [c2 - 0.2, 1240, "inOut"]]); tw(cur, "y", [[a + 1.2, 470, "lin"], [c1 - 0.2, 650, "inOut"], [c2 - 0.2, 650, "inOut"]]); tw(cur, "op", [[a + 1.2, 0], [a + 1.5, 1]]);
    chip(g, "studyscribe-export.json", 360, 820, c1 + 0.15, "ok"); chip(g, "All data deleted", 1130, 820, c2 + 0.15, "ok");
    captions(g, s);
  }


  // ================= NEW E. THREE STEPS (light) =================
  {
    const s = S.steps, g = scene(s), a = s.start;
    const hd = h("div", "abs", "Start in three steps", g); hd.style.cssText += "font-size:84px;font-weight:700;letter-spacing:-0.04em;color:#0b1f55;text-align:center;width:1920px;"; put(hd, 0, 150);
    tw(hd, "op", [[a + 0.2, 0], [a + 0.7, 1]]); tw(hd, "y", [[a + 0.2, 40], [a + 0.8, 0, "expo"]]);
    const line = h("div", "abs", null, g); line.style.cssText += "height:6px;border-radius:3px;background:linear-gradient(90deg,#2f6bff,#22d3ee);transform-origin:0 50%;"; put(line, 420, 466, 1080);
    const steps = [["1", "Request your invite", "Free to start", "^request", 150], ["2", "Add a lecture", "Record, upload, or paste", "^add", 730], ["3", "Start studying", "Notes, cards, quizzes", "^studying", 1310]];
    steps.forEach(([n, t, sub, w, x], i) => {
      const e = h("div", "step", `<em>${n}</em><b>${t}</b><span>${sub}</span>`, g); put(e, x, 400);
      const t0 = W(s, w, 0, 0.15); tw(e, "op", [[t0, 0], [t0 + 0.25, 1]]); tw(e, "y", [[t0, 70], [t0 + 0.7, 0, "expo"]]); tw(e, "s", [[t0, 0.8], [t0 + 0.6, 1, "back"]]);
    });
    tw(line, "s", [[W(s, "^request", 0, 0.1), 0.001], [W(s, "^studying", 0, 0.1), 1, "inOut"]]);
    captions(g, s);
  }

  // ================= 16. FINALE (dark) =================
  {
    const s = S.finale, g = scene(s);
    const names = ["Lecture", "Transcript", "Notes", "Flashcards", "Quiz", "Ready"], widths = [220, 270, 200, 270, 190, 200], gap = 36;
    const total = widths.reduce((p, w) => p + w, 0) + gap * 5; let x = (1920 - total) / 2;
    const rowT = s.start + 0.5, rowOut = W(s, "^studyscribe", 0, 0.35);
    names.forEach((n, i) => {
      const off = h("div", "pill dark off", n, g), on = h("div", "pill on", n, g); [off, on].forEach((e) => { put(e, x, 470, widths[i]); e.style.justifyContent = "center"; e.style.padding = "0"; });
      const t0 = rowT + 0.3 + i * 0.4;
      tw(off, "op", [[rowT - 0.3, 0], [rowT, 1], [rowOut, 1], [rowOut + 0.4, 0]]); tw(off, "y", [[rowT - 0.3, 40], [rowT, 0], [rowOut, 0], [rowOut + 0.4, -50]]);
      tw(on, "op", [[t0, 0], [t0 + 0.3, 1], [rowOut, 1], [rowOut + 0.4, 0]]); tw(on, "s", [[t0, 0.88], [t0 + 0.5, 1, "back"]]); tw(on, "y", [[rowOut, 0], [rowOut + 0.4, -50]]);
      x += widths[i] + gap;
    });
    const logo = h("img", "abs", null, g); logo.src = "assets/logo.webp"; put(logo, 900, 190, 120, 120);
    const hd = h("div", "abs mark", "Record once.<br>Study smarter.", g); hd.style.cssText += "font-size:132px;line-height:1.04;"; put(hd, 0, 330, 1920);
    const cta = h("div", "cta", "Get started free", g); put(cta, 700, 700, 520); cta.style.justifyContent = "center"; cta.style.padding = "0";
    const url = h("div", "url", "studyscribe-ai.vercel.app", g); put(url, 0, 860);
    const tIn = W(s, "^studyscribe", 0, 0.3);
    tw(logo, "op", [[tIn, 0], [tIn + 0.5, 1]]); tw(logo, "s", [[tIn, 0], [tIn + 0.8, 1, "back"]]);
    tw(hd, "op", [[tIn + 0.2, 0], [tIn + 0.8, 1]]); tw(hd, "y", [[tIn + 0.2, 60], [tIn + 1, 0, "expo"]]); tw(hd, "blur", [[tIn + 0.2, 16], [tIn + 0.8, 0]]);
    tw(cta, "op", [[W(s, "^try") - 0.2, 0], [W(s, "^try") + 0.3, 1]]); tw(cta, "s", [[W(s, "^try") - 0.2, 0.8], [W(s, "^try") + 0.4, 1, "back"]]);
    tw(url, "op", [[W(s, "^free") - 0.1, 0], [W(s, "^free") + 0.5, 1]]);
    captions(g, s);
  }

  // ---- slide-wipe at every scene change --------------------------------------------------
  TL.scenes.slice(1).forEach((s) => {
    const w = h("div", "wipe"); w.style.zIndex = 5;
    tw(w, "x", [[s.start - 0.25, 0], [s.start + 0.55, 3200, "inOut"]]); tw(w, "op", [[s.start - 0.26, 0], [s.start - 0.25, 0.92], [s.start + 0.5, 0.92], [s.start + 0.56, 0]]);
  });

  window.renderAt = (t) => {
    const state = new Map();
    for (const tr of tracks) { let st = state.get(tr.el); if (!st) { st = Object.assign({}, DEF); state.set(tr.el, st); } st[tr.prop] = val(tr.frames, t); }
    for (const [el, st] of state) {
      el.style.transform = `translate3d(${st.x}px,${st.y}px,0) rotateX(${st.rx}deg) rotateY(${st.ry}deg) rotate(${st.r}deg) scale(${st.s})`;
      el.style.opacity = st.op; el.style.visibility = st.op < 0.003 ? "hidden" : "visible"; el.style.filter = st.blur > 0.1 ? `blur(${st.blur}px)` : "none";
    }
    ticks.forEach((f) => f(t));
  };
})();
