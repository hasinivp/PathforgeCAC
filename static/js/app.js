/* Pathforge student demo — all interactive behavior runs in the browser.
   Data comes from /data/*.json through Flask. Progress is stored in localStorage.
   Sample listings, sponsor confirmation, and admin review are SIMULATED. */

document.documentElement.dataset.appReady = "1";
const STORAGE_KEY = "pathforge-demo-v2";
const GRADES = ["9", "10", "11", "12"];
const INTERESTS = ["Environmental Science", "Field Research", "Coding", "Statistics", "Problem Solving",
  "Patient Care", "Visual Arts", "Storytelling", "Infrastructure", "Teaching"];
const DEFAULT_STORE = { profile: null, goalId: null, saved: [], progress: {}, projects: [], skills: [], rsvps: {}, activeProjectId: null };

const data = { careers: [], opportunities: {}, quiz: null, pathways: {}, projects: {} };
const ui = {
  careerFilter: "All", careerQuery: "",
  quizIndex: 0, quizAnswers: {}, quizResult: null,
  opp: { q: "", level: "all", category: "all", eligibleOnly: false, nearZip: false, freeOnly: false },
  modalCareerId: null
};
let store = loadStore();

/* ---------- Helpers ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titleCase = (s) => String(s).replaceAll("-", " ").replace(/\b\w/g, (c) => c.toUpperCase());
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...clone(DEFAULT_STORE), ...(raw || {}) };
  } catch {
    return clone(DEFAULT_STORE);
  }
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    toast("This browser blocked storage, so changes will not be kept after you leave.");
  }
}
let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}
function gradeRange(text) {
  const nums = (String(text || "").match(/\d+/g) || []).map(Number);
  if (!nums.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}
function eligibleFor(range) {
  if (!range || !store.profile) return true;
  const g = Number(store.profile.grade);
  return g >= range[0] && g <= range[1];
}
function zipArea(zip) { return String(zip || "").slice(0, 3); }
function nearMyZip(zip) { return !!(store.profile && zip && zipArea(zip) === zipArea(store.profile.zip)); }
function careerById(id) { return data.careers.find((c) => c.id === id) || null; }
function currentGoal() { return careerById(store.goalId); }
function findSaved(id) { return store.saved.some((s) => s.id === id); }

/* ---------- Data loading ---------- */
async function loadData() {
  try {
    const [careers, opportunities, quiz, pathways, projects] = await Promise.all(
      ["careers", "opportunities", "quiz", "pathways", "projects"].map((n) => fetch(`/api/${n}`).then((r) => r.json()))
    );
    for (const item of [careers, opportunities, quiz, pathways, projects]) {
      if (item.error) throw new Error(item.error);
    }
    data.careers = Object.entries(careers).flatMap(([category, list]) => list.map((c) => ({ ...c, category, areas: c.areas || [] })));
    data.opportunities = opportunities;
    data.quiz = quiz;
    data.pathways = pathways;
    data.projects = projects;
    populateSelects();
    renderAll();
    renderKit();
  } catch (err) {
    $("#careerGrid").innerHTML = `<div class="empty-state">Could not load the demo data (${esc(err.message)}). Check that the files in the data folder are valid JSON.</div>`;
  }
}
function populateSelects() {
  const cats = [...new Set(buildOpportunities().filter((o) => o.source !== "student").map((o) => o.category))];
  $("#oppCategory").innerHTML = `<option value="all">All categories</option>` + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  $("#projectCategory").innerHTML = `<option value="">Choose one</option>` + data.projects.categories.map((c) => `<option>${esc(c)}</option>`).join("");
}

/* ---------- Opportunities ---------- */
function buildOpportunities() {
  const list = [];
  Object.entries(data.opportunities).forEach(([level, groups]) =>
    groups.forEach((group) =>
      Object.entries(group).forEach(([category, items]) =>
        items.forEach((item) => list.push({
          id: "opp-" + slug(item.name),
          name: item.name,
          level,
          category,
          link: item.link || "",
          ageGrade: item["age/grade"] || "Eligibility not listed",
          range: gradeRange(item["age/grade"]),
          location: item.location || "Location not listed",
          zip: item.zip || "",
          cost: item.cost || "Cost not listed",
          deadline: item.deadline || "",
          description: item.description || "",
          tags: item.tags || [],
          source: item.status === "sample" ? "sample" : "listed"
        }))
      )
    )
  );
  store.projects.filter((p) => p.adminApproved).forEach((p) => list.push({
    id: "proj-" + p.id,
    name: p.name,
    level: "Student-created",
    category: p.category,
    link: "",
    ageGrade: "Open to all students",
    range: null,
    location: p.zip ? `ZIP ${p.zip}` : "Location not set",
    zip: p.zip || "",
    cost: "Free (demo)",
    deadline: p.date || "",
    description: p.description,
    tags: data.projects.tagsByCategory[p.category] || [],
    source: "student",
    projectId: p.id
  }));
  return list;
}
function opportunityScore(opp) {
  if (!store.profile) return 0;
  const goalAreas = currentGoal()?.areas || [];
  const interestHits = opp.tags.filter((t) => goalAreas.includes(t)).length;
  return interestHits * 2 + (nearMyZip(opp.zip) ? 2 : 0) + (opp.range && eligibleFor(opp.range) ? 1 : 0);
}

/* ---------- Careers and recommendations ---------- */
function recommendedCareer() {
  if (currentGoal()) return currentGoal();
  if (!store.profile) return null;
  const scored = data.careers
    .map((c) => ({ c, n: c.interests.filter((i) => store.profile.interests.includes(i)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return scored[0]?.c || null;
}
function pathwayFor(career) {
  const grade = store.profile?.grade || "10";
  const tpl = data.pathways[career.id] || data.pathways.default;
  const lines = tpl[grade] || tpl["10"] || [];
  return lines.map((text, i) => ({ id: `${career.id}|${grade}|${i}`, text: text.replaceAll("{title}", career.title) }));
}
function stepStatus(id) { return store.progress[id] || "todo"; }
function pathPercent(steps) {
  if (!steps.length) return 0;
  return Math.round((steps.filter((s) => stepStatus(s.id) === "done").length / steps.length) * 100);
}

/* ---------- Quiz ---------- */
function scoreQuiz() {
  const counts = {};
  data.quiz.questions.forEach((q) => {
    const choice = q.choices.find((c) => c.id === ui.quizAnswers[q.id]);
    choice?.careerAreas.forEach((a) => (counts[a] = (counts[a] || 0) + 1));
  });
  const results = data.careers
    .map((career) => {
      const matched = career.areas.filter((a) => counts[a]).map((a) => [a, counts[a]]);
      // Average strength across the career's areas, so broad careers don't win just by listing more areas.
      const total = matched.reduce((s, [, n]) => s + n, 0);
      return { career, score: career.areas.length ? total / career.areas.length : 0, matched };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.career.title.localeCompare(b.career.title))
    .slice(0, 3);
  return { counts, results };
}
function renderQuiz() {
  const el = $("#quizArea");
  if (!data.quiz) return;
  if (ui.quizResult) return renderQuizResult(el);
  const qs = data.quiz.questions;
  const i = ui.quizIndex;
  const q = qs[i];
  const picked = ui.quizAnswers[q.id];
  el.innerHTML = `
    <div class="quiz-top">
      <div><p class="eyebrow">CAREER CHOICES QUIZ</p><h2>${esc(data.quiz.title)}</h2></div>
      <span class="progress-label">Question ${i + 1} of ${qs.length}</span>
    </div>
    <div class="progress-track"><div style="width:${((i + 1) / qs.length) * 100}%"></div></div>
    <p class="muted">${esc(data.quiz.description)}</p>
    <h3 class="quiz-question">${esc(q.question)}</h3>
    <div class="choice-list">
      ${q.choices.map((c) => `
        <button type="button" class="choice ${picked === c.id ? "selected" : ""}" data-action="quiz-pick" data-qid="${esc(q.id)}" data-choice="${esc(c.id)}" aria-pressed="${picked === c.id}">
          <span class="choice-dot"></span><span>${esc(c.text)}</span>
        </button>`).join("")}
    </div>
    <div class="quiz-actions">
      <button type="button" class="btn btn-outline" data-action="quiz-back" ${i === 0 ? "disabled" : ""}>← Back</button>
      <button type="button" class="btn btn-primary" data-action="quiz-next" ${picked ? "" : "disabled"}>${i === qs.length - 1 ? "See my results →" : "Continue →"}</button>
    </div>`;
}
function renderQuizResult(el) {
  const { results } = ui.quizResult;
  if (!results.length) {
    el.innerHTML = `<div class="empty-state">No matches yet. Try again or browse the career library.</div>`;
    return;
  }
  el.innerHTML = `
    <p class="eyebrow">YOUR STARTING POINTS</p>
    <h2>${esc(results[0].career.title)} is your strongest match.</h2>
    <p class="muted" style="margin-top:10px">${esc(data.quiz.resultsNote)}</p>
    <div class="result-list">
      ${results.map((r, idx) => `
        <article class="result-card ${idx === 0 ? "top" : ""}">
          <div>
            <span class="category-label">${idx === 0 ? "Top match" : "Also explore"}</span>
            <h3>${esc(r.career.title)}</h3>
            <p>${esc(r.career.description)}</p>
          </div>
          <div class="why"><strong>Why it matched:</strong>${r.matched.map(([a, n]) => `<span>${esc(titleCase(a))} · ${n}</span>`).join("")}</div>
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-action="set-goal" data-id="${esc(r.career.id)}">${store.goalId === r.career.id ? "Current goal ✓" : "Set as my goal"}</button>
            <button type="button" class="btn btn-outline btn-sm" data-action="open-career" data-id="${esc(r.career.id)}">View profile</button>
          </div>
        </article>`).join("")}
    </div>
    <div class="modal-actions" style="margin-top:4px">
      <button type="button" class="btn btn-outline" data-action="quiz-restart">Retake quiz</button>
      <button type="button" class="btn btn-navy" data-page="path">Build my pathway →</button>
    </div>`;
}

/* ---------- Render: career library ---------- */
function renderCareers() {
  const q = ui.careerQuery.trim().toLowerCase();
  const list = data.careers.filter((c) =>
    (ui.careerFilter === "All" || c.interests.includes(ui.careerFilter)) &&
    `${c.title} ${c.category} ${c.interests.join(" ")} ${c.description}`.toLowerCase().includes(q));
  $("#careerCount").textContent = `${list.length} career${list.length === 1 ? "" : "s"}`;
  $("#interestChips").innerHTML = ["All", ...INTERESTS].map((i) =>
    `<button type="button" class="chip ${ui.careerFilter === i ? "active" : ""}" data-action="career-filter" data-value="${esc(i)}">${esc(i)}</button>`).join("");
  const goalId = store.goalId;
  $("#careerGrid").innerHTML = list.length ? list.map((c) => `
    <article class="card career-card">
      <div class="card-head" style="margin:0">
        <span class="category-label">${esc(c.category)}</span>
        ${goalId === c.id ? `<span class="goal-tag">Your goal</span>` : ""}
      </div>
      <h3 style="margin:4px 0 0">${esc(c.title)}</h3>
      <p>${esc(c.description)}</p>
      <div class="tags">${c.interests.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      <div class="card-foot">
        <button type="button" class="text-action" data-action="open-career" data-id="${esc(c.id)}">View profile →</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="save-career" data-id="${esc(c.id)}">${findSaved("career-" + c.id) ? "In My Path ✓" : "+ My Path"}</button>
      </div>
    </article>`).join("") : `<div class="empty-state">No careers match that search. Try a broader interest.</div>`;
}

function openCareer(id) {
  const c = careerById(id);
  if (!c) return;
  ui.modalCareerId = id;
  const saved = findSaved("career-" + id);
  $("#careerBody").innerHTML = `
    <p class="eyebrow">CAREER PROFILE</p>
    <h2 id="careerTitle">${esc(c.title)}</h2>
    <span class="category-label">${esc(c.category)}</span>
    <p class="modal-desc">${esc(c.description)}</p>
    <p class="modal-section"><strong>Typical education:</strong> ${esc(c.education || "Not listed yet.")}</p>
    <p class="modal-section"><strong>Interests:</strong></p>
    <div class="chip-row" style="margin-top:6px">${c.interests.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
    <p class="muted small">Demo profile. Check current requirements with a school counselor or the program itself.</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" data-action="save-career" data-id="${esc(id)}">${saved ? "In My Path ✓" : "Add to My Path +"}</button>
      <button type="button" class="btn btn-navy" data-action="set-goal" data-id="${esc(id)}">${store.goalId === id ? "Current goal ✓" : "Set as my goal"}</button>
    </div>`;
  openModal("#careerModal");
}

function saveCareer(id) {
  const c = careerById(id);
  if (!c) return;
  const key = "career-" + id;
  if (findSaved(key)) { toast("Already in My Path."); return; }
  store.saved.push({ id: key, type: "Career", title: c.title, category: c.category, areas: c.areas, interests: c.interests });
  persist(); renderAll(); toast("Added to My Path.");
}
function setGoal(id) {
  const c = careerById(id);
  if (!c) return;
  store.goalId = id;
  persist(); renderAll();
  closeModals();
  toast(`Goal set: ${c.title}.`);
}

/* ---------- Render: opportunities ---------- */
function renderOpportunities() {
  const f = ui.opp;
  const q = f.q.trim().toLowerCase();
  const list = buildOpportunities()
    .filter((o) => !q || `${o.name} ${o.description} ${o.location} ${o.category}`.toLowerCase().includes(q))
    .filter((o) => f.level === "all" || o.level === f.level)
    .filter((o) => f.category === "all" || o.category === f.category)
    .filter((o) => !f.eligibleOnly || eligibleFor(o.range))
    .filter((o) => !f.nearZip || nearMyZip(o.zip))
    .filter((o) => !f.freeOnly || /free/i.test(o.cost))
    .sort((a, b) => opportunityScore(b) - opportunityScore(a));
  $("#oppCount").textContent = `${list.length} shown`;
  $("#opportunityGrid").innerHTML = list.length ? list.map(oppCard).join("") :
    `<div class="empty-state">No opportunities match these filters. Clear a filter, or create your own in Create.</div>`;
}
function oppCard(o) {
  const badge = o.source === "sample" ? `<span class="badge badge-sample">Sample</span>`
    : o.source === "student" ? `<span class="badge badge-student">Student-created · demo</span>`
    : `<span class="badge badge-listed">Official listing</span>`;
  const gradeWarn = o.range && !eligibleFor(o.range);
  const savedNow = findSaved(o.id);
  const rsvp = o.source === "student" ? `<button type="button" class="btn btn-outline btn-sm" data-action="rsvp" data-id="${esc(o.projectId)}">${store.rsvps[o.projectId] ? "RSVP'd (demo) ✓" : "RSVP (demo)"}</button>` : "";
  const link = o.link ? `<a class="btn btn-outline btn-sm" href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">Visit official page ↗</a>` : "";
  const match = store.profile && opportunityScore(o) >= 3 ? `<span class="match-note">Good match for your goal</span>` : "";
  return `
    <article class="card opp-card">
      <div class="opp-top"><h3>${esc(o.name)}</h3>${badge}</div>
      ${match}
      ${o.description ? `<p>${esc(o.description)}</p>` : ""}
      <div class="opp-meta">
        <span>${esc(o.category)}</span>
        <span class="${gradeWarn ? "warn" : ""}">${gradeWarn ? "Not listed for your grade" : esc(o.ageGrade)}</span>
        <span>${esc(o.location)}</span>
        <span>${esc(o.cost)}</span>
        ${o.deadline ? `<span>Deadline: ${esc(o.deadline)}</span>` : ""}
      </div>
      <div class="opp-actions">
        ${link}${rsvp}
        ${o.source === "student" ? "" : `<button type="button" class="btn btn-primary btn-sm" data-action="toggle-opp" data-id="${esc(o.id)}">${savedNow ? "Saved ✓ · Remove" : "Save to My Path +"}</button>`}
      </div>
    </article>`;
}
function toggleOpp(id) {
  const opp = buildOpportunities().find((o) => o.id === id);
  if (!opp) return;
  if (findSaved(id)) {
    store.saved = store.saved.filter((s) => s.id !== id);
    toast("Removed from My Path.");
  } else {
    store.saved.push({ id, type: "Opportunity", title: opp.name, category: opp.category, areas: opp.tags, source: opp.source });
    toast("Saved to My Path.");
  }
  persist(); renderAll();
}

/* ---------- Render: My Path ---------- */
function renderPath() {
  const goal = currentGoal();
  const suggested = goal || recommendedCareer();
  $("#pathCount").textContent = store.saved.length;

  $("#pathGoal").innerHTML = goal ? `
    <p class="eyebrow">CAREER GOAL</p>
    <div class="goal-title">${esc(goal.title)}</div>
    <p class="goal-desc">${esc(goal.description)}</p>
    <div class="card-actions" style="margin-top:14px">
      <button type="button" class="btn btn-outline btn-sm" data-page="discover" data-tab="quiz">Retake quiz</button>
      <button type="button" class="btn btn-outline btn-sm" data-action="open-career" data-id="${esc(goal.id)}">View profile</button>
    </div>` : `
    <p class="eyebrow">CAREER GOAL</p>
    <div class="empty-state" style="padding:22px">${suggested ? `No goal set yet. Based on your interests, <strong>${esc(suggested.title)}</strong> may be a starting point.` : "No goal set yet."}
      <div class="card-actions" style="justify-content:center;margin-top:12px">
        ${suggested ? `<button type="button" class="btn btn-primary btn-sm" data-action="set-goal" data-id="${esc(suggested.id)}">Use this goal</button>` : ""}
        <button type="button" class="btn btn-outline btn-sm" data-page="discover" data-tab="quiz">Take the quiz</button>
      </div></div>`;

  const steps = suggested ? pathwayFor(suggested) : [];
  const pct = pathPercent(steps);
  $("#pathRing").style.setProperty("--p", pct);
  $("#pathRing").querySelector("span").textContent = `${pct}%`;
  $("#pathTitle").textContent = suggested
    ? `${suggested.title}: Grade ${store.profile?.grade || "10"} steps`
    : "Your steps";
  $("#pathSteps").innerHTML = !store.profile
    ? `<div class="empty-state">Create your demo profile on Home to get steps for your grade.</div>`
    : !steps.length
      ? `<div class="empty-state">Set a goal to generate your pathway.</div>`
      : steps.map((s, i) => {
          const st = stepStatus(s.id);
          const label = st === "done" ? "Done ✓" : st === "doing" ? "In progress" : "Tap to start";
          return `
            <li class="road-step ${st}">
              <span class="road-node">${st === "done" ? "✓" : i + 1}</span>
              <button type="button" class="road-btn" data-action="cycle-step" data-id="${esc(s.id)}">${esc(s.text)}<small>${label}</small></button>
            </li>`;
        }).join("");

  $("#savedList").innerHTML = store.saved.length ? store.saved.map((s) => `
    <div class="saved-item">
      <div>
        <span class="category-label">${esc(s.type)}</span>
        <strong>${esc(s.title)}</strong>
        <p>${esc(s.category || "")}</p>
      </div>
      <button type="button" class="btn btn-sm btn-danger" data-action="remove-saved" data-id="${esc(s.id)}">Remove</button>
    </div>`).join("") : `<div class="empty-state">Nothing saved yet. Save careers or opportunities to build your roadmap.</div>`;
}
function cycleStep(id) {
  const order = ["todo", "doing", "done"];
  const next = order[(order.indexOf(stepStatus(id)) + 1) % order.length];
  store.progress[id] = next;
  persist(); renderAll();
  if (next === "done") toast("Step complete. Nice work.");
}

/* ---------- Render: Home ---------- */
function profileFormHTML(prefix) {
  return `
    <form class="${prefix === "home" ? "onboard-form" : "profile-form"}" data-form="profile" data-prefix="${prefix}">
      <label>Pseudonym (a nickname, not your real name)
        <input name="username" required maxlength="24" pattern="[A-Za-z0-9_]{3,24}" placeholder="e.g. Pathfinder_78664" value="${esc(store.profile?.username || "")}">
      </label>
      <div class="form-row">
        <label>Grade
          <select name="grade" required>
            ${GRADES.map((g) => `<option value="${g}" ${store.profile?.grade === g ? "selected" : ""}>${g}th grade</option>`).join("")}
          </select>
        </label>
        <label>ZIP code
          <input name="zip" required inputmode="numeric" pattern="\\d{5}" maxlength="5" placeholder="78664" value="${esc(store.profile?.zip || "")}">
        </label>
      </div>
      <label>Goals (in your own words)
        <textarea name="goals" rows="2" maxlength="200" placeholder="What do you want to learn or do?">${esc(store.profile?.goals || "")}</textarea>
      </label>
      <div>
        <p class="eyebrow" style="margin-bottom:8px">Interests (choose one or more)</p>
        <div class="interest-grid">
          ${INTERESTS.map((i) => `
            <label><input type="checkbox" name="interests" value="${esc(i)}" ${(store.profile?.interests || []).includes(i) ? "checked" : ""}><span class="pick">${esc(i)}</span></label>`).join("")}
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${store.profile ? "Save changes" : "Create demo profile →"}</button>
      </div>
      <p class="form-note">Simulated account for this demo. No email, name, or verification is collected.</p>
    </form>`;
}
function renderHome() {
  const el = $("#homeContent");
  if (!store.profile) {
    el.innerHTML = `
      <div class="card onboard">
        <div>
          <p class="eyebrow">STEP 1 · CREATE YOUR DEMO PROFILE</p>
          <h2>Tell us where you are starting from.</h2>
          <p class="muted" style="margin:8px 0 18px">Grade and ZIP shape your pathway and the opportunities you see. Nothing is sent anywhere.</p>
          ${profileFormHTML("home")}
        </div>
        <div>
          <p class="eyebrow">WHAT HAPPENS NEXT</p>
          <ol class="side-list">
            <li><span>1</span><div><strong>Take the quiz</strong>10 questions suggest careers to explore.</div></li>
            <li><span>2</span><div><strong>Get a grade-specific path</strong>Steps tailored to your grade and goal.</div></li>
            <li><span>3</span><div><strong>Find or create</strong>Save real and sample opportunities, or build one.</div></li>
          </ol>
        </div>
      </div>`;
    return;
  }
  const p = store.profile;
  const goal = currentGoal() || recommendedCareer();
  const steps = goal ? pathwayFor(goal) : [];
  const pct = pathPercent(steps);
  const next = steps.filter((s) => stepStatus(s.id) !== "done").slice(0, 3);
  const recs = buildOpportunities()
    .filter((o) => eligibleFor(o.range))
    .map((o) => ({ o, s: opportunityScore(o) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  const projectsDone = store.projects.filter((x) => x.completed).length;

  el.innerHTML = `
    <div class="dash-grid">
      <div class="card welcome dash-wide">
        <div>
          <p class="eyebrow">WELCOME BACK</p>
          <h2 style="color:#fff">Hi, ${esc(p.username)}.</h2>
          <p class="sub">Grade ${esc(p.grade)} · ZIP ${esc(p.zip)} · Goal: ${goal ? esc(goal.title) : "not set yet"}</p>
          <div class="card-actions" style="margin-top:6px">
            <button type="button" class="btn btn-light btn-sm" data-page="path">Open My Path</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="open-profile">Edit profile</button>
          </div>
        </div>
        <div class="ring" style="--p:${pct}"><span>${pct}%</span></div>
      </div>
      <div class="card">
        <p class="eyebrow">NEXT STEPS</p>
        <h2>Keep going.</h2>
        <ul class="mini-list" style="margin-top:14px">
          ${next.length ? next.map((s) => `<li><span>${esc(s.text)}</span></li>`).join("") : `<li><span>${goal ? "Every step is done for now. Nice work." : "Take the quiz to get your first steps."}</span></li>`}
        </ul>
        ${goal ? "" : `<button type="button" class="btn btn-primary full" data-page="discover" data-tab="quiz">Take the quiz →</button>`}
      </div>
      <div class="card">
        <p class="eyebrow">RECOMMENDED FOR YOU</p>
        <h2>Opportunities nearby and in reach.</h2>
        <ul class="mini-list" style="margin-top:14px">
          ${recs.length ? recs.map(({ o }) => `<li><div>${esc(o.name)}<small>${esc(o.location)} · ${esc(o.cost)}</small></div><button type="button" class="text-action" data-page="discover" data-tab="opportunities">View</button></li>`).join("")
            : `<li><span>No strong matches yet. Set a goal to get recommendations.</span></li>`}
        </ul>
      </div>
      <div class="card dash-wide soft" style="display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap">
        <div>
          <p class="eyebrow">NO LOCAL OPPORTUNITY?</p>
          <h2>Create the one you need.</h2>
          <p class="muted" style="margin-top:6px">${projectsDone ? `You have ${projectsDone} completed project${projectsDone === 1 ? "" : "s"}.` : "Build a workshop or event with a launch kit, sponsor step, and review."}</p>
        </div>
        <button type="button" class="btn btn-primary" data-page="create">Start a launch kit →</button>
      </div>
    </div>`;
}

/* ---------- Render: Create ---------- */
const PROJECT_FLOW = ["Draft created", "Sponsor confirmation", "Admin review", "Published", "Run & document"];
function projectStatus(p) {
  if (p.completed) return "Completed";
  if (p.adminApproved) return "Published";
  if (p.sponsorConfirmed) return "Review pending";
  return "Sponsor pending";
}
function verificationLabel(p) {
  if (p.adminApproved) return ["badge-verified", "Admin approved (simulated demo)"];
  if (p.sponsorConfirmed) return ["badge-verified", "Sponsor confirmed (simulated)"];
  return ["badge-neutral", "Self-reported"];
}
function kitFor(p) {
  const name = p.name || "[Project name]";
  const description = p.description || "[What you want to do]";
  const msg = data.projects.sponsorMessage
    .replaceAll("{sponsor}", p.sponsor || "[sponsor name]")
    .replaceAll("{name}", name)
    .replaceAll("{date}", p.date || "[date]")
    .replaceAll("{participants}", p.participants || "[number]")
    .replaceAll("{description}", description)
    .replaceAll("{student}", p.username || "[your pseudonym]");
  const notes = data.projects.categoryNotes[p.category] || [];
  return `
    <p class="eyebrow">LAUNCH KIT</p>
    <div class="kit-title">${esc(name)}</div>
    <div class="kit-meta">${esc(p.category || "No category")} · ${esc(p.date || "Date not set")} · ${esc(p.participants || "?")} participants${p.zip ? ` · ZIP ${esc(p.zip)}` : ""}</div>
    ${data.projects.phases.map((ph) => `
      <div class="phase"><strong>${esc(ph.title)}</strong><small>${esc(ph.weeks)}</small>
        <ul>${ph.tasks.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      </div>`).join("")}
    ${notes.length ? `<p class="eyebrow" style="margin-top:6px">Safety notes for this category</p><ul class="kit-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    <div class="kit-box">
      <strong>Sponsor request (draft)</strong>
      <p style="margin-top:8px">${esc(msg)}</p>
      <button type="button" class="btn btn-outline btn-sm" data-action="copy-text" data-text="${esc(msg)}">Copy message</button>
    </div>
    <p class="muted small">Outcomes to track: ${data.projects.outcomeSuggestions.map(esc).join("; ")}.</p>`;
}
function renderKit() {
  const el = $("#kitOutput");
  const p = store.projects.find((x) => x.id === store.activeProjectId);
  if (!p) return;
  el.innerHTML = kitFor(p);
}
function renderWorkflow() {
  const picker = $("#activeProject");
  picker.innerHTML = store.projects.length
    ? store.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === store.activeProjectId ? "selected" : ""}>${esc(p.name)}</option>`).join("")
    : `<option value="">No projects yet</option>`;
  picker.disabled = !store.projects.length;
  const p = store.projects.find((x) => x.id === store.activeProjectId);
  const el = $("#workflow");
  if (!p) {
    el.innerHTML = `<div class="empty-state">Save a draft above to start its workflow. Each step is simulated in this demo.</div>`;
    return;
  }
  const doneFlags = [true, !!p.sponsorConfirmed, !!p.adminApproved, !!p.adminApproved, !!p.completed];
  const currentIdx = doneFlags.findIndex((d) => !d);
  const actions = [
    "",
    p.sponsorConfirmed ? "" : `<button type="button" class="btn btn-outline btn-sm" data-action="sponsor-confirm" data-id="${esc(p.id)}">Simulate sponsor confirmation</button>`,
    p.adminApproved || !p.sponsorConfirmed ? "" : `<button type="button" class="btn btn-outline btn-sm" data-action="admin-approve" data-id="${esc(p.id)}">Simulate admin approval</button>`,
    "",
    p.adminApproved && !p.completed ? `<button type="button" class="btn btn-outline btn-sm" data-action="complete-project" data-id="${esc(p.id)}">Mark as run & completed</button>` : ""
  ];
  const notes = [
    "Saved in this browser.",
    "Demo: no one is contacted. The sponsor's reply is simulated.",
    "Demo: no real review takes place. Not a real authorization.",
    "Demo: appears in Discover as a student-created event. RSVPs are stored on this device only.",
    "Add hours and outcomes in your Portfolio."
  ];
  el.innerHTML = `
    <div class="wf-steps">
      ${PROJECT_FLOW.map((label, i) => {
        const cls = doneFlags[i] ? "done" : i === currentIdx ? "current" : "todo";
        return `
          <div class="wf-step ${cls}">
            <span class="wf-state">${doneFlags[i] ? "Complete" : i === currentIdx ? "Next" : "Upcoming"}</span>
            <strong>${i + 1}. ${esc(label)}</strong>
            <p>${esc(notes[i])}</p>
            ${i === currentIdx ? actions[i] : ""}
          </div>`;
      }).join("")}
    </div>
    <div class="status-line">
      <span class="badge badge-neutral">Status: ${esc(projectStatus(p))}</span>
      <span class="badge ${verificationLabel(p)[0]}">${esc(verificationLabel(p)[1])}</span>
      ${p.adminApproved && !p.completed ? `<span>Now visible in Discover as a student-created event (demo).</span>` : ""}
    </div>`;
}
function saveProject(form) {
  const f = Object.fromEntries(new FormData(form).entries());
  if (!f.name?.trim() || !f.description?.trim() || !f.category) {
    toast("Add a name, a description, and a category first.");
    return;
  }
  if (f.zip && !/^\d{5}$/.test(f.zip)) { toast("ZIP codes have five digits."); return; }
  const project = {
    id: `p${Date.now().toString(36)}`,
    name: f.name.trim(), description: f.description.trim(), category: f.category,
    date: f.date || "", participants: f.participants || "", zip: f.zip || "",
    sponsor: f.sponsor?.trim() || "", firstStep: f.firstStep?.trim() || "",
    username: store.profile?.username || "",
    createdAt: new Date().toLocaleDateString(),
    sponsorConfirmed: false, adminApproved: false, completed: false,
    hours: 0, outcome: "", photosNote: ""
  };
  store.projects.unshift(project);
  store.activeProjectId = project.id;
  persist();
  form.reset();
  $("#kitOutput").innerHTML = kitFor(project);
  renderAll();
  toast("Draft saved. Next: sponsor confirmation.");
}
function loadDemo() {
  const form = $("#projectForm");
  const d = data.projects.demoExample;
  ["name", "description", "category", "date", "participants", "sponsor", "firstStep", "zip"].forEach((k) => {
    if (form.elements[k]) form.elements[k].value = d[k] ?? "";
  });
  toast("Demo example loaded. Generate the kit or save the draft.");
}
function generateKit() {
  const form = $("#projectForm");
  const f = Object.fromEntries(new FormData(form).entries());
  if (!f.name?.trim() || !f.category) { toast("Add a name and category to generate the kit."); return; }
  $("#kitOutput").innerHTML = kitFor({ ...f, username: store.profile?.username || "" });
  $("#kitOutput").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- Render: Portfolio ---------- */
function allSkills() {
  const set = new Set(store.skills);
  const goal = currentGoal();
  (goal?.interests || []).forEach((i) => set.add(i));
  store.saved.filter((s) => s.type === "Career").forEach((s) => (s.interests || []).forEach((i) => set.add(i)));
  return [...set];
}
function renderPortfolio() {
  const hours = store.projects.reduce((s, p) => s + Number(p.hours || 0), 0);
  const completed = store.projects.filter((p) => p.completed).length;
  $("#portfolioStats").innerHTML = `
    <div class="stat"><strong>${store.projects.length}</strong><small>Projects created</small></div>
    <div class="stat"><strong>${hours}</strong><small>Hours logged (self-reported)</small></div>
    <div class="stat"><strong>${completed}</strong><small>Completed projects</small></div>
    <div class="stat"><strong>${store.saved.length}</strong><small>Saved path items</small></div>`;
  const skills = allSkills();
  $("#skillChips").innerHTML = skills.length ? skills.map((s) => `<span class="tag">${esc(s)}</span>`).join("") : `<span class="muted">Save a career or add a skill to start.</span>`;

  $("#projectList").innerHTML = `
    <div class="card-head" style="margin-bottom:14px">
      <div><p class="eyebrow">EXPERIENCE LOG</p><h2>Your projects</h2></div>
    </div>
    <div class="proj-list">
    ${store.projects.length ? store.projects.map((p) => {
      const [vcls, vtxt] = verificationLabel(p);
      return `
        <article class="project-card">
          <div class="row"><span class="category-label">${esc(projectStatus(p))}</span><span class="badge ${vcls}">${esc(vtxt)}</span></div>
          <h3>${esc(p.name)}</h3>
          <div class="meta"><span>${esc(p.category)}</span><span>·</span><span>${esc(p.date || "Date not set")}</span>${p.zip ? `<span>· ZIP ${esc(p.zip)}</span>` : ""}${p.sponsor ? `<span>· Sponsor: ${esc(p.sponsor)}</span>` : ""}</div>
          <p class="hours-line">Hours logged: <strong>${Number(p.hours || 0)}</strong></p>
          ${p.outcome ? `<div class="outcome-text"><strong>Outcome:</strong> ${esc(p.outcome)}</div>` : ""}
          <form class="inline-form compact" data-form="hours" data-id="${esc(p.id)}">
            <input name="hours" type="number" min="0.5" max="200" step="0.5" placeholder="Add hours" aria-label="Hours to add" required>
            <button class="btn btn-outline btn-sm" type="submit">Log hours</button>
          </form>
          <form class="inline-form" data-form="outcome" data-id="${esc(p.id)}">
            <input name="outcome" maxlength="240" placeholder="What changed? e.g. 25 students tested water samples" aria-label="Outcome">
            <button class="btn btn-outline btn-sm" type="submit">Save outcome</button>
          </form>
          <div class="row" style="justify-content:space-between">
            <button type="button" class="text-action" data-action="set-active" data-id="${esc(p.id)}">Open workflow →</button>
            <button type="button" class="btn btn-sm btn-danger" data-action="delete-project" data-id="${esc(p.id)}">Delete</button>
          </div>
        </article>`;
    }).join("") : `<div class="empty-state">Your projects will appear here after you save a draft in Create.</div>`}
    </div>
    <p class="verify-note" style="margin-top:14px">Hours and outcomes are self-reported. “Sponsor confirmed” and “Admin approved” are simulated for this demo and are not third-party verification.</p>`;
}

/* ---------- Modals ---------- */
function openModal(sel) { const m = $(sel); m.classList.add("open"); m.setAttribute("aria-hidden", "false"); }
function closeModals() { $$(".modal-backdrop").forEach((m) => { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); }); }
function openProfile() {
  $("#profileModalBody").innerHTML = profileFormHTML("modal") +
    (store.profile ? `<div class="modal-actions"><button type="button" class="btn btn-danger" data-action="reset-demo">Reset all demo data</button></div>` : "");
  openModal("#profileModal");
}
function saveProfile(form) {
  const f = new FormData(form);
  const username = (f.get("username") || "").toString().trim();
  const zip = (f.get("zip") || "").toString().trim();
  const grade = (f.get("grade") || "").toString();
  const interests = f.getAll("interests").map(String);
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) { toast("Use 3–24 letters, numbers, or underscores for your pseudonym."); return; }
  if (!/^\d{5}$/.test(zip)) { toast("Enter a five-digit ZIP code."); return; }
  if (!GRADES.includes(grade)) { toast("Choose a grade from 9 to 12."); return; }
  if (!interests.length) { toast("Pick at least one interest."); return; }
  store.profile = { username, zip, grade, goals: (f.get("goals") || "").toString().trim(), interests };
  persist();
  closeModals();
  renderAll();
  toast(`Profile saved. Welcome, ${username}.`);
}

/* ---------- Export ---------- */
function exportJson() {
  const goal = currentGoal();
  const payload = {
    exportedAt: new Date().toISOString(),
    note: "Self-reported demo data stored in this browser. Sponsor and admin steps are simulated.",
    student: store.profile ? { username: store.profile.username, grade: store.profile.grade, zip: store.profile.zip, interests: store.profile.interests } : null,
    careerGoal: goal ? goal.title : null,
    pathwayProgress: store.progress,
    savedItems: store.saved,
    skills: allSkills(),
    projects: store.projects
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "pathforge-portfolio.json"; a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Navigation ---------- */
function currentTab() {
  return document.querySelector("[data-action='tab'].active")?.dataset.value || "careers";
}
function syncNav() {
  const page = document.querySelector(".page.active")?.id.replace("page-", "") || "home";
  const tab = currentTab();
  $$(".nav-link").forEach((b) => {
    const want = b.dataset.tab || "careers";
    const on = b.dataset.page === page && (page !== "discover" || want === tab || (want === "careers" && tab === "quiz"));
    b.classList.toggle("active", on);
  });
}
function showPage(name) {
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${name}`));
  syncNav();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "portfolio") renderPortfolio();
}
function showTab(name) {
  $$("[data-action='tab']").forEach((b) => { b.classList.toggle("active", b.dataset.value === name); b.setAttribute("aria-selected", b.dataset.value === name); });
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  if (name === "quiz" && !ui.quizResult) renderQuiz();
  syncNav();
}

/* ---------- Render all ---------- */
function renderAll() {
  renderHome();
  renderCareers();
  renderQuiz();
  renderOpportunities();
  renderPath();
  renderWorkflow();
  renderPortfolio();
  $("#profileButton").textContent = store.profile ? `@${store.profile.username}` : "Set up profile";
}

/* ---------- Event handling (delegated) ---------- */
function handleAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case "tab": showTab(el.dataset.value); break;
    case "career-filter": ui.careerFilter = el.dataset.value; renderCareers(); break;
    case "open-career": openCareer(id); break;
    case "save-career": saveCareer(id); break;
    case "set-goal": setGoal(id); break;
    case "quiz-pick": ui.quizAnswers[el.dataset.qid] = el.dataset.choice; renderQuiz(); break;
    case "quiz-back": if (ui.quizIndex > 0) { ui.quizIndex--; renderQuiz(); } break;
    case "quiz-next": {
      const q = data.quiz.questions[ui.quizIndex];
      if (!ui.quizAnswers[q.id]) return;
      if (ui.quizIndex < data.quiz.questions.length - 1) { ui.quizIndex++; renderQuiz(); }
      else { ui.quizResult = scoreQuiz(); renderQuiz(); }
      break;
    }
    case "quiz-restart": ui.quizAnswers = {}; ui.quizIndex = 0; ui.quizResult = null; renderQuiz(); break;
    case "toggle-opp": toggleOpp(id); break;
    case "remove-saved": store.saved = store.saved.filter((s) => s.id !== id); persist(); renderAll(); toast("Removed from My Path."); break;
    case "cycle-step": cycleStep(id); break;
    case "rsvp":
      store.rsvps[id] = !store.rsvps[id];
      persist(); renderAll();
      toast(store.rsvps[id] ? "RSVP saved on this device (demo)." : "RSVP removed.");
      break;
    case "open-profile": openProfile(); break;
    case "close-modal": closeModals(); break;
    case "reset-demo":
      if (!window.confirm("Reset all demo data in this browser? This cannot be undone.")) return;
      store = clone(DEFAULT_STORE);
      persist(); ui.quizAnswers = {}; ui.quizIndex = 0; ui.quizResult = null;
      closeModals(); renderAll(); showPage("home"); toast("Demo data reset.");
      break;
    case "load-demo": loadDemo(); break;
    case "generate-kit": generateKit(); break;
    case "copy-text":
      navigator.clipboard?.writeText(el.dataset.text).then(() => toast("Message copied."), () => toast("Copy was blocked by the browser."));
      break;
    case "sponsor-confirm":
      updateProject(id, (p) => { p.sponsorConfirmed = true; });
      toast("Simulated: sponsor confirmed. No one was contacted.");
      break;
    case "admin-approve":
      updateProject(id, (p) => { p.adminApproved = true; });
      toast("Simulated: admin approved. Now visible in Discover as a demo event.");
      break;
    case "complete-project":
      updateProject(id, (p) => { p.completed = true; });
      toast("Marked completed. Log your hours and outcomes in Portfolio.");
      break;
    case "set-active": store.activeProjectId = id; persist(); renderAll(); renderKit(); showPage("create"); break;
    case "delete-project":
      if (!window.confirm("Delete this project draft from this browser?")) return;
      store.projects = store.projects.filter((p) => p.id !== id);
      if (store.activeProjectId === id) store.activeProjectId = store.projects[0]?.id || null;
      persist(); renderAll(); toast("Project deleted.");
      break;
    case "export-json": exportJson(); break;
    case "print-pdf": window.print(); break;
  }
}
function updateProject(id, fn) {
  const p = store.projects.find((x) => x.id === id);
  if (!p) return;
  fn(p);
  persist(); renderAll();
}

document.addEventListener("click", (e) => {
  const pageEl = e.target.closest("[data-page]");
  if (pageEl) {
    e.preventDefault();
    showPage(pageEl.dataset.page);
    if (pageEl.dataset.page === "discover") showTab(pageEl.dataset.tab || "careers");
    else if (pageEl.dataset.tab) showTab(pageEl.dataset.tab);
    return;
  }
  const actionEl = e.target.closest("[data-action]");
  if (actionEl && !actionEl.disabled) {
    if (actionEl.tagName === "A") e.preventDefault();
    handleAction(actionEl.dataset.action, actionEl);
  }
  if (e.target.classList.contains("modal-backdrop")) closeModals();
});

document.addEventListener("submit", (e) => {
  const form = e.target;
  if (!form.dataset.form) return;
  e.preventDefault();
  switch (form.dataset.form) {
    case "profile": saveProfile(form); break;
    case "project": saveProject(form); break;
    case "hours": {
      const hours = Number(new FormData(form).get("hours"));
      if (!(hours > 0)) return;
      updateProject(form.dataset.id, (p) => { p.hours = Number(p.hours || 0) + hours; });
      toast(`Logged ${hours} hour${hours === 1 ? "" : "s"}.`);
      break;
    }
    case "outcome": {
      const text = (new FormData(form).get("outcome") || "").toString().trim();
      if (!text) return;
      updateProject(form.dataset.id, (p) => { p.outcome = text; });
      toast("Outcome saved.");
      break;
    }
    case "skill": {
      const skill = (new FormData(form).get("skill") || "").toString().trim();
      if (!skill) return;
      if (!store.skills.includes(skill)) store.skills.push(skill);
      persist(); form.reset(); renderAll(); toast("Skill added.");
      break;
    }
  }
});

function onFilterInput(e) {
  const t = e.target;
  if (t.dataset.filter === "career-search") { ui.careerQuery = t.value; renderCareers(); }
  if (t.dataset.oppFilter) {
    const key = t.dataset.oppFilter;
    ui.opp[key] = t.type === "checkbox" ? t.checked : t.value;
    renderOpportunities();
  }
  if (t.dataset.select === "active-project") {
    store.activeProjectId = t.value; persist(); renderAll();
  }
}
document.addEventListener("input", onFilterInput);
document.addEventListener("change", onFilterInput);

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });

loadData();
