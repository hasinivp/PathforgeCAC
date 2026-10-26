import json
from pathlib import Path

from flask import Flask, jsonify, render_template

app = Flask(__name__)
ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

# Only these JSON files are served to the frontend.
ALLOWED_DATA = {"careers", "opportunities", "quiz", "pathways", "projects"}


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/<name>")
def get_data(name):
    if name not in ALLOWED_DATA:
        return jsonify({"error": "Not found"}), 404
    file_path = DATA / f"{name}.json"
    if not file_path.is_file():
        return jsonify({"error": f"{name}.json was not found"}), 404
    try:
        return jsonify(json.loads(file_path.read_text(encoding="utf-8")))
    except json.JSONDecodeError as exc:
        return jsonify({"error": f"{name}.json contains invalid JSON", "details": str(exc)}), 500


@app.route("/api/health")
def health():
    return jsonify({"status": "healthy", "app": "Pathforge"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
