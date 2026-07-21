// ドコモでんきシミュレーター — UIロジック(状態管理・localStorage・描画)

const STORAGE_KEY = "denkiSim.v1";

const DEFAULTS = {
  kwh: 260,
  plan: "basic",
  fuelKey: "2026-07",       // プリセット選択中の月(手入力すると "custom")
  fuelFix: 46.04,
  fuelUnit: 3.07,
  kepcoFuelFix: 33.66,
  kepcoFuelUnit: 2.24,
  saieneUnit: 4.18,
  pointKey: "b2",
  gasSet: false,
};

let state = loadState();

const $ = (id) => document.getElementById(id);
const inKwh = $("inKwh");
const inPlan = $("inPlan");
const inFuel = $("inFuel");
const inSaiene = $("inSaiene");
const inPoint = $("inPoint");
const fuelPresets = $("fuelPresets");
const outTotal = $("outTotal");
const outTotalNote = $("outTotalNote");
const outNet = $("outNet");
const outPointNote = $("outPointNote");
const breakdownList = $("breakdownList");
const breakdownNote = $("breakdownNote");
const outProcess = $("outProcess");
const saieneNote = $("saieneNote");
const pointNote = $("pointNote");
const resetBtn = $("resetBtn");

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") return { ...DEFAULTS, ...saved };
  } catch (e) { /* 破損時はデフォルト */ }
  return { ...DEFAULTS };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

function fmt(yen) { return yen.toLocaleString("ja-JP") + "円"; }
function fmt2(x) { return x.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "円"; }

function parseNum(str) {
  if (typeof str !== "string") return 0;
  const half = str.replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/−/g, "-").replace(/▲/g, "-");
  const n = parseFloat(half.replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

// ===== セレクト構築 =====
function buildSelects() {
  inPlan.innerHTML = "";
  for (const [v, label] of [["basic", "ドコモでんき Basic"], ["green", "ドコモでんき Green(再エネ・+500円/月)"]]) {
    const o = document.createElement("option");
    o.value = v; o.textContent = label;
    inPlan.appendChild(o);
  }
  inPlan.value = state.plan;
  buildPointSelect();
}

function buildPointSelect() {
  const opts = DENKI_CONSTANTS.pointOptions[state.plan];
  inPoint.innerHTML = "";
  for (const p of opts) {
    const o = document.createElement("option");
    o.value = p.key; o.textContent = p.label;
    inPoint.appendChild(o);
  }
  // ガスセットの選択肢は簡易化のためチェック相当のoptionを付けず、還元率に+2%する別項目にはしない
  if (!opts.find((p) => p.key === state.pointKey)) state.pointKey = opts[0].key;
  inPoint.value = state.pointKey;
  pointNote.textContent = "還元対象は基本料金+電力量料金(燃調・再エネ除く)の税抜額。ドコモガスセット契約中は表示の還元率に+2%されます(下の内訳で加算可)。";
}

function buildFuelPresets() {
  fuelPresets.innerHTML = "";
  for (const p of DENKI_CONSTANTS.fuelPresets) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "preset-btn";
    b.textContent = `${p.label} ${p.docomo.unit >= 0 ? "+" : ""}${p.docomo.unit}円`;
    b.addEventListener("click", () => {
      state.fuelKey = p.key;
      state.fuelFix = p.docomo.fix;
      state.fuelUnit = p.docomo.unit;
      state.kepcoFuelFix = p.kepco.fix;
      state.kepcoFuelUnit = p.kepco.unit;
      inFuel.value = String(p.docomo.unit);
      saveState();
      render();
    });
    fuelPresets.appendChild(b);
  }
}

// ===== 入力バインド =====
inKwh.addEventListener("input", () => { state.kwh = parseNum(inKwh.value); saveState(); render(); });
inKwh.addEventListener("blur", () => { inKwh.value = state.kwh.toLocaleString("ja-JP"); });

inFuel.addEventListener("input", () => {
  const u = parseNum(inFuel.value);
  state.fuelUnit = u;
  state.fuelFix = Math.round(u * 15 * 100) / 100; // 最低料金部分≒15kWh×単価
  state.fuelKey = "custom";
  saveState(); render();
});

inSaiene.addEventListener("input", () => { state.saieneUnit = parseNum(inSaiene.value); saveState(); render(); });

inPlan.addEventListener("change", () => { state.plan = inPlan.value; buildPointSelect(); saveState(); render(); });
inPoint.addEventListener("change", () => { state.pointKey = inPoint.value; saveState(); render(); });

resetBtn.addEventListener("click", () => {
  if (!confirm("入力値をデフォルトに戻します。よろしいですか？")) return;
  state = { ...DEFAULTS };
  saveState(); syncInputs(); buildPointSelect(); render();
});

function syncInputs() {
  inKwh.value = state.kwh.toLocaleString("ja-JP");
  inPlan.value = state.plan;
  inFuel.value = String(state.fuelUnit);
  inSaiene.value = String(state.saieneUnit);
  inPoint.value = state.pointKey;
}

function currentPointPct() {
  const opts = DENKI_CONSTANTS.pointOptions[state.plan];
  const p = opts.find((o) => o.key === state.pointKey);
  return p ? p.pct : 0;
}

// ===== 描画 =====
function render() {
  const r = calcDenki({
    kwh: state.kwh,
    plan: state.plan,
    fuelFix: state.fuelFix,
    fuelUnit: state.fuelUnit,
    saieneUnit: state.saieneUnit,
    pointPct: currentPointPct(),
    gasSet: state.gasSet,
    kepcoFuelFix: state.kepcoFuelFix,
    kepcoFuelUnit: state.kepcoFuelUnit,
  });

  outTotal.textContent = fmt(r.total);
  const fuelLabel = state.fuelKey === "custom" ? "手入力" : (DENKI_CONSTANTS.fuelPresets.find((p) => p.key === state.fuelKey) || {}).label || "";
  outTotalNote.textContent = `${r.kwh}kWh・燃調${fuelLabel} ${state.fuelUnit >= 0 ? "+" : ""}${state.fuelUnit}円/kWh・再エネ${state.saieneUnit}円/kWh`;

  outNet.textContent = `${r.points.toLocaleString()}pt → ${fmt(r.net)}`;
  outPointNote.textContent = `還元率${r.pct}%(対象額 税抜${r.taxExcl.toLocaleString()}円の100円ごと)。ポイントを差し引いた実質負担額です。`;

  // 内訳
  let html = "";
  const row = (dt, dd, cls) => `<div class="breakdown-row${cls ? " " + cls : ""}"><dt>${dt}</dt><dd>${dd}</dd></div>`;
  html += row(`最低料金(〜15kWh)${r.plan === "green" ? " Green" : ""}`, fmt2(r.minCharge));
  const tierNames = ["15〜120kWh", "120〜300kWh", "300kWh超"];
  r.tierDetail.forEach((t, i) => {
    html += row(`${tierNames[i]} (${t.use}kWh × ${t.unit}円)`, fmt2(t.amount));
  });
  html += row("燃料費等調整", fmt2(r.fuel), r.fuel < 0 ? "minus" : "");
  html += row(`再エネ賦課金 (${r.kwh}kWh × ${state.saieneUnit}円)`, fmt(r.saiene));
  html += row("<b>合計(1円未満切捨て)</b>", `<b>${fmt(r.total)}</b>`);
  html += row(`dポイント還元(${r.pct}%)`, `−${r.points.toLocaleString()}pt`, "minus");
  breakdownList.innerHTML = html;

  if (r.kepco) {
    const diffTxt = r.kepco.diff === 0 ? "同額" : (r.kepco.diff > 0 ? `+${fmt(r.kepco.diff)} ドコモが高い` : `${fmt(r.kepco.diff)} ドコモが安い`);
    breakdownNote.innerHTML = `参考: 同条件を関西電力 従量電灯A(規制料金・燃調上限あり)で計算すると <b>${fmt(r.kepco.total)}</b>(口座振替割引適用で${fmt(r.kepco.totalWithKoufuri)})。料金差: ${diffTxt}。※ポイント還元を含めた実質は上の実質負担と比べてください。`;
  } else {
    breakdownNote.textContent = "";
  }

  outProcess.innerHTML = buildProcessHtml(r);
}

function buildProcessHtml(r) {
  const C = DENKI_CONSTANTS;
  const tr = (a, b, f) => `<tr><td>${a}${f ? `<br><span class="formula">${f}</span>` : ""}</td><td>${b}</td></tr>`;
  let h = "";
  h += `<h3>単価表(関西Mプラン・税込)</h3><table>`;
  h += tr("最低料金 Basic(〜15kWh)", fmt2(C.rates.minChargeBasic));
  h += tr("最低料金 Green(〜15kWh)", fmt2(C.rates.minChargeGreen), "Basic+500円/月(再エネ実質100%)");
  h += tr("15〜120kWh", C.rates.tiers[0].unit + "円/kWh");
  h += tr("120〜300kWh", C.rates.tiers[1].unit + "円/kWh");
  h += tr("300kWh超", C.rates.tiers[2].unit + "円/kWh");
  h += `</table>`;
  h += `<h3>燃料費等調整(毎月変動・ドコモは上限なし)</h3><table>`;
  for (const p of C.fuelPresets) {
    h += tr(p.label, `${p.docomo.unit >= 0 ? "+" : ""}${p.docomo.unit}円/kWh`, `最低料金部分 ${p.docomo.fix >= 0 ? "+" : ""}${p.docomo.fix}円/月・関電規制は${p.kepco.unit >= 0 ? "+" : ""}${p.kepco.unit}円`);
  }
  h += tr("計算式", "", "最低料金部分の定額 + 単価×(使用量−15kWh)");
  h += tr("政府補助", "", "検針分26年8月・10月=3.5円/kWh、9月=4.5円/kWh値引き(プリセット8月分は反映済み)");
  h += `</table>`;
  h += `<h3>今回の計算</h3><table>`;
  h += tr("最低料金+電力量料金", fmt2(r.energy), "ポイント還元の対象部分");
  h += tr("燃料費等調整", fmt2(r.fuel), `${state.fuelFix}円 + ${state.fuelUnit}円×${Math.max(0, r.kwh - 15)}kWh`);
  h += tr("再エネ賦課金", fmt(r.saiene), `${r.kwh}kWh×${state.saieneUnit}円 切捨て`);
  h += tr("<b>合計</b>", `<b>${fmt(r.total)}</b>`, "1円未満切捨て");
  h += tr("dポイント", `${r.points.toLocaleString()}pt`, `税抜${r.taxExcl.toLocaleString()}円÷100 × ${r.pct}`);
  h += `</table>`;
  h += `<p class="formula" style="margin-top:10px">単価の確認日: ${C.verifiedOn}(出典はdenki.js内に記載)。再エネ賦課金は毎年5月分から改定(2026年度=4.18円/kWh)。</p>`;
  return h;
}

// ===== 初期化 =====
buildSelects();
buildFuelPresets();
syncInputs();
render();
