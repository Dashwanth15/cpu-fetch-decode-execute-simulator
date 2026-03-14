"""
main.py — Flask server for the COA CPU Simulator Web Interface
Run:  python main.py
Opens: http://127.0.0.1:5000  in your default browser automatically.
"""

import os
import sys
import webbrowser
import threading
from pathlib import Path

# ── ensure backend/ is on the path ──────────────────────────────────────────
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "backend"))

from flask import Flask, jsonify, request, send_from_directory
from cpu_engine import PROGRAMS, run_program, run_custom
from performance_analyzer import compute as compute_performance

# ── Flask app ────────────────────────────────────────────────────────────────
# NOTE: static_folder=None disables Flask's built-in static-file catch-all route
# (which was registering /<path:filename> for GET only and blocking our POST
# routes with 405). Static files are served explicitly below instead.
FRONTEND = ROOT / "frontend"
app = Flask(__name__, static_folder=None)


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main HTML page."""
    return send_from_directory(str(FRONTEND), "index.html")


# Serve static assets by explicit sub-path prefix.
# Using named prefixes (css/, js/) instead of a catch-all /<path:filename>
# prevents Werkzeug from matching POST /api/* requests here (which would
# return 405 since static routes only accept GET).
@app.route("/css/<path:filename>")
def static_css(filename):
    return send_from_directory(str(FRONTEND / "css"), filename)


@app.route("/js/<path:filename>")
def static_js(filename):
    return send_from_directory(str(FRONTEND / "js"), filename)


@app.route("/fonts/<path:filename>")
def static_fonts(filename):
    return send_from_directory(str(FRONTEND / "fonts"), filename)


@app.route("/api/programs", methods=["GET"])
def list_programs():
    """Return the list of built-in programs."""
    result = []
    for key, fn in PROGRAMS.items():
        spec = fn()
        result.append({
            "key"        : key,
            "name"       : spec["name"],
            "description": spec["description"],
            "expected"   : spec["expected"],
        })
    return jsonify(result)


@app.route("/api/simulate", methods=["POST"])
def simulate():
    """
    Run the selected program and return the full simulation trace.
    Body JSON: { "program": "sum5" }
    """
    body = request.get_json(force=True, silent=True) or {}
    prog_key = body.get("program", "sum5")

    if prog_key not in PROGRAMS:
        return jsonify({"error": f"Unknown program '{prog_key}'"}), 400

    try:
        result = run_program(prog_key)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/performance", methods=["POST"])
def performance():
    """
    Compute performance metrics for a simulation run.
    Accepts the same body as /api/simulate or /api/custom:
      { "type": "program", "program": "sum5" }
      { "type": "custom",  "a": 7, "b": 3, "op": "ADD" }
    Returns structured performance metrics without re-running simulation
    if trace data is passed directly via { "trace": [...] }.
    """
    body = request.get_json(force=True, silent=True) or {}
    sim_type = body.get("type", "program")

    try:
        if sim_type == "custom":
            a  = int(body.get("a", 0))
            b  = int(body.get("b", 0))
            op = str(body.get("op", "ADD")).upper().strip()
            result = run_custom(a, b, op)
        else:
            prog_key = body.get("program", "sum5")
            if prog_key not in PROGRAMS:
                return jsonify({"error": f"Unknown program '{prog_key}'"}), 400
            result = run_program(prog_key)

        # Compute performance metrics from the trace produced by the simulation
        trace   = result.get("trace", [])
        metrics = compute_performance(trace)

        # Attach contextual info for the frontend
        metrics["program_name"] = result.get("program_name", "")
        metrics["halted"]       = result.get("halted", False)
        return jsonify(metrics)

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/custom", methods=["POST"])
def custom_op():
    """
    Run a custom arithmetic operation through the full CPU simulator.
    Body JSON: { "a": 7, "b": 3, "op": "MUL" }
    Returns same trace structure as /api/simulate plus result/result_hex/result_bin/error.
    """
    body = request.get_json(force=True, silent=True) or {}
    try:
        a  = int(body.get("a", 0))
        b  = int(body.get("b", 0))
        op = str(body.get("op", "ADD")).upper().strip()
    except (TypeError, ValueError) as e:
        return jsonify({"error": f"Invalid input: {e}"}), 400

    if not (0 <= a <= 65535) or not (0 <= b <= 65535):
        return jsonify({"error": "A and B must be in range 0–65535."}), 400
    if op not in ("ADD", "SUB", "MUL", "DIV"):
        return jsonify({"error": "Operation must be ADD, SUB, MUL, or DIV."}), 400

    try:
        result = run_custom(a, b, op)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ── Launch ───────────────────────────────────────────────────────────────────

def open_browser():
    webbrowser.open("http://127.0.0.1:5000")


if __name__ == "__main__":
    # Open browser 1.5 s after server starts (gives Flask time to bind)
    threading.Timer(1.5, open_browser).start()
    print("=" * 60)
    print("  COA CPU Simulator — Web Interface")
    print("  Server  : http://127.0.0.1:5000")
    print("  Press   : Ctrl+C to stop")
    print("=" * 60)
    app.run(host="127.0.0.1", port=5000, debug=False)
