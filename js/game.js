"use strict";

/* =========================================================
   설정값 — 밸런스 조정은 이 블록에서
   ========================================================= */
const CONFIG = {
  STAGE1_TIME_MS: 12000,
  STAGE1_CORRECT_POINTS: 150,
  STAGE1_WRONG_PENALTY: 50,
  STAGE1_TIME_BONUS_MAX: 250,

  STAGE2_ROUNDS: 3,
  STAGE2_CYCLE_MS: 1500,
  STAGE2_ZONE_WIDTH_PCT: 20,
  STAGE2_PERFECT_POINTS: 300,
  STAGE2_GOOD_POINTS: 180,
  STAGE2_OK_POINTS: 80,

  STAGE3_TIME_MS: 16000,
  STAGE3_SLOTS: 9,
  STAGE3_MAX_MEATS: 15,
  STAGE3_SPAWN_INTERVAL_MS: [650, 1100],
  STAGE3_COOK_DURATION_MS: 2200,
  STAGE3_PERFECT_WINDOW: [0.42, 0.68],
  STAGE3_OVERCOOK_END: 1.0,
  STAGE3_BURNT_GRACE_MS: 800,
  STAGE3_PERFECT_POINTS: 200,
  STAGE3_OK_POINTS: 80,

  // 실제 쿡캠 올인원숯키트 사용설명서(6단계) 기준 순서 — 항상 이 순서로 진행
  STAGE1_SEQUENCE: [
    { key: "ignite_cube", icon: "🧨", label: "라이터 큐브 점화" },
    { key: "add_charcoal", icon: "🪵", label: "숯 넣기" },
    { key: "place_rest", icon: "🥘", label: "숯받침 놓기" },
    { key: "wait_burn", icon: "⏳", label: "숯 타오르기" },
    { key: "move_to_grill", icon: "🔥", label: "그릴로 옮기기" },
    { key: "grill_meat", icon: "🥩", label: "고기 굽기 시작" }
  ],
  STAGE1_DECOYS: [
    { key: "gloves", icon: "🧤", label: "장갑" },
    { key: "tongs", icon: "🥢", label: "집게" },
    { key: "plate", icon: "🍽️", label: "접시" }
  ],

  GRADES: [
    { min: 3200, name: "숯불의 신", icon: "👑" },
    { min: 2400, name: "그릴마스터", icon: "🏆" },
    { min: 1500, name: "바비큐 애호가", icon: "🥩" },
    { min: 0,    name: "요리 새내기", icon: "🍳" }
  ],

  LEADERBOARD_KEY: "kbbqGameLeaderboard_v1",
  LEADERBOARD_MAX: 20
};

/* =========================================================
   상태
   ========================================================= */
const state = {
  stage1Score: 0,
  stage2Score: 0,
  stage3Score: 0,
  pendingTotal: 0
};

let s1 = null; // stage1 runtime
let s2 = null; // stage2 runtime
let s3 = null; // stage3 runtime

/* =========================================================
   오디오 — 타이틀/메뉴 화면은 BGM, 게임 플레이 중에는 효과음
   ========================================================= */
const bgm = document.getElementById("bgm");
bgm.volume = 0.5;

let soundEnabled = localStorage.getItem("kbbqSoundEnabled") !== "off";
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function beep({ freq = 440, duration = 0.12, type = "sine", volume = 0.22, slideTo = null }) {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

const sfx = {
  tapCorrect: () => beep({ freq: 720, duration: 0.09, type: "triangle", volume: 0.22, slideTo: 960 }),
  tapWrong: () => beep({ freq: 220, duration: 0.16, type: "sawtooth", volume: 0.18, slideTo: 120 }),
  stageClear: () => { beep({ freq: 520, duration: 0.1, type: "triangle", volume: 0.22 }); setTimeout(() => beep({ freq: 780, duration: 0.14, type: "triangle", volume: 0.22 }), 100); },
  ignitePerfect: () => { beep({ freq: 660, duration: 0.1, type: "triangle", volume: 0.24 }); setTimeout(() => beep({ freq: 990, duration: 0.16, type: "triangle", volume: 0.24 }), 90); },
  igniteGood: () => beep({ freq: 560, duration: 0.12, type: "triangle", volume: 0.2 }),
  igniteMiss: () => beep({ freq: 160, duration: 0.2, type: "sawtooth", volume: 0.18, slideTo: 90 }),
  meatPerfect: () => { beep({ freq: 700, duration: 0.08, type: "sine", volume: 0.22 }); setTimeout(() => beep({ freq: 1040, duration: 0.14, type: "sine", volume: 0.22 }), 80); },
  meatOk: () => beep({ freq: 440, duration: 0.1, type: "sine", volume: 0.18 }),
  meatBurnt: () => beep({ freq: 140, duration: 0.22, type: "square", volume: 0.16, slideTo: 80 })
};

function playBgm() {
  if (!soundEnabled) return;
  bgm.play().catch(() => {});
}

function stopBgm() {
  bgm.pause();
}

bgm.addEventListener("play", updateSoundToggleUI);
bgm.addEventListener("pause", updateSoundToggleUI);

function updateSoundToggleUI() {
  const btn = document.getElementById("btn-sound-toggle");
  const icon = soundEnabled ? "🔊" : "🔇";
  const showLabel = bgm.paused && !inGameplay();
  btn.classList.toggle("label", showLabel);
  btn.textContent = showLabel ? icon + " 소리 켜기" : icon;
  btn.classList.toggle("muted", !soundEnabled);
}

document.getElementById("btn-sound-toggle").addEventListener("click", () => {
  if (bgm.paused && !inGameplay()) {
    // 아직 재생 전(자동재생 차단 등) 상태에서는 무조건 "켜기"로 취급한다.
    // 기존 soundEnabled 값과 무관하게 토글하면 첫 클릭에 꺼지는 버그가 생긴다.
    soundEnabled = true;
    localStorage.setItem("kbbqSoundEnabled", "on");
    bgm.muted = false;
    playBgm();
  } else {
    soundEnabled = !soundEnabled;
    localStorage.setItem("kbbqSoundEnabled", soundEnabled ? "on" : "off");
    bgm.muted = !soundEnabled;
    if (soundEnabled && !inGameplay()) playBgm();
  }
  updateSoundToggleUI();
});

function inGameplay() {
  return ["screen-stage1", "screen-stage2", "screen-stage3"].some(id =>
    document.getElementById(id).classList.contains("active")
  );
}

updateSoundToggleUI();
function unlockAudioOnce() {
  if (!soundEnabled || inGameplay()) return;
  if (!bgm.paused) {
    document.removeEventListener("click", unlockAudioOnce, { capture: true });
    return;
  }
  bgm.play().then(() => {
    document.removeEventListener("click", unlockAudioOnce, { capture: true });
  }).catch(() => {});
}
document.addEventListener("click", unlockAudioOnce, { capture: true });

/* =========================================================
   화면 전환
   ========================================================= */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.cssText = "position:fixed;left:50%;bottom:calc(32px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);" +
      "background:rgba(20,13,10,.95);color:#fdf3ec;padding:12px 20px;border-radius:12px;" +
      "font-size:14px;z-index:100;max-width:88%;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.4);" +
      "word-break:keep-all;line-height:1.4;" +
      "opacity:0;transition:opacity .2s ease;pointer-events:none;";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = "0"; }, 2200);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randRange(min, max) { return min + Math.random() * (max - min); }

/* =========================================================
   STAGE 1: 준비 (키트 조립 순서 맞추기)
   ========================================================= */
function startStage1() {
  document.getElementById("s1-unbox").style.display = "flex";
  document.getElementById("s1-play").classList.remove("active");
  document.getElementById("s1-timer").textContent = (CONFIG.STAGE1_TIME_MS / 1000).toFixed(1) + "초";
  showScreen("screen-stage1");
}

function onUnboxTap() {
  stopBgm();
  document.getElementById("s1-unbox").style.display = "none";
  document.getElementById("s1-play").classList.add("active");
  beginStage1Play();
}

function beginStage1Play() {
  const sequence = CONFIG.STAGE1_SEQUENCE;
  const decoys = CONFIG.STAGE1_DECOYS;
  const gridItems = shuffle(sequence.concat(decoys));

  s1 = {
    sequence,
    cursor: 0,
    score: 0,
    startTime: performance.now(),
    rafId: null,
    finished: false
  };

  const seqWrap = document.getElementById("s1-sequence");
  seqWrap.innerHTML = "";
  const row = document.createElement("div");
  row.className = "seq-row-zigzag";
  sequence.forEach((item, idx) => {
    if (idx > 0) {
      const arrow = document.createElement("span");
      arrow.className = "seq-arrow zig";
      arrow.textContent = (idx - 1) % 2 === 0 ? "↘" : "↗";
      row.appendChild(arrow);
    }
    const d = document.createElement("div");
    d.className = "seq-item " + (idx % 2 === 0 ? "seq-up" : "seq-down") + (idx === 0 ? " next" : "");
    d.dataset.key = item.key;
    d.textContent = item.icon;
    row.appendChild(d);
  });
  seqWrap.appendChild(row);

  const grid = document.getElementById("s1-grid");
  grid.innerHTML = "";
  gridItems.forEach(item => {
    const tile = document.createElement("div");
    tile.className = "item-tile";
    tile.dataset.key = item.key;
    tile.textContent = item.icon;
    tile.addEventListener("click", () => onStage1Tap(item.key, tile));
    grid.appendChild(tile);
  });

  document.getElementById("s1-progress").style.width = "100%";
  tickStage1();
}

function onStage1Tap(key, tileEl) {
  if (!s1 || s1.finished) return;
  const expected = s1.sequence[s1.cursor];
  if (key === expected.key) {
    sfx.tapCorrect();
    tileEl.classList.add("correct");
    setTimeout(() => { tileEl.style.visibility = "hidden"; }, 200);
    s1.score += CONFIG.STAGE1_CORRECT_POINTS;

    const seqEls = document.querySelectorAll("#s1-sequence .seq-item");
    seqEls[s1.cursor].classList.remove("next");
    seqEls[s1.cursor].classList.add("done");
    s1.cursor++;
    if (s1.cursor < s1.sequence.length) {
      seqEls[s1.cursor].classList.add("next");
    } else {
      finishStage1(true);
    }
  } else {
    sfx.tapWrong();
    tileEl.classList.remove("wrong");
    void tileEl.offsetWidth;
    tileEl.classList.add("wrong");
    s1.score = Math.max(0, s1.score - CONFIG.STAGE1_WRONG_PENALTY);
  }
}

function tickStage1() {
  if (!s1 || s1.finished) return;
  const elapsed = performance.now() - s1.startTime;
  const remainMs = Math.max(0, CONFIG.STAGE1_TIME_MS - elapsed);
  document.getElementById("s1-timer").textContent = (remainMs / 1000).toFixed(1) + "초";
  document.getElementById("s1-progress").style.width = (remainMs / CONFIG.STAGE1_TIME_MS * 100) + "%";

  if (remainMs <= 0) {
    finishStage1(false);
    return;
  }
  s1.rafId = requestAnimationFrame(tickStage1);
}

function finishStage1(completed) {
  if (!s1 || s1.finished) return;
  s1.finished = true;
  if (s1.rafId) cancelAnimationFrame(s1.rafId);

  if (completed) {
    const elapsed = performance.now() - s1.startTime;
    const remainFrac = Math.max(0, (CONFIG.STAGE1_TIME_MS - elapsed) / CONFIG.STAGE1_TIME_MS);
    s1.score += Math.round(remainFrac * CONFIG.STAGE1_TIME_BONUS_MAX);
    sfx.stageClear();
    toast("준비 완료! ⚡ 스피드 보너스 획득");
  } else {
    toast("시간 종료! 다음 단계로 이동합니다");
  }
  state.stage1Score = s1.score;
  setTimeout(startStage2, 700);
}

/* =========================================================
   STAGE 2: 착화 (타이밍 게이지)
   ========================================================= */
function startStage2() {
  s2 = { round: 1, score: 0, roundStartTime: 0, rafId: null, locked: false };
  document.getElementById("s2-feedback").textContent = "";
  document.getElementById("s2-feedback").className = "hit-feedback";
  showScreen("screen-stage2");
  beginStage2Round();
}

function beginStage2Round() {
  document.getElementById("s2-round").textContent = `${s2.round} / ${CONFIG.STAGE2_ROUNDS}`;
  const zoneCenter = randRange(20, 80);
  const zoneWidth = CONFIG.STAGE2_ZONE_WIDTH_PCT;
  s2.zoneCenter = zoneCenter;
  s2.zoneHalf = zoneWidth / 2;
  s2.locked = false;

  const zoneEl = document.getElementById("s2-zone");
  zoneEl.style.left = (zoneCenter - zoneWidth / 2) + "%";
  zoneEl.style.width = zoneWidth + "%";

  s2.roundStartTime = performance.now();
  tickStage2();
}

function stage2MarkerPos(now) {
  const elapsed = (now - s2.roundStartTime) % CONFIG.STAGE2_CYCLE_MS;
  const half = CONFIG.STAGE2_CYCLE_MS / 2;
  const frac = elapsed < half ? (elapsed / half) : (1 - (elapsed - half) / half);
  return frac * 100;
}

function tickStage2() {
  if (!s2 || s2.locked) return;
  const now = performance.now();
  const pos = stage2MarkerPos(now);
  document.getElementById("s2-marker").style.left = pos + "%";
  s2.rafId = requestAnimationFrame(tickStage2);
}

function onIgniteTap() {
  if (!s2 || s2.locked) return;
  s2.locked = true;
  if (s2.rafId) cancelAnimationFrame(s2.rafId);

  const pos = stage2MarkerPos(performance.now());
  const dist = Math.abs(pos - s2.zoneCenter);
  const fb = document.getElementById("s2-feedback");
  let points = 0, label = "", cls = "";

  if (dist <= s2.zoneHalf * 0.4) { points = CONFIG.STAGE2_PERFECT_POINTS; label = "완벽한 착화! 🔥"; cls = "perfect"; sfx.ignitePerfect(); }
  else if (dist <= s2.zoneHalf) { points = CONFIG.STAGE2_GOOD_POINTS; label = "좋아요!"; cls = "good"; sfx.igniteGood(); }
  else if (dist <= s2.zoneHalf * 1.8) { points = CONFIG.STAGE2_OK_POINTS; label = "아쉬워요"; cls = "good"; sfx.igniteGood(); }
  else { points = 0; label = "실패..."; cls = "miss"; sfx.igniteMiss(); }

  s2.score += points;
  fb.textContent = `${label} (+${points})`;
  fb.className = "hit-feedback " + cls;

  setTimeout(() => {
    if (s2.round >= CONFIG.STAGE2_ROUNDS) {
      finishStage2();
    } else {
      s2.round++;
      fb.textContent = "";
      fb.className = "hit-feedback";
      beginStage2Round();
    }
  }, 550);
}

function finishStage2() {
  state.stage2Score = s2.score;
  sfx.stageClear();
  toast("착화 완료! 이제 구워볼까요?");
  setTimeout(startStage3, 700);
}

/* =========================================================
   STAGE 3: 굽기 (반응속도 타이밍)
   ========================================================= */
const SLOT_POSITIONS = [
  { left: "18%", top: "18%" }, { left: "50%", top: "18%" }, { left: "82%", top: "18%" },
  { left: "18%", top: "50%" }, { left: "50%", top: "50%" }, { left: "82%", top: "50%" },
  { left: "18%", top: "82%" }, { left: "50%", top: "82%" }, { left: "82%", top: "82%" }
];

function startStage3() {
  s3 = {
    startTime: performance.now(),
    score: 0,
    meats: [],
    spawned: 0,
    slotsUsed: new Set(),
    nextSpawnAt: 0,
    rafId: null,
    finished: false
  };
  document.getElementById("s3-grill").innerHTML = "";
  document.getElementById("s3-score").textContent = "0";
  showScreen("screen-stage3");
  s3.nextSpawnAt = performance.now() + randRange(200, 500);
  requestAnimationFrame(stage3Loop);
}

function stage3Spawn(now) {
  if (s3.spawned >= CONFIG.STAGE3_MAX_MEATS) return;
  const freeSlots = [];
  for (let i = 0; i < CONFIG.STAGE3_SLOTS; i++) if (!s3.slotsUsed.has(i)) freeSlots.push(i);
  if (freeSlots.length === 0) return;

  const slot = freeSlots[Math.floor(Math.random() * freeSlots.length)];
  s3.slotsUsed.add(slot);
  s3.spawned++;

  const pos = SLOT_POSITIONS[slot % SLOT_POSITIONS.length];
  const el = document.createElement("div");
  el.className = "meat state-cooking";
  el.style.left = pos.left;
  el.style.top = pos.top;
  el.innerHTML = `<div class="doneness-ring"></div><span class="meat-icon">🥩</span>`;

  const meat = { el, slot, spawnTime: now, resolved: false };
  el.addEventListener("click", () => onMeatTap(meat));
  document.getElementById("s3-grill").appendChild(el);
  s3.meats.push(meat);
}

function onMeatTap(meat) {
  if (meat.resolved) return;
  const now = performance.now();
  const progress = (now - meat.spawnTime) / CONFIG.STAGE3_COOK_DURATION_MS;
  let points = 0;

  if (progress >= CONFIG.STAGE3_PERFECT_WINDOW[0] && progress <= CONFIG.STAGE3_PERFECT_WINDOW[1]) {
    points = CONFIG.STAGE3_PERFECT_POINTS;
    toast("완벽하게 구워졌어요! 🔥 +" + points);
  } else if (progress < CONFIG.STAGE3_PERFECT_WINDOW[0]) {
    points = CONFIG.STAGE3_OK_POINTS;
    toast("조금 덜 익었어요 +" + points);
  } else if (progress <= CONFIG.STAGE3_OVERCOOK_END) {
    points = CONFIG.STAGE3_OK_POINTS;
    toast("살짝 과했어요 +" + points);
  } else {
    points = 0;
    toast("이런, 탔어요...");
  }

  resolveMeat(meat, points);
}

function resolveMeat(meat, points) {
  meat.resolved = true;
  if (points >= CONFIG.STAGE3_PERFECT_POINTS) sfx.meatPerfect();
  else if (points > 0) sfx.meatOk();
  else sfx.meatBurnt();
  s3.score += points;
  document.getElementById("s3-score").textContent = s3.score;
  s3.slotsUsed.delete(meat.slot);
  meat.el.style.transition = "opacity .25s ease, transform .25s ease";
  meat.el.style.opacity = "0";
  meat.el.style.transform = "translate(-50%, -50%) scale(0.6)";
  setTimeout(() => meat.el.remove(), 260);
}

function stage3Loop(now) {
  if (!s3 || s3.finished) return;

  const elapsed = now - s3.startTime;
  const remainMs = Math.max(0, CONFIG.STAGE3_TIME_MS - elapsed);
  document.getElementById("s3-timer").textContent = (remainMs / 1000).toFixed(1) + "초";

  if (now >= s3.nextSpawnAt) {
    stage3Spawn(now);
    s3.nextSpawnAt = now + randRange(CONFIG.STAGE3_SPAWN_INTERVAL_MS[0], CONFIG.STAGE3_SPAWN_INTERVAL_MS[1]);
  }

  s3.meats.forEach(meat => {
    if (meat.resolved) return;
    const progress = (now - meat.spawnTime) / CONFIG.STAGE3_COOK_DURATION_MS;
    meat.el.classList.remove("state-cooking", "state-perfect", "state-overcooked", "state-burnt");
    if (progress < CONFIG.STAGE3_PERFECT_WINDOW[0]) {
      meat.el.classList.add("state-cooking");
    } else if (progress <= CONFIG.STAGE3_PERFECT_WINDOW[1]) {
      meat.el.classList.add("state-perfect");
    } else if (progress <= CONFIG.STAGE3_OVERCOOK_END) {
      meat.el.classList.add("state-overcooked");
    } else {
      meat.el.classList.add("state-burnt");
      const burntFor = (progress - CONFIG.STAGE3_OVERCOOK_END) * CONFIG.STAGE3_COOK_DURATION_MS;
      if (burntFor >= CONFIG.STAGE3_BURNT_GRACE_MS) {
        resolveMeat(meat, 0);
      }
    }
  });
  s3.meats = s3.meats.filter(m => !m.resolved || m.el.isConnected);

  const timeUp = remainMs <= 0;
  const allDone = s3.spawned >= CONFIG.STAGE3_MAX_MEATS && s3.meats.every(m => m.resolved);
  if (timeUp || allDone) {
    finishStage3();
    return;
  }
  s3.rafId = requestAnimationFrame(stage3Loop);
}

function finishStage3() {
  if (s3.finished) return;
  s3.finished = true;
  state.stage3Score = s3.score;
  setTimeout(showResult, 500);
}

/* =========================================================
   결과 / 등급 / 쿠폰
   ========================================================= */
function computeGrade(total) {
  return CONFIG.GRADES.find(g => total >= g.min) || CONFIG.GRADES[CONFIG.GRADES.length - 1];
}

function generateCouponCode(total) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "BQ";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function showResult() {
  sfx.stageClear();
  playBgm();

  const total = state.stage1Score + state.stage2Score + state.stage3Score;
  state.pendingTotal = total;
  const grade = computeGrade(total);
  const coupon = generateCouponCode(total);

  document.getElementById("result-grade-icon").textContent = grade.icon;
  document.getElementById("result-grade-name").textContent = grade.name;
  document.getElementById("result-score").textContent = total;
  document.getElementById("result-coupon").textContent = coupon;
  document.getElementById("result-breakdown").innerHTML = `
    <div><span>준비</span><span>${state.stage1Score}</span></div>
    <div><span>착화</span><span>${state.stage2Score}</span></div>
    <div><span>굽기</span><span>${state.stage3Score}</span></div>
  `;
  state.pendingGrade = grade.name;
  showScreen("screen-result");
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function buildShareCardImage({ gradeIcon, grade, total, coupon }) {
  return new Promise(resolve => {
    const W = 900, H = 1300;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, "#1a2c4d");
    bgGrad.addColorStop(1, "#060a14");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.fillStyle = "#d9b364";
    ctx.font = "bold 30px sans-serif";
    ctx.fillText("「불의 향연」 2026.9.10~13", W / 2, 110);

    ctx.font = "220px sans-serif";
    ctx.fillText(gradeIcon, W / 2, 430);

    ctx.fillStyle = "#d9b364";
    ctx.font = "bold 64px sans-serif";
    ctx.fillText(grade, W / 2, 530);

    ctx.fillStyle = "#f5f1e6";
    ctx.font = "34px sans-serif";
    ctx.fillText("총점", W / 2 - 70, 600);
    ctx.fillStyle = "#ffc233";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText(`${total}점`, W / 2 + 40, 602);

    ctx.strokeStyle = "#ff7a29";
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    roundRectPath(ctx, W / 2 - 260, 680, 520, 190, 22);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#9fb0c9";
    ctx.font = "26px sans-serif";
    ctx.fillText("현장 교환 쿠폰 코드", W / 2, 740);
    ctx.fillStyle = "#ffc233";
    ctx.font = "bold 56px monospace";
    ctx.fillText(coupon, W / 2, 820);

    ctx.fillStyle = "#99a9c4";
    ctx.font = "28px sans-serif";
    ctx.fillText("쿡캠 올인원숯키트 × 그릴마스터 챌린지", W / 2, 1150);
    ctx.font = "24px sans-serif";
    ctx.fillText("#불의향연 #쿡캠", W / 2, 1195);

    canvas.toBlob(blob => {
      resolve(blob ? new File([blob], "grillmaster-result.png", { type: "image/png" }) : null);
    }, "image/png");
  });
}

let isSharing = false;
let leaderboardOrigin = "screen-title";

async function shareResult() {
  if (isSharing) return;
  isSharing = true;
  const shareBtn = document.getElementById("btn-share");
  shareBtn.disabled = true;

  try {
    await shareResultInner();
  } finally {
    isSharing = false;
    shareBtn.disabled = false;
  }
}

async function shareResultInner() {
  const total = state.pendingTotal;
  const grade = state.pendingGrade;
  const gradeIcon = document.getElementById("result-grade-icon").textContent;
  const coupon = document.getElementById("result-coupon").textContent;
  const text = `경남 K-BBQ 숯불페스티벌 「불의 향연」 그릴마스터 챌린지에서 "${grade}" 등급, ${total}점을 획득했어요! 🔥 쿡캠 올인원숯키트로 나만의 완벽한 바비큐를 완성해보세요. #불의향연 #쿡캠`;

  // 클립보드 복사는 사용자 제스처(클릭) 유효 시간 안에 처리돼야 하므로
  // await가 들어가는 이미지 생성보다 먼저 호출한다. 순서가 바뀌면(이미지
  // 생성 후 복사 시도) iOS 등에서 제스처가 만료돼 조용히 실패한다.
  let clipboardOk = false;
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); clipboardOk = true; } catch (e) { /* ignore */ }
  }

  // navigator.share({files:[...]})는 일부 iOS 버전에서 사진이 중복 저장되는
  // 버그가 있어(텍스트 동봉 여부와 무관하게 발생) 사용하지 않는다. 대신
  // 이미지를 모달로 보여주고 길게 눌러 직접 저장하게 하는, 플랫폼 버그에
  // 영향받지 않는 방식을 사용한다.
  const file = await buildShareCardImage({ gradeIcon, grade, total, coupon }).catch(() => null);

  if (file) {
    const url = URL.createObjectURL(file);
    const img = document.getElementById("share-preview-img");
    img.src = url;
    document.getElementById("modal-share-image").classList.remove("hidden");
    toast(clipboardOk ? "캡션 문구가 클립보드에 복사됐어요!" : "이미지가 준비됐어요!");
    return;
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: "그릴마스터 챌린지", text });
    } catch (e) { /* ignore */ }
    stopBgm();
    return;
  }
  toast("결과가 클립보드에 복사되었어요. SNS에 붙여넣어 공유해보세요!");
  stopBgm();
}

/* =========================================================
   리더보드
   ========================================================= */
function loadLeaderboard() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG.LEADERBOARD_KEY)) || [];
  } catch (e) { return []; }
}

function saveLeaderboardEntry(name) {
  const list = loadLeaderboard();
  list.push({ name, score: state.pendingTotal, grade: state.pendingGrade, date: new Date().toISOString() });
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, CONFIG.LEADERBOARD_MAX);
  localStorage.setItem(CONFIG.LEADERBOARD_KEY, JSON.stringify(trimmed));
}

function renderLeaderboard() {
  const list = loadLeaderboard();
  const ol = document.getElementById("leaderboard-list");
  if (list.length === 0) {
    ol.innerHTML = `<li class="empty">아직 기록이 없어요. 첫 번째 그릴러가 되어보세요!</li>`;
    return;
  }
  ol.innerHTML = list.map((entry, idx) => `
    <li>
      <span class="rank">${idx + 1}</span>
      <span class="name">${escapeHtml(entry.name)}</span>
      <span class="score">${entry.score}점</span>
    </li>
  `).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* =========================================================
   이벤트 바인딩
   ========================================================= */
document.getElementById("btn-start").addEventListener("click", () => {
  playBgm();
  startStage1();
});
document.getElementById("btn-unbox").addEventListener("click", onUnboxTap);
document.getElementById("btn-howto").addEventListener("click", () => showScreen("screen-howto"));
document.getElementById("btn-howto-close").addEventListener("click", () => showScreen("screen-title"));

document.getElementById("btn-ignite").addEventListener("click", onIgniteTap);

document.getElementById("btn-share").addEventListener("click", shareResult);
document.getElementById("btn-retry").addEventListener("click", () => {
  state.stage1Score = 0; state.stage2Score = 0; state.stage3Score = 0;
  showScreen("screen-title");
});
document.getElementById("btn-save-score").addEventListener("click", () => {
  document.getElementById("modal-nickname").classList.remove("hidden");
  document.getElementById("nickname-input").value = "";
  document.getElementById("nickname-input").focus();
});
document.getElementById("btn-nickname-submit").addEventListener("click", () => {
  const input = document.getElementById("nickname-input");
  const name = input.value.trim() || "익명 그릴러";
  saveLeaderboardEntry(name);
  document.getElementById("modal-nickname").classList.add("hidden");
  renderLeaderboard();
  leaderboardOrigin = "screen-result";
  showScreen("screen-leaderboard");
});

document.getElementById("btn-share-modal-close").addEventListener("click", () => {
  const img = document.getElementById("share-preview-img");
  document.getElementById("modal-share-image").classList.add("hidden");
  if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  img.src = "";
  stopBgm();
});

document.getElementById("btn-leaderboard-open").addEventListener("click", () => {
  renderLeaderboard();
  leaderboardOrigin = "screen-title";
  showScreen("screen-leaderboard");
});
document.getElementById("btn-leaderboard-close").addEventListener("click", () => showScreen(leaderboardOrigin || "screen-title"));
