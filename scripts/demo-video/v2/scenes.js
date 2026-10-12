// Deterministic scene engine: window.renderAt(t) draws the whole frame for time t (seconds),
// so render.mjs can step through the video one frame at a time and screenshot each one.
// Callouts, highlights and clicks are timed to the narration through W(scene, /word/), and every
// position on a screenshot comes from rects.js, which capture.mjs measures in the live app.
(() => {
  const build = () => {
    // R: highlight/click targets as [x, y, w, h, radius] in the 1600x896 space screenshots are drawn in.
    const TL = window.__TL, OV = TL.overlap, S = {}, R = window.__RECTS;
    TL.scenes.forEach((s, i) => { s.i = i; s.end = i < TL.scenes.length - 1 ? TL.scenes[i + 1].start : TL.total; S[s.id] = s; });
    const stage = document.getElementById("stage");
    // Layout. A screenshot first appears whole, as a window (scale L.win); zoomed in, it fills the frame
    // down to a band edge: L.band when its callouts sit in the empty column beside it, L.bandStrip when
    // they sit in a row under it (at L.stripY). Captions always sit below the band.
    // Detail pages zoom to L.detail: the page header's Share button then sits just past the right edge
    // (at 1.225 it is still whole; anything between would cut it in half).
    const L = { win: 0.86, winY: 420, band: 935, bandStrip: 828, stripY: 848, detail: 1.36, detailWide: 1.225 };
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
    // One track per element and property: a later track for the same pair replaces the earlier one.
    const tw = (el, prop, frames) => tracks.push({ el, prop, frames });
    const h = (tag, cls, html, parent = stage) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; parent.appendChild(e); return e; };
    const put = (e, x, y, w, ht) => { e.style.left = x + "px"; e.style.top = y + "px"; if (w != null) e.style.width = w + "px"; if (ht != null) e.style.height = ht + "px"; return e; };
    const at = (s, f) => s.start + s.dur * f;
    // Time (seconds) the narrator starts the first word of scene s matching `re` (nth match).
    const word = (s, re, nth = 0) => {
      const rx = new RegExp(re, "i"), m = (s.words || []).filter((w) => rx.test(w.w)), w = m[nth] || m[0];
      return w ? { t: s.start + s.voiceAt + w.t0, raw: w.raw } : { t: at(s, 0.5), raw: "?" };
    };
    const W = (s, re, nth = 0) => word(s, re, nth).t;
    // A visual beat landing on a spoken word: it starts LEAD before the word (so it reads as on the word)
    // plus any deliberate offset. Every beat is logged in window.__CUES for the timing check.
    const LEAD = 0.05, CUES = (window.__CUES = []);
    const cue = (s, re, what, { nth = 0, offset = -LEAD } = {}) => {
      const w = word(s, re, nth), t = w.t + offset;
      CUES.push({ scene: s.id, word: w.raw, wordT: +w.t.toFixed(3), t: +t.toFixed(3), what });
      return t;
    };

    // ---- backgrounds ----------------------------------------------------------------------
    const bgDark = h("div", "abs"); bgDark.id = "bgDark";
    const bgLight = h("div", "abs"); bgLight.id = "bgLight";

    // ---- scene changes: a band sweeps across and the next scene is revealed exactly behind its centre
    // line, so no frame ever mixes two scenes (a crossfade between the dark and light looks muddy grey).
    // The band starts and ends off-screen; its centre line is slanted 12 degrees like the band.
    const WIPE = { pre: 0.3, post: 0.5, from: -560, to: 2600, slant: Math.tan((12 * Math.PI) / 180) };
    const wipeX = (T, t) => val([[T - WIPE.pre, WIPE.from], [T + WIPE.post, WIPE.to, "inOut"]], t);
    const lineX = (T, t, y) => 50 + wipeX(T, t) - WIPE.slant * (y - 550); // stage x of the band's centre line at height y
    // clip-path polygon (in an element's own coordinates, given its scale about the frame centre) for the
    // part of the frame left of the line ("in": the incoming scene) or right of it ("out").
    const wiped = (T, t, side, sc = 1) => {
      const lx = (x) => (x - 960) / sc + 960, ly = (y) => (y - 540) / sc + 540, a = lineX(T, t, -60), b = lineX(T, t, 1140);
      const edge = side === "in" ? [-60, -60] : [1980, 1980];
      return `polygon(${lx(edge[0])}px ${ly(-60)}px, ${lx(a)}px ${ly(-60)}px, ${lx(b)}px ${ly(1140)}px, ${lx(edge[1])}px ${ly(1140)}px)`;
    };
    const inWipe = (T, t) => t >= T - WIPE.pre && t <= T + WIPE.post;
    // The light background shows from the product scene to the end of the steps scene.
    {
      const on = S.product.start, off = S.finale.start;
      tw(bgLight, "op", [[on - WIPE.pre - 0.01, 0], [on - WIPE.pre, 1], [off + WIPE.post, 1], [off + WIPE.post + 0.01, 0]]);
      ticks.push((t) => { bgLight.style.clipPath = inWipe(on, t) ? wiped(on, t, "in") : inWipe(off, t) ? wiped(off, t, "out") : "none"; });
    }

    // ---- helpers ----------------------------------------------------------------------------
    const scene = (s) => {
      const g = h("div", "scene");
      const first = s.i === 0, last = s.i === TL.scenes.length - 1;
      const op = first ? [[0, 1]] : [[s.start - WIPE.pre - 0.01, 0], [s.start - WIPE.pre, 1]];
      if (!last) op.push([s.end + WIPE.post, 1], [s.end + WIPE.post + 0.01, 0]);
      tw(g, "op", op);
      const sc = first ? [[0, 1]] : [[s.start - WIPE.pre, 0.975], [s.start + 0.6, 1]];
      if (!last) sc.push([s.end, 1], [s.end + OV, 1.03, "lin"]);
      const scale = (t) => val(sc, t);
      tw(g, "s", sc);
      ticks.push((t) => { g.style.clipPath = !first && inWipe(s.start, t) ? wiped(s.start, t, "in", scale(t)) : !last && inWipe(s.end, t) ? wiped(s.end, t, "out", scale(t)) : "none"; });
      return g;
    };
    const pop = (e, t) => { tw(e, "op", [[t, 0], [t + 0.2, 1]]); tw(e, "s", [[t, 0.6], [t + 0.55, 1, "back"]]); tw(e, "y", [[t, 20], [t + 0.5, 0]]); return e; };
    // Callout chips [text, time, class] laid out as a row or a column and anchored at (x, y): ax/ay pick
    // the point of the group that sits there (0.5, 0.5 is its centre). Each pops in when its word is spoken.
    const callouts = (p, items, x, y, { ax = 0.5, ay = 0, dir = "row" } = {}) => {
      const box = h("div", "callouts " + dir, null, p); put(box, x, y);
      box.style.transform = `translate(${-ax * 100}%, ${-ay * 100}%)`;
      items.forEach(([text, t, cls]) => pop(h("div", "chip " + (cls || ""), `<i></i>${text}`, box), t));
      return box;
    };
    const strip = (p, items) => callouts(p, items, 960, L.stripY);
    // A column of callouts centred in the empty page to the right of a zoomed screenshot's content.
    const beside = (p, items, right) => callouts(p, items, (right + 1920) / 2, L.band / 2, { ay: 0.5, dir: "column" });

    const screen = (p, img, free = false) => h("div", "screen" + (free ? " free" : ""), `<img src="../frames/${img}.jpg">`, p);
    // Camera views of a screenshot: {s, x, y} = its scale and the stage position of its top-left corner.
    const view = {
      win: (s = L.win) => ({ s, x: 960 - 800 * s, y: L.winY - 448 * s }),
      // Zoomed in: screenshot x=cx at the centre of the frame (side edges kept off-screen) and screenshot y=top at its top edge.
      zoom: (s, cx, top) => {
        let x = 960 - cx * s;
        if (1600 * s >= 1960) x = Math.min(-20, Math.max(1940 - 1600 * s, x));
        return { s, x, y: -top * s };
      },
    };
    const cam = (el, keys) => {
      const fx = keys.map(([t, v, e]) => [t, v.x, e]), fy = keys.map(([t, v, e]) => [t, v.y, e]), fs = keys.map(([t, v, e]) => [t, v.s, e]);
      tw(el, "x", fx); tw(el, "y", fy); tw(el, "s", fs);
      const now = (t) => ({ x: val(fx, t), y: val(fy, t), s: val(fs, t) });
      return { now, pt: (t, [px, py]) => { const c = now(t); return [c.x + px * c.s, c.y + py * c.s]; } };
    };
    // Cuts a zoomed screenshot off at the band edge, so it never runs under the callouts or captions,
    // and shades the edge like the bottom of a sheet.
    const band = (g, scr, c, bottom) => {
      const edge = h("div", "edge", null, g);
      ticks.push((t) => {
        const v = c.now(t), local = (bottom - v.y) / v.s;
        scr.style.clipPath = local < 896 ? `inset(0 0 ${896 - local}px 0)` : "none";
        const left = Math.max(0, v.x), right = Math.min(1920, v.x + 1600 * v.s);
        put(edge, left, bottom, right - left);
        edge.style.opacity = Math.max(0, Math.min(1, (v.y + 896 * v.s - bottom) / 40)) * (parseFloat(scr.style.opacity) || 0);
      });
    };
    // A screenshot that fades in as a window and then follows the camera keys [t, view, ease].
    const tour = (s, g, img, keys, { bottom = L.band, out = null, from = view.win(L.win - 0.03) } = {}) => {
      const scr = screen(g, img);
      tw(scr, "op", out == null ? [[s.start, 0], [s.start + 0.5, 1]] : [[s.start, 0], [s.start + 0.5, 1], [out, 1], [out + 0.45, 0]]);
      const c = cam(scr, [[s.start, from], ...keys]);
      band(g, scr, c, bottom);
      return { scr, c };
    };
    // A highlight box around [x, y, w, h, r] on a screenshot: a STROKE-px outline whose inner edge sits GAP px
    // (on screen) outside the target's own edge, with corners concentric to the target's (r in screenshot
    // space; 0 for a target with no visible edge, such as a line of text). k = 1 / the screenshot's scale
    // while it shows, so the gap and stroke look the same at any zoom.
    const GAP = 5, STROKE = 3;
    const rim = (scr, [x, y, w, ht, r = 0], on, off, { k = 1 } = {}) => {
      const p = (GAP + STROKE) * k;
      const e = h("div", "rim", null, scr); put(e, x - p, y - p, w + 2 * p, ht + 2 * p);
      e.style.setProperty("--k", k); e.style.borderRadius = r + p + "px";
      tw(e, "op", [[on, 0], [on + 0.15, 1], [off ?? 1e6, 1], [(off ?? 1e6) + 0.25, 0]]);
      return e;
    };
    // The pointer's tip is at (3, 2) of its 24-unit box; points [t, x, y, click] place the tip itself.
    const ARROW = '<svg viewBox="0 0 24 24"><path d="M3 2l15.5 9.2-6.9 1.6 4 7.4-3 1.6-4-7.4L3 18.5z" fill="#fff" stroke="#111b3c" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const cursor = (p, pts, k = 1) => {
      const size = 34 * k, tx = (size * 3) / 24, ty = (size * 2) / 24;
      const c = h("div", "cur", ARROW, p);
      c.style.cssText += `width:${size}px;height:${size}px;margin:${-ty}px 0 0 ${-tx}px;transform-origin:${tx}px ${ty}px;`;
      c.firstChild.style.filter = `drop-shadow(0 ${3 * k}px ${4 * k}px rgba(0,0,0,.32))`;
      tw(c, "x", pts.map(([t, x], i) => [t, x, i ? "inOut" : "lin"])); tw(c, "y", pts.map(([t, , y], i) => [t, y, i ? "inOut" : "lin"]));
      tw(c, "op", [[pts[0][0], 0], [pts[0][0] + 0.25, 1]]);
      const sc = [[pts[0][0], 1]];
      pts.forEach(([t, x, y, click]) => {
        if (!click) return;
        const d = 64 * k, r = h("div", "ripple", null, p); put(r, x - d / 2, y - d / 2, d, d); r.style.borderWidth = 3 * k + "px";
        tw(r, "op", [[t - 0.01, 0], [t, 0.9], [t + 0.55, 0]]); tw(r, "s", [[t, 0.3], [t + 0.55, 1.7]]);
        sc.push([t - 0.1, 1], [t, 0.82], [t + 0.12, 1]);
      });
      tw(c, "s", sc);
    };
    // A flashcard: an outer box takes fades, moves and spins, and the card inside flips in 3D. (Fading the
    // flipping element itself would flatten it, showing its hidden face mirrored through the other.)
    const flashcard = (p, q, ans, x, y, ansStyle = "") => {
      const w = h("div", "abs", null, p); put(w, x, y, 640, 400); w.style.perspective = "2200px";
      const c = h("div", "fc", null, w);
      h("div", "face", `<small>QUESTION</small><p>${q}</p>`, c); h("div", "face back", `<small>ANSWER</small><p style="${ansStyle}">${ans}</p>`, c);
      return [w, c];
    };
    const typing = (el, text, t0, cps) => ticks.push((t) => { const n = Math.max(0, Math.min(text.length, Math.floor((t - t0) * cps))); el.textContent = t < t0 ? "" : text.slice(0, n) + (n < text.length ? "|" : ""); });
    // Burned-in captions from the narration timing (for viewers watching without sound), one phrase at a
    // time: a sentence stays whole when it is short, otherwise it splits at its commas (neighbouring
    // pieces merged while they fit), and only a long piece with no comma splits at its middle word.
    const phrases = (words) => {
      const text = (ws) => ws.map((x) => x.raw).join(" "), out = [];
      const halve = (p) => {
        if (text(p).length <= 54 || p.length < 2) return [p];
        let best = 1, score = 1e9;
        for (let i = 1; i < p.length; i++) { const m = Math.max(text(p.slice(0, i)).length, text(p.slice(i)).length); if (m < score) { score = m; best = i; } }
        return [p.slice(0, best), p.slice(best)];
      };
      let sent = [];
      const flush = () => {
        if (!sent.length) return;
        if (text(sent).length <= 54) out.push(sent);
        else {
          const parts = []; let cur = [];
          sent.forEach((w) => { cur.push(w); if (/[,;:]$/.test(w.raw)) { parts.push(cur); cur = []; } });
          if (cur.length) parts.push(cur);
          const merged = [];
          parts.forEach((p) => { const last = merged[merged.length - 1]; if (last && text(last.concat(p)).length <= 50) merged[merged.length - 1] = last.concat(p); else merged.push(p); });
          merged.forEach((p) => out.push(...halve(p)));
        }
        sent = [];
      };
      words.forEach((w) => { sent.push(w); if (/[.?!]$/.test(w.raw)) flush(); });
      flush();
      return out;
    };
    const captions = (g, s) => {
      if (!s.words || !s.words.length) return;
      const lines = phrases(s.words);
      const spans = lines.map((P) => [s.start + s.voiceAt + P[0].t0 - 0.05, s.start + s.voiceAt + P[P.length - 1].t1 + 0.25]);
      spans.forEach((sp, i) => { if (i + 1 < spans.length) sp[1] = Math.min(sp[1], spans[i + 1][0] - 0.02); });
      lines.forEach((P, i) => {
        const [t0, t1] = spans[i];
        const e = h("div", "cap", `<span>${P.map((x) => x.raw).join(" ")}</span>`, g); put(e, 0, 960, 1920);
        tw(e, "op", [[t0, 0], [t0 + 0.1, 1], [t1 - 0.08, 1], [t1, 0]]); tw(e, "y", [[t0, 10], [t0 + 0.18, 0]]);
      });
    };
    // Stage x of a screenshot's content column right edge, for callouts beside a zoomed detail page.
    const rightOf = (v, col) => v.x + (col[0] + col[2]) * v.s;

    // ================= 1. HOOK (dark, kinetic type) =================
    {
      const s = S.hook, g = scene(s);
      const lines = [
        { w: ["You", "sat", "through", "the", "whole", "lecture."], i0: 0 },
        { w: ["You", "even", "took", "notes."], i0: 6 },
        { w: ["And", "by", "Friday,", "most", "of", "it", "was", '<span class="gone">gone.</span>'], i0: 10 },
      ];
      // Each word appears as it is spoken (word i of the narration).
      const wt = (i, label) => { const w = s.words[i], t = s.start + s.voiceAt + w.t0; CUES.push({ scene: s.id, word: w.raw, wordT: +t.toFixed(3), t: +(t - LEAD).toFixed(3), what: label }); return t - LEAD; };
      lines.forEach((Ln, li) => {
        const el = h("div", "big", null, g); put(el, 0, 410, 1920);
        Ln.w.forEach((txt, wi) => {
          const w = h("span", "w", txt + (wi < Ln.w.length - 1 ? " " : ""), el), t0 = wt(Ln.i0 + wi, "word appears");
          tw(w, "op", [[t0, 0], [t0 + 0.3, 1]]); tw(w, "y", [[t0, 40], [t0 + 0.55, 0, "expo"]]); tw(w, "blur", [[t0, 14], [t0 + 0.35, 0]]);
          if (li === 2 && wi === Ln.w.length - 1) { const f = t0 + 1.0; tw(w, "blur", [[t0, 14], [t0 + 0.35, 0], [f, 0], [f + 1.2, 16, "inOut"]]); tw(w, "op", [[t0, 0], [t0 + 0.3, 1], [f, 1], [f + 1.2, 0.12, "inOut"]]); }
        });
        if (li < 2) { const out = s.start + s.voiceAt + s.words[lines[li + 1].i0].t0 - 0.4; tw(el, "op", [[out, 1], [out + 0.3, 0]]); tw(el, "y", [[out, 0], [out + 0.3, -40]]); }
      });
    }

    // ================= 2. BRAND (dark) =================
    {
      const s = S.brand, g = scene(s), tl = cue(s, "^meet", "logo appears");
      for (let i = 0; i < 3; i++) { const r = h("div", "ring", null, g); put(r, 780, 250); tw(r, "s", [[tl + i * 0.4, 0.3], [tl + 2.4 + i * 0.4, 3.4, "out"]]); tw(r, "op", [[tl + i * 0.4 - 0.01, 0], [tl + i * 0.4, 0.9], [tl + 2.4 + i * 0.4, 0]]); }
      const logo = h("img", "abs", null, g); logo.src = "assets/logo.webp"; put(logo, 865, 280, 190, 190);
      tw(logo, "op", [[tl, 0], [tl + 0.2, 1]]); tw(logo, "s", [[tl, 0], [tl + 0.8, 1, "back"]]);
      const mark = h("div", "abs mark", "StudyScribe AI", g); put(mark, 0, 500, 1920);
      const tm = cue(s, "^studyscribe", "name appears"); tw(mark, "op", [[tm, 0], [tm + 0.4, 1]]); tw(mark, "y", [[tm, 60], [tm + 0.8, 0, "expo"]]); tw(mark, "blur", [[tm, 16], [tm + 0.5, 0]]);
      // The line under the name is what is said: "Record once, and turn it into everything you need to study."
      [["Record once.", "^record", 700], ["Turn it into everything you need to study.", "^turn", 772]].forEach(([text, re, y]) => {
        const e = h("div", "abs tag", text, g); put(e, 0, y, 1920);
        const t0 = cue(s, re, `"${text}" appears`); tw(e, "op", [[t0, 0], [t0 + 0.3, 1]]); tw(e, "y", [[t0, 24], [t0 + 0.5, 0]]);
      });
    }

    // ================= 3. PIPELINE (dark): one recording becomes a whole study set =================
    {
      const s = S.pipeline, g = scene(s);
      // Three columns centred on y = 540: the file, its transcript, and what it turns into. On "the whole
      // idea" they appear as empty outlines, each filled in as it is named.
      const tWhole = cue(s, "^whole", "outlines of the whole idea"), td = cue(s, "^drop", "lecture file drops in"), tt = cue(s, "^transcript", "transcript card + arrow");
      const tn = cue(s, "^notes", "Study notes tile + arrow"), tf = cue(s, "^flashcards", "Flashcards tile"), tq = cue(s, "^quiz", "Practice quiz tile");
      [[110, 380, 420, 320, td], [640, 380, 640, 320, tt], [1410, 344, 400, 112, tn], [1410, 484, 400, 112, tf], [1410, 624, 400, 112, tq]].forEach(([x, y, w, ht, filled], i) => {
        const e = h("div", "ghost", null, g); put(e, x, y, w, ht); e.style.borderRadius = (i < 2 ? 30 : 26) + "px";
        tw(e, "op", [[tWhole, 0], [tWhole + 0.3, 1], [filled, 1], [filled + 0.2, 0]]);
      });
      const file = h("div", "dcard", '<small>YOUR LECTURE</small><div class="wave"></div><div class="dline" style="margin:22px 0 0;font-size:30px;font-weight:600">Intro to AI.m4a</div><div class="dline" style="margin:0;color:#8ec1ff;font-size:24px">1:13</div>', g); put(file, 110, 380, 420, 320);
      const bars = file.querySelector(".wave"); bars.style.cssText = "display:flex;align-items:flex-end;gap:7px;height:120px;";
      const hs = []; for (let i = 0; i < 22; i++) { const b = h("div", "", null, bars); const v = 24 + 90 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)); b.style.cssText = `width:10px;border-radius:5px;background:#7db4ff;height:${v}px;`; hs.push([b, v]); }
      ticks.push((t) => hs.forEach(([b, v], i) => { b.style.height = v * (0.7 + 0.3 * Math.sin(t * 6 + i)) + "px"; }));
      const tr1 = cue(s, "^recording", "lecture file pulses");
      tw(file, "op", [[td, 0], [td + 0.2, 1]]); tw(file, "y", [[td, -260], [td + 0.55, 0, "back"]]); tw(file, "r", [[td, -8], [td + 0.55, 0, "back"]]);
      tw(file, "s", [[tr1, 1], [tr1 + 0.2, 1.05], [tr1 + 0.6, 1, "inOut"]]);
      const tr = h("div", "dcard", "<small>TRANSCRIPT</small>", g); put(tr, 640, 380, 640, 320);
      const lines = [["0:00", "AI is one of the most transformative"], ["0:07", "technologies of our time. It lets"], ["0:14", "computers learn from data, spot"], ["0:21", "patterns, and make decisions."]];
      tw(tr, "op", [[tt, 0], [tt + 0.2, 1]]); tw(tr, "y", [[tt, 50], [tt + 0.6, 0, "expo"]]);
      lines.forEach(([ts, tx], i) => {
        const l = h("div", "dline", `<b>${ts}</b><span></span>`, tr), t0 = tt + 0.2 + i * 0.3;
        tw(l, "op", [[t0 - 0.05, 0], [t0 + 0.1, 1]]); typing(l.querySelector("span"), tx, t0, 40);
      });
      [["Study notes", 344, tn], ["Flashcards", 484, tf], ["Practice quiz", 624, tq]].forEach(([name, y, t0]) => {
        const e = h("div", "ftile", name, g); put(e, 1410, y);
        tw(e, "op", [[t0, 0], [t0 + 0.2, 1]]); tw(e, "x", [[t0, -160], [t0 + 0.6, 0, "expo"]]); tw(e, "s", [[t0, 0.8], [t0 + 0.55, 1, "back"]]);
      });
      // the arrows from file to transcript, and from transcript to the study tools
      [[540, 90, tt], [1290, 110, tn]].forEach(([x, w, t0]) => {
        const ar = h("div", "abs", null, g); ar.style.cssText += "height:6px;border-radius:3px;background:#2f6bff;"; put(ar, x, 537, w);
        tw(ar, "op", [[t0, 0], [t0 + 0.2, 1]]);
      });
      captions(g, s);
    }

    // ================= 4. PRODUCT: the library of lectures and meetings =================
    {
      const s = S.product, g = scene(s), scr = screen(g, "dashboard", true); put(scr, 160, L.winY - 448);
      tw(scr, "op", [[s.start, 0], [s.start + 0.6, 1]]); tw(scr, "y", [[s.start, 150], [s.start + 1.2, 0, "expo"]]); tw(scr, "rx", [[s.start, 18], [s.start + 1.2, 0, "expo"]]);
      tw(scr, "s", [[s.start, 0.72], [s.start + 1.2, L.win - 0.02, "expo"], [s.end, L.win, "lin"]]);
      strip(g, [["Record live", cue(s, "^record$", "chip Record live")], ["Upload a file", cue(s, "^upload$", "chip Upload a file")], ["Paste a link", cue(s, "^paste$", "chip Paste a link")]]);
      captions(g, s);
    }

    // ================= 5. ADD: transcription starts on its own, in 27 languages =================
    {
      const s = S.add, g = scene(s), A = R.add;
      const tl = cue(s, "^twenty-seven", "language picker screen");
      // Zoomed on the three ways in, cropped in the gap between the consent note and the cards.
      const zA = view.zoom(1.3, 800, (A.banner[1] + A.banner[3] + A.cards[0][1]) / 2), kA = 1 / zA.s;
      const add = tour(s, g, "add-recording", [], { bottom: L.bandStrip, out: tl, from: zA });
      // "Transcription": the card's own "Automatic transcription" line.
      rim(add.scr, A.automatic, cue(s, "^transcription", "box: Automatic transcription"), tl, { k: kA });
      // The link form comes up with its spoken-language list open, cropped just above the list's label.
      const Lg = R.language, topL = Math.max(Lg.radios[1] + Lg.radios[3] + 2, Lg.label[1] - 14), kL = 1 / 1.25;
      const lang = screen(g, "language"); tw(lang, "op", [[tl, 0], [tl + 0.3, 1]]);
      const cL = cam(lang, [[tl, view.zoom(1.25, 800, topL)]]);
      band(g, lang, cL, L.bandStrip);
      rim(lang, Lg.list, cue(s, "^languages", "box: the language list"), null, { k: kL });
      strip(g, [["Starts automatically", cue(s, "^starts", "chip Starts automatically")], ["27 languages", tl]]);
      captions(g, s);
    }

    // ================= 6. TRANSCRIPT (Thermodynamics): timestamps, speaker labels, click a line =================
    {
      const s = S.transcript, g = scene(s), a = s.start, ck = s.clickTimes[0], T = R.transcript;
      const z = view.zoom(L.detail, 540, 0), k = 1 / z.s;
      const { scr } = tour(s, g, "transcript", [[a + 0.3, view.win(), "inOut"], [a + 1.0, z, "inOut"]]);
      const tStamp = cue(s, "^timestamped", "box: timestamp 0:23"), tLab = cue(s, "^labeled", "box: speaker Prof. Lee");
      rim(scr, T.stamp, tStamp, tLab, { k });
      rim(scr, T.speaker, tLab, ck - 0.2, { k });
      const tClick = cue(s, "^click", "click on the line", { offset: 0 });
      rim(scr, T.line, tClick + 0.05, null, { k });
      const [cx, cy] = T.click;
      cursor(scr, [[ck - 1.0, cx + 220, cy + 110], [ck - 0.3, cx, cy], [ck, cx, cy, true]], k);
      beside(g, [["Timestamps", tStamp], ["Speaker labels", cue(s, "^speaker", "chip Speaker labels")], ["Back to that exact moment", cue(s, "^back", "chip Back to that exact moment")]], rightOf(z, T.column));
      captions(g, s);
    }

    // ================= 7. NOTES (Microeconomics) =================
    {
      const s = S.notes, g = scene(s), a = s.start, N = R.notes;
      const z = view.zoom(L.detail, 540, 0), k = 1 / z.s;
      const { scr } = tour(s, g, "study-notes", [[a + 0.2, view.win(), "inOut"], [a + 0.8, z, "inOut"]]);
      const tOrg = cue(s, "^organized", "box: Key Concepts"), tIdeas = cue(s, "^ideas", "box: Formulas and Definitions");
      rim(scr, N.concepts, tOrg, tIdeas, { k });
      rim(scr, N.formulas, tIdeas, null, { k });
      beside(g, [["Study notes", cue(s, "^study", "chip Study notes")], ["Organized by idea", tOrg]], rightOf(z, N.column));
      captions(g, s);
    }

    // ================= 8. CARDS (the Intro to AI deck, over its review screen) =================
    {
      const s = S.cards, g = scene(s), a = s.start;
      // The review screen on the right (centred on x = 1360) and the card stack left of it, not overlapping it.
      const scr = screen(g, "flashcards", true); put(scr, 1360 - 800, 470 - 448);
      tw(scr, "op", [[a, 0], [a + 0.6, 1]]); tw(scr, "x", [[a, 160], [a + 1, 0, "expo"]]); tw(scr, "s", [[a, 0.54], [a + 1, 0.6]]); tw(scr, "ry", [[a, -22], [a + 1.1, -9, "expo"]]);
      const tc = cue(s, "^flashcards", "flashcard stack appears");
      [[-5, 14], [4, 28]].forEach(([deg, off]) => {
        const back = h("div", "card", null, g); back.style.cssText += "height:400px;width:640px;"; put(back, 170 + off * 0.6, 270 + off);
        back.style.display = "block"; tw(back, "r", [[a, deg]]); tw(back, "op", [[tc, 0], [tc + 0.3, 0.85]]);
      });
      const [A, Af] = flashcard(g, "What does AI stand for?", "Artificial intelligence", 170, 270), [B, Bf] = flashcard(g, "What are three capabilities AI enables computers to do?", "Learn from data, recognize patterns, and make decisions.", 170, 270, "font-size:46px;line-height:1.15");
      const f1 = cue(s, "^write", "card flips to its answer"), swap = cue(s, "^export", "next card comes in"), f2 = W(s, "^anki") + 0.2;
      tw(A, "op", [[tc, 0], [tc + 0.2, 1], [swap, 1], [swap + 0.4, 0]]); tw(A, "s", [[tc, 0.8], [tc + 0.6, 1, "back"]]); tw(Af, "ry", [[f1, 0], [f1 + 0.7, 180, "inOut"]]);
      tw(A, "x", [[swap, 0], [swap + 0.55, -1000, "inOut"]]); tw(A, "r", [[swap, 0], [swap + 0.55, -14, "inOut"]]);
      // The next card comes in once the first has mostly slid away, so the two never blend.
      tw(B, "op", [[swap + 0.25, 0], [swap + 0.6, 1]]); tw(B, "s", [[swap + 0.25, 0.9], [swap + 0.75, 1, "back"]]); tw(Bf, "ry", [[f2, 0], [f2 + 0.8, 180, "inOut"]]);
      strip(g, [["Quizlet", cue(s, "^quizlet", "chip Quizlet")], ["Anki", cue(s, "^anki", "chip Anki")], ["Notion", cue(s, "^notion", "chip Notion")]]);
      captions(g, s);
    }

    // ================= 9. FLIP (light): try a flashcard yourself =================
    {
      const s = S.flip, g = scene(s);
      const t0 = cue(s, "^let's", "Your turn + card"), tt = cue(s, "^take", "countdown starts"), tf = cue(s, "^artificial", "card flips to the answer");
      const hd = h("div", "abs", "Your turn", g); hd.style.cssText += "font-size:84px;font-weight:700;letter-spacing:-0.04em;color:#0b1f55;text-align:center;width:1920px;"; put(hd, 0, 96);
      tw(hd, "op", [[t0, 0], [t0 + 0.3, 1]]); tw(hd, "y", [[t0, 40], [t0 + 0.6, 0, "expo"]]);
      // The card is centred on (960, 500) and grows to 1.2x: 768 x 480, from y = 260 to 740.
      const [c, cf] = flashcard(g, "What does AI stand for?", "Artificial intelligence", 640, 300, "font-size:62px");
      tw(c, "op", [[t0, 0], [t0 + 0.3, 1]]); tw(c, "s", [[t0, 0.7], [t0 + 0.7, 1.2, "back"]]); tw(c, "y", [[t0, 80], [t0 + 0.7, 0, "expo"]]); tw(cf, "ry", [[tf, 0], [tf + 0.8, 180, "inOut"]]);
      const cd = h("div", "abs", "3", g); cd.style.cssText += "width:120px;height:120px;border-radius:50%;display:grid;place-items:center;font-size:64px;font-weight:700;color:#2f6bff;background:#fff;box-shadow:0 0 0 6px #cfe0ff,0 20px 50px rgba(37,79,200,.18);"; put(cd, 900, 790);
      tw(cd, "op", [[tt, 0], [tt + 0.2, 1], [tf, 1], [tf + 0.2, 0]]); tw(cd, "s", [[tt, 0.6], [tt + 0.4, 1, "back"]]);
      ticks.push((t) => { const u = Math.max(0, Math.min(0.999, (t - tt) / Math.max(0.3, tf - tt))); cd.textContent = String(3 - Math.floor(u * 3)); });
      callouts(g, [["Recall made easy", cue(s, "^recall", "chip Recall made easy"), "ok"]], 960, 800);
      // confetti burst when the card turns
      for (let i = 0; i < 18; i++) { const d = h("div", "dot", null, g); d.style.background = ["#2f6bff", "#7db4ff", "#0b1f55"][i % 3]; put(d, 960, 500); const ang = (i / 18) * 6.283, r = 300 + (i % 3) * 90; tw(d, "x", [[tf + 0.4, 0], [tf + 1.3, Math.cos(ang) * r, "expo"]]); tw(d, "y", [[tf + 0.4, 0], [tf + 1.3, Math.sin(ang) * r * 0.8, "expo"]]); tw(d, "op", [[tf + 0.39, 0], [tf + 0.4, 1], [tf + 1.3, 0]]); }
      captions(g, s);
    }

    // ================= 10. LEARN (Cell Biology): written recall =================
    {
      const s = S.learn, g = scene(s), a = s.start, Ln = R.learn;
      // Less zoom than the other detail pages, so the answer box stays clear of the band edge.
      const z = view.zoom(L.detailWide, 540, 0), k = 1 / z.s;
      const { scr } = tour(s, g, "learn-mode", [[a + 0.9, view.win(), "inOut"], [a + 1.6, z, "inOut"]]);
      // The answer is typed over the box's placeholder in the textarea's own font, size, padding and colour.
      const [x, y, w, , r] = Ln.input, F = Ln.font, b = F.border, tw0 = cue(s, "^written", "box: answer box; typing starts");
      const box = h("div", "abs typed", "", scr); put(box, x + b, y + b, w - 2 * b, F.padY * 2 + F.lineHeight);
      box.style.cssText += `background:${F.background};padding:${F.padY}px ${F.padX}px;border-radius:${r - b}px ${r - b}px 0 0;font-size:${F.size}px;line-height:${F.lineHeight}px;font-weight:${F.weight};color:${F.color};letter-spacing:${F.letterSpacing};`;
      tw(box, "op", [[tw0 - 0.02, 0], [tw0, 1]]); typing(box, "In the cytoplasm", tw0, 18);
      rim(scr, Ln.input, tw0, null, { k });
      beside(g, [["Recognition", cue(s, "^recognition", "chip Recognition")], ["Written recall", tw0]], rightOf(z, Ln.card));
      captions(g, s);
    }

    // ================= 11. TEST (Cell Biology): practice exam =================
    {
      const s = S.test, g = scene(s), a = s.start, ck = s.clickTimes[0], Tt = R.test;
      const z = view.zoom(L.detail, 540, 0), k = 1 / z.s, [cx, cy] = Tt.click;
      const { scr } = tour(s, g, "test-mode", [[a + 0.3, view.win(), "inOut"], [a + 1.0, z, "inOut"]]);
      const tClick = cue(s, "^test", "click an answer", { offset: 0 });
      rim(scr, Tt.option, tClick + 0.05, null, { k });
      cursor(scr, [[a + 0.9, cx + 300, cy + 150], [ck - 0.3, cx, cy], [ck, cx, cy, true]], k);
      beside(g, [["Practice exam", cue(s, "^practice", "chip Practice exam")]], rightOf(z, Tt.column));
      captions(g, s);
    }

    // ================= 12. QUIZ (World War I, ten questions) =================
    {
      const s = S.quiz, g = scene(s), a = s.start, ck = s.clickTimes[0], Q = R.quiz;
      // Cropped in the gap between the quiz header and the question card, down to the page dots.
      const z = view.zoom(1.28, 800, (Q.top + Q.card[1]) / 2), k = 1 / z.s, [cx, cy] = Q.click;
      const { scr } = tour(s, g, "quiz", [[a + 0.2, view.win(), "inOut"], [a + 0.8, z, "inOut"]], { bottom: L.bandStrip });
      const tClick = cue(s, "^quiz", "click an answer", { offset: 0 });
      rim(scr, Q.option, tClick + 0.05, null, { k });
      cursor(scr, [[a + 0.7, cx + 220, cy + 200], [ck - 0.3, cx, cy], [ck, cx, cy, true]], k);
      strip(g, [["10 questions", cue(s, "^ten", "chip 10 questions")], ["Instant feedback", cue(s, "^instant", "chip Instant feedback")]]);
      captions(g, s);
    }

    // ================= 13. CHALLENGE (light): a real quiz question with a timer =================
    {
      const s = S.challenge, g = scene(s), a = s.start, ck = s.clickTimes[0];
      const tq = cue(s, "^question", "question card appears"), tp = cue(s, "^pick", "timer starts"), qx = 380, qy = 150, qw = 1160;
      const q = h("div", "qcard", '<small>QUESTION 1 OF 10 &nbsp;·&nbsp; MULTIPLE CHOICE</small><h3>What is AI described as in the transcript?</h3>', g); put(q, qx, qy);
      const opts = ["A futuristic concept that is yet to be developed.", "A simple computer program for basic tasks.", "One of the most transformative technologies of our time.", "A technology primarily used for entertainment."].map((tx) => h("div", "opt", `<u></u>${tx}`, q));
      tw(q, "op", [[tq, 0], [tq + 0.3, 1]]); tw(q, "y", [[tq, 70], [tq + 0.7, 0, "expo"]]);
      cue(s, "^third", "click the third option", { offset: 0 });
      opts.forEach((o, i) => { if (i === 2) ticks.push((t) => o.classList.toggle("right", t >= ck)); else tw(o, "op", [[ck, 1], [ck + 0.4, 0.35]]); });
      // The third option's centre, from the laid-out card (fonts are loaded before this runs).
      const o3 = opts[2], ox = qx + o3.offsetLeft + o3.offsetWidth / 2, oy = qy + o3.offsetTop + o3.offsetHeight / 2;
      const bar = h("div", "abs", null, g); bar.style.cssText += "height:14px;border-radius:7px;background:#2f6bff;"; put(bar, qx, qy - 38, qw);
      tw(bar, "op", [[tp, 0], [tp + 0.1, 1], [ck, 1], [ck + 0.3, 0]]);
      ticks.push((t) => { const u = Math.max(0, Math.min(1, (t - tp) / Math.max(0.5, ck - tp))); bar.style.width = qw * (1 - u) + "px"; });
      cursor(g, [[tp, 1500, 820], [ck - 0.3, ox, oy], [ck, ox, oy, true]]);
      callouts(g, [["Correct!", cue(s, "^right", "chip Correct!"), "ok"]], qx + qw + 28, oy, { ax: 0, ay: 0.5 });
      strip(g, [["Instant feedback", cue(s, "^instant", "chip Instant feedback")]]);
      captions(g, s);
    }

    // ================= 14. GUIDE (Organic Chemistry) =================
    {
      const s = S.guide, g = scene(s), a = s.start, G = R.guide;
      const z = view.zoom(1.3, 800, 0), k = 1 / z.s;
      const { scr } = tour(s, g, "study-guide", [[a + 0.15, view.win(), "inOut"], [a + 0.8, z, "inOut"]], { bottom: L.bandStrip });
      const tS = cue(s, "^structured", "box: guide header");
      rim(scr, G.header, tS, null, { k });
      strip(g, [["Structured study guide", tS], ["From your own lecture", cue(s, "^lecture", "chip From your own lecture")]]);
      captions(g, s);
    }

    // ================= 15. TUTOR (Psychology) =================
    {
      const s = S.tutor, g = scene(s), a = s.start, Tu = R.tutor;
      // Less zoom than the other detail pages, so the whole conversation fits above the band edge.
      const z = view.zoom(L.detailWide, 540, 0);
      tour(s, g, "ai-tutor", [[a + 0.1, view.win(), "inOut"], [a + 0.8, z, "inOut"]]);
      const cx = (rightOf(z, Tu.card) + 1920) / 2, cy = L.band / 2;
      const tb = h("div", "callouts", null, g); put(tb, cx, cy); tb.style.transform = "translate(-50%, -50%)";
      const th = h("div", "think", `<span class="lat">${"<u></u>".repeat(9)}</span>Thinking`, tb); th.style.position = "relative";
      const ta = cue(s, "^ask", "Thinking indicator"), tn = cue(s, "^answers", "chip Answers from your class");
      tw(th, "op", [[ta, 0], [ta + 0.2, 1], [tn - 0.15, 1], [tn, 0]]); tw(th, "s", [[ta, 0.7], [ta + 0.5, 1, "back"]]);
      const cells = th.querySelectorAll("u"), ring = [0, 1, 2, 5, 8, 7, 6, 3];
      ticks.push((t) => cells.forEach((c, i) => { const n = ring.indexOf(i); c.style.opacity = n < 0 ? 0.07 : Math.max(0.15, 1 - ((((t * 7 - n) % 8) + 8) % 8) / 3.2); }));
      callouts(g, [["Answers from your class", tn]], cx, cy, { ay: 0.5 });
      captions(g, s);
    }

    // ================= 16. PRO: meetings (Q3 roadmap sync email) =================
    {
      const s = S.pro, g = scene(s), a = s.start, ck = s.clickTimes[0], Em = R.email;
      // 1.25 puts the band edge in the gap below the first two bullet points of the email.
      const z = view.zoom(1.25, 800, 0), k = 1 / z.s;
      const { scr } = tour(s, g, "email-drafts", [[a + 0.9, view.win(), "inOut"], [a + 1.8, z, "inOut"]], { bottom: L.bandStrip });
      // "in the tone you choose": the cursor goes to the writing-tone picker and clicks it.
      const tTone = cue(s, "^tone", "box: writing-tone picker"), tCk = cue(s, "^choose", "click the tone picker", { offset: 0 });
      rim(scr, Em.tone, tTone, null, { k });
      const [tx, ty] = [Em.tone[0] + Em.tone[2] / 2, Em.tone[1] + Em.tone[3] / 2];
      cursor(scr, [[tTone - 0.5, tx + 260, ty + 220], [ck - 0.3, tx, ty], [ck, tx, ty, true]], k);
      strip(g, [["Summary emails", cue(s, "^summaries", "chip Summary emails")], ["Follow-up emails", cue(s, "^follow-up", "chip Follow-up emails")], ["Your tone", tTone]]);
      captions(g, s);
    }

    // ================= 17. WHO IT IS FOR (light) =================
    {
      const s = S.who, g = scene(s);
      const t0 = cue(s, "^studyscribe", "heading appears"), tl = cue(s, "^language", "Spanish transcript screen");
      const hd = h("div", "abs", "StudyScribe is for", g); hd.style.cssText += "font-size:80px;font-weight:700;letter-spacing:-0.04em;color:#0b1f55;text-align:center;width:1920px;"; put(hd, 0, 140);
      tw(hd, "op", [[t0, 0], [t0 + 0.3, 1], [tl, 1], [tl + 0.3, 0]]); tw(hd, "y", [[t0, 40], [t0 + 0.6, 0, "expo"]]);
      // Who it is for, as three lines of type, each landing as it is said (the last one stays lit).
      [["Students cramming before finals", "^students"], ["Professionals buried in meetings", "^professionals"], ["Anyone learning in another language", "^anyone"]].forEach(([t, w], i, all) => {
        const e = h("div", "abs who", t, g); put(e, 0, 360 + i * 120);
        const ti = cue(s, w, `line "${t}"`), dim = i + 1 < all.length ? W(s, all[i + 1][1]) - LEAD : null;
        tw(e, "op", dim ? [[ti, 0], [ti + 0.3, 1], [dim, 1], [dim + 0.3, 0.35], [tl, 0.35], [tl + 0.3, 0]] : [[ti, 0], [ti + 0.3, 1], [tl, 1], [tl + 0.3, 0]]);
        tw(e, "y", [[ti, 30], [ti + 0.6, 0, "expo"]]);
      });
      const es = screen(g, "spanish-transcript", true); put(es, 160, 70);
      tw(es, "op", [[tl, 0], [tl + 0.3, 1]]); tw(es, "y", [[tl, 160], [tl + 0.9, 0, "expo"]]); tw(es, "s", [[tl, 0.6], [tl + 0.9, 0.78, "expo"]]); tw(es, "ry", [[tl, -10], [tl + 1.2, -4, "expo"]]);
      callouts(g, [["Transcribed in Spanish", tl + 0.3, "ok"]], 960, 52);
      captions(g, s);
    }

    // ================= 18. LIBRARY (analytics): a 40-second reading, a 7-minute class, a 52-minute lecture =================
    {
      const s = S.library, g = scene(s), a = s.start, Lb = R.library;
      // Cropped just above the "Recent recordings" heading, wide enough for the whole list.
      const top = Math.max(Lb.stats[1] + Lb.stats[3] + 4, Lb.heading[1] - 20), z = view.zoom(1.42, 800, top), k = 1 / z.s;
      const { scr } = tour(s, g, "analytics", [[a + 0.15, view.win(), "inOut"], [a + 0.9, z, "inOut"]], { bottom: L.bandStrip });
      const [r0, r1, r2] = Lb.rows, t40 = cue(s, "^forty-second", "box + chip: 40s reading"), t7 = cue(s, "^seven-minute", "box + chip: 7m class"), t52 = cue(s, "^fifty-two", "box + chip: 52m lecture");
      rim(scr, r0, t40, t7, { k }); rim(scr, r1, t7, t52, { k }); rim(scr, r2, t52, null, { k });
      strip(g, [["Poetry reading: 40s", t40], ["Spanish 201: 7m", t7], ["Cell Biology: 52m", t52], ["One library", cue(s, "^library", "chip One library")]]);
      captions(g, s);
    }

    // ================= 19. TRUST =================
    {
      const s = S.trust, g = scene(s);
      const th = cue(s, "^recordings", "headline appears"), tcards = cue(s, "^yours", "export and delete cards");
      const hl = h("div", "abs", "Your recordings stay yours.", g); hl.style.cssText += "font-size:96px;font-weight:700;letter-spacing:-0.04em;color:#0b1f55;text-align:center;width:1920px;"; put(hl, 0, 340);
      tw(hl, "op", [[th, 0], [th + 0.3, 1]]); tw(hl, "y", [[th, 40], [th + 0.6, 0, "expo"]]);
      const ex = h("div", "card", "Export everything", g);
      const dl = h("div", "card", "Delete it all", g);
      // Two 560 x 200 cards centred on (610, 700) and (1310, 700).
      put(ex, 330, 600); put(dl, 1030, 600);
      [[ex, 0], [dl, 0.1]].forEach(([el, d]) => { tw(el, "op", [[tcards + d, 0], [tcards + d + 0.25, 1]]); tw(el, "y", [[tcards + d, 60], [tcards + d + 0.6, 0, "expo"]]); });
      const [c1, c2] = s.clickTimes;
      cue(s, "^export", "click Export everything", { offset: 0 }); cue(s, "^delete", "click Delete it all", { offset: 0 });
      tw(ex, "s", [[c1, 1], [c1 + 0.12, 0.95], [c1 + 0.4, 1, "back"]]); tw(dl, "s", [[c2, 1], [c2 + 0.12, 0.95], [c2 + 0.4, 1, "back"]]);
      cursor(g, [[tcards, 960, 520], [c1 - 0.3, 610, 700], [c1, 610, 700, true], [c2 - 0.3, 1310, 700], [c2, 1310, 700, true]]);
      callouts(g, [["studyscribe-export.json", c1 + 0.1, "ok"]], 610, 834); callouts(g, [["All data deleted", c2 + 0.1, "ok"]], 1310, 834);
      captions(g, s);
    }

    // ================= 20. THREE STEPS (light) =================
    {
      const s = S.steps, g = scene(s);
      const t0 = cue(s, "^getting", "heading appears");
      const hd = h("div", "abs", "Getting started is simple", g); hd.style.cssText += "font-size:84px;font-weight:700;letter-spacing:-0.04em;color:#0b1f55;text-align:center;width:1920px;"; put(hd, 0, 210);
      tw(hd, "op", [[t0, 0], [t0 + 0.3, 1]]); tw(hd, "y", [[t0, 40], [t0 + 0.6, 0, "expo"]]);
      // Each step appears exactly as it is said, joined to the one before it by a line drawn as it lands.
      const steps = [["1", "Request your invite", "^request", 380], ["2", "Add your first lecture", "^add", 960], ["3", "Start studying", "^start$", 1540]];
      const times = steps.map(([n, t, w]) => cue(s, w, `step ${n} "${t}"`));
      [[380, 960, times[1]], [960, 1540, times[2]]].forEach(([x0, x1, tl]) => {
        const ln = h("div", "abs", null, g); ln.style.cssText += "height:6px;border-radius:3px;background:#2f6bff;transform-origin:0 50%;"; put(ln, x0 + 64, 521, x1 - x0 - 128);
        tw(ln, "s", [[tl - 0.3, 0.001], [tl, 1, "inOut"]]); tw(ln, "op", [[tl - 0.31, 0], [tl - 0.3, 1]]);
      });
      steps.forEach(([n, t, , cx], i) => {
        const e = h("div", "step", `<em>${n}</em><b>${t}</b>`, g); put(e, cx - 280, 460, 560);
        tw(e, "op", [[times[i], 0], [times[i] + 0.2, 1]]); tw(e, "y", [[times[i], 40], [times[i] + 0.6, 0, "expo"]]); tw(e, "s", [[times[i], 0.9], [times[i] + 0.5, 1, "back"]]);
      });
      // No subtitles here: the three steps on screen are the narration word for word.
    }

    // ================= 21. FINALE (dark) =================
    {
      const s = S.finale, g = scene(s);
      // "From the first lecture to the final exam." word by word, then the name and the line.
      const words = ["From", "the", "first", "lecture", "to", "the", "final", "exam."], line = h("div", "big", null, g); put(line, 0, 470, 1920); line.style.fontSize = "92px";
      const tName = cue(s, "^studyscribe", "logo + name");
      words.forEach((txt, i) => {
        const w = s.words[i], t = s.start + s.voiceAt + w.t0; CUES.push({ scene: s.id, word: w.raw, wordT: +t.toFixed(3), t: +(t - LEAD).toFixed(3), what: "word appears" });
        const sp = h("span", "w", txt + (i < words.length - 1 ? " " : ""), line), t0 = t - LEAD;
        tw(sp, "op", [[t0, 0], [t0 + 0.3, 1]]); tw(sp, "y", [[t0, 30], [t0 + 0.5, 0, "expo"]]);
      });
      tw(line, "op", [[tName - 0.35, 1], [tName - 0.05, 0]]);
      const logo = h("img", "abs", null, g); logo.src = "assets/logo.webp"; put(logo, 900, 170, 120, 120);
      const mark = h("div", "abs mark", "StudyScribe AI", g); mark.style.fontSize = "120px"; put(mark, 0, 310, 1920);
      tw(logo, "op", [[tName, 0], [tName + 0.3, 1]]); tw(logo, "s", [[tName, 0], [tName + 0.7, 1, "back"]]);
      tw(mark, "op", [[tName, 0], [tName + 0.3, 1]]); tw(mark, "y", [[tName, 40], [tName + 0.7, 0, "expo"]]);
      const tagline = h("div", "abs tag", '<span>Record once.</span> <span>Study smarter.</span>', g); tagline.style.fontSize = "64px"; tagline.style.color = "#fff"; tagline.style.fontWeight = "600"; put(tagline, 0, 470, 1920);
      [...tagline.children].forEach((sp, i) => { sp.style.display = "inline-block"; const t0 = cue(s, i ? "^study$" : "^record", `"${sp.textContent}" appears`); tw(sp, "op", [[t0, 0], [t0 + 0.3, 1]]); tw(sp, "y", [[t0, 24], [t0 + 0.5, 0, "expo"]]); });
      const cta = h("div", "cta", "Get started free", g); put(cta, 700, 640, 520); cta.style.justifyContent = "center"; cta.style.padding = "0";
      const url = h("div", "url", "studyscribe-ai.vercel.app", g); put(url, 0, 800);
      const tTry = cue(s, "^try", "Get started free + address");
      tw(cta, "op", [[tTry, 0], [tTry + 0.25, 1]]); tw(cta, "s", [[tTry, 0.8], [tTry + 0.5, 1, "back"]]);
      tw(url, "op", [[tTry, 0], [tTry + 0.3, 1]]);
      captions(g, s);
    }

    // ---- the band of every scene change (see WIPE) --------------------------------------------
    TL.scenes.slice(1).forEach((s) => {
      const w = h("div", "wipe", "<i></i>"); w.style.zIndex = 5;
      tw(w, "x", [[s.start - WIPE.pre, WIPE.from], [s.start + WIPE.post, WIPE.to, "inOut"]]);
      tw(w, "op", [[s.start - WIPE.pre - 0.01, 0], [s.start - WIPE.pre, 1], [s.start + WIPE.post, 1], [s.start + WIPE.post + 0.01, 0]]);
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
  };
  // Positions measured from laid-out text (the challenge card) need the real fonts, so the scenes are
  // built once they have loaded; render.mjs waits for window.renderAt.
  Promise.all(["400 20px Geist", "700 20px Geist", "500 20px 'Geist Mono'"].map((f) => document.fonts.load(f))).then(build);
})();
