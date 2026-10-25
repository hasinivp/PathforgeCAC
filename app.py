import json
from flask import Flask, render_template
from pathlib import Path

app = Flask(__name__)
careers_file = Path("data") / "careers.json"

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/health", methods=["GET"])
def health_check():
    return {"status": "healthy",
            "app":"Pathforge"}

@app.route("/api/careers")
def careers():
    
    if careers_file.is_file():
        with open(careers_file) as f:
            careers_data = json.load(f)
        return careers_data
    else:
        return {"error": "Careers data not found."}, 404

@app.route("/api/careers/<career_id>", methods=["GET"])
def career_detail(career_id):
    if careers_file.is_file():
        with open(careers_file) as f:
            careers_data = json.load(f)
    else:
        return {"error": "Careers data not found."}, 404
    for category, career_list in careers_data.items():
        career = next(
            (c for c in career_list if c["id"] == career_id),
            None
        )

        if career is not None:
            return career

    return {"error": "Career not found."}, 404

if(__name__ == "__main__"):
    app.run(debug=True)