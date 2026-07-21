// ドコモでんきシミュレーター — 料金計算ロジック(純粋関数)
// 関西電力エリア・Mプラン(従量電灯A相当)専用。DOMには一切触れない。
//
// ============================================================
// 単価定数(2026-07-15 Web調査・一次情報で確認、算術検証済み)
// 出典:
//  - ドコモでんき料金単価表: https://denki.docomo.ne.jp/plan/price/
//  - Basic関西: https://denki.docomo.ne.jp/plan/basic_kansai/
//  - Green関西: https://denki.docomo.ne.jp/plan/green_kansai/
//  - 燃料費等調整単価: https://denki.docomo.ne.jp/fuel-cost/
//  - 燃調上限廃止のお知らせ: https://denki.docomo.ne.jp/notice/detail/025.html
//  - 関電 燃調プレス(例:7月分): https://www.kepco.co.jp/corporate/pr/2026/pdf/20260528_1j.pdf
//  - 再エネ賦課金2026年度: https://www.kepco.co.jp/corporate/notice/notice_pdf/20260323_1.pdf
// 検証: 関電公式モデル(従量電灯A・260kWh・2026年7月分=7,843円)を単価から再現一致
// ============================================================
const DENKI_CONSTANTS = {
  verifiedOn: "2026-07-15",

  // 関西Mプラン 料金表(税込・2024年6月検針分から適用)
  rates: {
    minChargeBasic: 522.58,   // 最低料金(最初の15kWhまで)
    minChargeGreen: 1022.58,  // Green = Basic + 500円/月
    minKwh: 15,
    tiers: [
      { upTo: 120, unit: 20.21 }, // 15kWh超〜120kWh
      { upTo: 300, unit: 25.61 }, // 120kWh超〜300kWh
      { upTo: Infinity, unit: 28.59 }, // 300kWh超
    ],
  },

  // 燃料費等調整(関西M: 最低料金部分=月額定額 + 15kWh超過分=円/kWh)
  // docomo=ドコモでんき(上限なし・関電自由料金と同値) / kepco=関電従量電灯A(規制・上限あり)
  fuelPresets: [
    { key: "2026-05", label: "26年5月分", docomo: { fix: 43.56, unit: 2.90 }, kepco: { fix: 33.66, unit: 2.24 } },
    { key: "2026-06", label: "26年6月分", docomo: { fix: 44.55, unit: 2.97 }, kepco: { fix: 33.66, unit: 2.24 } },
    { key: "2026-07", label: "26年7月分", docomo: { fix: 46.04, unit: 3.07 }, kepco: { fix: 33.66, unit: 2.24 } },
    { key: "2026-08", label: "26年8月分(補助込)", docomo: { fix: -0.52, unit: -0.03 }, kepco: { fix: -18.84, unit: -1.26 } },
  ],
  // 政府補助(電気・ガス料金負担軽減): 検針分2026年8月・10月=3.5円/kWh、9月=4.5円/kWh値引き

  // 再エネ賦課金(全電圧共通・円/kWh)
  saiene: {
    fy2026: 4.18, // 2026年5月分〜2027年4月分
    fy2025: 3.98, // 2025年5月分〜2026年4月分
  },

  // dポイント還元(還元対象=最低料金+電力量料金の税抜100円ごと。燃調・再エネは対象外)
  // 対象回線プラン=ドコモMAX/mini/ahamo/eximo/irumo等(2019年10月以降のプラン)
  pointOptions: {
    basic: [
      { key: "b2", label: "対象回線プラン × dカード払い(2%)", pct: 2 },
      { key: "b1a", label: "対象回線プラン × その他の支払い(1%)", pct: 1 },
      { key: "b1b", label: "対象回線なし × dカード払い(1%)", pct: 1 },
      { key: "b05", label: "対象回線なし × その他(0.5%)", pct: 0.5 },
    ],
    green: [
      { key: "g20", label: "対象回線 × dカードPLATINUM(初年度20%)", pct: 20 },
      { key: "g10", label: "対象回線 × dカードGOLD/GOLD U(10%)", pct: 10 },
      { key: "g9", label: "対象回線 × GOLD系会員・他の支払い(9%)", pct: 9 },
      { key: "g5", label: "対象回線 × 一般dカード払い(5%)", pct: 5 },
      { key: "g2", label: "対象回線なし × dカード払い(2%)", pct: 2 },
      { key: "g1", label: "対象回線なし × その他(1%)", pct: 1 },
    ],
  },
  gasSetBonusPct: 2, // ドコモガスセットで+2%
};

// ============================================================
// メイン計算
// input: {
//   kwh,                 // 月間使用量
//   plan,                // "basic" | "green"
//   fuelFix, fuelUnit,   // 燃調: 最低料金部分(円/月)・15kWh超過分(円/kWh)
//   saieneUnit,          // 再エネ賦課金(円/kWh)
//   pointPct,            // 還元率(%)
//   gasSet,              // ドコモガスセット(true/false)
//   kepcoFuelFix, kepcoFuelUnit, // 比較用: 関電規制の燃調(省略可)
// }
// ============================================================
function calcDenki(input) {
  const C = DENKI_CONSTANTS;
  const kwh = Math.max(0, input.kwh || 0);
  const plan = input.plan === "green" ? "green" : "basic";

  // ---- 1. 最低料金+電力量料金(ポイント還元の対象部分) ----
  const minCharge = plan === "green" ? C.rates.minChargeGreen : C.rates.minChargeBasic;
  let tierDetail = [];
  let energy = minCharge;
  let prev = C.rates.minKwh;
  for (const t of C.rates.tiers) {
    if (kwh <= prev) break;
    const use = Math.min(kwh, t.upTo) - prev;
    tierDetail.push({ upTo: t.upTo, unit: t.unit, use, amount: use * t.unit });
    energy += use * t.unit;
    prev = t.upTo;
  }

  // ---- 2. 燃料費等調整(最低料金部分は定額、超過分×単価。マイナスあり) ----
  const fuelFix = Number(input.fuelFix) || 0;
  const fuelUnit = Number(input.fuelUnit) || 0;
  const fuelOver = kwh > C.rates.minKwh ? (kwh - C.rates.minKwh) * fuelUnit : 0;
  const fuel = fuelFix + fuelOver;

  // ---- 3. 再エネ賦課金(使用量×単価・1円未満切捨て) ----
  const saieneUnit = Number(input.saieneUnit) || 0;
  const saiene = Math.floor(kwh * saieneUnit);

  // ---- 4. 合計(1円未満切捨て) ----
  const total = Math.floor(energy + fuel + saiene);

  // ---- 5. dポイント(対象=最低料金+電力量料金の税抜100円ごと・概算) ----
  const pct = (Number(input.pointPct) || 0) + (input.gasSet ? C.gasSetBonusPct : 0);
  const taxExcl = Math.floor(energy / 1.1);
  const points = Math.floor(taxExcl / 100) * pct; // 100円ごとにpctポイント
  const net = total - points;

  // ---- 6. 比較: 関電 従量電灯A(規制料金)。Green比較は成立しないためBasic料金で計算 ----
  let kepco = null;
  if (input.kepcoFuelFix !== undefined && input.kepcoFuelUnit !== undefined) {
    const kEnergy = energy - minCharge + C.rates.minChargeBasic; // 単価同一・最低料金はBasic相当
    const kFuel = (Number(input.kepcoFuelFix) || 0) + (kwh > C.rates.minKwh ? (kwh - C.rates.minKwh) * (Number(input.kepcoFuelUnit) || 0) : 0);
    const kTotal = Math.floor(kEnergy + kFuel + saiene);
    kepco = { total: kTotal, totalWithKoufuri: kTotal - 55, fuel: kFuel, diff: total - kTotal };
  }

  return {
    kwh, plan, minCharge, tierDetail,
    energy, fuel, fuelFix, fuelOver, saiene, total,
    pct, taxExcl, points, net, kepco,
  };
}

// Node.jsテスト用(ブラウザでは無視される)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DENKI_CONSTANTS, calcDenki };
}
