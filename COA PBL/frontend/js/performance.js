/**
 * performance.js — COA CPU Simulator · Performance Analysis Module
 * ─────────────────────────────────────────────────────────────────
 * STANDALONE MODULE: Does NOT modify any existing app.js code.
 * Exposes a single public function: PerformanceAnalysis.update(params)
 * Called from app.js after a simulation finishes (two one-liner additions).
 *
 * Charts powered by Chart.js (loaded via CDN in index.html)
 *   A. Bar Chart   — Instruction index vs total cycles per instruction
 *   B. Pie Chart   — Fetch / Decode / Execute cycle percentage
 *   C. Line Chart  — Instruction execution timeline (cumulative cycles)
 */

"use strict";

const PerformanceAnalysis = (() => {
    // ── Chart instances (kept for hot-update / destroy-and-recreate) ──────────
    let barChart = null;
    let pieChart = null;
    let lineChart = null;

    // ── Last params (so we can refresh when tab first opens) ──────────────────
    let _lastParams = null;
    let _lastMetrics = null;

    // ── Color palette — vivid neon/jewel tones for dark backgrounds ──────────
    const COLORS = {
        fetch: { fill: "rgba(0,   212, 255, 0.75)", border: "#00d4ff" },   // electric cyan
        decode: { fill: "rgba(187,  64, 255, 0.72)", border: "#bb40ff" },   // vivid violet
        execute: { fill: "rgba(16,  217, 140, 0.72)", border: "#10d98c" },   // neon mint
        bar: { fill: "rgba(251, 191,  36, 0.80)", border: "#fbbf24" },   // amber gold
        line: { fill: "rgba(249,  82,  82, 0.85)", border: "#f95252" },   // coral red
    };

    // Shared Chart.js defaults — deep dark canvas
    const CHART_DEFAULTS = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: "easeOutQuart" },
        plugins: {
            legend: {
                labels: {
                    color: "#e2e8f0",
                    font: { family: "JetBrains Mono, monospace", size: 12 },
                    boxWidth: 14,
                    padding: 16,
                    usePointStyle: true,
                }
            },
            tooltip: {
                backgroundColor: "rgba(5, 5, 18, 0.97)",
                titleColor: "#e2e8f0",
                bodyColor: "#94a3b8",
                borderColor: "rgba(255,255,255,0.12)",
                borderWidth: 1,
                padding: 10,
                cornerRadius: 8,
            }
        },
        scales: {
            x: {
                ticks: { color: "#64748b", font: { family: "JetBrains Mono, monospace", size: 11 } },
                grid: { color: "rgba(255,255,255,0.04)", drawBorder: false },
            },
            y: {
                ticks: { color: "#64748b", font: { family: "JetBrains Mono, monospace", size: 11 } },
                grid: { color: "rgba(255,255,255,0.06)", drawBorder: false },
                beginAtZero: true,
            }
        }
    };


    // ── DOM helpers ───────────────────────────────────────────────────────────
    const $ = id => document.getElementById(id);

    function setText(id, val) {
        const el = $(id);
        if (el) el.textContent = val;
    }

    function animateValue(id, newVal, suffix = "") {
        const el = $(id);
        if (!el) return;
        el.classList.remove("metric-pulse");
        void el.offsetWidth;   // reflow to restart animation
        el.textContent = newVal + suffix;
        el.classList.add("metric-pulse");
    }

    // ── Public entry-point ────────────────────────────────────────────────────

    /**
     * update(params) — fetch metrics from /api/performance and redraw charts.
     * @param {Object} params  { type: "program", program: "sum5" }
     *                      OR { type: "custom",  a, b, op }
     */
    async function update(params) {
        _lastParams = params;
        showPerfLoading(true);
        // Show a notification badge on the Performance tab
        showTabBadge(true);

        try {
            const res = await fetch("/api/performance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params),
            });
            const data = await res.json();
            if (data.error) { console.warn("Performance API error:", data.error); return; }

            _lastMetrics = data;
            renderMetrics(data);
            renderCharts(data);

        } catch (e) {
            console.error("Performance analysis failed:", e);
        } finally {
            showPerfLoading(false);
        }
    }

    // ── Render metric cards ───────────────────────────────────────────────────
    function renderMetrics(data) {
        animateValue("perf-total-instrs", data.total_instructions);
        animateValue("perf-total-cycles", data.total_cycles);
        animateValue("perf-cpi", data.cpi.toFixed(2));
        animateValue("perf-throughput", data.throughput.toFixed(3));

        const bd = data.cycle_breakdown || {};
        animateValue("perf-fetch-count", bd.fetch ?? 0);
        animateValue("perf-decode-count", bd.decode ?? 0);
        animateValue("perf-exec-count", bd.execute ?? 0);

        const pct = data.cycle_breakdown_pct || {};
        setText("perf-fetch-pct", (pct.fetch ?? 0) + "%");
        setText("perf-decode-pct", (pct.decode ?? 0) + "%");
        setText("perf-exec-pct", (pct.execute ?? 0) + "%");

        // Animate stage progress bars (width driven by percentage)
        setBarWidth("fetch-bar-fill", pct.fetch ?? 0);
        setBarWidth("decode-bar-fill", pct.decode ?? 0);
        setBarWidth("exec-bar-fill", pct.execute ?? 0);

        // Halted badge
        const badge = $("perf-status-badge");
        if (badge) {
            badge.textContent = data.halted ? "HALTED ✓" : "RUNNING";
            badge.className = "perf-status-badge " + (data.halted ? "badge-ok" : "badge-warn");
            badge.style.display = "";
        }

        // Program name label
        setText("perf-prog-name", data.program_name || "");
    }

    function setBarWidth(id, pct) {
        const el = $(id);
        if (!el) return;
        // Brief delay so the CSS transition fires visually
        requestAnimationFrame(() => { el.style.width = Math.min(100, pct) + "%"; });
    }

    // ── Render / update all 3 charts ──────────────────────────────────────────
    function renderCharts(data) {
        const details = data.instruction_details || [];

        renderBarChart(data, details);
        renderPieChart(data);
        renderLineChart(data, details);
    }

    // ── A. Bar Chart: per-instruction cycle breakdown ─────────────────────────
    function renderBarChart(data, details) {
        const canvas = $("chart-bar");
        if (!canvas || !window.Chart) return;

        const labels = details.map(d => `I#${d.instr_num}`);
        const fetchD = details.map(d => d.fetch_cycles);
        const decodeD = details.map(d => d.decode_cycles);
        const executeD = details.map(d => d.execute_cycles);

        const config = {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "Fetch Cycles",
                        data: fetchD,
                        backgroundColor: COLORS.fetch.fill,
                        borderColor: COLORS.fetch.border,
                        borderWidth: 2,
                        borderRadius: 5,
                    },
                    {
                        label: "Decode Cycles",
                        data: decodeD,
                        backgroundColor: COLORS.decode.fill,
                        borderColor: COLORS.decode.border,
                        borderWidth: 2,
                        borderRadius: 5,
                    },
                    {
                        label: "Execute Cycles",
                        data: executeD,
                        backgroundColor: COLORS.execute.fill,
                        borderColor: COLORS.execute.border,
                        borderWidth: 2,
                        borderRadius: 5,
                    },
                ]
            },
            options: {
                ...deepClone(CHART_DEFAULTS),
                plugins: {
                    ...deepClone(CHART_DEFAULTS).plugins,
                    title: {
                        display: true,
                        text: "Cycles per Instruction — Stage Breakdown",
                        color: "#e2e8f0",
                        font: { size: 13, weight: "600" },
                        padding: { bottom: 12 },
                    }
                },
                scales: {
                    x: { ...deepClone(CHART_DEFAULTS).scales.x, stacked: true },
                    y: {
                        ...deepClone(CHART_DEFAULTS).scales.y, stacked: true,
                        title: { display: true, text: "Clock Cycles", color: "#64748b" }
                    }
                }
            }
        };

        if (barChart) { barChart.destroy(); barChart = null; }
        barChart = new Chart(canvas, config);
    }

    // ── B. Pie Chart: % of cycles in each stage ───────────────────────────────
    function renderPieChart(data) {
        const canvas = $("chart-pie");
        if (!canvas || !window.Chart) return;

        const bd = data.cycle_breakdown || {};
        const pct = data.cycle_breakdown_pct || {};

        const config = {
            type: "doughnut",
            data: {
                labels: ["Fetch", "Decode", "Execute"],
                datasets: [{
                    data: [bd.fetch ?? 0, bd.decode ?? 0, bd.execute ?? 0],
                    backgroundColor: [COLORS.fetch.fill, COLORS.decode.fill, COLORS.execute.fill],
                    borderColor: ["#0a0a12", "#0a0a12", "#0a0a12"],
                    borderWidth: 4,
                    hoverOffset: 14,
                }]
            },
            options: {
                ...deepClone(CHART_DEFAULTS),
                cutout: "55%",
                scales: {},    // no axes on doughnut
                plugins: {
                    legend: {
                        position: "bottom",
                        labels: {
                            color: "#e2e8f0",
                            font: { family: "JetBrains Mono, monospace", size: 12 },
                            padding: 16,
                            usePointStyle: true,
                        }
                    },
                    title: {
                        display: true,
                        text: "Cycle Distribution by Pipeline Stage",
                        color: "#e2e8f0",
                        font: { size: 13, weight: "600" },
                        padding: { bottom: 12 },
                    },
                    tooltip: {
                        ...deepClone(CHART_DEFAULTS).plugins.tooltip,
                        callbacks: {
                            label: ctx => {
                                const keys = ["fetch", "decode", "execute"];
                                const key = keys[ctx.dataIndex];
                                return ` ${ctx.label}: ${ctx.raw} cycles (${pct[key] ?? 0}%)`;
                            }
                        }
                    }
                }
            }
        };

        if (pieChart) { pieChart.destroy(); pieChart = null; }
        pieChart = new Chart(canvas, config);
    }

    // ── C. Line Chart: instruction execution timeline ─────────────────────────
    function renderLineChart(data, details) {
        const canvas = $("chart-line");
        if (!canvas || !window.Chart) return;

        // X-axis: instruction index; Y-axis: clock cycle at which that instruction ends
        const labels = details.map(d => `Instr #${d.instr_num}`);
        const endCycles = details.map(d => d.end_cycle);
        const totalCycles = details.map(d => d.total_cycles);

        const config = {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        label: "Cumulative Clock Cycle",
                        data: endCycles,
                        borderColor: COLORS.line.border,
                        backgroundColor: "rgba(249, 82, 82, 0.12)",
                        pointBackgroundColor: COLORS.line.border,
                        pointRadius: 5,
                        pointHoverRadius: 9,
                        tension: 0.35,
                        fill: true,
                        yAxisID: "yLeft",
                    },
                    {
                        label: "Cycles This Instruction",
                        data: totalCycles,
                        borderColor: COLORS.bar.border,
                        backgroundColor: "rgba(251, 191, 36, 0.10)",
                        pointBackgroundColor: COLORS.bar.border,
                        pointRadius: 4,
                        pointHoverRadius: 8,
                        tension: 0.25,
                        fill: false,
                        borderDash: [5, 3],
                        yAxisID: "yRight",
                    }
                ]
            },
            options: {
                ...deepClone(CHART_DEFAULTS),
                interaction: { mode: "index", intersect: false },
                plugins: {
                    ...deepClone(CHART_DEFAULTS).plugins,
                    title: {
                        display: true,
                        text: "Instruction Execution Timeline vs Clock Cycles",
                        color: "#e2e8f0",
                        font: { size: 13, weight: "600" },
                        padding: { bottom: 12 },
                    }
                },
                scales: {
                    x: {
                        ...deepClone(CHART_DEFAULTS).scales.x,
                        title: { display: true, text: "Instruction", color: "#a6adc8" }
                    },
                    yLeft: {
                        position: "left",
                        ticks: { color: COLORS.line.border, font: { family: "JetBrains Mono, monospace", size: 11 } },
                        grid: { color: "rgba(255,255,255,0.05)", drawBorder: false },
                        beginAtZero: true,
                        title: { display: true, text: "Cumulative Cycle", color: COLORS.line.border }
                    },
                    yRight: {
                        position: "right",
                        ticks: { color: COLORS.bar.border, font: { family: "JetBrains Mono, monospace", size: 11 } },
                        grid: { drawOnChartArea: false },
                        beginAtZero: true,
                        title: { display: true, text: "Cycles / Instr", color: COLORS.bar.border }
                    }
                }
            }
        };

        if (lineChart) { lineChart.destroy(); lineChart = null; }
        lineChart = new Chart(canvas, config);
    }

    // ── UI helpers ────────────────────────────────────────────────────────────
    function showPerfLoading(show) {
        const el = $("perf-loading");
        if (el) el.style.display = show ? "flex" : "none";
        const body = $("perf-body");
        if (body) body.style.opacity = show ? "0.3" : "1";
    }

    function showTabBadge(show) {
        const badge = $("tab-perf-badge");
        if (badge) badge.style.display = show ? "inline-block" : "none";
    }

    // ── Tab switching ─────────────────────────────────────────────────────────
    function initTabs() {
        const btnSim = $("tab-btn-sim");
        const btnPerf = $("tab-btn-perf");
        const panelSim = $("panel-simulator");
        const panelPerf = $("panel-performance");

        function activateTab(which) {
            const isPerf = (which === "perf");
            if (btnSim) btnSim.classList.toggle("active", !isPerf);
            if (btnPerf) btnPerf.classList.toggle("active", isPerf);
            if (panelSim) panelSim.style.display = isPerf ? "none" : "";
            if (panelPerf) panelPerf.style.display = isPerf ? "" : "none";

            // When switching to perf tab, force chart resize (needed if charts were
            // drawn while the tab was hidden → Chart.js width/height can be 0)
            if (isPerf) {
                showTabBadge(false);
                setTimeout(() => {
                    [barChart, pieChart, lineChart].forEach(c => c && c.resize());
                }, 50);
            }
        }

        if (btnSim) btnSim.addEventListener("click", () => activateTab("sim"));
        if (btnPerf) btnPerf.addEventListener("click", () => activateTab("perf"));
    }

    // ── Deep-clone helper (safe copy for Chart.js config reuse) ──────────────
    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    document.addEventListener("DOMContentLoaded", () => {
        initTabs();
    });

    // ── Public API ────────────────────────────────────────────────────────────
    return { update };

})();  // end IIFE → PerformanceAnalysis
