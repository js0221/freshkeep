/* =======================================================
   냉장고 지킴이 - 음식물 쓰레기 감소앱
   데이터는 localStorage에 저장되어 새로고침해도 유지됩니다.
======================================================= */

/* =======================================================
   [AI 레시피 설정]
   아래 따옴표 사이에 Google AI Studio에서 받은 키를 붙여넣으세요.
   예: const GEMINI_API_KEY = "AIzaSyx...";
   키가 없으면 AI 버튼은 안내 메시지만 뜨고, 기본 레시피는 그대로 작동합니다.
======================================================= */
const GEMINI_API_KEY = "";              // ← 여기에 키를 붙여넣기
const GEMINI_MODEL = "gemini-2.5-flash";

/* ---------- 데이터 저장/불러오기 ---------- */
function loadData(key, fallback) {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : fallback;
}
function saveData(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let users = loadData("fk_users", {});           // 회원 정보 { 아이디: 비밀번호 }
let ingredients = loadData("fk_ingredients", []); // 식재료 목록
let stats = loadData("fk_stats", { consumed: 0, discarded: 0 }); // 통계

let currentCategory = "전체"; // 목록 화면에서 선택된 카테고리
let currentUser = null;       // 현재 로그인한 아이디

/* ---------- 임박 기준일 (며칠 전부터 알림) ---------- */
const SOON_DAYS = 3;

/* ---------- 식재료 아이콘 (카테고리 기반 자동) ---------- */
function getIcon(item) {
  // item이 문자열이면 이름만, 객체면 이름+카테고리 사용
  const name = typeof item === "string" ? item : item.name;
  const category = typeof item === "object" && item ? item.category : "";

  // (1) 자주 쓰는 재료는 전용 아이콘
  const nameMap = {
    "우유": "🥛", "계란": "🥚", "달걀": "🥚", "사과": "🍎", "바나나": "🍌",
    "당근": "🥕", "토마토": "🍅", "양파": "🧅", "감자": "🥔",
    "빵": "🍞", "치즈": "🧀", "두부": "🍲", "배추": "🥬", "오이": "🥒",
    "딸기": "🍓", "포도": "🍇", "버섯": "🍄"
  };
  for (const key in nameMap) {
    if (name.includes(key)) return nameMap[key];
  }

  // (2) 전용 아이콘이 없으면 카테고리로 자동 처리
  //     → 삼겹살·닭가슴살·소고기 등 어떤 고기든 "육류" 하나로 해결
  const catMap = {
    "채소": "🥬", "과일": "🍎", "육류": "🥩",
    "수산물": "🐟", "유제품": "🥛", "기타": "🥗"
  };
  return catMap[category] || "🥗";
}

/* ---------- 유통기한까지 남은 일수 계산 ---------- */
function daysLeft(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

/* ---------- 신선도 상태 판정 ---------- */
function getStatus(dateStr) {
  const d = daysLeft(dateStr);
  if (d < 0) return "expired";
  if (d <= SOON_DAYS) return "soon";
  return "fresh";
}

/* ---------- 식재료 카드 HTML 생성 ---------- */
function createCard(item) {
  const status = getStatus(item.expireDate);
  const d = daysLeft(item.expireDate);

  let badge, badgeClass;
  if (status === "expired") { badge = "기한 지남"; badgeClass = "badge-expired"; }
  else if (status === "soon") { badge = `D-${d}`; badgeClass = "badge-soon"; }
  else { badge = `D-${d}`; badgeClass = "badge-fresh"; }

  const cat = item.category ? `<span class="food-cat">${item.category}</span>` : "";

  return `
    <div class="food-card ${status}">
      <span class="food-icon">${getIcon(item)}</span>
      <div class="food-info">
        <div class="food-name">${item.name} <span style="font-weight:400;color:var(--text-soft)">x${item.quantity}</span></div>
        <div class="food-meta">${cat}${item.storage} · 유통기한 ${item.expireDate}</div>
      </div>
      <span class="food-badge ${badgeClass}">${badge}</span>
      <div class="food-actions">
        <button class="icon-btn edit" title="수정" onclick="openEdit(${item.id})">✏️</button>
        <button class="icon-btn eat" title="다 먹음" onclick="consumeItem(${item.id})">✅</button>
        <button class="icon-btn trash" title="버림" onclick="discardItem(${item.id})">🗑️</button>
      </div>
    </div>
  `;
}

/* ---------- 화면 새로 그리기 ---------- */
function render() {
  const sorted = [...ingredients].sort(
    (a, b) => new Date(a.expireDate) - new Date(b.expireDate)
  );

  const soon = sorted.filter(i => getStatus(i.expireDate) === "soon");
  const expired = sorted.filter(i => getStatus(i.expireDate) === "expired");
  document.getElementById("sum-total").textContent = ingredients.length;
  document.getElementById("sum-soon").textContent = soon.length;
  document.getElementById("sum-expired").textContent = expired.length;

  const urgent = sorted.filter(i => getStatus(i.expireDate) !== "fresh");
  document.getElementById("soon-list").innerHTML =
    urgent.length ? urgent.map(createCard).join("")
                  : `<p class="empty-msg">임박한 식재료가 없어요 👍</p>`;

  document.getElementById("main-list").innerHTML =
    sorted.length ? sorted.map(createCard).join("")
                  : `<p class="empty-msg">아직 등록한 식재료가 없어요. 등록해보세요!</p>`;

  renderFullList();
  renderRecipes();
  renderStats();
}

/* ---------- 4. 목록 화면 (검색 + 보관 필터 + 카테고리) ---------- */
function renderFullList() {
  const keyword = document.getElementById("search-input").value.trim();
  const filter = document.getElementById("filter-storage").value;

  let list = [...ingredients].sort(
    (a, b) => new Date(a.expireDate) - new Date(b.expireDate)
  );
  if (keyword) list = list.filter(i => i.name.includes(keyword));
  if (filter !== "전체") list = list.filter(i => i.storage === filter);
  if (currentCategory !== "전체") list = list.filter(i => i.category === currentCategory);

  document.getElementById("full-list").innerHTML =
    list.length ? list.map(createCard).join("")
                : `<p class="empty-msg">조건에 맞는 식재료가 없어요.</p>`;
}

/* ---------- 5. 레시피 추천 (목록 확장) ---------- */
const RECIPES = [
  { name: "계란 볶음밥", ing: ["계란", "양파", "당근"] },
  { name: "토마토 계란탕", ing: ["토마토", "계란"] },
  { name: "감자 조림", ing: ["감자", "양파"] },
  { name: "야채 볶음", ing: ["당근", "양파", "버섯"] },
  { name: "두부 김치찌개", ing: ["두부", "배추"] },
  { name: "바나나 우유 스무디", ing: ["바나나", "우유"] },
  { name: "치즈 토스트", ing: ["빵", "치즈", "계란"] },
  { name: "딸기 요거트", ing: ["딸기", "우유"] },
  { name: "버섯 크림 스프", ing: ["버섯", "우유", "양파"] },
  { name: "감자전", ing: ["감자", "양파"] },
  { name: "오이무침", ing: ["오이"] },
  { name: "닭볶음탕", ing: ["닭", "감자", "당근", "양파"] },
  { name: "생선구이", ing: ["생선"] },
  { name: "포도 화채", ing: ["포도", "우유"] },
  { name: "사과 샐러드", ing: ["사과", "치즈"] },
  { name: "배추 된장국", ing: ["배추", "두부"] },
  { name: "토마토 파스타", ing: ["토마토", "양파", "치즈"] },
  { name: "계란말이", ing: ["계란", "당근", "양파"] }
];

function renderRecipes() {
  const owned = ingredients.map(i => i.name);

  // 각 레시피의 보유 재료 수 계산
  const checked = RECIPES.map(r => {
    const have = r.ing.filter(x => owned.some(o => o.includes(x) || x.includes(o)));
    return { ...r, haveCount: have.length, have };
  });

  // ✅ 핵심: 레시피 재료를 "전부" 가지고 있는 것만 추천
  const makeable = checked
    .filter(r => r.haveCount === r.ing.length)
    .sort((a, b) => b.ing.length - a.ing.length); // 재료 많이 쓰는 요리 먼저

  const box = document.getElementById("recipe-list");
  if (!makeable.length) {
    box.innerHTML = `<p class="empty-msg">지금 가진 재료로 완성할 수 있는 레시피가 없어요.<br>재료를 더 등록해보세요!</p>`;
    return;
  }

  box.innerHTML = makeable.map(r => {
    const ingHtml = r.ing.map(x => `<span class="recipe-have">${x}</span>`).join(", ");
    return `
      <div class="recipe-card">
        <div class="recipe-name">🍳 ${r.name}</div>
        <div class="recipe-match">✅ 지금 바로 만들 수 있어요!</div>
        <div class="recipe-ing">재료: ${ingHtml}</div>
      </div>
    `;
  }).join("");
}

/* ---------- Gemini API 호출 (공통 함수) ---------- */
async function callGemini(prompt) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    }
  );
  if (!res.ok) throw new Error("API 응답 오류: " + res.status);
  const data = await res.json();
  return (data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          data.candidates[0].content.parts[0].text) || "";
}

/* ---------- 5-2. AI 레시피 자동 추천 (Gemini) ---------- */
async function getAIRecipes() {
  const owned = ingredients.map(i => i.name);
  const status = document.getElementById("ai-status");
  const box = document.getElementById("recipe-list");

  if (!owned.length) {
    status.textContent = "먼저 식재료를 등록해주세요.";
    return;
  }
  if (!GEMINI_API_KEY) {
    status.textContent = "⚠️ API 키가 없어요. script.js 위쪽 GEMINI_API_KEY에 키를 넣어주세요.";
    return;
  }

  status.textContent = "AI가 레시피를 생각하는 중이에요... 🤔";
  box.innerHTML = "";

  // AI에게 보낼 질문 (가진 재료로만 만들 수 있는 요리를 JSON으로 요청)
  const prompt =
    "다음 재료만 사용해서 만들 수 있는 한국 가정 요리를 최대 6개 추천해줘.\n" +
    "반드시 아래 재료 안에서만 만들 수 있는 요리여야 해. 목록에 없는 재료가 들어간 요리는 빼.\n" +
    "재료: " + owned.join(", ") + "\n" +
    "반드시 JSON 배열로만 답해. 다른 설명은 절대 쓰지 마.\n" +
    '형식: [{"name":"요리이름","ing":["재료1","재료2"]}]';

  try {
    let text = await callGemini(prompt);

    // AI가 ```json ... ``` 으로 감싸서 줄 때를 대비해 제거
    text = text.replace(/```json|```/g, "").trim();
    const recipes = JSON.parse(text);

    if (!recipes.length) {
      status.textContent = "추천할 만한 레시피를 못 찾았어요.";
      return;
    }

    status.textContent = "🤖 AI 추천 결과예요!";
    box.innerHTML = recipes.map(r => {
      const ingHtml = (r.ing || []).map(x => `<span class="recipe-have">${x}</span>`).join(", ");
      return `
        <div class="recipe-card">
          <div class="recipe-name">🍳 ${r.name}</div>
          <div class="recipe-match">✨ AI 추천</div>
          <div class="recipe-ing">재료: ${ingHtml}</div>
        </div>`;
    }).join("");

  } catch (err) {
    console.error(err);
    status.textContent = "오류가 났어요. 인터넷 연결과 API 키를 확인해주세요.";
    renderRecipes(); // 실패하면 기본 레시피라도 다시 보여줌
  }
}


function renderStats() {
  document.getElementById("stat-consumed").textContent = stats.consumed;
  document.getElementById("stat-discarded").textContent = stats.discarded;

  const total = stats.consumed + stats.discarded;
  const score = total === 0 ? 0 : Math.round((stats.consumed / total) * 100);

  document.getElementById("stat-score").textContent = score + "점";
  document.getElementById("stat-bar-fill").style.width = score + "%";

  let msg;
  if (total === 0) msg = "아직 기록이 없어요. 식재료를 끝까지 써보세요!";
  else if (score >= 80) msg = "훌륭해요! 음식물 쓰레기를 거의 안 만들고 있어요 🌱";
  else if (score >= 50) msg = "좋아요! 조금만 더 챙기면 완벽해요 💪";
  else msg = "버리는 식재료가 많아요. 임박 알림을 확인해보세요!";
  document.getElementById("stat-msg").textContent = msg;
}

/* ---------- 동작: 식재료 등록 ---------- */
function addIngredient() {
  const name = document.getElementById("add-name").value.trim();
  const category = document.getElementById("add-category").value;
  const date = document.getElementById("add-date").value;
  const storage = document.getElementById("add-storage").value;
  const qty = parseInt(document.getElementById("add-qty").value) || 1;

  if (!name) { alert("식재료 이름을 입력하세요."); return; }
  if (!date) { alert("유통기한을 선택하세요."); return; }

  ingredients.push({ id: Date.now(), name, category, expireDate: date, storage, quantity: qty });
  saveData("fk_ingredients", ingredients);

  document.getElementById("add-name").value = "";
  document.getElementById("add-date").value = "";
  document.getElementById("add-qty").value = 1;

  render();
  switchScreen("screen-main");
  alert("등록되었습니다!");
}

/* ---------- 카테고리 자동 채움 ---------- */
// (1) 흔한 재료는 즉시 추측 (오프라인, 키 불필요)
function guessCategory(name) {
  const rules = {
    "육류": ["고기", "삼겹", "목살", "소고기", "돼지", "닭", "갈비", "스테이크", "베이컨", "소시지", "햄", "차돌", "등심", "안심"],
    "수산물": ["생선", "고등어", "갈치", "연어", "오징어", "새우", "조개", "멸치", "문어", "낙지", "게", "굴", "조기", "꽁치", "참치", "전복", "홍합"],
    "유제품": ["우유", "치즈", "버터", "요거트", "요구르트", "생크림", "연유"],
    "과일": ["사과", "바나나", "딸기", "포도", "수박", "참외", "귤", "오렌지", "복숭아", "키위", "망고", "파인애플", "감", "자두", "블루베리", "체리", "레몬", "멜론"],
    "채소": ["양파", "당근", "감자", "고구마", "배추", "상추", "오이", "호박", "마늘", "대파", "파", "버섯", "시금치", "브로콜리", "양배추", "무", "고추", "피망", "가지", "콩나물", "깻잎", "부추", "미나리", "토마토"]
  };
  for (const cat in rules) {
    if (rules[cat].some(k => name.includes(k))) return cat;
  }
  return null; // 못 찾으면 null
}

// (2) 이름 입력을 끝내면 카테고리 자동 선택
async function autoFillCategory() {
  const name = document.getElementById("add-name").value.trim();
  if (!name) return;
  const sel = document.getElementById("add-category");

  // 먼저 빠른 로컬 추측
  const local = guessCategory(name);
  if (local) { sel.value = local; return; }

  // 모르면 AI에게 분류 요청 (키 있을 때만)
  if (!GEMINI_API_KEY) return;
  try {
    const prompt = `"${name}"는 다음 중 어떤 종류야? 채소, 과일, 육류, 수산물, 유제품, 기타 중에서 정확히 한 단어로만 답해.`;
    let answer = await callGemini(prompt);
    answer = answer.replace(/[^가-힣]/g, "").trim(); // 한글만 남기기
    const valid = ["채소", "과일", "육류", "수산물", "유제품", "기타"];
    if (valid.includes(answer)) sel.value = answer;
  } catch (err) {
    console.error("카테고리 자동 분류 실패:", err);
  }
}


function openEdit(id) {
  const item = ingredients.find(i => i.id === id);
  if (!item) return;
  document.getElementById("edit-id").value = item.id;
  document.getElementById("edit-name").value = item.name;
  document.getElementById("edit-date").value = item.expireDate;
  document.getElementById("edit-qty").value = item.quantity;
  document.getElementById("edit-modal").classList.remove("hidden");
}
function saveEdit() {
  const id = Number(document.getElementById("edit-id").value);
  const item = ingredients.find(i => i.id === id);
  if (!item) return;
  item.name = document.getElementById("edit-name").value.trim() || item.name;
  item.expireDate = document.getElementById("edit-date").value || item.expireDate;
  item.quantity = parseInt(document.getElementById("edit-qty").value) || 1;
  saveData("fk_ingredients", ingredients);
  closeEdit();
  render();
}
function closeEdit() {
  document.getElementById("edit-modal").classList.add("hidden");
}

/* ---------- 동작: 다 먹음 / 버림 ---------- */
function consumeItem(id) {
  ingredients = ingredients.filter(i => i.id !== id);
  stats.consumed++;
  saveData("fk_ingredients", ingredients);
  saveData("fk_stats", stats);
  render();
}
function discardItem(id) {
  if (!confirm("이 식재료를 버린 것으로 기록할까요?")) return;
  ingredients = ingredients.filter(i => i.id !== id);
  stats.discarded++;
  saveData("fk_ingredients", ingredients);
  saveData("fk_stats", stats);
  render();
}

/* ---------- 데이터 초기화 ---------- */
function resetStats() {
  if (!confirm("통계 기록을 모두 초기화할까요?")) return;
  stats = { consumed: 0, discarded: 0 };
  saveData("fk_stats", stats);
  render();
  alert("통계가 초기화되었습니다.");
}
function resetAll() {
  if (!confirm("식재료와 통계를 모두 삭제할까요? 되돌릴 수 없습니다.")) return;
  ingredients = [];
  stats = { consumed: 0, discarded: 0 };
  saveData("fk_ingredients", ingredients);
  saveData("fk_stats", stats);
  render();
  switchScreen("screen-main");
  alert("모든 데이터가 삭제되었습니다.");
}

/* ---------- 유통기한 알림 팝업 ---------- */
function showAlertPopup() {
  const urgent = ingredients
    .filter(i => getStatus(i.expireDate) !== "fresh")
    .sort((a, b) => new Date(a.expireDate) - new Date(b.expireDate));

  if (!urgent.length) return; // 임박 식재료 없으면 팝업 안 띄움

  document.getElementById("alert-list").innerHTML = urgent.map(i => {
    const status = getStatus(i.expireDate);
    const d = daysLeft(i.expireDate);
    const label = status === "expired" ? "기한 지남" : `D-${d}`;
    const color = status === "expired" ? "var(--danger)" : "#b9810a";
    return `
      <div class="modal-item">
        <span>${getIcon(i)} ${i.name}</span>
        <span class="mi-badge" style="color:${color}">${label}</span>
      </div>`;
  }).join("");

  document.getElementById("alert-modal").classList.remove("hidden");
}

/* ---------- 내 정보 (마이페이지) ---------- */
function openProfile() {
  document.getElementById("profile-id").textContent = currentUser;
  document.getElementById("profile-pw").value = "";
  document.getElementById("profile-pw2").value = "";
  document.getElementById("profile-modal").classList.remove("hidden");
}
function closeProfile() {
  document.getElementById("profile-modal").classList.add("hidden");
}
function saveProfile() {
  const pw = document.getElementById("profile-pw").value;
  const pw2 = document.getElementById("profile-pw2").value;

  if (!pw) { alert("새 비밀번호를 입력하세요."); return; }
  if (pw !== pw2) { alert("비밀번호가 일치하지 않습니다."); return; }

  users[currentUser] = pw;          // 비밀번호 변경 저장
  saveData("fk_users", users);
  closeProfile();
  alert("비밀번호가 저장되었습니다.");
}
function deleteAccount() {
  if (!confirm("정말 탈퇴하시겠습니까?\n계정과 모든 식재료·통계 기록이 삭제됩니다.")) return;

  delete users[currentUser];        // 계정 삭제
  saveData("fk_users", users);

  // 데이터도 함께 삭제
  ingredients = [];
  stats = { consumed: 0, discarded: 0 };
  saveData("fk_ingredients", ingredients);
  saveData("fk_stats", stats);

  currentUser = null;
  closeProfile();
  alert("회원 탈퇴가 완료되었습니다.");
  logout();
}

/* ---------- 화면 전환 ---------- */
function switchScreen(targetId) {
  document.querySelectorAll(".app-body .screen").forEach(s => s.classList.remove("active"));
  document.getElementById(targetId).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.target === targetId);
  });
}

/* ---------- 회원가입 / 로그인 ---------- */
function signup() {
  const id = document.getElementById("signup-id").value.trim();
  const pw = document.getElementById("signup-pw").value;
  const pw2 = document.getElementById("signup-pw2").value;

  if (!id || !pw) { alert("아이디와 비밀번호를 입력하세요."); return; }
  if (users[id]) { alert("이미 존재하는 아이디입니다."); return; }
  if (pw !== pw2) { alert("비밀번호가 일치하지 않습니다."); return; }

  users[id] = pw;
  saveData("fk_users", users);
  alert("가입이 완료되었습니다! 로그인해주세요.");
  showAuth("screen-login");
  document.getElementById("login-id").value = id;
}

function login() {
  const id = document.getElementById("login-id").value.trim();
  const pw = document.getElementById("login-pw").value;

  if (!id || !pw) { alert("아이디와 비밀번호를 입력하세요."); return; }
  if (users[id] === undefined) { alert("존재하지 않는 아이디입니다. 회원가입을 해주세요."); return; }
  if (users[id] !== pw) { alert("비밀번호가 틀렸습니다."); return; }

  currentUser = id;
  document.getElementById("user-name").textContent = id;
  document.getElementById("screen-login").classList.remove("active");
  document.getElementById("app").classList.remove("hidden");
  render();
  showAlertPopup(); // 로그인 직후 유통기한 알림
}

function logout() {
  document.getElementById("app").classList.add("hidden");
  showAuth("screen-login");
  document.getElementById("login-id").value = "";
  document.getElementById("login-pw").value = "";
}

/* 로그인/회원가입 화면 전환 */
function showAuth(screenId) {
  document.querySelectorAll(".screen-auth").forEach(s => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

/* ---------- 이벤트 연결 ---------- */
document.getElementById("btn-login").addEventListener("click", login);
document.getElementById("btn-signup").addEventListener("click", signup);
document.getElementById("btn-logout").addEventListener("click", logout);
document.getElementById("btn-add").addEventListener("click", addIngredient);

// 내 정보(마이페이지)
document.getElementById("btn-profile").addEventListener("click", openProfile);
document.getElementById("btn-profile-save").addEventListener("click", saveProfile);
document.getElementById("btn-profile-close").addEventListener("click", closeProfile);
document.getElementById("btn-delete-account").addEventListener("click", deleteAccount);

document.getElementById("go-signup").addEventListener("click", e => { e.preventDefault(); showAuth("screen-signup"); });
document.getElementById("go-login").addEventListener("click", e => { e.preventDefault(); showAuth("screen-login"); });

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => switchScreen(btn.dataset.target));
});

document.getElementById("search-input").addEventListener("input", renderFullList);
document.getElementById("filter-storage").addEventListener("change", renderFullList);

// AI 레시피 추천 버튼
document.getElementById("btn-ai-recipe").addEventListener("click", getAIRecipes);

// 재료 이름 입력을 끝내면 카테고리 자동 채움
document.getElementById("add-name").addEventListener("blur", autoFillCategory);

// 카테고리 탭
document.querySelectorAll(".cat-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".cat-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentCategory = tab.dataset.cat;
    renderFullList();
  });
});

// 알림 팝업 닫기
document.getElementById("btn-alert-close").addEventListener("click", () => {
  document.getElementById("alert-modal").classList.add("hidden");
});

// 수정 팝업
document.getElementById("btn-edit-save").addEventListener("click", saveEdit);
document.getElementById("btn-edit-cancel").addEventListener("click", closeEdit);

// 초기화 버튼
document.getElementById("btn-reset-stats").addEventListener("click", resetStats);
document.getElementById("btn-reset-all").addEventListener("click", resetAll);

// 엔터로 로그인
document.getElementById("login-pw").addEventListener("keydown", e => {
  if (e.key === "Enter") login();
});
