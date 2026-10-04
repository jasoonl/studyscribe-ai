// Deterministic scene engine: window.renderAt(t) draws the whole frame for time t (seconds),
// so render.mjs can step through the video one frame at a time and screenshot each one.
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

  // ---- backgrounds ----------------------------------------------------------------------
  const bgDark = h("div", "abs"); bgDark.id = "bgDark";
  const bgLight = h("div", "abs"); bgLight.id = "bgLight";
  const blobs = [];
  [[200, 150, 760, "rgba(47,107,255,.34)"], [1500, 700, 820, "rgba(34,211,238,.26)"], [900, -100, 640, "rgba(120,160,255,.30)"]].forEach(([x, y, d, c], i) => {
    const b = h("div", "blob"); b.style.cssText += `left:${x}px;top:${y}px;width:${d}px;height:${d}px;background:${c};`; blobs.push([b, x, y, i]);
  });
  ticks.push((t) => blobs.forEach(([b, x, y, i]) => { b.style.transform = `translate(${Math.sin(t * 0.22 + i * 2) * 90}px, ${Math.cos(t * 0.18 + i) * 70}px)`; }));
  tw(bgLight, "op", [[S.product.start, 0], [S.product.start + 0.5, 1], [S.trust.end, 1], [S.trust.end + 0.5, 0]]);

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
  const lower = (p, s, title, sub) => {
    const e = h("div", "lower", `<b>${title}</b><span>${sub}</span>`, p);
    tw(e, "op", [[s.start + 0.5, 0], [s.start + 0.9, 1], [s.end - 0.1, 1], [s.end + 0.3, 0]]);
    tw(e, "y", [[s.start + 0.5, 30], [s.start + 1, 0]]);
  };
  const screen = (p, img, free = false) => { const e = h("div", "screen" + (free ? " free" : ""), `<img src="../frames/${img}.jpg">`, p); return e; };
  const camera = (el, base, pivot, keys) => {
    const fx = [], fy = [], fs = [];
    keys.forEach(([t, cx, cy, z, ease]) => {
      const sc = base * z; let px = pivot[0], py = pivot[1];
      if (z >= 1.3) {
        // Zoomed in: keep the screenshot's left/right/top edges off-screen and its bottom edge just above the lower third.
        px = Math.max(Math.min(px, cx * sc - 30), 1950 - (1600 - cx) * sc); py = Math.min(py, cy * sc - 20); py = Math.max(py, 930 - (896 - cy) * sc);
      }
      fs.push([t, sc, ease]); fx.push([t, px - cx * sc, ease]); fy.push([t, py - cy * sc, ease]);
    });
    tw(el, "x", fx); tw(el, "y", fy); tw(el, "s", fs);
  };
  const rim = (scr, [x, y, w, ht], on, off) => {
    const e = h("div", "rim", null, scr); put(e, x, y, w, ht); e.style.transformOrigin = "50% 50%";
    tw(e, "op", [[on, 0], [on + 0.2, 1], [off ?? 1e6, 1], [(off ?? 1e6) + 0.3, 0]]); tw(e, "s", [[on, 1.08], [on + 0.35, 1, "back"]]);
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

  // ================= 3. PRODUCT (light) =================
  {
    const s = S.product, g = scene(s), scr = screen(g, "dashboard", true); put(scr, 160, 40);
    tw(scr, "op", [[s.start, 0], [s.start + 0.6, 1]]); tw(scr, "y", [[s.start, 150], [s.start + 1.2, 0, "expo"]]); tw(scr, "rx", [[s.start, 18], [s.start + 1.2, 0, "expo"]]);
    tw(scr, "s", [[s.start, 0.84], [s.start + 1.2, 0.975, "expo"], [s.end, 1.0, "lin"]]);
    chip(g, "Record live", 150, 260, at(s, 0.28)); chip(g, "Upload a file", 1450, 170, at(s, 0.46)); chip(g, "Paste a link", 170, 700, at(s, 0.64));
    lower(g, s, "One place for every lecture", "Record, upload or import by link");
  }

  // ================= 4. ADD =================
  {
    const s = S.add, g = scene(s), scr = screen(g, "add-recording"), base = 0.975, a = s.start;
    tw(scr, "op", [[a, 0], [a + 0.5, 1]]);
    camera(scr, base, [960, 500], [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + 1.9, 800, 600, 1.42, "inOut"]]);
    const cards = [[381, 399, 259, 421], [671, 399, 258, 421], [960, 399, 259, 421]];
    rim(scr, cards[0], at(s, 0.2), at(s, 0.38)); rim(scr, cards[1], at(s, 0.38), at(s, 0.56)); rim(scr, cards[2], at(s, 0.56));
    cursor(scr, [[at(s, 0.12), 700, 330], [at(s, 0.26), 511, 769], [at(s, 0.44), 800, 747], [at(s, 0.62), 1089, 769], [at(s, 0.86), 1089, 769, true]]);
    chip(g, "27 languages", 1330, 190, at(s, 0.6)); chip(g, "Starts automatically", 190, 190, at(s, 0.44));
    lower(g, s, "Add a lecture your way", "Transcription starts on its own");
  }

  // ================= 5. TRANSCRIPT =================
  {
    const s = S.transcript, g = scene(s), scr = screen(g, "transcript"), a = s.start;
    tw(scr, "op", [[a, 0], [a + 0.5, 1]]);
    camera(scr, 0.975, [960, 500], [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + s.dur * 0.3, 560, 830, 1.5, "inOut"], [a + s.dur * 0.56, 420, 815, 2.1, "inOut"]]);
    rim(scr, [150, 792, 52, 34], at(s, 0.6));
    cursor(scr, [[at(s, 0.5), 700, 700], [at(s, 0.72), 172, 806], [at(s, 0.74), 172, 806, true]]);
    chip(g, "Speaker labels", 1200, 70, at(s, 0.34)); chip(g, "Click to jump to that moment", 1020, 150, at(s, 0.66));
    lower(g, s, "Accurate, timestamped transcripts", "Speaker labels on every turn");
  }

  // ================= 6. NOTES =================
  {
    const s = S.notes, g = scene(s), scr = screen(g, "study-notes"), a = s.start;
    tw(scr, "op", [[a, 0], [a + 0.5, 1]]);
    camera(scr, 0.975, [960, 500], [[a, 800, 448, 0.94], [a + 0.9, 576, 690, 1.45, "inOut"], [s.end, 576, 790, 1.45, "inOut"]]);
    rim(scr, [172, 622, 610, 52], at(s, 0.34));
    chip(g, "Key concepts", 1290, 300, at(s, 0.3)); chip(g, "Organized by idea", 1290, 410, at(s, 0.5));
    lower(g, s, "Study notes in seconds", "Generated from the transcript");
  }

  // ================= 7. CARDS =================
  {
    const s = S.cards, g = scene(s), a = s.start;
    const scr = screen(g, "flashcards", true); put(scr, 1380 - 800, 470 - 448);
    tw(scr, "op", [[a, 0], [a + 0.6, 1]]); tw(scr, "x", [[a, 160], [a + 1, 0, "expo"]]); tw(scr, "s", [[a, 0.55], [a + 1, 0.62]]); tw(scr, "ry", [[a, -22], [a + 1.1, -9, "expo"]]);
    [[-5, 14], [4, 28]].forEach(([deg, off], i) => {
      const back = h("div", "card", null, g); back.style.cssText += "height:400px;width:640px;"; put(back, 300 + off * 0.6, 270 + off);
      back.style.display = "block"; tw(back, "r", [[a, deg]]); tw(back, "op", [[a + 0.2 + i * 0.1, 0], [a + 0.7 + i * 0.1, 0.85]]);
    });
    const mk = (q, ans, x, y) => {
      const c = h("div", "fc", null, g); put(c, x, y);
      h("div", "face", `<small>QUESTION</small><p>${q}</p>`, c); h("div", "face back", `<small>ANSWER</small><p>${ans}</p>`, c); return c;
    };
    const A = mk("Who is the author of the poem 'A Prayer'?", "Alfred Noyes", 300, 270), B = mk("What is the title of the poem in the transcript?", "A Prayer", 300, 270);
    tw(A, "op", [[a + 0.3, 0], [a + 0.8, 1], [at(s, 0.5), 1], [at(s, 0.5) + 0.5, 0]]); tw(A, "s", [[a + 0.3, 0.8], [a + 0.9, 1, "back"]]); tw(A, "ry", [[at(s, 0.24), 0], [at(s, 0.24) + 0.7, 180, "inOut"]]);
    tw(A, "x", [[at(s, 0.5), 0], [at(s, 0.5) + 0.55, -1000, "inOut"]]); tw(A, "r", [[at(s, 0.5), 0], [at(s, 0.5) + 0.55, -14, "inOut"]]);
    tw(B, "op", [[at(s, 0.5), 0], [at(s, 0.5) + 0.45, 1]]); tw(B, "s", [[at(s, 0.5), 0.9], [at(s, 0.5) + 0.55, 1, "back"]]); tw(B, "ry", [[at(s, 0.7), 0], [at(s, 0.7) + 0.7, 180, "inOut"]]);
    chip(g, "Quizlet", 960, 800, at(s, 0.56)); chip(g, "Anki", 1180, 800, at(s, 0.67)); chip(g, "Notion", 1340, 800, at(s, 0.78));
    lower(g, s, "Flashcards, made for you", "Export to Quizlet, Anki or Notion");
  }

  // ================= 8. LEARN =================
  {
    const s = S.learn, g = scene(s), a = s.start;
    const L = screen(g, "learn-mode", true), T = screen(g, "test-mode", true);
    put(L, 480 - 800, 400 - 448); put(T, 1440 - 800, 400 - 448);
    [[L, 0, 5], [T, 0.15, -5]].forEach(([el, d, ry]) => {
      tw(el, "op", [[a + d, 0], [a + d + 0.6, 1]]); tw(el, "y", [[a + d, 120], [a + d + 1, 0, "expo"]]);
      tw(el, "s", [[a + d, 0.46], [a + d + 1, 0.56], [s.end, 0.6, "lin"]]); tw(el, "ry", [[a + d, ry * 2.4], [a + d + 1, ry, "expo"]]);
    });
    rim(L, [139, 767, 852, 51], at(s, 0.3)); rim(T, [136, 668, 425, 44], at(s, 0.62));
    cursor(L, [[at(s, 0.18), 600, 640], [at(s, 0.28), 180, 792], [at(s, 0.3), 180, 792, true]]); cursor(T, [[at(s, 0.5), 700, 600], [at(s, 0.6), 172, 690], [at(s, 0.62), 172, 690, true]]);
    const steps = ["Recognition", "Written recall", "Practice test"];
    steps.forEach((txt, i) => {
      const x = 330 + i * 460, y = 790, t0 = at(s, 0.2 + i * 0.22);
      const off = h("div", "pill off", txt, g); put(off, x, y); const on = h("div", "pill on", txt, g); put(on, x, y);
      tw(off, "op", [[a + 0.8, 0], [a + 1.2, 1]]); tw(on, "op", [[t0, 0], [t0 + 0.35, 1]]); tw(on, "s", [[t0, 0.9], [t0 + 0.5, 1, "back"]]);
      if (i < 2) { const ln = h("div", "abs", null, g); put(ln, x + 280 + i * 0 + 0, y + 38, 180, 4); ln.style.cssText += "background:rgba(47,107,255,.35);border-radius:3px;"; tw(ln, "op", [[a + 1, 0], [a + 1.4, 1]]); }
    });
    lower(g, s, "Learn, then prove it", "Recognition, recall and a practice test");
  }

  // ================= 9. QUIZ + GUIDE =================
  {
    const s = S.quiz, g = scene(s), a = s.start;
    const Q = screen(g, "quiz", true), G = screen(g, "study-guide", true);
    put(Q, 480 - 800, 400 - 448); put(G, 1440 - 800, 400 - 448);
    [[Q, 0, 5], [G, 0.2, -5]].forEach(([el, d, ry]) => {
      tw(el, "op", [[a + d, 0], [a + d + 0.6, 1]]); tw(el, "y", [[a + d, 120], [a + d + 1, 0, "expo"]]);
      tw(el, "s", [[a + d, 0.46], [a + d + 1, 0.56], [s.end, 0.6, "lin"]]); tw(el, "ry", [[a + d, ry * 2.4], [a + d + 1, ry, "expo"]]);
    });
    rim(Q, [479, 205, 642, 40], at(s, 0.3)); cursor(Q, [[at(s, 0.16), 900, 480], [at(s, 0.28), 557, 225], [at(s, 0.3), 557, 225, true]]);
    chip(g, "Instant scoring", 190, 780, at(s, 0.46)); chip(g, "Structured study guide", 1090, 780, at(s, 0.62));
    lower(g, s, "Quizzes and study guides", "Built from your own lecture");
  }

  // ================= 10. TUTOR =================
  {
    const s = S.tutor, g = scene(s), scr = screen(g, "ai-tutor"), a = s.start;
    tw(scr, "op", [[a, 0], [a + 0.5, 1]]);
    camera(scr, 0.975, [960, 500], [[a, 800, 448, 0.94], [a + 0.9, 565, 640, 1.55, "inOut"], [at(s, 0.7), 565, 740, 1.55, "inOut"]]);
    chip(g, "Answers from your lecture", 1180, 250, at(s, 0.3));
    const th = h("div", "think", `<span class="lat">${"<u></u>".repeat(9)}</span>Thinking`, g); put(th, 1310, 800);
    tw(th, "op", [[at(s, 0.46), 0], [at(s, 0.5), 1], [at(s, 0.86), 1], [at(s, 0.9), 0]]); tw(th, "s", [[at(s, 0.46), 0.7], [at(s, 0.56), 1, "back"]]);
    const cells = th.querySelectorAll("u"), ring = [0, 1, 2, 5, 8, 7, 6, 3];
    ticks.push((t) => cells.forEach((c, i) => { const k = ring.indexOf(i); c.style.opacity = k < 0 ? 0.07 : Math.max(0.15, 1 - ((((t * 7 - k) % 8) + 8) % 8) / 3.2); }));
    lower(g, s, "An AI tutor that knows your class", "Ask anything about the lecture");
  }

  // ================= 11. PRO =================
  {
    const s = S.pro, g = scene(s), scr = screen(g, "email-drafts"), a = s.start;
    tw(scr, "op", [[a, 0], [a + 0.5, 1]]);
    camera(scr, 0.975, [960, 500], [[a, 800, 448, 0.94], [a + 0.9, 800, 448, 1, "inOut"], [a + s.dur * 0.3, 930, 290, 1.6, "inOut"]]);
    rim(scr, [1202, 95, 118, 46], at(s, 0.7)); cursor(scr, [[at(s, 0.5), 1000, 380], [at(s, 0.76), 1262, 118], [at(s, 0.78), 1262, 118, true]]);
    chip(g, "Summary email", 190, 250, at(s, 0.3)); chip(g, "Tone: Formal", 190, 360, at(s, 0.46)); chip(g, "Copied", 1500, 120, at(s, 0.82), "ok");
    lower(g, s, "Meetings, handled", "Summaries and follow-up emails in your tone");
  }

  // ================= 12. TRUST =================
  {
    const s = S.trust, g = scene(s), a = s.start;
    const shield = h("div", "abs", '<svg viewBox="0 0 64 64" width="150" height="150"><defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1b8fe0"/></linearGradient></defs><path d="M32 4l22 8v16c0 14-9 26-22 32C19 54 10 42 10 28V12z" fill="url(#sg)"/><path d="M22 32l7 7 14-15" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>', g);
    put(shield, 885, 150); tw(shield, "op", [[a + 0.2, 0], [a + 0.5, 1]]); tw(shield, "s", [[a + 0.2, 0], [a + 0.9, 1, "back"]]);
    const hl = h("div", "abs", "Your data. Your call.", g); hl.style.cssText += "font-size:96px;font-weight:700;letter-spacing:-0.04em;color:#0b1f55;text-align:center;width:1920px;"; put(hl, 0, 330);
    tw(hl, "op", [[a + 0.6, 0], [a + 1.1, 1]]); tw(hl, "y", [[a + 0.6, 40], [a + 1.2, 0, "expo"]]);
    const ex = h("div", "card", '<em><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="#2f6bff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 5 5-5M5 20h14"/></svg></em>Export my data', g);
    const dl = h("div", "card del", '<em><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="#e11d48" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></em>Delete my account', g);
    put(ex, 330, 570); put(dl, 1030, 570);
    [[ex, 0.3], [dl, 0.42]].forEach(([el, d]) => { tw(el, "op", [[a + 1.1 + d, 0], [a + 1.6 + d, 1]]); tw(el, "y", [[a + 1.1 + d, 60], [a + 1.8 + d, 0, "expo"]]); });
    tw(ex, "s", [[at(s, 0.42), 1], [at(s, 0.42) + 0.12, 0.95], [at(s, 0.42) + 0.4, 1, "back"]]); tw(dl, "s", [[at(s, 0.74), 1], [at(s, 0.74) + 0.12, 0.95], [at(s, 0.74) + 0.4, 1, "back"]]);
    const cur = h("div", "cur", ARROW, g);
    tw(cur, "x", [[at(s, 0.2), 1000, "lin"], [at(s, 0.4), 640, "inOut"], [at(s, 0.74), 1240, "inOut"]]); tw(cur, "y", [[at(s, 0.2), 470, "lin"], [at(s, 0.4), 660, "inOut"], [at(s, 0.74), 660, "inOut"]]); tw(cur, "op", [[at(s, 0.2), 0], [at(s, 0.28), 1]]);
    chip(g, "studyscribe-export.json", 360, 830, at(s, 0.48), "ok"); chip(g, "All data deleted", 1130, 830, at(s, 0.8), "ok");
    lower(g, s, "Privacy you can see", "Export or delete everything, anytime");
  }

  // ================= 13. FINALE (dark) =================
  {
    const s = S.finale, g = scene(s), a = s.start;
    const names = ["Lecture", "Transcript", "Notes", "Flashcards", "Quiz", "Ready"], widths = [220, 270, 200, 270, 190, 200], gap = 36;
    const total = widths.reduce((p, w) => p + w, 0) + gap * 5; let x = (1920 - total) / 2;
    const rowT = at(s, 0.12), rowOut = at(s, 0.46);
    names.forEach((n, i) => {
      const off = h("div", "pill dark off", n, g), on = h("div", "pill on", n, g); [off, on].forEach((e) => { put(e, x, 470, widths[i]); e.style.justifyContent = "center"; e.style.padding = "0"; });
      const t0 = rowT + i * 0.42;
      tw(off, "op", [[rowT - 0.3, 0], [rowT, 1], [rowOut, 1], [rowOut + 0.4, 0]]); tw(off, "y", [[rowT - 0.3, 40], [rowT, 0], [rowOut, 0], [rowOut + 0.4, -50]]);
      tw(on, "op", [[t0, 0], [t0 + 0.3, 1], [rowOut, 1], [rowOut + 0.4, 0]]); tw(on, "s", [[t0, 0.88], [t0 + 0.5, 1, "back"]]); tw(on, "y", [[rowOut, 0], [rowOut + 0.4, -50]]);
      x += widths[i] + gap;
    });
    const logo = h("img", "abs", null, g); logo.src = "assets/logo.webp"; put(logo, 900, 190, 120, 120);
    const hd = h("div", "abs mark", "Record once.<br>Study smarter.", g); hd.style.cssText += "font-size:132px;line-height:1.04;"; put(hd, 0, 330, 1920);
    const cta = h("div", "cta", "Get started free", g); put(cta, 700, 700, 520); cta.style.justifyContent = "center"; cta.style.padding = "0";
    const url = h("div", "url", "studyscribe-ai.vercel.app", g); put(url, 0, 860);
    const tIn = at(s, 0.5);
    tw(logo, "op", [[tIn, 0], [tIn + 0.5, 1]]); tw(logo, "s", [[tIn, 0], [tIn + 0.8, 1, "back"]]);
    tw(hd, "op", [[tIn + 0.2, 0], [tIn + 0.8, 1]]); tw(hd, "y", [[tIn + 0.2, 60], [tIn + 1, 0, "expo"]]); tw(hd, "blur", [[tIn + 0.2, 16], [tIn + 0.8, 0]]);
    tw(cta, "op", [[at(s, 0.7), 0], [at(s, 0.7) + 0.5, 1]]); tw(cta, "s", [[at(s, 0.7), 0.8], [at(s, 0.7) + 0.6, 1, "back"]]);
    tw(url, "op", [[at(s, 0.76), 0], [at(s, 0.76) + 0.6, 1]]);
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
