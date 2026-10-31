// PremedFix demo composition. Every frame is a pure function of t (seconds):
// window.renderAt(t) lays out the stage and resolves once new images decode.
(() => {
  const M = window.MANIFEST;
  const A = window.AUSTIN;
  const DURATION = 159;
  /** Seconds added to every beat after the safeguards and rules scenes were inserted. */
  const SHIFT = 35;
  const $ = (id) => document.getElementById(id);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const eio = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const eout = (p) => 1 - Math.pow(1 - p, 3);
  const prog = (t, a, d) => (d <= 0 ? (t >= a ? 1 : 0) : clamp((t - a) / d, 0, 1));
  /** Fades in over [a, a+fi] and out over [b-fo, b]. */
  const vis = (t, a, b, fi = 0.45, fo = 0.4) => Math.min(eout(prog(t, a, fi)), 1 - prog(t, b - fo, fo));
  const fmt = (v) => Math.round(v).toLocaleString("en-US");
  /** Center of a captured element, in screen coordinates at a given scroll. */
  const mid = (shot, key, scroll) => {
    const b = M[shot].boxes[key];
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 - scroll };
  };

  // ---------------------------------------------------------------------------
  // Timeline
  // ---------------------------------------------------------------------------

  const desk = {
    shots: [
      { at: 17.0, name: "overview" },
      { at: 21.75, name: "imp-map", dip: true },
      { at: 27.6, name: "imp-preview" },
      { at: 33.0, name: "imp-result", dip: true },
      { at: 34.75, name: "case", dip: true },
      { at: 47.4, name: "case-note" },
      { at: 49.0, name: "case-verified" },
      { at: 50.6, name: "case-draft" },
      { at: 54.8, name: "case-sent" },
      { at: 70.0, name: "r-start" },
      { at: 76.8, name: "r-review" },
      { at: 78.55, name: "r-acc1" },
      { at: 79.35, name: "r-acc2" },
      { at: 80.15, name: "r-acc3" },
      { at: 82.5, name: "r-ready" },
      { at: 83.75, name: "d-form", dip: true },
      { at: 88.4, name: "d-submitted", dip: true },
      { at: 91.2, name: "d-closed", dip: true },
      { at: 99.2, name: "settings", dip: true },
      // Safeguards
      { at: 100.75, name: "s-conflict", dip: true },
      { at: 104.4, name: "s-electrical", dip: true },
      { at: 108.1, name: "s-duplicate", dip: true },
      { at: 111.9, name: "s-isolation", dip: true },
      // Rule editor
      { at: 115.75, name: "rules-v1", dip: true },
      { at: 121.2, name: "rules-draft", dip: true },
      { at: 123.5, name: "rules-hvac" },
      { at: 127.7, name: "rules-preview", dip: true },
      { at: 132.9, name: "rules-activated", dip: true },
      { at: 100.75 + SHIFT, name: "austin", dip: true },
    ],
    cam: [
      { at: 18.6, dur: 1.4, z: 1.3, cx: 820, cy: 250 },
      { at: 21.93, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      // 01 Import
      { at: 22.6, dur: 1.6, z: 1.5, cx: 700, cy: 327 },
      { at: 25.4, dur: 1.2, scroll: 569, z: 1, cx: 720, cy: 405 },
      { at: 27.9, dur: 1.2, scroll: 1225 },
      { at: 29.4, dur: 1.2, z: 1.7, ...mid("imp-preview", "missing", 1225) },
      { at: 31.6, dur: 0.8, z: 1, cx: 720, cy: 405 },
      { at: 33.18, dur: 0, scroll: 0 },
      { at: 33.4, dur: 0.8, z: 1.6, cx: 838, cy: 151 },
      { at: 34.93, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      // 02 Triage
      { at: 35.6, dur: 1.2, z: 1.5, cx: 560, cy: 62 },
      { at: 38.0, dur: 1.4, scroll: 538, z: 1, cx: 720, cy: 405 },
      { at: 39.6, dur: 1.2, z: 1.45, cx: 650, cy: 405 },
      // 03 Contact
      { at: 46.0, dur: 1.2, scroll: 114, z: 1.35, cx: 650, cy: 405 },
      { at: 50.8, dur: 1.0, z: 1.3, cx: 650, cy: 608 },
      { at: 54.95, dur: 1.0, scroll: 0, z: 1.6, cx: 560, cy: 62 },
      { at: 60.0, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      // 05 Review
      { at: 71.8, dur: 1.4, scroll: 992, z: 1.7, cx: 774, cy: 405 },
      { at: 74.6, dur: 0.8, scroll: 1150, z: 1, cx: 720, cy: 405 },
      { at: 77.0, dur: 0.8, scroll: 600 },
      { at: 80.4, dur: 0.8, scroll: 1200 },
      { at: 82.7, dur: 0.7, z: 1.6, cx: 1218, cy: 665 },
      { at: 83.93, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      // 06 Decide
      { at: 84.6, dur: 1.0, z: 1.35, cx: 650, cy: 553 },
      { at: 88.58, dur: 0, cy: 480 },
      { at: 91.38, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      { at: 91.5, dur: 0.8, z: 1.8, cx: 560, cy: 62 },
      // Audit
      { at: 96.0, dur: 1.4, scroll: 1843, z: 1.3, cx: 1228, cy: 405 },
      { at: 97.4, dur: 1.7, scroll: 2150 },
      { at: 99.38, dur: 0, scroll: 0, z: 1.5, cx: 1127, cy: 259 },
      // Safeguards: each shot opens framed on its evidence.
      { at: 100.93, dur: 0, scroll: 0, z: 1.6, cx: 1218, cy: 279 },
      { at: 104.58, dur: 0, scroll: 700, z: 1.7, cx: 1228, cy: 405 },
      { at: 108.28, dur: 0, scroll: 214, z: 1.4, cx: 650, cy: 405 },
      { at: 112.08, dur: 0, scroll: 0, z: 1.25, cx: 620, cy: 300 },
      // Rule editor
      { at: 115.93, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      { at: 116.4, dur: 1.2, scroll: 783, z: 1.4, cx: 640, cy: 405 },
      { at: 119.2, dur: 1.0, scroll: 300, z: 1.3, cx: 1218, cy: 380 },
      { at: 121.38, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      { at: 121.5, dur: 1.0, scroll: 833, z: 1.35, cx: 700, cy: 405 },
      { at: 123.7, dur: 1.0, z: 1.2, cx: 640, cy: 520 },
      { at: 126.0, dur: 0.8, scroll: 2343, z: 1, cx: 720, cy: 405 },
      { at: 127.88, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      { at: 128.0, dur: 0.9, z: 1.35, cx: 640, cy: 330 },
      { at: 131.0, dur: 0.9, scroll: 400, z: 1.25, cx: 840, cy: 480 },
      { at: 133.08, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      { at: 133.2, dur: 0.8, z: 1.4, cx: 1000, cy: 380 },
      { at: 100.93 + SHIFT, dur: 0, scroll: 0, z: 1, cx: 720, cy: 405 },
      // Austin
      { at: 101.6 + SHIFT, dur: 1.2, z: 1.6, cx: 560, cy: 230 },
      { at: 105.6 + SHIFT, dur: 1.0, z: 1.9, cx: 560, cy: 360 },
      { at: 109.2 + SHIFT, dur: 1.2, z: 1.45, cx: 1127, cy: 542 },
      { at: 113.0 + SHIFT, dur: 1.0, z: 1, cx: 720, cy: 405 },
    ],
    cursor: [
      { at: 25.6, dur: 0.3, o: 1 },
      { at: 26.0, dur: 1.2, x: 374, y: 754 },
      { at: 31.8, dur: 0.8, x: 345, y: 754 },
      { at: 33.0, dur: 0.2, o: 0 },
      { at: 47.5, dur: 0, x: 960, y: 560 },
      { at: 47.6, dur: 0.3, o: 1 },
      { at: 47.9, dur: 0.8, x: 900, y: 422 },
      { at: 49.4, dur: 0.8, x: 379, y: 600 },
      { at: 53.6, dur: 0.8, x: 394, y: 752 },
      { at: 54.9, dur: 0.25, o: 0 },
      { at: 74.6, dur: 0, x: 1200, y: 560 },
      { at: 74.75, dur: 0.2, o: 1 },
      { at: 75.0, dur: 0.6, x: 1062, y: 203 },
      { at: 75.9, dur: 0.6, x: 1101, y: 689 },
      { at: 77.0, dur: 0.8, x: 1346, y: 285 },
      { at: 78.6, dur: 0.5, x: 1346, y: 427 },
      { at: 79.4, dur: 0.5, x: 1346, y: 531 },
      { at: 80.4, dur: 0.8, x: 1062, y: 334 },
      { at: 81.6, dur: 0.6, x: 1101, y: 676 },
      { at: 82.5, dur: 0.25, o: 0 },
      { at: 86.9, dur: 0, x: 900, y: 560 },
      { at: 87.0, dur: 0.2, o: 1 },
      { at: 87.2, dur: 0.8, x: 390, y: 680 },
      { at: 88.3, dur: 0.15, o: 0 },
      { at: 89.9, dur: 0, x: 800, y: 560 },
      { at: 90.0, dur: 0.2, o: 1 },
      { at: 90.2, dur: 0.7, x: 373, y: 637 },
      { at: 91.15, dur: 0.15, o: 0 },
      // Rule editor: create the draft, write the HVAC rule, save, activate.
      { at: 119.8, dur: 0, x: 1300, y: 600 },
      { at: 119.9, dur: 0.2, o: 1 },
      { at: 120.1, dur: 0.7, x: 1115, y: 402 },
      { at: 121.15, dur: 0.1, o: 0 },
      { at: 122.3, dur: 0, x: 1150, y: 560 },
      { at: 122.35, dur: 0.15, o: 1 },
      { at: 122.5, dur: 0.6, x: 954, y: 405 },
      { at: 126.8, dur: 0.5, x: 385, y: 672 },
      { at: 127.65, dur: 0.1, o: 0 },
      { at: 131.7, dur: 0, x: 1250, y: 700 },
      { at: 131.8, dur: 0.15, o: 1 },
      { at: 131.95, dur: 0.55, x: 1087, y: 574 },
      { at: 132.85, dur: 0.1, o: 0 },
    ],
    clicks: [27.4, 32.8, 48.8, 50.4, 54.6, 75.7, 76.6, 78.4, 79.2, 80.0, 81.4, 82.3, 88.15, 91.0, 121.0, 123.3, 127.5, 132.7],
    url: [
      [17.0, "Overview"],
      [21.9, "Import permits"],
      [34.9, "Case LKM-BLD-2019-04127"],
      [70.0, "Evidence review · LKM-BLD-2019-04127"],
      [83.9, "Case LKM-BLD-2019-04127"],
      [99.3, "Settings"],
      [100.9, "Evidence review · LKM-BLD-2019-02210"],
      [104.55, "Evidence review · LKM-ELE-2016-00388"],
      [108.25, "Case LKM-BLD-2018-00412"],
      [112.05, "Lakemont case, opened by another municipality"],
      [115.9, "Jurisdiction Rules · City of Lakemont"],
      [100.9 + SHIFT, "Austin analysis"],
    ],
  };

  const phone = {
    shots: [
      { at: 57.0, name: "p-start" },
      { at: 59.3, name: "p-code", dip: true },
      { at: 61.9, name: "p-home", dip: true },
      { at: 64.4, name: "p-uploaded", dip: true },
      { at: 67.6, name: "p-done", dip: true },
    ],
    cam: [
      { at: 60.0, dur: 0.8, scroll: 204 },
      { at: 62.08, dur: 0, scroll: 0 },
      { at: 63.0, dur: 1.0, scroll: 520 },
      { at: 64.58, dur: 0, scroll: 1071 },
      { at: 66.2, dur: 0.8, scroll: 1715 },
      { at: 67.78, dur: 0, scroll: 0 },
    ],
    taps: [
      { t: 59.0, x: 195, y: 332 },
      { t: 61.6, x: 195, y: 693 },
      { t: 67.3, x: 195, y: 632 },
    ],
  };

  const CAPS = [
    { start: 17.0, end: 21.9, chip: "Command center", title: "The whole backlog in one place", body: "Every tile opens the cases behind it. Queues show who acts next." },
    { start: 22.0, end: 34.9, step: 1, chip: "Import", title: "Import any permit export", body: "Columns are mapped from the file’s own headers. Every row is validated, and rejected rows keep their reason." },
    { start: 35.0, end: 45.9, step: 2, chip: "Triage", title: "Triage with rules you can audit", body: "Each flag names its rule, version, and the fields it read. Missing values are never filled in." },
    { start: 46.0, end: 56.9, step: 3, chip: "Contact", title: "Reach owners, with approval", body: "Staff verify the contact against property records and approve every notice before it goes out." },
    { start: 57.0, end: 69.9, step: 4, chip: "Evidence", title: "Homeowners send proof from their phone", body: "A one-time code confirms the verified contact. Then an invoice, photos, and a short statement." },
    { start: 70.0, end: 83.9, step: 5, chip: "Review", title: "Every fact cites its source", body: "Extracted values show the exact quote and page. The inspector accepts each checklist item." },
    { start: 84.0, end: 95.9, step: 6, chip: "Decide", title: "Officials decide. Not software.", body: "Only a building official records the decision, and the permit closes when the city’s system confirms it." },
    { start: 96.0, end: 100.9, chip: "Audit trail", title: "A record that can’t be rewritten", body: "Every step is written to an append-only, hash-chained log." },
    {
      start: 101.0,
      end: 115.9,
      chip: "Safeguards",
      title: "Caution is the default",
      list: [
        [100.9, "Conflicting dates are flagged for a person to resolve."],
        [104.55, "Electrical work needs a passed site inspection."],
        [108.25, "Duplicate records are reconciled by staff, never deleted."],
        [112.05, "Each city sees only its own records."],
      ],
    },
    {
      start: 116.0,
      end: 135.9,
      chip: "Rules",
      title: "Each city writes its own rules",
      body: "Add a rule and the triage engine re-runs every open case first. Cases that would get fewer human checks are flagged before anything changes.",
    },
  ];
  const STEPS = ["Import", "Triage", "Contact", "Evidence", "Review", "Decide"];

  // Audio cue list, read by the render script.
  window.EVENTS = {
    duration: DURATION,
    clicks: desk.clicks,
    taps: phone.taps.map((p) => p.t),
    whoosh: [17.0, 21.75, 34.75, 57.0, 70.0, 83.75, 100.75, 104.4, 108.1, 111.9, 115.75, 121.2, 127.7, 132.9, 135.75, 151.0],
    countUp: [0.3, 2.1],
    impact: [7.0],
    chimes: [91.25, 128.1, 133.1, 137.2, 141.0, 144.8],
    steps: [12.4, 12.72, 13.04, 13.36, 13.68, 14.0],
    end: [156.9],
  };

  // ---------------------------------------------------------------------------
  // Static DOM
  // ---------------------------------------------------------------------------

  $("hookSrc").textContent = `City of Austin open data · Issued Construction Permits · snapshot ${A.snapshot}`;
  const loop = $("loop");
  STEPS.forEach((s, i) => {
    if (i) loop.insertAdjacentHTML("beforeend", `<div class="conn" data-i="${i}"></div>`);
    loop.insertAdjacentHTML("beforeend", `<div class="chipstep" data-i="${i}"><div class="n">0${i + 1}</div><div class="l">${s}</div></div>`);
  });
  const capsEl = $("caps");
  CAPS.forEach((c, i) => {
    const prog = c.step ? `<div class="prog">${STEPS.map((_, k) => `<i class="${k < c.step ? "on" : ""}"></i>`).join("")}</div>` : "";
    const chip = c.step ? `<div class="chip"><b>0${c.step}</b>${c.chip}</div>` : `<div class="chip">${c.chip}</div>`;
    const body = c.list ? `<ul class="body list">${c.list.map(([, text]) => `<li>${text}</li>`).join("")}</ul>` : `<div class="body">${c.body}</div>`;
    capsEl.insertAdjacentHTML("beforeend", `<div class="cap abs" id="cap${i}">${prog}${chip}<div class="title">${c.title}</div>${body}</div>`);
  });
  $("aus1k").textContent = `${fmt(A.remote)} of ${fmt(A.total)} expired residential permits route to document-based resolution under default rules.`;
  $("aus2v").textContent = `${A.floorPct}%`;
  $("aus2k").textContent = "on the most cautious reading";
  $("aus3v").textContent = `${A.hvacPct}%`;
  $("aus3k").textContent = "with one HVAC rule, previewed the same way as in the rule editor";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function track(moves, init, t) {
    let s = { ...init };
    for (const m of moves) {
      if (t < m.at) break;
      const p = m.dur ? eio(prog(t, m.at, m.dur)) : 1;
      const next = { ...s };
      for (const k of Object.keys(m)) if (k !== "at" && k !== "dur") next[k] = lerp(s[k], m[k], p);
      s = next;
      if (p < 1) break;
    }
    return s;
  }

  /** Visible shots and their opacities for a shot list at time t. */
  function shotsAt(list, t) {
    let i = -1;
    for (let k = 0; k < list.length; k++) if (list[k].at <= t) i = k;
    if (i < 0) return [];
    const cur = list[i];
    const prev = list[i - 1];
    if (!prev) return [{ name: cur.name, o: 1 }];
    if (cur.dip) {
      const out = 1 - prog(t, cur.at, 0.18);
      const inn = prog(t, cur.at + 0.18, 0.28);
      return out > 0 ? [{ name: prev.name, o: out }] : [{ name: cur.name, o: inn }];
    }
    const p = prog(t, cur.at, 0.3);
    return p < 1 ? [{ name: prev.name, o: 1 }, { name: cur.name, o: p }] : [{ name: cur.name, o: 1 }];
  }

  // Image cache: only the shots in use (plus the next one) stay in the DOM.
  const cache = new Map();
  function ensure(name, parent, phoneShot) {
    let e = cache.get(name);
    if (e) return { e, pending: null };
    const s = M[name];
    const wrap = document.createElement("div");
    wrap.className = phoneShot ? "pshot" : "shot";
    const main = new Image();
    main.className = "main";
    main.src = `../shots/${s.file}`;
    main.style.height = `${s.h}px`;
    wrap.appendChild(main);
    const loads = [main.decode()];
    if (s.side) {
      const side = new Image();
      side.className = "side";
      side.src = `../shots/${s.side}`;
      wrap.appendChild(side);
      loads.push(side.decode());
    }
    parent.appendChild(wrap);
    e = { wrap, main, s };
    cache.set(name, e);
    return { e, pending: Promise.all(loads) };
  }
  function nextShot(list, t) {
    return list.find((s) => s.at > t)?.name;
  }

  function setVis(el, o, extra = "") {
    el.style.opacity = String(o);
    el.style.visibility = o <= 0.001 ? "hidden" : "visible";
    if (extra !== null) el.style.transform = extra;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  window.renderAt = async (t) => {
    const pending = [];

    // Hook
    const hookV = vis(t, 0.2, 7.0, 0.5, 0.45);
    setVis($("hook"), hookV, `scale(${lerp(1, 1.03, prog(t, 0, 7))})`);
    $("hookNum").textContent = fmt(A.total * eout(prog(t, 0.3, 1.8)));
    setVis($("hookLine"), eout(prog(t, 1.6, 0.6)), `translateY(${lerp(16, 0, eout(prog(t, 1.6, 0.6)))}px)`);
    setVis($("hookSrc"), eout(prog(t, 3.0, 0.6)), null);

    // Reveal + loop
    const brandV = vis(t, 7.0, 17.0, 0.6, 0.5);
    const up = eio(prog(t, 12.0, 0.7));
    setVis($("brand"), brandV, `translateY(${lerp(0, -190, up)}px) scale(${lerp(1, 0.72, up)})`);
    $("mark").style.transform = `scale(${lerp(0.86, 1, eout(prog(t, 7.0, 0.7)))})`;
    setVis($("brandTag"), Math.min(eout(prog(t, 7.8, 0.6)), 1 - prog(t, 12.0, 0.3)), null);
    document.querySelectorAll(".chipstep").forEach((el) => {
      const i = +el.dataset.i;
      const p = eout(prog(t, 12.4 + i * 0.32, 0.5));
      setVis(el, Math.min(p, 1 - prog(t, 16.5, 0.45)), `translateY(${lerp(18, 0, p)}px)`);
    });
    document.querySelectorAll(".conn").forEach((el) => {
      const i = +el.dataset.i;
      setVis(el, Math.min(eout(prog(t, 12.3 + i * 0.32, 0.4)), 1 - prog(t, 16.5, 0.45)), null);
    });
    setVis($("loopnote"), Math.min(eout(prog(t, 14.6, 0.6)), 1 - prog(t, 16.5, 0.45)), null);

    // Captions
    CAPS.forEach((c, i) => {
      const el = $(`cap${i}`);
      const pin = eout(prog(t, c.start + 0.15, 0.55));
      const pout = prog(t, c.end - 0.35, 0.35);
      const o = Math.min(pin, 1 - pout);
      setVis(el, o, `translateY(${lerp(26, 0, pin) - 14 * pout}px)`);
      if (o > 0) {
        const title = el.querySelector(".title");
        const body = el.querySelector(".body");
        const pt = eout(prog(t, c.start + 0.28, 0.55));
        const pb = eout(prog(t, c.start + 0.42, 0.55));
        title.style.opacity = String(pt);
        title.style.transform = `translateY(${lerp(14, 0, pt)}px)`;
        body.style.opacity = String(pb);
        body.style.transform = `translateY(${lerp(14, 0, pb)}px)`;
        if (c.list) {
          el.querySelectorAll("li").forEach((li, k) => {
            const [at] = c.list[k];
            const next = c.list[k + 1]?.[0] ?? Infinity;
            const pi = eout(prog(t, at + 0.15, 0.5));
            li.style.opacity = String(pi * (t < next ? 1 : 0.45));
            li.style.transform = `translateX(${lerp(-10, 0, pi)}px)`;
            li.classList.toggle("on", t >= at && t < next);
          });
        }
      }
    });

    // Window
    const winIn1 = eout(prog(t, 17.0, 0.8));
    const winIn2 = eout(prog(t, 70.0, 0.7));
    const winOut1 = eout(prog(t, 57.0, 0.45));
    const winOut2 = eout(prog(t, 116.0 + SHIFT, 0.6));
    let winO = 0;
    let winY = 0;
    let winS = 1;
    if (t < 57.0) { winO = winIn1 * (1 - winOut1); winY = lerp(70, 0, winIn1); winS = lerp(1, 0.96, winOut1); }
    else if (t < 70.0) { winO = 1 - winOut1; winS = lerp(1, 0.96, winOut1); }
    else { winO = winIn2 * (1 - winOut2); winY = lerp(50, 0, winIn2); winS = lerp(1, 0.97, winOut2); }
    setVis($("win"), winO, `translateY(${winY}px) scale(${winS})`);

    if (winO > 0) {
      let label = "";
      for (const [at, u] of desk.url) if (t >= at) label = u;
      if ($("url").textContent !== label) $("url").textContent = label;

      const cam = track(desk.cam, { scroll: 0, z: 1, cx: 720, cy: 405 }, t);
      const z = cam.z;
      const cx = clamp(cam.cx, 720 / z, 1440 - 720 / z);
      const cy = clamp(cam.cy, 405 / z, 810 - 405 / z);
      $("cam").style.transform = `translate(${720 - cx * z}px, ${405 - cy * z}px) scale(${z})`;

      const visible = shotsAt(desk.shots, t);
      const keep = new Set(visible.map((v) => v.name));
      const nx = nextShot(desk.shots, t);
      if (nx) keep.add(nx);
      for (const [name, e] of cache) if (!M[name].phone && !keep.has(name)) { e.wrap.remove(); cache.delete(name); }
      for (const name of keep) {
        const { e, pending: p } = ensure(name, $("shots"), false);
        if (p) pending.push(p);
        const v = visible.find((x) => x.name === name);
        e.wrap.style.opacity = v ? String(v.o) : "0";
        e.wrap.style.zIndex = v ? String(visible.indexOf(v) + 1) : "0";
        const scroll = clamp(cam.scroll, 0, Math.max(0, e.s.h - e.s.vh));
        e.main.style.transform = `translateY(${-scroll}px)`;
      }

      const cur = track(desk.cursor, { x: 1100, y: 620, o: 0 }, t);
      let press = 1;
      for (const c of desk.clicks) if (t >= c - 0.08 && t < c + 0.14) press = 0.86;
      const curEl = $("cursor");
      curEl.style.opacity = String(cur.o);
      curEl.style.transform = `translate(${cur.x - 3}px, ${cur.y - 3}px) scale(${press / Math.sqrt(z)})`;
      const rip = $("ripples");
      let html = "";
      for (const c of desk.clicks) {
        const p = prog(t, c, 0.5);
        if (t >= c && p < 1) {
          const at = track(desk.cursor, { x: 1100, y: 620, o: 0 }, c);
          const r = lerp(8, 34, eout(p)) / Math.sqrt(z);
          html += `<div class="ripple" style="left:${at.x - r}px;top:${at.y - r}px;width:${2 * r}px;height:${2 * r}px;opacity:${1 - p}"></div>`;
        }
      }
      if (rip.innerHTML !== html) rip.innerHTML = html;
    }

    // Phone
    const phIn = eout(prog(t, 57.25, 0.7));
    const phOut = eout(prog(t, 70.0, 0.4));
    const phO = phIn * (1 - phOut);
    setVis($("phone"), phO, `translateY(${lerp(80, 0, phIn) + 30 * phOut}px)`);
    if (phO > 0) {
      const cam = track(phone.cam, { scroll: 0 }, t);
      const visible = shotsAt(phone.shots, t);
      const keep = new Set(visible.map((v) => v.name));
      const nx = nextShot(phone.shots, t);
      if (nx) keep.add(nx);
      for (const [name, e] of cache) if (M[name].phone && !keep.has(name)) { e.wrap.remove(); cache.delete(name); }
      for (const name of keep) {
        const { e, pending: p } = ensure(name, $("pshots"), true);
        if (p) pending.push(p);
        const v = visible.find((x) => x.name === name);
        e.wrap.style.opacity = v ? String(v.o) : "0";
        e.wrap.style.zIndex = v ? String(visible.indexOf(v) + 1) : "0";
        const scroll = clamp(cam.scroll, 0, Math.max(0, e.s.h - e.s.vh));
        e.main.style.transform = `translateY(${-scroll}px)`;
      }
      let html = "";
      for (const tp of phone.taps) {
        const p = prog(t, tp.t - 0.1, 0.55);
        if (p > 0 && p < 1) {
          const r = lerp(14, 30, eout(p));
          html += `<div class="tap" style="left:${tp.x - r}px;top:${tp.y - r}px;width:${2 * r}px;height:${2 * r}px;opacity:${Math.min(1, 3 * (1 - p))}"></div>`;
        }
      }
      if ($("taps").innerHTML !== html) $("taps").innerHTML = html;
    }

    // Austin column
    const ausV = vis(t, 101.0 + SHIFT, 116.0 + SHIFT, 0.5, 0.45);
    setVis($("aus"), ausV, null);
    if (ausV > 0) {
      const head = eout(prog(t, 101.15 + SHIFT, 0.55));
      setVis($("ausEyebrow"), head, `translateY(${lerp(12, 0, head)}px)`);
      const ti = eout(prog(t, 101.3 + SHIFT, 0.55));
      setVis($("ausTitle"), ti, `translateY(${lerp(14, 0, ti)}px)`);
      const s1 = eout(prog(t, 102.2 + SHIFT, 0.5));
      setVis($("aus1"), s1, `translateY(${lerp(14, 0, s1)}px)`);
      $("aus1v").textContent = `${(A.remotePct * eout(prog(t, 102.2 + SHIFT, 1.2))).toFixed(1)}%`;
      const s2 = eout(prog(t, 106.0 + SHIFT, 0.5));
      setVis($("aus2"), s2, `translateY(${lerp(14, 0, s2)}px)`);
      const s3 = eout(prog(t, 109.8 + SHIFT, 0.5));
      setVis($("aus3"), s3, `translateY(${lerp(14, 0, s3)}px)`);
      setVis($("ausFoot"), eout(prog(t, 113.2 + SHIFT, 0.6)), null);
    }

    // Outro
    const o1 = Math.min(eout(prog(t, 116.5 + SHIFT, 0.6)), 1 - prog(t, 121.4 + SHIFT, 0.4));
    setVis($("outro"), o1 > 0 ? 1 : 0, null);
    setVis($("out1"), o1, `translateY(${lerp(18, 0, eout(prog(t, 116.5 + SHIFT, 0.6)))}px)`);
    const o2 = Math.min(eout(prog(t, 117.6 + SHIFT, 0.6)), 1 - prog(t, 121.4 + SHIFT, 0.4));
    setVis($("out2"), o2, `translateY(${lerp(14, 0, eout(prog(t, 117.6 + SHIFT, 0.6)))}px)`);
    const e1 = eout(prog(t, 121.9 + SHIFT, 0.6));
    setVis($("end"), e1, null);
    $("endRow").style.transform = `scale(${lerp(0.94, 1, e1)})`;
    setVis($("endTag"), eout(prog(t, 122.3 + SHIFT, 0.6)), null);

    if (pending.length) await Promise.all(pending);
  };

  window.DURATION = DURATION;
})();
