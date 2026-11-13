(function () {
  "use strict";

  const SK = "nova_planner_v2";
  const DAYS_VI = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
  const MONTHS_VI = [
    "Tháng 1",
    "Tháng 2",
    "Tháng 3",
    "Tháng 4",
    "Tháng 5",
    "Tháng 6",
    "Tháng 7",
    "Tháng 8",
    "Tháng 9",
    "Tháng 10",
    "Tháng 11",
    "Tháng 12"
  ];

  const PRIORITY_LABELS = {
    high: "CAO",
    med: "TRUNG BÌNH",
    low: "THẤP"
  };

  const PRIORITY_CLASSES = {
    high: "priority-high",
    med: "priority-med",
    low: "priority-low"
  };

  let appData = { tasks: {}, yearGoals: {} };
  let audioCtx = null;
  let alarmedIds = new Set();
  let calYear;
  let calMonth;
  let selectedDay = null;
  let yearView;
  let editingYM = null;

  const $ = (id) => document.getElementById(id);

  function extensionStorageAvailable() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function storageGet(key) {
    if (extensionStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(result[key] || null);
        });
      });
    }

    return Promise.resolve(localStorage.getItem(key));
  }

  function storageSet(key, value) {
    if (extensionStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      });
    }

    localStorage.setItem(key, value);
    return Promise.resolve();
  }

  async function loadData() {
    try {
      const raw = await storageGet(SK);
      if (!raw) return;

      const loaded = JSON.parse(raw);
      appData = Object.assign({ tasks: {}, yearGoals: {} }, loaded);

      if (appData.monthNotes) {
        Object.keys(appData.monthNotes).forEach((key) => {
          if (!appData.tasks[key]) appData.tasks[key] = [];
          appData.monthNotes[key].forEach((note) => {
            appData.tasks[key].push({
              id: note.id || uid(),
              name: note.text,
              time: "",
              desc: "Ghi chú cũ",
              priority: "med",
              done: false
            });
          });
        });
        delete appData.monthNotes;
        await saveData();
      }
    } catch (error) {
      appData = { tasks: {}, yearGoals: {} };
    }
  }

  async function saveData() {
    await storageSet(SK, JSON.stringify(appData));
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function todayKey() {
    const date = new Date();
    return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  function dateKey(year, month, day) {
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function escH(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function initStars() {
    const canvas = $("stars-canvas");
    const ctx = canvas.getContext("2d");
    let stars = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function init() {
      stars = [];
      for (let i = 0; i < 90; i += 1) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.3 + 0.3,
          speed: Math.random() * 0.24 + 0.04,
          a: Math.random(),
          ad: Math.random() > 0.5 ? 1 : -1,
          hue: Math.random() > 0.72 ? (Math.random() > 0.5 ? 180 : 300) : 0
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach((star) => {
        star.a += star.ad * 0.008;
        if (star.a > 1 || star.a < 0.1) star.ad *= -1;
        star.y -= star.speed;
        if (star.y < 0) {
          star.y = canvas.height;
          star.x = Math.random() * canvas.width;
        }

        ctx.save();
        ctx.globalAlpha = star.a * 0.7;
        if (star.hue) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = star.hue === 180 ? "rgba(0,213,255,0.8)" : "rgba(255,76,207,0.8)";
          ctx.fillStyle = star.hue === 180 ? "#00d5ff" : "#ff4ccf";
        } else {
          ctx.fillStyle = "#eef4ff";
        }
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      requestAnimationFrame(draw);
    }

    resize();
    init();
    draw();
    window.addEventListener("resize", () => {
      resize();
      init();
    });
  }

  function updateClock() {
    const now = new Date();
    $("clockDisplay").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    $("dateDisplay").textContent =
      `${DAYS_VI[now.getDay()]}, ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    checkPopupAlarms(now);
  }

  function getACtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playAlarm() {
    try {
      const ctx = getACtx();
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      const times = [0, 0.15, 0.3, 0.45, 0.65, 0.8];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime + times[index]);
        gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + times[index] + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + times[index] + 0.3);
        osc.start(ctx.currentTime + times[index]);
        osc.stop(ctx.currentTime + times[index] + 0.32);
      });
    } catch (error) {
      // Audio can be blocked until the user interacts with the popup.
    }
  }

  function playAdd() {
    try {
      const ctx = getACtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.22);
    } catch (error) {
      // Ignore blocked audio.
    }
  }

  function playDone() {
    try {
      const ctx = getACtx();
      [440, 550, 660].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.22, ctx.currentTime + index * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + index * 0.09 + 0.18);
        osc.start(ctx.currentTime + index * 0.09);
        osc.stop(ctx.currentTime + index * 0.09 + 0.2);
      });
    } catch (error) {
      // Ignore blocked audio.
    }
  }

  function switchTab(name, targetButton) {
    document.querySelectorAll(".tab-btn").forEach((button) => button.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    targetButton.classList.add("active");
    $(`panel-${name}`).classList.add("active");
  }

  function flash(id) {
    const element = $(id);
    element.style.borderColor = "var(--danger)";
    element.style.boxShadow = "0 0 0 3px rgba(255,93,120,0.2)";
    setTimeout(() => {
      element.style.borderColor = "";
      element.style.boxShadow = "";
    }, 900);
  }

  let t24PickerEl = null;
  let t24ActiveCtx = null;

  function closeTime24Picker() {
    if (!t24PickerEl) return;
    t24PickerEl.classList.remove("open");
    if (t24ActiveCtx) {
      t24ActiveCtx.wrap.classList.remove("open");
      t24ActiveCtx.finalize();
      t24ActiveCtx = null;
    }
  }

  function positionTime24Picker(wrap) {
    if (!t24PickerEl) return;
    const rect = wrap.getBoundingClientRect();
    const popW = t24PickerEl.offsetWidth || 172;
    const popH = t24PickerEl.offsetHeight || 242;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - popW - 8);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = (spaceBelow >= popH || spaceBelow >= rect.top)
      ? (rect.bottom + 6)
      : Math.max(8, rect.top - popH - 6);
    t24PickerEl.style.left = `${left}px`;
    t24PickerEl.style.top = `${top}px`;
  }

  function syncTime24PickerHighlight(shouldScroll) {
    if (!t24PickerEl || !t24ActiveCtx) return;
    const vals = { h: t24ActiveCtx.getHour(), m: t24ActiveCtx.getMin() };
    ["h", "m"].forEach((col) => {
      const list = t24PickerEl.querySelector(`.t24-pop-list[data-col="${col}"]`);
      if (!list) return;
      let activeBtn = null;
      list.querySelectorAll(".t24-opt").forEach((btn) => {
        const isAct = vals[col] !== "" && btn.dataset.val === vals[col];
        btn.classList.toggle("act", isAct);
        if (isAct) activeBtn = btn;
      });
      if (shouldScroll) {
        list.scrollTop = activeBtn ? Math.max(0, activeBtn.offsetTop - (list.clientHeight - activeBtn.offsetHeight) / 2) : 0;
      }
    });
  }

  function ensureTime24Picker() {
    if (t24PickerEl) return t24PickerEl;
    const pop = document.createElement("div");
    pop.className = "t24-pop";
    pop.id = "t24Picker";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Chọn giờ 24h");

    const hdr = document.createElement("div");
    hdr.className = "t24-pop-hdr";
    const title = document.createElement("span");
    title.textContent = "🕒 GIỜ 24H";
    const nowBtn = document.createElement("button");
    nowBtn.type = "button";
    nowBtn.className = "t24-pop-now";
    nowBtn.textContent = "Bây giờ";
    hdr.appendChild(title);
    hdr.appendChild(nowBtn);

    const cols = document.createElement("div");
    cols.className = "t24-pop-cols";

    function makeCol(labelText, maxVal, colType) {
      const col = document.createElement("div");
      col.className = "t24-pop-col";
      const lbl = document.createElement("div");
      lbl.className = "t24-pop-col-lbl";
      lbl.textContent = labelText;
      const list = document.createElement("div");
      list.className = "t24-pop-list";
      list.dataset.col = colType;
      for (let i = 0; i <= maxVal; i += 1) {
        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "t24-opt";
        opt.dataset.val = pad(i);
        opt.textContent = pad(i);
        list.appendChild(opt);
      }
      col.appendChild(lbl);
      col.appendChild(list);
      return col;
    }

    cols.appendChild(makeCol("Giờ", 23, "h"));
    cols.appendChild(makeCol("Phút", 59, "m"));

    const ftr = document.createElement("div");
    ftr.className = "t24-pop-ftr";
    const clrBtn = document.createElement("button");
    clrBtn.type = "button";
    clrBtn.className = "t24-pop-act t24-pop-clr";
    clrBtn.textContent = "Xóa";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "t24-pop-act t24-pop-ok";
    okBtn.textContent = "✓ Xong";
    ftr.appendChild(clrBtn);
    ftr.appendChild(okBtn);

    pop.appendChild(hdr);
    pop.appendChild(cols);
    pop.appendChild(ftr);
    document.body.appendChild(pop);

    pop.addEventListener("click", (e) => {
      if (!t24ActiveCtx) return;
      const opt = e.target.closest(".t24-opt");
      if (!opt) return;
      const list = opt.closest(".t24-pop-list");
      if (list && list.dataset.col === "h") t24ActiveCtx.setHour(opt.dataset.val);
      else if (list && list.dataset.col === "m") t24ActiveCtx.setMin(opt.dataset.val);
      syncTime24PickerHighlight(false);
    });

    nowBtn.addEventListener("click", () => {
      if (!t24ActiveCtx) return;
      const n = new Date();
      t24ActiveCtx.setHour(pad(n.getHours()));
      t24ActiveCtx.setMin(pad(n.getMinutes()));
      syncTime24PickerHighlight(true);
    });

    clrBtn.addEventListener("click", () => {
      if (!t24ActiveCtx) return;
      t24ActiveCtx.clear();
      closeTime24Picker();
    });

    okBtn.addEventListener("click", () => closeTime24Picker());

    document.addEventListener("mousedown", (e) => {
      if (!t24PickerEl || !t24PickerEl.classList.contains("open")) return;
      if (t24PickerEl.contains(e.target)) return;
      if (t24ActiveCtx && t24ActiveCtx.wrap.contains(e.target)) return;
      closeTime24Picker();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && t24PickerEl && t24PickerEl.classList.contains("open")) {
        closeTime24Picker();
      }
    });

    window.addEventListener("resize", () => {
      if (t24PickerEl && t24PickerEl.classList.contains("open") && t24ActiveCtx) {
        positionTime24Picker(t24ActiveCtx.wrap);
      }
    });

    t24PickerEl = pop;
    return pop;
  }

  function initTime24Inputs() {
    document.querySelectorAll("[data-t24]").forEach((wrap) => {
      if (wrap.dataset.t24Ready === "1") return;
      wrap.dataset.t24Ready = "1";

      const hEl = document.createElement("input");
      hEl.type = "text";
      hEl.className = "t24-seg t24-h";
      hEl.id = `${wrap.id}_h`;
      hEl.setAttribute("inputmode", "numeric");
      hEl.setAttribute("maxlength", "2");
      hEl.setAttribute("placeholder", "--");
      hEl.setAttribute("autocomplete", "off");
      hEl.setAttribute("aria-label", "Giờ (00 đến 23)");

      const sep = document.createElement("span");
      sep.className = "t24-sep";
      sep.textContent = ":";

      const mEl = document.createElement("input");
      mEl.type = "text";
      mEl.className = "t24-seg t24-m";
      mEl.id = `${wrap.id}_m`;
      mEl.setAttribute("inputmode", "numeric");
      mEl.setAttribute("maxlength", "2");
      mEl.setAttribute("placeholder", "--");
      mEl.setAttribute("autocomplete", "off");
      mEl.setAttribute("aria-label", "Phút (00 đến 59)");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "t24-btn";
      btn.tabIndex = -1;
      btn.title = "Chọn giờ (24h)";
      btn.setAttribute("aria-label", "Mở bảng chọn giờ 24h");
      btn.textContent = "🕒";

      wrap.appendChild(hEl);
      wrap.appendChild(sep);
      wrap.appendChild(mEl);
      wrap.appendChild(btn);

      let hFresh = false;
      let mFresh = false;
      let hJustFocused = false;
      let mJustFocused = false;
      let hSkipFocusSelect = false;

      const padSeg = (el) => {
        if (/^\d$/.test(el.value)) el.value = `0${el.value}`;
      };

      const focusMinute = () => {
        mEl.focus();
        mFresh = true;
        if (mEl.value) mEl.select();
      };

      const enterMinuteDigit = (digit) => {
        const allSel = mEl.selectionStart === 0 && mEl.selectionEnd === mEl.value.length && mEl.value.length > 0;
        const cur = (mFresh || allSel) ? "" : mEl.value.replace(/\D/g, "");
        mFresh = false;
        if (cur.length === 0) {
          if (parseInt(digit, 10) >= 6) {
            mEl.value = `0${digit}`;
            mFresh = true;
          } else {
            mEl.value = digit;
          }
        } else {
          mEl.value = `${cur.slice(0, 1)}${digit}`;
          mFresh = true;
        }
        if (t24ActiveCtx && t24ActiveCtx.wrap === wrap) syncTime24PickerHighlight(true);
      };

      const enterHourDigit = (digit) => {
        const allSel = hEl.selectionStart === 0 && hEl.selectionEnd === hEl.value.length && hEl.value.length > 0;
        const cur = (hFresh || allSel) ? "" : hEl.value.replace(/\D/g, "");
        hFresh = false;
        if (cur.length === 0) {
          if (parseInt(digit, 10) >= 3) {
            hEl.value = `0${digit}`;
            focusMinute();
          } else {
            hEl.value = digit;
          }
        } else {
          const num = parseInt(`${cur.slice(0, 1)}${digit}`, 10);
          if (num <= 23) {
            hEl.value = `${cur.slice(0, 1)}${digit}`;
            focusMinute();
          } else {
            hEl.value = `0${cur.slice(0, 1)}`;
            focusMinute();
            enterMinuteDigit(digit);
          }
        }
        if (t24ActiveCtx && t24ActiveCtx.wrap === wrap) syncTime24PickerHighlight(true);
      };

      const stepSeg = (el, maxVal, delta) => {
        const cur = el.value.trim();
        let num = cur === "" ? (delta > 0 ? -1 : 0) : parseInt(cur, 10);
        if (Number.isNaN(num)) num = delta > 0 ? -1 : 0;
        const mod = maxVal + 1;
        const next = (((num + delta) % mod) + mod) % mod;
        el.value = pad(next);
        el.select();
        if (el === hEl) hFresh = true;
        else mFresh = true;
        if (t24ActiveCtx && t24ActiveCtx.wrap === wrap) syncTime24PickerHighlight(true);
      };

      const handlePaste = (e) => {
        const txt = ((e.clipboardData || window.clipboardData).getData("text") || "").trim();
        let m = txt.match(/(\d{1,2})\s*[:hH.]\s*(\d{1,2})/);
        if (!m) {
          const digits = txt.replace(/\D/g, "");
          if (digits.length === 4) m = [txt, digits.slice(0, 2), digits.slice(2, 4)];
          else if (digits.length === 3) m = [txt, digits.slice(0, 1), digits.slice(1, 3)];
        }
        if (m) {
          const hh = parseInt(m[1], 10);
          const mm = parseInt(m[2], 10);
          if (!Number.isNaN(hh) && !Number.isNaN(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
            e.preventDefault();
            hEl.value = pad(hh);
            mEl.value = pad(mm);
            hFresh = true;
            mFresh = true;
            if (t24ActiveCtx && t24ActiveCtx.wrap === wrap) syncTime24PickerHighlight(true);
          }
        }
      };

      hEl.addEventListener("mousedown", () => { if (document.activeElement !== hEl) hJustFocused = true; });
      hEl.addEventListener("focus", () => {
        if (hSkipFocusSelect) { hSkipFocusSelect = false; hFresh = false; return; }
        hFresh = true;
        hEl.select();
        setTimeout(() => { if (hFresh && document.activeElement === hEl && hEl.value) hEl.select(); }, 0);
      });
      hEl.addEventListener("mouseup", (e) => {
        if (hJustFocused) {
          hJustFocused = false;
          if (hEl.value) { e.preventDefault(); hEl.select(); }
        }
      });
      hEl.addEventListener("blur", () => padSeg(hEl));
      hEl.addEventListener("paste", handlePaste);
      hEl.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key >= "0" && e.key <= "9") { e.preventDefault(); enterHourDigit(e.key); return; }
        if (e.key === ":" || e.key === "." || e.key === "h" || e.key === "H") { e.preventDefault(); padSeg(hEl); focusMinute(); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); stepSeg(hEl, 23, 1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); stepSeg(hEl, 23, -1); return; }
        if (e.key === "ArrowRight") {
          if (hEl.selectionStart === hEl.value.length || (hEl.selectionStart === 0 && hEl.selectionEnd === hEl.value.length)) {
            e.preventDefault();
            padSeg(hEl);
            focusMinute();
          }
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          if (hEl.selectionStart === 0 && hEl.selectionEnd === hEl.value.length) hEl.value = "";
          else hEl.value = hEl.value.slice(0, -1);
          hFresh = false;
          if (t24ActiveCtx && t24ActiveCtx.wrap === wrap) syncTime24PickerHighlight(false);
          return;
        }
        if (e.key === "Delete") { e.preventDefault(); hEl.value = ""; hFresh = false; return; }
        if (e.key === "Enter") {
          padSeg(hEl);
          if (hEl.value !== "" && mEl.value === "") mEl.value = "00";
          if (t24PickerEl && t24PickerEl.classList.contains("open")) {
            e.stopPropagation();
            closeTime24Picker();
          }
          return;
        }
        if (e.key.length === 1) e.preventDefault();
      });
      hEl.addEventListener("input", () => {
        const d = hEl.value.replace(/\D/g, "").slice(0, 2);
        if (d.length === 1 && parseInt(d, 10) >= 3) { hEl.value = `0${d}`; focusMinute(); }
        else if (d.length === 2) {
          if (parseInt(d, 10) <= 23) { hEl.value = d; focusMinute(); }
          else { hEl.value = `0${d[0]}`; focusMinute(); enterMinuteDigit(d[1]); }
        } else hEl.value = d;
        hFresh = false;
      });

      mEl.addEventListener("mousedown", () => { if (document.activeElement !== mEl) mJustFocused = true; });
      mEl.addEventListener("focus", () => {
        mFresh = true;
        if (mEl.value) {
          mEl.select();
          setTimeout(() => { if (mFresh && document.activeElement === mEl && mEl.value) mEl.select(); }, 0);
        }
      });
      mEl.addEventListener("mouseup", (e) => {
        if (mJustFocused) {
          mJustFocused = false;
          if (mEl.value) { e.preventDefault(); mEl.select(); }
        }
      });
      mEl.addEventListener("blur", () => padSeg(mEl));
      mEl.addEventListener("paste", handlePaste);
      mEl.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key >= "0" && e.key <= "9") { e.preventDefault(); enterMinuteDigit(e.key); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); stepSeg(mEl, 59, 1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); stepSeg(mEl, 59, -1); return; }
        if (e.key === "ArrowLeft") {
          if (mEl.selectionStart === 0 || (mEl.selectionStart === 0 && mEl.selectionEnd === mEl.value.length)) {
            e.preventDefault();
            padSeg(mEl);
            hEl.focus();
            hFresh = true;
            hEl.select();
        setTimeout(() => { if (hFresh && document.activeElement === hEl && hEl.value) hEl.select(); }, 0);
          }
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          if (mEl.value === "") {
            hSkipFocusSelect = true;
            hEl.focus();
            hFresh = false;
            hEl.setSelectionRange(hEl.value.length, hEl.value.length);
          } else if (mEl.selectionStart === 0 && mEl.selectionEnd === mEl.value.length) {
            mEl.value = "";
            mFresh = false;
          } else {
            mEl.value = mEl.value.slice(0, -1);
            mFresh = false;
          }
          if (t24ActiveCtx && t24ActiveCtx.wrap === wrap) syncTime24PickerHighlight(false);
          return;
        }
        if (e.key === "Delete") { e.preventDefault(); mEl.value = ""; mFresh = false; return; }
        if (e.key === "Enter") {
          padSeg(mEl);
          if (t24PickerEl && t24PickerEl.classList.contains("open")) {
            e.stopPropagation();
            closeTime24Picker();
          }
          return;
        }
        if (e.key.length === 1) e.preventDefault();
      });
      mEl.addEventListener("input", () => {
        const d = mEl.value.replace(/\D/g, "").slice(0, 2);
        if (d.length === 1 && parseInt(d, 10) >= 6) { mEl.value = `0${d}`; mFresh = true; }
        else if (d.length === 2) { mEl.value = parseInt(d, 10) <= 59 ? d : `0${d[0]}`; mFresh = true; }
        else { mEl.value = d; mFresh = false; }
      });

      const finalize = () => {
        padSeg(hEl);
        padSeg(mEl);
        if (hEl.value !== "" && mEl.value === "") mEl.value = "00";
      };

      wrap.addEventListener("focusout", (e) => {
        if (wrap.contains(e.relatedTarget)) return;
        if (t24PickerEl && t24PickerEl.contains(e.relatedTarget)) return;
        if (t24ActiveCtx && t24ActiveCtx.wrap === wrap) return;
        finalize();
      });

      wrap.addEventListener("click", (e) => {
        if (e.target === wrap || e.target === sep) {
          hEl.focus();
          hEl.select();
        setTimeout(() => { if (hFresh && document.activeElement === hEl && hEl.value) hEl.select(); }, 0);
        }
      });

      const ctx = {
        wrap,
        finalize,
        getHour: () => (/^\d{1,2}$/.test(hEl.value.trim()) ? pad(parseInt(hEl.value.trim(), 10)) : ""),
        getMin: () => (/^\d{1,2}$/.test(mEl.value.trim()) ? pad(parseInt(mEl.value.trim(), 10)) : ""),
        setHour: (hh) => { hEl.value = hh; if (mEl.value === "") mEl.value = "00"; },
        setMin: (mm) => { mEl.value = mm; if (hEl.value === "") hEl.value = "00"; },
        clear: () => { hEl.value = ""; mEl.value = ""; }
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pop = ensureTime24Picker();
        if (t24ActiveCtx && t24ActiveCtx.wrap === wrap && pop.classList.contains("open")) {
          closeTime24Picker();
          return;
        }
        if (t24ActiveCtx) closeTime24Picker();
        t24ActiveCtx = ctx;
        wrap.classList.add("open");
        pop.classList.add("open");
        positionTime24Picker(wrap);
        syncTime24PickerHighlight(true);
      });

      Object.defineProperty(wrap, "value", {
        configurable: true,
        get() {
          const hr = hEl.value.trim();
          const mn = mEl.value.trim();
          if (!hr) return "";
          const hh = parseInt(hr, 10);
          if (Number.isNaN(hh) || hh < 0 || hh > 23) return "";
          const mm = mn === "" ? 0 : parseInt(mn, 10);
          if (Number.isNaN(mm) || mm < 0 || mm > 59) return "";
          return `${pad(hh)}:${pad(mm)}`;
        },
        set(v) {
          const str = (v === null || v === undefined) ? "" : String(v).trim();
          if (!str) { hEl.value = ""; mEl.value = ""; return; }
          const match = str.match(/^(\d{1,2}):(\d{1,2})$/);
          if (match) {
            const hh = parseInt(match[1], 10);
            const mm = parseInt(match[2], 10);
            if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
              hEl.value = pad(hh);
              mEl.value = pad(mm);
              return;
            }
          }
          hEl.value = "";
          mEl.value = "";
        }
      });

      Object.defineProperty(wrap, "isIncomplete", {
        configurable: true,
        get() {
          return hEl.value.trim() === "" && mEl.value.trim() !== "";
        }
      });
    });
  }

  async function addTask() {
    const name = $("taskName").value.trim();
    if (!name) {
      flash("taskName");
      return;
    }

    const timeEl = $("taskTime");
    if (timeEl && timeEl.isIncomplete) {
      flash("taskTime");
      showToast("Giờ chưa hợp lệ", "Vui lòng nhập đủ giờ và phút (24h: 00:00 – 23:59).");
      return;
    }
    const time = timeEl ? timeEl.value : "";
    const desc = $("taskDesc").value.trim();
    const priority = $("taskPriority").value;

    const key = todayKey();
    if (!appData.tasks[key]) appData.tasks[key] = [];
    appData.tasks[key].push({ id: uid(), name, time, desc, priority, done: false });
    await saveData();
    renderTasks();
    renderCal();
    playAdd();
    $("taskName").value = "";
    $("taskTime").value = "";
    $("taskDesc").value = "";
  }

  async function addMonthTask() {
    const name = $("mTaskName").value.trim();
    const time = $("mTaskTime").value;
    const desc = $("mTaskDesc").value.trim();
    const priority = $("mTaskPriority").value;

    if (!selectedDay) return;
    if (!name) {
      flash("mTaskName");
      return;
    }

    if (!appData.tasks[selectedDay]) appData.tasks[selectedDay] = [];
    appData.tasks[selectedDay].push({ id: uid(), name, time, desc, priority, done: false });
    await saveData();
    renderMonthTasks();
    renderCal();
    if (selectedDay === todayKey()) renderTasks();
    playAdd();
    $("mTaskName").value = "";
    $("mTaskTime").value = "";
    $("mTaskDesc").value = "";
  }

  async function toggleTask(id, targetDate) {
    const key = targetDate || todayKey();
    const tasks = appData.tasks[key] || [];
    const task = tasks.find((item) => item.id === id);
    if (!task) return;

    task.done = !task.done;
    if (task.done) playDone();
    await saveData();
    if (key === todayKey()) renderTasks();
    if (selectedDay === key && $("panel-month").classList.contains("active")) renderMonthTasks();
    renderCal();
  }

  async function deleteTask(id, targetDate) {
    const key = targetDate || todayKey();
    appData.tasks[key] = (appData.tasks[key] || []).filter((task) => task.id !== id);
    await saveData();
    if (key === todayKey()) renderTasks();
    if (selectedDay === key && $("panel-month").classList.contains("active")) renderMonthTasks();
    renderCal();
  }

  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });
  }

  function renderTaskItem(task, targetDate) {
    const priority = task.priority || "med";
    const priorityLabel = PRIORITY_LABELS[priority] || PRIORITY_LABELS.med;
    const priorityClass = PRIORITY_CLASSES[priority] || PRIORITY_CLASSES.med;
    const dateAttr = targetDate ? ` data-date="${escH(targetDate)}"` : "";

    return `<div class="task-item ${task.done ? "done" : ""}" id="task-${escH(task.id)}">
      <button class="task-check ${task.done ? "checked" : ""}" type="button" data-action="toggle-task" data-id="${escH(task.id)}"${dateAttr} aria-label="Đánh dấu hoàn thành">${task.done ? "✓" : ""}</button>
      <div class="task-body">
        <div class="task-header">
          ${task.time ? `<span class="task-time">${escH(task.time)}</span>` : ""}
          <span class="task-name">${escH(task.name)}</span>
          <span class="task-priority ${priorityClass}">${priorityLabel}</span>
        </div>
        ${task.desc ? `<div class="task-desc">${escH(task.desc)}</div>` : ""}
        <div class="task-actions">
          <button class="btn btn-danger btn-sm" type="button" data-action="delete-task" data-id="${escH(task.id)}"${dateAttr}>Xóa</button>
        </div>
      </div>
    </div>`;
  }

  function renderTasks() {
    const key = todayKey();
    const tasks = appData.tasks[key] || [];
    const done = tasks.filter((task) => task.done).length;
    const total = tasks.length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    $("statTotal").textContent = total;
    $("statDone").textContent = done;
    $("statLeft").textContent = total - done;
    $("progressBar").style.width = `${percent}%`;
    $("progressPct").textContent = `${percent}%`;

    const list = $("taskList");
    if (!tasks.length) {
      list.innerHTML =
        '<div class="empty-state"><div class="empty-icon">🚀</div><div class="empty-text">Chưa có mục tiêu nào. Hãy bắt đầu.</div></div>';
      return;
    }

    list.innerHTML = sortTasks(tasks).map((task) => renderTaskItem(task, null)).join("");
  }

  function checkPopupAlarms(now) {
    const tasks = appData.tasks[todayKey()] || [];
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    tasks.forEach((task) => {
      if (task.time === hhmm && !task.done && !alarmedIds.has(task.id)) {
        alarmedIds.add(task.id);
        playAlarm();
        setTimeout(playAlarm, 900);
        showToast(`Đến giờ: ${task.name}`, `${task.time} - Đã đến lúc thực hiện.`);
        const element = $(`task-${task.id}`);
        if (element) {
          element.classList.add("ringing");
          setTimeout(() => {
            const item = $(`task-${task.id}`);
            if (item) item.classList.remove("ringing");
          }, 8000);
        }
      }
    });
  }

  function showToast(title, message) {
    const container = $("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast";

    const icon = document.createElement("div");
    icon.className = "toast-icon";
    icon.textContent = "🔔";

    const body = document.createElement("div");
    const titleEl = document.createElement("div");
    titleEl.className = "toast-title";
    titleEl.textContent = title;
    const msgEl = document.createElement("div");
    msgEl.className = "toast-msg";
    msgEl.textContent = message;

    body.append(titleEl, msgEl);
    toast.append(icon, body);
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = "toastOut 0.25s ease forwards";
      setTimeout(() => toast.remove(), 260);
    }, 6000);
  }

  function initCal() {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    renderCal();
  }

  function prevMonth() {
    calMonth -= 1;
    if (calMonth < 0) {
      calMonth = 11;
      calYear -= 1;
    }
    renderCal();
  }

  function nextMonth() {
    calMonth += 1;
    if (calMonth > 11) {
      calMonth = 0;
      calYear += 1;
    }
    renderCal();
  }

  function renderCal() {
    $("calTitle").textContent = `${MONTHS_VI[calMonth]} / ${calYear}`;
    const grid = $("calGrid");
    const dayLabels = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    let html = dayLabels.map((day) => `<div class="cal-day-label">${day}</div>`).join("");
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const daysInPrev = new Date(calYear, calMonth, 0).getDate();
    const now = new Date();

    for (let i = firstDay - 1; i >= 0; i -= 1) {
      html += `<div class="cal-cell other-month"><div class="cal-num">${daysInPrev - i}</div></div>`;
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = dateKey(calYear, calMonth + 1, day);
      const tasks = appData.tasks[key] || [];
      const isToday = day === now.getDate() && calMonth === now.getMonth() && calYear === now.getFullYear();
      const isSelected = selectedDay === key;
      const dots = tasks.length
        ? `<div class="cal-dots">${tasks.map((task) => `<span class="cal-dot ${task.done ? "done" : ""}"></span>`).join("")}</div>`
        : "";

      html += `<button class="cal-cell ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}" type="button" data-day="${day}">
        <span class="cal-num">${day}</span>${dots}
      </button>`;
    }

    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    let nextDayNumber = 1;
    for (let i = firstDay + daysInMonth; i < totalCells; i += 1) {
      html += `<div class="cal-cell other-month"><div class="cal-num">${nextDayNumber}</div></div>`;
      nextDayNumber += 1;
    }

    grid.innerHTML = html;
  }

  function selectDay(day) {
    selectedDay = dateKey(calYear, calMonth + 1, day);
    renderCal();
    $("monthNotePanel").classList.add("open");
    $("monthNoteDate").textContent = `${day} ${MONTHS_VI[calMonth]} ${calYear}`;
    renderMonthTasks();
  }

  function renderMonthTasks() {
    const tasks = appData.tasks[selectedDay] || [];
    const list = $("monthTaskList");
    if (!tasks.length) {
      list.innerHTML =
        '<div class="empty-state empty-state-small"><div class="empty-text">Ngày này chưa có kế hoạch nào.</div></div>';
      return;
    }

    list.innerHTML = sortTasks(tasks).map((task) => renderTaskItem(task, selectedDay)).join("");
  }

  function initYear() {
    yearView = new Date().getFullYear();
    renderYear();
  }

  function prevYear() {
    yearView -= 1;
    renderYear();
  }

  function nextYear() {
    yearView += 1;
    renderYear();
  }

  function renderYear() {
    $("yearTitle").textContent = yearView;
    $("yearMonths").innerHTML = MONTHS_VI.map((name, index) => {
      const key = `${yearView}-${index + 1}`;
      const goals = appData.yearGoals[key] || [];
      const doneGoals = goals.filter((goal) => goal.done).length;
      const badge = goals.length ? `<div class="month-card-badge">${doneGoals}/${goals.length}</div>` : "";
      const preview = goals
        .slice(0, 2)
        .map((goal) => `<div class="${goal.done ? "month-goal-done" : ""}">- ${escH(goal.text)}</div>`)
        .join("");

      return `<button class="month-card ${goals.length ? "has-goals" : ""}" type="button" data-month-index="${index}">
        ${badge}
        <div class="month-card-name">${name}</div>
        <div class="month-card-goals">${preview || '<span class="empty-text">Nhấn để thêm...</span>'}</div>
      </button>`;
    }).join("");
  }

  function openYearModal(index) {
    editingYM = `${yearView}-${index + 1}`;
    $("yearModalTitle").textContent = `${MONTHS_VI[index]} / ${yearView}`;
    $("yearGoalInput").value = "";
    renderYearGoals();
    $("yearModal").classList.add("open");
    $("yearGoalInput").focus();
  }

  function closeYearModal() {
    $("yearModal").classList.remove("open");
    editingYM = null;
    renderYear();
  }

  async function saveYearGoal() {
    const text = $("yearGoalInput").value.trim();
    if (!text || !editingYM) return;

    if (!appData.yearGoals[editingYM]) appData.yearGoals[editingYM] = [];
    appData.yearGoals[editingYM].push({ id: uid(), text, done: false });
    await saveData();
    $("yearGoalInput").value = "";
    renderYearGoals();
    renderYear();
    playAdd();
  }

  async function toggleYearGoal(id) {
    const goal = (appData.yearGoals[editingYM] || []).find((item) => item.id === id);
    if (!goal) return;

    goal.done = !goal.done;
    if (goal.done) playDone();
    await saveData();
    renderYearGoals();
    renderYear();
  }

  async function deleteYearGoal(id) {
    if (!editingYM) return;

    appData.yearGoals[editingYM] = (appData.yearGoals[editingYM] || []).filter((goal) => goal.id !== id);
    await saveData();
    renderYearGoals();
    renderYear();
  }

  function renderYearGoals() {
    const goals = appData.yearGoals[editingYM] || [];
    const list = $("yearGoalList");
    if (!goals.length) {
      list.innerHTML =
        '<div class="empty-state empty-state-small"><div class="empty-text">Chưa có mục tiêu nào.</div></div>';
      return;
    }

    list.innerHTML = goals.map((goal) => `
      <div class="task-item ${goal.done ? "done" : ""}">
        <button class="task-check ${goal.done ? "checked" : ""}" type="button" data-action="toggle-year-goal" data-id="${escH(goal.id)}" aria-label="Đánh dấu hoàn thành">${goal.done ? "✓" : ""}</button>
        <div class="task-body">
          <div class="task-name">${escH(goal.text)}</div>
        </div>
        <button class="btn btn-danger btn-sm" type="button" data-action="delete-year-goal" data-id="${escH(goal.id)}">Xóa</button>
      </div>
    `).join("");
  }

  function bindEvents() {
    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab, button));
    });

    $("addTaskBtn").addEventListener("click", addTask);
    $("addMonthTaskBtn").addEventListener("click", addMonthTask);
    $("prevMonthBtn").addEventListener("click", prevMonth);
    $("nextMonthBtn").addEventListener("click", nextMonth);
    $("prevYearBtn").addEventListener("click", prevYear);
    $("nextYearBtn").addEventListener("click", nextYear);
    $("closeYearModalBtn").addEventListener("click", closeYearModal);
    $("saveYearGoalBtn").addEventListener("click", saveYearGoal);

    $("calGrid").addEventListener("click", (event) => {
      const cell = event.target.closest("[data-day]");
      if (!cell) return;
      selectDay(Number(cell.dataset.day));
    });

    $("yearMonths").addEventListener("click", (event) => {
      const card = event.target.closest("[data-month-index]");
      if (!card) return;
      openYearModal(Number(card.dataset.monthIndex));
    });

    document.addEventListener("click", (event) => {
      const actionTarget = event.target.closest("[data-action]");
      if (!actionTarget) return;

      const action = actionTarget.dataset.action;
      const id = actionTarget.dataset.id;
      const date = actionTarget.dataset.date;

      if (action === "toggle-task") toggleTask(id, date || null);
      if (action === "delete-task") deleteTask(id, date || null);
      if (action === "toggle-year-goal") toggleYearGoal(id);
      if (action === "delete-year-goal") deleteYearGoal(id);
    });

    $("yearModal").addEventListener("click", (event) => {
      if (event.target === $("yearModal")) closeYearModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;

      const active = document.querySelector(".panel.active");
      if ($("yearModal").classList.contains("open")) {
        event.preventDefault();
        saveYearGoal();
      } else if (active && active.id === "panel-day") {
        event.preventDefault();
        addTask();
      } else if (active && active.id === "panel-month" && $("monthNotePanel").classList.contains("open")) {
        event.preventDefault();
        addMonthTask();
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     POMODORO & WEBSITE BLOCKER
  ══════════════════════════════════════════════════════════════ */
  let pomoTimerInterval = null;
  let pomoBgWorker = null;
  let pomoEndTime = null;
  let pomoTimeLeft = 25 * 60;
  let pomoMode = "work";
  let pomoIsRunning = false;
  const popupInstanceId = uid();
  let blockedSites = [];
  let blockerSettings = {
    blockOnPomo: true,
    blockOnSchedule: false,
    startTime: "19:00",
    endTime: "22:00"
  };

  const pomoStorage = {
    get: (keys, callback) => {
      if (extensionStorageAvailable()) {
        chrome.storage.local.get(keys, callback);
      } else {
        const result = {};
        keys.forEach((k) => {
          const val = localStorage.getItem(k);
          if (val) {
            try { result[k] = JSON.parse(val); } catch (e) { result[k] = val; }
          }
        });
        callback(result);
      }
    },
    set: (data, callback) => {
      if (extensionStorageAvailable()) {
        chrome.storage.local.set(data, callback);
      }
      try {
        Object.keys(data).forEach((k) => {
          localStorage.setItem(k, JSON.stringify(data[k]));
        });
      } catch (e) {}
      if (callback && !extensionStorageAvailable()) callback();
    }
  };

  function defaultPomoSeconds(mode) {
    if (mode === "short") return 5 * 60;
    if (mode === "long") return 15 * 60;
    return 25 * 60;
  }

  function formatPomoTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function updatePomoUI() {
    const timerDisplay = $("pomo-timer");
    const statusDisplay = $("pomo-status");
    if (timerDisplay) timerDisplay.textContent = formatPomoTime(pomoTimeLeft);
    if (statusDisplay) {
      if (pomoIsRunning) {
        statusDisplay.innerHTML =
          pomoMode === "work"
            ? '<span style="color:var(--danger)">🔥 Đang trong giờ học tập (Đã bật chặn web)</span>'
            : '<span style="color:var(--success)">☕ Đang giờ giải lao (Tạm mở khóa web)</span>';
      } else {
        statusDisplay.textContent = "Đã tạm dừng / Sẵn sàng";
      }
    }
    document.title = pomoIsRunning
      ? `${pomoMode === "work" ? "🍅" : "☕"} ${formatPomoTime(pomoTimeLeft)} — Nova Planner`
      : "Nova Planner";
  }

  function syncPomoState() {
    const currentLeft = (pomoIsRunning && pomoEndTime)
      ? Math.max(0, Math.ceil((pomoEndTime - Date.now()) / 1000))
      : pomoTimeLeft;
    pomoStorage.set({
      pomoState: {
        isRunning: pomoIsRunning,
        currentMode: pomoMode,
        currentPhase: pomoMode === "work" ? "work" : "break",
        timeLeft: currentLeft,
        totalTime: defaultPomoSeconds(pomoMode),
        endTime: pomoIsRunning ? pomoEndTime : null,
        sourceId: popupInstanceId,
        updatedAt: Date.now()
      }
    });
  }

  function tickPopupPomo() {
    if (!pomoIsRunning || !pomoEndTime) return;
    const now = Date.now();
    if (now < pomoEndTime) {
      const nextLeft = Math.max(0, Math.ceil((pomoEndTime - now) / 1000));
      if (nextLeft !== pomoTimeLeft) {
        pomoTimeLeft = nextLeft;
        updatePomoUI();
      }
      return;
    }

    if (now - pomoEndTime > 12 * 3600 * 1000) {
      pausePomoTimer();
      pomoTimeLeft = defaultPomoSeconds(pomoMode);
      syncPomoState();
      updatePomoUI();
      return;
    }

    while (pomoEndTime <= now) {
      if (pomoMode === "work") {
        pomoMode = "short";
      } else {
        pomoMode = "work";
      }
      pomoEndTime += defaultPomoSeconds(pomoMode) * 1000;
    }

    pomoTimeLeft = Math.max(1, Math.ceil((pomoEndTime - now) / 1000));
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === pomoMode);
    });
    playDone();
    if (pomoMode === "short") {
      showToast("🎉 Pomodoro Hoàn thành!", "Tự động chuyển sang giờ nghỉ 5 phút.");
    } else {
      showToast("⏰ Hết giờ nghỉ!", "Tự động bắt đầu phiên học tập 25 phút.");
    }
    syncPomoState();
    updatePomoUI();
  }

  function ensurePopupWorker() {
    if (pomoBgWorker) return;
    try {
      const blob = new Blob(["setInterval(function(){postMessage(1);},500);"], {
        type: "application/javascript"
      });
      pomoBgWorker = new Worker(URL.createObjectURL(blob));
      pomoBgWorker.onmessage = tickPopupPomo;
    } catch (e) {
      pomoBgWorker = null;
    }
  }

  function startPomoTimer(resumeEndTime) {
    if (pomoIsRunning) return;
    const ctx = getACtx();
    if (ctx && ctx.state === "suspended") {
      try { ctx.resume(); } catch (e) {}
    }
    if (pomoTimeLeft <= 0) {
      pomoTimeLeft = defaultPomoSeconds(pomoMode);
    }
    pomoIsRunning = true;
    pomoEndTime = (typeof resumeEndTime === "number" && resumeEndTime > Date.now())
      ? resumeEndTime
      : Date.now() + pomoTimeLeft * 1000;
    pomoTimeLeft = Math.max(0, Math.ceil((pomoEndTime - Date.now()) / 1000));
    syncPomoState();
    updatePomoUI();

    ensurePopupWorker();
    clearInterval(pomoTimerInterval);
    pomoTimerInterval = setInterval(tickPopupPomo, 1000);
  }

  function pausePomoTimer() {
    if (pomoIsRunning && pomoEndTime) {
      pomoTimeLeft = Math.max(0, Math.ceil((pomoEndTime - Date.now()) / 1000));
    }
    clearInterval(pomoTimerInterval);
    pomoIsRunning = false;
    pomoEndTime = null;
    syncPomoState();
    updatePomoUI();
  }

  function switchPomoMode(mode, minutes) {
    pausePomoTimer();
    pomoMode = mode;
    pomoTimeLeft = minutes * 60;
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    syncPomoState();
    updatePomoUI();
  }

  function extractHostname(inputUrl) {
    let cleaned = inputUrl.trim().toLowerCase();
    if (!cleaned) return "";
    try {
      if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
        cleaned = "https://" + cleaned;
      }
      const urlObj = new URL(cleaned);
      return urlObj.hostname.replace(/^www\./, "");
    } catch (e) {
      return cleaned.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0].split(":")[0];
    }
  }

  function renderBlockedSites() {
    const listEl = $("blocked-sites-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (blockedSites.length === 0) {
      listEl.innerHTML = '<li style="color:var(--muted); justify-content:center;">Chưa có trang web nào trong danh sách chặn</li>';
      return;
    }

    blockedSites.forEach((domain, index) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>🌐 <b>${escH(domain)}</b></span>
        <button class="remove-site-btn" data-index="${index}" title="Xóa">✖</button>
      `;
      listEl.appendChild(li);
    });

    listEl.querySelectorAll(".remove-site-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.getAttribute("data-index"), 10);
        blockedSites.splice(idx, 1);
        pomoStorage.set({ blockedSites }, () => renderBlockedSites());
      });
    });
  }

  function addBlockedDomain(raw) {
    const domain = extractHostname(raw);
    if (!domain) return;
    if (!blockedSites.includes(domain)) {
      blockedSites.push(domain);
      pomoStorage.set({ blockedSites }, () => {
        if ($("block-url-input")) $("block-url-input").value = "";
        renderBlockedSites();
        showToast("Đã thêm trang web", `Chặn: ${domain}`);
      });
    } else {
      if ($("block-url-input")) $("block-url-input").value = "";
      showToast("Thông báo", `${domain} đã có trong danh sách chặn.`);
    }
  }

  function saveBlockerSettings() {
    blockerSettings = {
      blockOnPomo: $("block-on-pomo") ? $("block-on-pomo").checked : true,
      blockOnSchedule: $("block-on-schedule") ? $("block-on-schedule").checked : false,
      startTime: $("study-start-time") ? $("study-start-time").value || "19:00" : "19:00",
      endTime: $("study-end-time") ? $("study-end-time").value || "22:00" : "22:00"
    };
    pomoStorage.set({ blockerSettings });
  }

  function initPomoAndBlocker() {
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchPomoMode(btn.dataset.mode, parseInt(btn.dataset.time, 10));
      });
    });

    if ($("pomo-start-btn")) $("pomo-start-btn").addEventListener("click", startPomoTimer);
    if ($("pomo-pause-btn")) $("pomo-pause-btn").addEventListener("click", pausePomoTimer);
    if ($("pomo-reset-btn")) {
      $("pomo-reset-btn").addEventListener("click", () => {
        const activeBtn = document.querySelector(".mode-btn.active");
        const defaultMin = activeBtn ? parseInt(activeBtn.dataset.time, 10) : 25;
        switchPomoMode(pomoMode, defaultMin);
      });
    }

    if ($("block-on-pomo")) $("block-on-pomo").addEventListener("change", saveBlockerSettings);
    if ($("block-on-schedule")) $("block-on-schedule").addEventListener("change", saveBlockerSettings);
    if ($("save-schedule-btn")) {
      $("save-schedule-btn").addEventListener("click", () => {
        saveBlockerSettings();
        showToast("Cài đặt giờ", "Đã lưu khung giờ học tập!");
      });
    }

    if ($("add-block-url-btn")) {
      $("add-block-url-btn").addEventListener("click", () => {
        const val = $("block-url-input") ? $("block-url-input").value : "";
        addBlockedDomain(val);
      });
    }

    if ($("block-url-input")) {
      $("block-url-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if ($("add-block-url-btn")) $("add-block-url-btn").click();
        }
      });
    }

    document.querySelectorAll(".preset-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const domain = chip.dataset.domain;
        if (domain) addBlockedDomain(domain);
      });
    });

    pomoStorage.get(["blockedSites", "blockerSettings", "pomoState"], (res) => {
      blockedSites = res.blockedSites || [];
      renderBlockedSites();

      if (res.blockerSettings) {
        blockerSettings = res.blockerSettings;
        if ($("block-on-pomo")) $("block-on-pomo").checked = blockerSettings.blockOnPomo ?? true;
        if ($("block-on-schedule")) $("block-on-schedule").checked = blockerSettings.blockOnSchedule ?? false;
        if ($("study-start-time")) $("study-start-time").value = blockerSettings.startTime || "19:00";
        if ($("study-end-time")) $("study-end-time").value = blockerSettings.endTime || "22:00";
      }

      if (res.pomoState) {
        pomoMode = res.pomoState.currentMode || "work";
        document.querySelectorAll(".mode-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.mode === pomoMode);
        });

        const defaultSec = defaultPomoSeconds(pomoMode);
        if (res.pomoState.isRunning) {
          const targetEnd = res.pomoState.endTime
            ? res.pomoState.endTime
            : (res.pomoState.updatedAt || Date.now()) + (res.pomoState.timeLeft || defaultSec) * 1000;
          if (targetEnd > Date.now()) {
            pomoTimeLeft = Math.max(1, Math.ceil((targetEnd - Date.now()) / 1000));
            startPomoTimer(targetEnd);
          } else {
            pomoIsRunning = true;
            pomoEndTime = targetEnd;
            ensurePopupWorker();
            clearInterval(pomoTimerInterval);
            pomoTimerInterval = setInterval(tickPopupPomo, 1000);
            tickPopupPomo();
          }
        } else {
          pomoTimeLeft = res.pomoState.timeLeft ?? defaultSec;
          updatePomoUI();
        }
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && pomoIsRunning) tickPopupPomo();
    });
    window.addEventListener("focus", () => {
      if (pomoIsRunning) tickPopupPomo();
    });
  }

  async function init() {
    initTime24Inputs();
    initStars();
    bindEvents();
    initPomoAndBlocker();
    await loadData();
    renderTasks();
    initCal();
    initYear();
    updateClock();
    setInterval(updateClock, 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
