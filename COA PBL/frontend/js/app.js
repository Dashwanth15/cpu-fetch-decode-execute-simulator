/**
 * app.js — COA CPU Simulator UI Controller
 *
 * Responsibilities:
 *  1. Fetch program list from /api/programs
 *  2. Run simulation via /api/simulate → receive full trace
 *  3. Step-through / auto-play the trace (cycle by cycle)
 *  4. Update the register file panel on every step
 *  5. Render the memory grid, highlight AR address
 *  6. Color-code signals, phases, and register changes
 */

"use strict";

// ── State ────────────────────────────────────────────────────────────────────
const state = {
    programs: [],
    selectedProgram: null,
    trace: [],          // full cycle array from API
    currentIdx: -1,          // which cycle is showing
    playTimer: null,
    isPlaying: false,
    simResult: null,        // full API response
    prevRegs: null,        // for flash-on-change
};

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
    programList: $("program-list"),
    programDesc: $("program-desc"),
    btnRun: $("btn-run"),
    statsBar: $("stats-bar"),
    playbackBar: $("playback-bar"),
    cycleDisplay: $("cycle-display"),
    emptyState: $("empty-state"),
    loadingOvl: $("loading-overlay"),

    // stats
    statCycles: $("stat-cycles"),
    statInstrs: $("stat-instrs"),
    statResult: $("stat-result"),
    statStatus: $("stat-status"),

    // playback
    btnFirst: $("btn-first"),
    btnPrev: $("btn-prev"),
    btnNext: $("btn-next"),
    btnLast: $("btn-last"),
    btnPlay: $("btn-play"),
    slider: $("cycle-slider"),
    lblCurrent: $("lbl-current"),
    lblTotal: $("lbl-total"),
    speedSelect: $("speed-select"),

    // registers (right panel)
    regPC: $("r-PC"),
    regIR: $("r-IR"),
    regAR: $("r-AR"),
    regDR: $("r-DR"),
    regAC: $("r-AC"),
    regTR: $("r-TR"),
    regZ: $("r-Z"),
    flagZ: $("flag-Z"),

    memGrid: $("mem-grid"),
    memNonZero: $("mem-nonzero"),
    memHighlight: $("mem-highlight"),
};

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    loadPrograms();
    bindButtons();
});

// ── API: Load programs ────────────────────────────────────────────────────────
async function loadPrograms() {
    try {
        const res = await fetch("/api/programs");
        const list = await res.json();
        state.programs = list;
        renderProgramList(list);
    } catch (e) {
        el.programList.innerHTML = `<p style="color:var(--red);font-size:.8rem">Failed to load programs: ${e.message}</p>`;
    }
}

// ── API: Run simulation ───────────────────────────────────────────────────────
async function runSimulation() {
    if (!state.selectedProgram) return;
    showLoading(true);
    try {
        const res = await fetch("/api/simulate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ program: state.selectedProgram }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        state.simResult = data;
        state.trace = data.trace;
        initViewer(data);
        // ── Performance Analysis hook (does NOT touch simulation logic) ──
        PerformanceAnalysis.update({ type: "program", program: state.selectedProgram });
    } catch (e) {
        alert("Simulation error: " + e.message);
    } finally {
        showLoading(false);
    }
}

// ── Render program list ───────────────────────────────────────────────────────
function renderProgramList(list) {
    el.programList.innerHTML = list.map(p => `
    <div class="prog-item" data-key="${p.key}" id="prog-${p.key}">
      <span class="prog-name">${p.name}</span>
      <span class="prog-expected">${p.expected}</span>
    </div>
  `).join("");

    el.programList.querySelectorAll(".prog-item").forEach(item => {
        item.addEventListener("click", () => selectProgram(item.dataset.key));
    });

    // Auto-select first
    if (list.length > 0) selectProgram(list[0].key);
}

function selectProgram(key) {
    state.selectedProgram = key;
    el.programList.querySelectorAll(".prog-item").forEach(i => i.classList.remove("active"));
    const item = document.getElementById(`prog-${key}`);
    if (item) item.classList.add("active");
    const prog = state.programs.find(p => p.key === key);
    if (prog) el.programDesc.textContent = prog.description;
    el.btnRun.disabled = false;

    // Reset viewer if switching program
    stopPlay();
    state.trace = []; state.currentIdx = -1;
}

// ── Viewer init ───────────────────────────────────────────────────────────────
function initViewer(data) {
    // Stats bar
    el.statsBar.style.display = "grid";
    el.playbackBar.style.display = "flex";
    el.statCycles.textContent = data.total_cycles;
    el.statInstrs.textContent = data.total_instructions;
    el.statResult.textContent = `AC = 0x${data.final_AC.toString(16).toUpperCase().padStart(4, "0")}`;
    el.statStatus.textContent = data.halted ? "HALTED ✓" : "MAX CYCLES";
    el.statStatus.style.color = data.halted ? "var(--green)" : "var(--red)";

    // Slider
    const total = data.trace.length;
    el.slider.max = total - 1;
    el.slider.value = 0;
    el.lblTotal.textContent = total;

    // Initial memory render
    renderMemory(data.trace[0].mem_snapshot, data.trace[0].registers.AR, data.data_labels || {});

    // Go to cycle 0
    state.currentIdx = 0;
    state.prevRegs = null;
    showCycle(0);
}

// ── Show cycle ────────────────────────────────────────────────────────────────
function showCycle(idx) {
    const total = state.trace.length;
    if (idx < 0 || idx >= total) return;
    state.currentIdx = idx;

    const c = state.trace[idx];

    // Update slider + labels
    el.slider.value = idx;
    el.lblCurrent.textContent = idx + 1;

    // Render the main cycle card
    el.cycleDisplay.innerHTML = buildCycleCard(c, idx);

    // Update right-panel register file
    updateRegFile(c.registers);

    // Update memory
    if (state.simResult) {
        renderMemory(c.mem_snapshot, c.registers.AR, state.simResult.data_labels || {});
    }

    state.prevRegs = { ...c.registers };
}

// ── Build cycle card HTML ─────────────────────────────────────────────────────
function buildCycleCard(c, idx) {
    const prev = idx > 0 ? state.trace[idx - 1].registers : null;

    // Phase class
    const phaseKey = c.phase.replace(/\s+/g, "-").replace(/[()]/g, "");
    const phaseCls = `phase-${phaseKey}`;

    // Instruction-boundary indicator
    const instrFirst = idx === 0 || state.trace[idx - 1].instr_num !== c.instr_num;
    const instrHeader = instrFirst
        ? `<div style="font-size:.72rem;color:var(--text-3);padding:10px 20px 0;
         border-top:${idx > 0 ? '1px solid var(--border)' : ''};letter-spacing:.5px;">
         ▸ INSTRUCTION CYCLE #${String(c.instr_num).padStart(3, "0")}
           &nbsp;(PC at start: ${c.start_pc}h)
       </div>` : "";

    // Mini registers in card
    const regs = c.registers;
    const miniRegs = [
        { n: "PC", v: `${regs.PC}h` },
        { n: "AR", v: `${regs.AR}h` },
        { n: "IR", v: `${regs.IR}h` },
        { n: "AC", v: `${regs.AC}` },
        { n: "DR", v: `${regs.DR}` },
        { n: "TR", v: `${regs.TR}` },
        { n: "Z", v: regs.Z },
    ].map(r => {
        const changed = prev && prev[r.n] !== regs[r.n];
        const zOk = r.n === "Z";
        return `<div class="mini-reg${changed ? " changed" : ""}">
      <div class="mr-name">${r.n}</div>
      <div class="mr-val${zOk && regs.Z ? " mr-z" : ""}">${r.v}</div>
    </div>`;
    }).join("");

    // RTL formatted (highlight arrows)
    const rtlHtml = c.rtl
        .replace(/<-/g, '<span class="rk">&larr;</span>')
        .replace(/M\[AR\]/g, '<span class="rv">M[AR]</span>')
        .replace(/\bAC\b/g, '<span class="rv">AC</span>')
        .replace(/\bDR\b/g, '<span class="rv">DR</span>')
        .replace(/\bPC\b/g, '<span class="rv">PC</span>')
        .replace(/\bIR\b/g, '<span class="rv">IR</span>')
        .replace(/\bAR\b/g, '<span class="rv">AR</span>');

    return `${instrHeader}
  <div class="clock-card">
    <div class="clock-header">
      <div>
        <div style="font-size:.68rem;color:var(--text-3);letter-spacing:.5px;margin-bottom:2px;">CLOCK CYCLE</div>
        <div class="clock-num">#${c.clock}</div>
      </div>
      <div class="clock-meta">
        <span class="phase-pill ${phaseCls}">${c.phase}</span>
        <span class="instr-badge">Instr #${c.instr_num}</span>
      </div>
    </div>

    <div class="rtl-block">
      <div class="rtl-label">RTL Micro-Operation</div>
      <div>
        <span class="t-state">${c.t_label}</span>
        <span class="rtl-expr">${rtlHtml}</span>
      </div>
    </div>

    <div class="signals-block">
      <div class="signals-label">Control Signals Activated</div>
      <div class="signals-wrap">
        ${c.signals.map(s => `<span class="sig-badge ${sigClass(s)}">${s}</span>`).join("")}
      </div>
    </div>

    <div class="card-regs">${miniRegs}</div>
  </div>`;
}

function sigClass(s) {
    if (!s) return "sig-nop";
    const su = s.toUpperCase();
    if (su.startsWith("PC")) return "sig-pc";
    if (su.startsWith("MEM")) return "sig-mem";
    if (su.startsWith("IR")) return "sig-ir";
    if (su.startsWith("ALU")) return "sig-alu";
    if (su.startsWith("AC")) return "sig-ac";
    if (su.startsWith("DR")) return "sig-dr";
    if (su === "HALT") return "sig-halt";
    if (su === "NOP") return "sig-nop";
    return "sig-mem";
}

// ── Register file (right panel) ───────────────────────────────────────────────
function updateRegFile(regs) {
    function setRow(rowEl, hexVal, binVal, changed) {
        const rv = rowEl.querySelector(".rv");
        const rb = rowEl.querySelector(".rb");
        if (rv) rv.textContent = hexVal;
        if (rb) rb.textContent = binVal;
        if (changed) {
            rowEl.classList.remove("flash");
            void rowEl.offsetWidth; // reflow
            rowEl.classList.add("flash");
        } else { rowEl.classList.remove("flash"); }
    }

    const prev = state.prevRegs;
    const ch = k => prev && prev[k] !== regs[k];

    // PC 12-bit
    const pcBin = parseInt(regs.PC, 16).toString(2).padStart(12, "0");
    setRow(el.regPC, regs.PC + "h", pcBin, ch("PC"));

    // IR 16-bit binary
    setRow(el.regIR, regs.IR + "h", regs.IR_binary, ch("IR"));

    // AR 12-bit
    const arBin = parseInt(regs.AR, 16).toString(2).padStart(12, "0");
    setRow(el.regAR, regs.AR + "h", arBin, ch("AR"));

    // DR 16-bit
    const drBin = regs.DR.toString(2).padStart(16, "0");
    setRow(el.regDR, regs.DR_hex + "h", drBin, ch("DR"));

    // AC 16-bit
    const acBin = regs.AC.toString(2).padStart(16, "0");
    setRow(el.regAC, regs.AC_hex + "h", acBin, ch("AC"));

    // TR 16-bit
    const trBin = regs.TR.toString(2).padStart(16, "0");
    setRow(el.regTR, regs.TR_hex + "h", trBin, ch("TR"));

    // Z
    const zv = el.flagZ;
    if (zv) {
        zv.textContent = regs.Z;
        zv.classList.toggle("on", regs.Z === 1);
        if (ch("Z")) { el.regZ.classList.remove("flash"); void el.regZ.offsetWidth; el.regZ.classList.add("flash"); }
        else el.regZ.classList.remove("flash");
    }
}

// ── Memory panel ──────────────────────────────────────────────────────────────
function renderMemory(mem, arHex, dataLabels) {
    const nonZeroOnly = el.memNonZero.checked;
    const hlAr = el.memHighlight.checked;
    const arAddr = parseInt(arHex, 16);

    // Program addresses (0x000-0x00F), data section
    const rows = [];
    for (let i = 0; i < mem.length; i++) {
        const val = mem[i];
        if (nonZeroOnly && val === 0) continue;

        const addrHex = i.toString(16).toUpperCase().padStart(3, "0");
        const valHex = val.toString(16).toUpperCase().padStart(4, "0");
        const valBin = val.toString(2).padStart(16, "0");
        const isProgram = i <= 0x00F;
        const labelKey = addrHex.toLowerCase();
        const label = dataLabels[labelKey] || "";
        const isAR = hlAr && i === arAddr;

        let rowCls = "mem-row";
        if (isAR) rowCls += " mem-ar";
        else if (isProgram) rowCls += " mem-program";
        else if (val !== 0) rowCls += " mem-data";

        rows.push(`
      <div class="${rowCls}" title="Address ${addrHex}h = ${valBin}">
        <span class="mem-addr">${addrHex}h</span>
        <span class="mem-hex">${valHex}</span>
        <span class="mem-bin${label ? " mem-label" : ""}">${label || valBin.slice(0, 8) + " " + valBin.slice(8)}</span>
      </div>`);
    }
    el.memGrid.innerHTML = rows.join("") || `<p class="mem-empty">All zero.</p>`;
}

// ── Playback controls ─────────────────────────────────────────────────────────
function bindButtons() {
    el.btnRun.addEventListener("click", runSimulation);
    el.btnFirst.addEventListener("click", () => { stopPlay(); showCycle(0); });
    el.btnPrev.addEventListener("click", () => { stopPlay(); showCycle(state.currentIdx - 1); });
    el.btnNext.addEventListener("click", () => { stopPlay(); showCycle(state.currentIdx + 1); });
    el.btnLast.addEventListener("click", () => { stopPlay(); showCycle(state.trace.length - 1); });
    el.btnPlay.addEventListener("click", togglePlay);

    el.slider.addEventListener("input", () => {
        stopPlay();
        showCycle(parseInt(el.slider.value));
    });

    el.memNonZero.addEventListener("change", refreshMemory);
    el.memHighlight.addEventListener("change", refreshMemory);

    // Keyboard shortcuts
    document.addEventListener("keydown", e => {
        if (state.trace.length === 0) return;
        if (e.key === "ArrowRight" || e.key === "d") { stopPlay(); showCycle(state.currentIdx + 1); }
        if (e.key === "ArrowLeft" || e.key === "a") { stopPlay(); showCycle(state.currentIdx - 1); }
        if (e.key === " ") { e.preventDefault(); togglePlay(); }
        if (e.key === "Home") { stopPlay(); showCycle(0); }
        if (e.key === "End") { stopPlay(); showCycle(state.trace.length - 1); }
    });
}

function togglePlay() {
    if (state.isPlaying) { stopPlay(); return; }
    if (state.currentIdx >= state.trace.length - 1) showCycle(0);
    el.btnPlay.textContent = "⏸";
    el.btnPlay.classList.add("playing");
    state.isPlaying = true;
    stepAuto();
}

function stopPlay() {
    clearTimeout(state.playTimer);
    state.isPlaying = false;
    el.btnPlay.textContent = "▶▶";
    el.btnPlay.classList.remove("playing");
}

function stepAuto() {
    if (!state.isPlaying) return;
    const next = state.currentIdx + 1;
    if (next >= state.trace.length) { stopPlay(); return; }
    showCycle(next);
    const delay = parseInt(el.speedSelect.value) || 500;
    state.playTimer = setTimeout(stepAuto, delay);
}

function refreshMemory() {
    if (!state.simResult || state.currentIdx < 0) return;
    const c = state.trace[state.currentIdx];
    renderMemory(c.mem_snapshot, c.registers.AR, state.simResult.data_labels || {});
}

// ── Loading overlay ───────────────────────────────────────────────────────────
function showLoading(show) {
    el.loadingOvl.style.display = show ? "flex" : "none";
}


// ═════════════════════════════════════════════════════════════════════════════
// CUSTOM ARITHMETIC OPERATION
// Calls POST /api/custom → { a, b, op }  and feeds the trace into the
// existing Fetch-Decode-Execute viewer (initViewer / showCycle unchanged).
// ═════════════════════════════════════════════════════════════════════════════

// ── Custom panel DOM refs ─────────────────────────────────────────────────────
const cEl = {
    inputA: document.getElementById("input-a"),
    inputB: document.getElementById("input-b"),
    toggleGroup: document.getElementById("op-toggle-group"),
    algoBadge: document.getElementById("algo-badge"),
    btnRun: document.getElementById("btn-run-custom"),
    result: document.getElementById("custom-result"),
    resHex: document.getElementById("res-hex"),
    resBin: document.getElementById("res-bin"),
    resMem: document.getElementById("res-mem"),
    errBox: document.getElementById("custom-error"),
    errMsg: document.getElementById("custom-error-msg"),
};

// ── Algorithm descriptions shown per operation ────────────────────────────────
const ALGO_TEXT = {
    ADD: "CLEAR → LOAD A → ADD B → STORE RESULT → HALT",
    SUB: "CLEAR → LOAD A → SUB B → STORE RESULT → HALT",
    MUL: "RESULT=0, COUNTER=B  |  Loop: RESULT+=A, COUNTER-=1, BIZ exit  |  HALT",
    DIV: "RESULT=0, TEMP=A, COUNTER=⌊A/B⌋+1  |  Loop: COUNTER-=1, BIZ exit, RESULT+=1, TEMP-=B  |  HALT",
};

// Current selected operation (default ADD)
let selectedOp = "ADD";

// ── Operation toggle handler ──────────────────────────────────────────────────
function selectOp(op) {
    selectedOp = op;

    // Update toggle button active state
    cEl.toggleGroup.querySelectorAll(".op-toggle").forEach(btn => {
        btn.classList.remove("active");
    });
    const activeBtn = document.getElementById(`op-${op}`);
    if (activeBtn) activeBtn.classList.add("active");

    // Update algorithm info
    if (cEl.algoBadge) cEl.algoBadge.textContent = ALGO_TEXT[op] || "";

    // Clear previous results when switching operation
    hideCustomResult();
}

// ── Hide result / error areas ─────────────────────────────────────────────────
function hideCustomResult() {
    if (cEl.result) cEl.result.style.display = "none";
    if (cEl.errBox) cEl.errBox.style.display = "none";
}

// ── Show result ───────────────────────────────────────────────────────────────
function showCustomResult(data) {
    hideCustomResult();

    if (data.error) {
        // Division by zero or other fatal error
        if (cEl.errMsg) cEl.errMsg.textContent = data.error;
        if (cEl.errBox) cEl.errBox.style.display = "flex";
        return;
    }

    // Populate result fields
    if (cEl.resHex) cEl.resHex.textContent = data.result_hex || "----";
    if (cEl.resBin) cEl.resBin.textContent = data.result_bin || "---- ---- ---- ----";
    if (cEl.resMem) cEl.resMem.textContent =
        (data.result !== null && data.result !== undefined)
            ? data.result.toString(10) + "  (0x" + data.result.toString(16).toUpperCase().padStart(4, "0") + ")"
            : "—";

    if (cEl.result) cEl.result.style.display = "flex";
}

// ── Stats bar update for custom ops ──────────────────────────────────────────
function updateStatsForCustom(data) {
    el.statsBar.style.display = "grid";

    el.statCycles.textContent = data.total_cycles || 0;
    el.statInstrs.textContent = data.total_instructions || 0;

    if (data.error) {
        el.statResult.textContent = "ERROR";
        el.statResult.classList.add("stat-result-custom");
        el.statStatus.textContent = "DIV/0 ✗";
        el.statStatus.style.color = "var(--red)";
    } else {
        const hexStr = data.result_hex || "----";
        el.statResult.textContent = `${selectedOp}: ${hexStr}`;
        el.statResult.classList.add("stat-result-custom");
        el.statStatus.textContent = data.halted ? "HALTED ✓" : "MAX CYCLES";
        el.statStatus.style.color = data.halted ? "var(--green)" : "var(--red)";
    }
}

// ── Main: Run custom arithmetic operation ────────────────────────────────────
async function runCustomOp() {
    // Read and validate inputs
    const aRaw = parseInt(cEl.inputA.value, 10);
    const bRaw = parseInt(cEl.inputB.value, 10);

    if (isNaN(aRaw) || aRaw < 0 || aRaw > 65535) {
        cEl.inputA.focus();
        alert("Operand A must be a whole number between 0 and 65535.");
        return;
    }
    if (isNaN(bRaw) || bRaw < 0 || bRaw > 65535) {
        cEl.inputB.focus();
        alert("Operand B must be a whole number between 0 and 65535.");
        return;
    }

    // Special-case: warn about large MUL (many loop iterations → slow)
    if (selectedOp === "MUL" && aRaw * bRaw > 60000) {
        const ok = confirm(
            `MUL ${aRaw} × ${bRaw} will run ${bRaw} loop iterations and may produce a truncated 16-bit result.\nContinue?`
        );
        if (!ok) return;
    }

    showLoading(true);
    hideCustomResult();

    // De-select any built-in program highlight so the viewer switches context
    state.selectedProgram = null;
    el.programList.querySelectorAll(".prog-item").forEach(i => i.classList.remove("active"));

    try {
        const res = await fetch("/api/custom", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ a: aRaw, b: bRaw, op: selectedOp }),
        });
        const data = await res.json();

        // Show result badges in the custom panel
        showCustomResult(data);

        // Update the stats bar
        updateStatsForCustom(data);

        if (data.error) {
            // Div-by-zero: no trace to show, but still display loading cleared
            el.playbackBar.style.display = "none";
            el.cycleDisplay.innerHTML = `
              <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <h3>Division by Zero</h3>
                <p>${data.error}</p>
                <p style="margin-top:8px;font-size:.75rem;color:var(--text-3)">
                  CPU halted immediately — no instruction cycles executed.
                </p>
              </div>`;
            return;
        }

        // Feed the trace into the existing viewer
        // Attach data_labels so memory panel labels 030h-035h correctly
        data.data_labels = data.data_labels || {
            "030": "A (operand)",
            "031": "B (operand)",
            "032": "RESULT",
            "033": "COUNTER",
            "034": "TEMP",
            "035": "ONE (const)",
        };

        state.simResult = data;
        state.trace = data.trace || [];
        stopPlay();
        initViewer(data);
        // ── Performance Analysis hook (does NOT touch simulation logic) ──
        PerformanceAnalysis.update({ type: "custom", a: aRaw, b: bRaw, op: selectedOp });

    } catch (e) {
        alert("Custom operation error: " + e.message);
    } finally {
        showLoading(false);
    }
}

// ── Wire up custom panel events ───────────────────────────────────────────────
(function initCustomPanel() {
    // Operation toggle buttons
    if (cEl.toggleGroup) {
        cEl.toggleGroup.querySelectorAll(".op-toggle").forEach(btn => {
            btn.addEventListener("click", () => selectOp(btn.dataset.op));
        });
    }

    // Run button
    if (cEl.btnRun) {
        cEl.btnRun.addEventListener("click", runCustomOp);
    }

    // Enter key in either input field triggers run
    [cEl.inputA, cEl.inputB].forEach(inp => {
        if (inp) inp.addEventListener("keydown", e => {
            if (e.key === "Enter") runCustomOp();
        });
    });

    // Set initial algorithm text
    selectOp("ADD");
})();

