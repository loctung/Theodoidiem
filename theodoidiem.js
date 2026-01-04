// ====== CONFIG: NGƯỠNG LOẠI BẰNG (khớp dropdown: 2.5 / 3.2 / 3.6) ======
const DEGREE_THRESHOLDS = [
  { name: "Xuất sắc", min: 3.60 },
  { name: "Giỏi", min: 3.20 },
  { name: "Khá", min: 2.50 },
  { name: "Trung bình", min: 2.00 },
  { name: "Yếu", min: 1.00 },
  { name: "Kém", min: 0.00 },
];

// ====== Quy đổi điểm: hệ 10 -> chữ -> hệ 4 ======
const LETTER_THRESHOLDS = [
  { letter: "A+", min10: 9.5, gpa4: 4.0 },
  { letter: "A",  min10: 8.5, gpa4: 3.8 },
  { letter: "B+", min10: 8.0, gpa4: 3.5 },
  { letter: "B",  min10: 7.0, gpa4: 3.0 },
  { letter: "C+", min10: 6.0, gpa4: 2.5 },
  { letter: "C",  min10: 5.5, gpa4: 2.0 },
  { letter: "D+", min10: 4.5, gpa4: 1.5 },
  { letter: "D",  min10: 4.0, gpa4: 1.0 },
  { letter: "F+", min10: 2.0, gpa4: 0.5 },
  { letter: "F",  min10: -Infinity, gpa4: 0.0 },
];

const LS_KEY = "study_tracker_v2";
const $ = (id) => document.getElementById(id);

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY));
    const state = parsed || { terms: [] };

    (state.terms || []).forEach(t => {
      if (!t.summary) t.summary = { gpa4: "", credits: "" };
      if (!t.mode) t.mode = "courses";
      if (typeof t.collapsed !== "boolean") t.collapsed = false; // ✅ NEW
      if (!Array.isArray(t.courses)) t.courses = [];

      (t.courses || []).forEach(c => {
        if (!Array.isArray(c.attempts)) {
          const g10 = c.grade10 ?? "";
          c.attempts = [{ type: "main", grade10: g10 }];
          delete c.grade10;
        }
        if (!c.attempts.length) c.attempts = [{ type: "main", grade10: "" }];
      });
    });

    return state;
  } catch {
    return { terms: [] };
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function degreeFromCgpa(cgpa) {
  for (const t of DEGREE_THRESHOLDS) if (cgpa >= t.min) return t.name;
  return "—";
}

// ====== Decimal helpers ======
function normalizeOneDecimal(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(",", ".");
  s = s.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    s = s.replace(/^(\d+)\.(\d).*/, "$1.$2");
  } else {
    s = s.replace(/^0+(\d)/, "$1");
  }
  return s;
}

function normalizeTwoDecimals(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(",", ".");
  s = s.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    s = s.replace(/^(\d+)\.(\d{0,2}).*$/, (m, a, b) => b ? `${a}.${b}` : `${a}.`);
  } else {
    s = s.replace(/^0+(\d)/, "$1");
  }
  return s;
}

function parseDecimal1(raw) {
  const s = normalizeOneDecimal(raw);
  if (!s || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDecimal2(raw) {
  const s = normalizeTwoDecimals(raw);
  if (!s || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseIntSafe(raw) {
  const s = String(raw ?? "").trim().replace(/[^\d]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function letterFrom10(score10) {
  for (const t of LETTER_THRESHOLDS) if (score10 >= t.min10) return t.letter;
  return "F";
}

function gpa4FromLetter(letter) {
  const found = LETTER_THRESHOLDS.find(x => x.letter === letter);
  return found ? found.gpa4 : 0;
}

function from10ToLetterGpa4(score10) {
  if (score10 == null) return { letter: "—", gpa4: null };
  const letter = letterFrom10(score10);
  const gpa4 = gpa4FromLetter(letter);
  return { letter, gpa4 };
}

function evaluationFromGpa4(gpa4) {
  if (gpa4 == null) return "—";
  return gpa4 < 1 ? "HOCLAI" : "DAT";
}

// ====== logic học nâng điểm / học lại ======
function getCourseAction(letter) {
  if (["C+", "C", "D+", "D"].includes(letter)) return { kind: "upgrade", label: "Học nâng điểm" };
  if (["F", "F+"].includes(letter)) return { kind: "retake", label: "Học lại" };
  return null;
}

function attemptLabel(type) {
  if (type === "main") return "Lần 1";
  if (type === "upgrade") return "Nâng điểm";
  if (type === "retake") return "Học lại";
  return "Lần khác";
}

function ensureCourseShape(course) {
  if (!course.attempts || !Array.isArray(course.attempts) || course.attempts.length === 0) {
    course.attempts = [{ type: "main", grade10: "" }];
  }
}

function bestAttemptGpa4(course) {
  let best = null;
  for (const a of (course.attempts || [])) {
    const g10 = parseDecimal1(a.grade10);
    const { gpa4 } = from10ToLetterGpa4(g10);
    if (gpa4 == null) continue;
    if (best == null || gpa4 > best) best = gpa4;
  }
  return best;
}

/**
 * ✅ NEW: Tổng tín chỉ học lại
 * Rule: nếu môn có BẤT KỲ lần nào điểm hệ 10 < 4 => cộng tín chỉ môn đó (mỗi môn tối đa 1 lần)
 */
function calcRetakeCredits(terms) {
  let sum = 0;
  for (const term of terms) {
    if (term.mode !== "courses") continue;
    for (const course of (term.courses || [])) {
      ensureCourseShape(course);
      const cr = parseIntSafe(course.credits) || 0;
      if (cr <= 0) continue;

      let isRetake = false;
      for (const att of (course.attempts || [])) {
        const g10 = parseDecimal1(att.grade10);
        if (g10 != null && g10 < 4) { isRetake = true; break; }
      }

      if (isRetake) sum += cr;
    }
  }
  return sum;
}

// ✅ Tín chỉ chưa học: term.summary credits > 0 và gpa4 trống
function calcUnlearnedCredits(terms) {
  let sum = 0;
  for (const term of terms) {
    if (term.mode !== "summary") continue;
    const g4 = parseDecimal2(term.summary?.gpa4);
    const c = parseIntSafe(term.summary?.credits) || 0;
    if (c > 0 && g4 == null) sum += c;
  }
  return sum;
}

// ====== ✅ Tính tổng (All / Pass) — bỏ qua kỳ chưa học ======
function calcTotals(terms) {
  let S_all = 0, C_all = 0;
  let S_pass = 0, C_pass = 0;

  for (const term of terms) {
    if (term.mode === "summary") {
      const g4 = parseDecimal2(term.summary.gpa4);
      const c = parseIntSafe(term.summary.credits) || 0;
      if (g4 != null && c > 0) {
        S_all += g4 * c; C_all += c;
        if (g4 >= 1) { S_pass += g4 * c; C_pass += c; }
      }
    } else {
      for (const course of term.courses) {
        ensureCourseShape(course);
        const cr = parseIntSafe(course.credits) || 0;
        const gpaBest = bestAttemptGpa4(course);
        if (gpaBest != null && cr > 0) {
          S_all += gpaBest * cr; C_all += cr;
          if (gpaBest >= 1) { S_pass += gpaBest * cr; C_pass += cr; }
        }
      }
    }
  }

  return {
    S_all, C_all, gpaAll: C_all > 0 ? (S_all / C_all) : 0,
    S_pass, C_pass, gpaPass: C_pass > 0 ? (S_pass / C_pass) : 0,
  };
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

// ===== UI render =====
function render() {
  const container = $("terms");
  container.innerHTML = "";

  state.terms.forEach((term, idx) => {
    const div = document.createElement("div");
    div.className = "term";

    // ✅ chỉ cho nút Ẩn/Hiện khi mode courses
    const showToggle = term.mode === "courses";
    const toggleText = term.collapsed ? "Hiện" : "Ẩn";

    div.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center">
        <h3 style="margin:0">Kỳ ${idx + 1}</h3>
        <div class="row" style="align-items:center">
          ${showToggle ? `
            <button class="btn ghost small" data-act="toggleTerm" data-idx="${idx}">
              ${toggleText}
            </button>
          ` : ""}
          <button class="btn danger" data-act="del" data-idx="${idx}">Xóa kỳ</button>
        </div>
      </div>

      <div class="row" style="margin-top:10px">
        <div>
          <label>Chế độ nhập</label>
          <select data-act="mode" data-idx="${idx}">
            <option value="courses" ${term.mode === "courses" ? "selected" : ""}>Nhập theo môn</option>
            <option value="summary" ${term.mode === "summary" ? "selected" : ""}>Nhập tổng kết kỳ</option>
          </select>
        </div>
      </div>

      <div data-sec="courses" style="display:${term.mode === "courses" && !term.collapsed ? "block" : "none"};margin-top:10px">
        ${renderCoursesTable(term, idx)}
        <div class="row" style="justify-content:flex-end;margin-top:10px">
          <button class="btn primary" data-act="addCourse" data-idx="${idx}">+ Thêm môn</button>
        </div>
      </div>

      <div data-sec="summary" style="display:${term.mode === "summary" ? "block" : "none"};margin-top:10px">
        <div class="row">
          <div>
            <label>GPA kỳ (hệ 4)</label>
            <input inputmode="decimal" data-act="sumGpa4" data-idx="${idx}"
              value="${escapeAttr(term.summary.gpa4 ?? "")}" placeholder="VD: 3.45 hoặc 3,45 (để trống nếu chưa học)" />
          </div>
          <div>
            <label>Tổng tín chỉ kỳ</label>
            <input inputmode="numeric" data-act="sumCredits" data-idx="${idx}"
              value="${escapeAttr(term.summary.credits ?? "")}" placeholder="VD: 18" />
          </div>
          <div class="muted" style="max-width:420px">
            * Nếu kỳ này chưa học thì chỉ cần nhập tổng tín chỉ là được.
          </div>
        </div>
      </div>

      ${term.mode === "courses" ? `
        <div class="termSummary" id="termSum-${idx}">
          ${renderTermSummary(term, idx)}
        </div>
      ` : ""}
    `;

    container.appendChild(div);
  });

  updateOverviewAndNeed();
  saveState();
}

function renderCoursesTable(term, termIdx) {
  const courses = term.courses || [];
  const rows = courses.map((course, cIdx) => {
    ensureCourseShape(course);

    const main = course.attempts[0] || { type: "main", grade10: "" };
    const g10Main = parseDecimal1(main.grade10);
    const convMain = from10ToLetterGpa4(g10Main);

    const action = convMain.letter !== "—" ? getCourseAction(convMain.letter) : null;
    const hasExtra = course.attempts.length >= 2;
    const rowspan = course.attempts.length;

    let attemptRows = "";

    for (let aIdx = 0; aIdx < course.attempts.length; aIdx++) {
      const att = course.attempts[aIdx];
      const g10 = parseDecimal1(att.grade10);
      const conv = from10ToLetterGpa4(g10);
      const evalv = evaluationFromGpa4(conv.gpa4);

      const isExtra = aIdx > 0;
      const rowClass = isExtra ? "retry-row" : "";
      const leftLabel = isExtra ? `<div class="retry-label">${attemptLabel(att.type)}</div>` : "";

      let actionCell = "";
      if (!isExtra) {
        if (action && !hasExtra) {
          actionCell = `
            <button class="link-btn ${action.kind === "retake" ? "danger" : ""}"
              data-act="addAttempt"
              data-kind="${action.kind}"
              data-idx="${termIdx}"
              data-cidx="${cIdx}">
              ${action.label}
            </button>
          `;
        } else {
          actionCell = `<span class="muted">—</span>`;
        }
      } else {
        actionCell = `
          <button class="link-btn danger"
            data-act="removeAttempt"
            data-idx="${termIdx}"
            data-cidx="${cIdx}"
            data-aidx="${aIdx}">
            Xóa lần này
          </button>
        `;
      }

      attemptRows += `
        <tr class="${rowClass}">
          ${aIdx === 0 ? `
            <td class="nowrap" rowspan="${rowspan}">${cIdx + 1}</td>
            <td rowspan="${rowspan}">
              <input class="course-name" data-act="cName" data-idx="${termIdx}" data-cidx="${cIdx}"
                value="${escapeAttr(course.name || "")}" placeholder=""/>
            </td>
            <td rowspan="${rowspan}">
              <input class="course-credits" inputmode="numeric" data-act="cCredits" data-idx="${termIdx}" data-cidx="${cIdx}"
                value="${escapeAttr(course.credits ?? "")}" placeholder="" />
            </td>
          ` : ""}

          <td>
            ${leftLabel}
            <input class="course-grade" inputmode="decimal"
              data-act="cGrade10"
              data-idx="${termIdx}"
              data-cidx="${cIdx}"
              data-aidx="${aIdx}"
              value="${escapeAttr(att.grade10 ?? "")}"
              placeholder="" />
          </td>

          <td class="nowrap">
            <span class="badge"
              data-out="letter"
              data-idx="${termIdx}" data-cidx="${cIdx}" data-aidx="${aIdx}">
              ${conv.letter}
            </span>
          </td>

          <td class="nowrap">
            <span data-out="gpa4"
              data-idx="${termIdx}" data-cidx="${cIdx}" data-aidx="${aIdx}">
              ${conv.gpa4 == null ? "—" : conv.gpa4.toFixed(1)}
            </span>
          </td>

          <td class="nowrap">
            <span class="badge ${evalv === "DAT" ? "ok" : (evalv === "HOCLAI" ? "danger" : "")}"
              data-out="eval"
              data-idx="${termIdx}" data-cidx="${cIdx}" data-aidx="${aIdx}">
              ${evalv}
            </span>
          </td>

          <td class="nowrap">
            ${aIdx === 0
              ? `<span data-out="note" data-idx="${termIdx}" data-cidx="${cIdx}">${actionCell}</span>`
              : actionCell
            }
          </td>

          ${aIdx === 0 ? `
            <td rowspan="${rowspan}">
              <button class="btn danger" data-act="delCourse" data-idx="${termIdx}" data-cidx="${cIdx}">Xóa</button>
            </td>
          ` : ""}
        </tr>
      `;
    }

    return attemptRows;
  }).join("");

  return `
    <table>
      <thead>
        <tr>
          <th>STT</th>
          <th>Tên môn</th>
          <th>Tín chỉ *</th>
          <th>Điểm hệ 10 *</th>
          <th>Điểm chữ</th>
          <th>Hệ 4</th>
          <th>Đánh giá</th>
          <th>Ghi chú</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="9" class="muted">Chưa có môn nào.</td></tr>`}
      </tbody>
    </table>
  `;
}

function calcTermTotals(term) {
  let S_all = 0, C_all = 0;
  let S_pass = 0, C_pass = 0;

  if (term.mode === "summary") {
    const g4 = parseDecimal2(term.summary.gpa4);
    const c = parseIntSafe(term.summary.credits) || 0;
    if (g4 != null && c > 0) {
      S_all += g4 * c; C_all += c;
      if (g4 >= 1) { S_pass += g4 * c; C_pass += c; }
    }
  } else {
    for (const course of term.courses) {
      ensureCourseShape(course);
      const cr = parseIntSafe(course.credits) || 0;
      const best = bestAttemptGpa4(course);
      if (best != null && cr > 0) {
        S_all += best * cr; C_all += cr;
        if (best >= 1) { S_pass += best * cr; C_pass += cr; }
      }
    }
  }

  return {
    C_all, C_pass,
    gpaAll: C_all > 0 ? (S_all / C_all) : 0,
    gpaPass: C_pass > 0 ? (S_pass / C_pass) : 0
  };
}

function renderTermSummary(term, idx) {
  const t = calcTermTotals(term);
  return `
    <div class="muted" style="margin-bottom:8px"><b>Tổng kết kỳ</b></div>
    <div class="grid4">
      <div><span class="muted">Tổng TC (đạt + không đạt):</span> <b id="tCAll-${idx}">${t.C_all}</b></div>
      <div><span class="muted">TC tích lũy (chỉ đạt):</span> <b id="tCPass-${idx}">${t.C_pass}</b></div>
      <div><span class="muted">TB hệ 4 (đạt + không đạt):</span> <b id="tGAll-${idx}">${t.gpaAll.toFixed(2)}</b></div>
      <div><span class="muted">TB tích lũy hệ 4 (chỉ đạt):</span> <b id="tGPass-${idx}">${t.gpaPass.toFixed(2)}</b></div>
    </div>
  `;
}

function updateOverviewAndNeed() {
  const totals = calcTotals(state.terms);
  const retakeCredits = calcRetakeCredits(state.terms);
  const unlearnedCredits = calcUnlearnedCredits(state.terms);

  $("creditsAll").textContent = String(totals.C_all);
  $("creditsPass").textContent = String(totals.C_pass);
  $("gpaAll").textContent = totals.gpaAll.toFixed(2);
  $("gpaPass").textContent = totals.gpaPass.toFixed(2);
  $("creditsRetake").textContent = String(retakeCredits);
  $("degree").textContent = degreeFromCgpa(totals.gpaPass);

  $("unlearnedCredits").textContent = String(unlearnedCredits);

  const S_cur = totals.S_pass;
  const C_cur = totals.C_pass;

  const target = Number($("target").value);
  const degName =
    target >= 3.6 ? "Xuất sắc" :
    target >= 3.2 ? "Giỏi" :
    target >= 2.5 ? "Khá" : "—";

  $("goalLine").textContent = `Mục tiêu của bạn là loại bằng: ${degName} (>= ${target.toFixed(2)})`;

  const needBox = $("needBox");

  if (unlearnedCredits <= 0) {
    $("need").textContent = "—";
    $("needNote").textContent = "Hãy tạo các kỳ chưa học (Nhập tổng kết kỳ), nhập tín chỉ và để trống GPA.";
    needBox.classList.remove("danger");
  } else {
    const need = (target * (C_cur + unlearnedCredits) - S_cur) / unlearnedCredits;
    const needClamped = clamp(need, 0, 4);
    $("need").textContent = needClamped.toFixed(2);

    if (need > 4) {
      $("needNote").textContent = `Để lấy được bằng ${degName}, các kỳ còn lại trung bình bạn phải đạt > 4.00 (không khả thi).`;
      needBox.classList.add("danger");
    } else {
      $("needNote").textContent = `Để lấy được bằng ${degName}, các kỳ học còn lại trung bình bạn phải đạt ${needClamped.toFixed(2)} (hệ 4).`;
      needBox.classList.remove("danger");
    }
  }

  // update tổng kết kỳ (cả khi bị ẩn vẫn update)
  state.terms.forEach((term, idx) => {
    if (term.mode !== "courses") return;
    const el = document.getElementById(`termSum-${idx}`);
    if (!el) return;

    const t = calcTermTotals(term);
    const a = document.getElementById(`tCAll-${idx}`);
    const p = document.getElementById(`tCPass-${idx}`);
    const gA = document.getElementById(`tGAll-${idx}`);
    const gP = document.getElementById(`tGPass-${idx}`);

    if (a) a.textContent = String(t.C_all);
    if (p) p.textContent = String(t.C_pass);
    if (gA) gA.textContent = t.gpaAll.toFixed(2);
    if (gP) gP.textContent = t.gpaPass.toFixed(2);
  });
}

// ===== Events =====
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const act = btn.dataset.act;

  if (btn.id === "addTerm") {
    if (state.terms.length >= 10) { alert("Tối đa 10 kỳ."); return; }
    state.terms.push({
      name: "",
      mode: "courses",
      collapsed: false, // ✅ NEW
      summary: { gpa4: "", credits: "" },
      courses: []
    });
    render();
    return;
  }

  if (btn.id === "reset") {
    if (confirm("Xóa toàn bộ dữ liệu đã lưu?")) {
      localStorage.removeItem(LS_KEY);
      state = loadState();
      render();
    }
    return;
  }

  if (act === "toggleTerm") {
    const idx = +btn.dataset.idx;
    const term = state.terms[idx];
    if (term && term.mode === "courses") {
      term.collapsed = !term.collapsed;
      render();
    }
    return;
  }

  if (act === "del") {
    const idx = +btn.dataset.idx;
    state.terms.splice(idx, 1);
    render();
    return;
  }

  if (act === "addCourse") {
    const idx = +btn.dataset.idx;
    state.terms[idx].courses.push({
      name: "",
      credits: "",
      attempts: [{ type: "main", grade10: "" }]
    });
    render();
    return;
  }

  if (act === "delCourse") {
    const idx = +btn.dataset.idx;
    const cidx = +btn.dataset.cidx;
    state.terms[idx].courses.splice(cidx, 1);
    render();
    return;
  }

  if (act === "addAttempt") {
    const idx = +btn.dataset.idx;
    const cidx = +btn.dataset.cidx;
    const kind = btn.dataset.kind;

    const course = state.terms[idx].courses[cidx];
    ensureCourseShape(course);
    if (course.attempts.length >= 2) return;

    course.attempts.push({ type: kind, grade10: "" });
    render();
    return;
  }

  if (act === "removeAttempt") {
    const idx = +btn.dataset.idx;
    const cidx = +btn.dataset.cidx;
    const aidx = +btn.dataset.aidx;

    const course = state.terms[idx].courses[cidx];
    ensureCourseShape(course);

    const ai = Number(aidx);
    if (ai > 0 && course.attempts.length > ai) {
      course.attempts.splice(ai, 1);
      render();
    }
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  const act = el.dataset.act;
  if (!act) return;

  const idx = +el.dataset.idx;

  if (act === "mode") {
    state.terms[idx].mode = el.value;
    // nếu chuyển sang summary thì không cần collapsed
    render();
    return;
  }

  if (act === "sumGpa4") {
    let fixed = normalizeTwoDecimals(el.value);
    const isTypingDot = fixed.endsWith(".");
    const n = parseDecimal2(fixed);

    if (n != null && !isTypingDot) {
      const clamped = clamp(n, 0, 4);
      fixed = normalizeTwoDecimals(String(clamped));
    }

    state.terms[idx].summary.gpa4 = fixed;
    el.value = fixed;

    updateOverviewAndNeed();
    saveState();
    return;
  }

  if (act === "sumCredits") {
    state.terms[idx].summary.credits = String(el.value ?? "").replace(/[^\d]/g, "");
    el.value = state.terms[idx].summary.credits;

    updateOverviewAndNeed();
    saveState();
    return;
  }

  if (act === "cName") {
    const cidx = +el.dataset.cidx;
    state.terms[idx].courses[cidx].name = el.value;
    saveState();
    return;
  }

  if (act === "cCredits") {
    const cidx = +el.dataset.cidx;
    state.terms[idx].courses[cidx].credits = String(el.value ?? "").replace(/[^\d]/g, "");
    el.value = state.terms[idx].courses[cidx].credits;

    updateOverviewAndNeed();
    saveState();
    return;
  }

  if (act === "cGrade10") {
    const cidx = +el.dataset.cidx;
    const aidx = +el.dataset.aidx;

    const fixed = normalizeOneDecimal(el.value);
    const course = state.terms[idx].courses[cidx];
    ensureCourseShape(course);

    course.attempts[aidx].grade10 = fixed;
    el.value = fixed;

    updateOverviewAndNeed();
    saveState();
    return;
  }
});

$("target").addEventListener("change", () => {
  updateOverviewAndNeed();
  saveState();
});

// Thu gọn / mở Hướng dẫn + lưu localStorage
const GUIDE_KEY = "study_tracker_guide_collapsed";
function setGuideCollapsed(collapsed) {
  const body = document.getElementById("guideBody");
  const btn = document.getElementById("toggleGuide");
  if (!body || !btn) return;

  body.style.display = collapsed ? "none" : "block";
  btn.textContent = collapsed ? "Mở ra" : "Thu gọn";
  localStorage.setItem(GUIDE_KEY, collapsed ? "1" : "0");
}
document.getElementById("toggleGuide")?.addEventListener("click", () => {
  const cur = localStorage.getItem(GUIDE_KEY) === "1";
  setGuideCollapsed(!cur);
});
setGuideCollapsed(localStorage.getItem(GUIDE_KEY) === "1");

// Init
render();
