// ドコモでんきシミュレーター — 料金計算ロジック(純粋関数)
// Mプラン(従量電灯A相当)・複数エリア対応。DOMには一切触れない。
//
// ============================================================
// 単価定数(確認日は各エリアのverifiedOn。一次情報で確認・算術検証済み)
// 出典:
//  - ドコモでんき料金単価表: https://denki.docomo.ne.jp/plan/price/
//  - 燃料費等調整単価: https://denki.docomo.ne.jp/fuel-cost/
//  - 燃調上限廃止のお知らせ: https://denki.docomo.ne.jp/notice/detail/025.html
//  - 関電 燃調プレス(例:7月分): https://www.kepco.co.jp/corporate/pr/2026/pdf/20260528_1j.pdf
//  - 再エネ賦課金2026年度: https://www.kepco.co.jp/corporate/notice/notice_pdf/20260323_1.pdf
// 検証: 関西=関電公式モデル(従量電灯A・260kWh・2026年7月分=7,843円)を再現一致
// ============================================================
const DENKI_CONSTANTS = {
  // 再エネ賦課金(全国・全電圧共通・円/kWh)
  saiene: {
    fy2026: 4.18, // 2026年5月分〜2027年4月分
    fy2025: 3.98, // 2025年5月分〜2026年4月分
  },

  // dポイント還元(還元対象=最低料金+電力量料金の税抜100円ごと。燃調・再エネは対象外)
  // Basicは全エリア共通。★Greenはエリア別★(各エリアのgreenPointDataを使用)
  // 出典: https://denki.docomo.ne.jp/assets_brand/json/region.json (公式ページの還元率表の実データ)
  pointOptions: {
    basic: [
      { key: "b2", label: "対象回線プラン × dカード払い(2%)", pct: 2 },
      { key: "b1a", label: "対象回線プラン × その他の支払い(1%)", pct: 1 },
      { key: "b1b", label: "対象回線なし × dカード払い(1%)", pct: 1 },
      { key: "b05", label: "対象回線なし × その他(0.5%)", pct: 0.5 },
    ],
  },
  // プラン切替時のデフォルト還元(控えめな条件にする)
  pointDefaults: { basic: "b2", green: "g_normal" },

  // Greenのエリア別還元率から選択肢を生成
  greenPointOptions(areaKey) {
    const g = (this.areas[areaKey] || this.areas.kansai).greenPointData;
    return [
      { key: "g_normal", label: `対象回線 × 一般dカード払い(${g.normal}%)`, pct: g.normal },
      { key: "g_gold", label: `対象回線 × dカードGOLD/GOLD U払い(${g.gold}%)`, pct: g.gold },
      { key: "g_plat", label: `対象回線 × dカードPLATINUM払い(初年度${g.plat1}%・2年目${g.plat2Low}〜${g.plat2High}%)`, pct: g.plat1 },
      { key: "g_goldOther", label: `対象回線 × GOLD/PLATINUM会員でdカード以外の支払い(${g.goldOther}%)`, pct: g.goldOther },
      { key: "g_normalOther", label: `対象回線 × 一般dカード会員でdカード以外(${g.normalOther}%)`, pct: g.normalOther },
      { key: "g_none2", label: `対象回線なし × dカード払い(${g.noLineCard}%)`, pct: g.noLineCard },
      { key: "g_none1", label: `対象回線なし × その他(${g.noLineOther}%)`, pct: g.noLineOther },
    ];
  },
  gasSetBonusPct: 2, // ドコモガスセットで+2%(対象ガスエリアのみ)

  // ---- エリア別設定 ----
  // 最低料金制(従量電灯A相当)のエリア。minKwh=最低料金でカバーされる使用量
  // fuelPresets: docomo=ドコモでんき(上限なし) / reg=地域電力の規制料金(上限あり・比較用)
  areas: {
    kansai: {
      label: "関西電力エリア",
      verifiedOn: "2026-07-15",
      regName: "関西電力 従量電灯A",
      koufuriDiscount: 55, // 口座振替割引(円/月・規制料金側)
      minKwh: 15,
      minChargeBasic: 522.58,
      minChargeGreen: 1022.58, // Basic+500円/月
      tiers: [
        { upTo: 120, unit: 20.21 },
        { upTo: 300, unit: 25.61 },
        { upTo: Infinity, unit: 28.59 },
      ],
      fuelPresets: [
        { key: "2026-05", label: "26年5月分", docomo: { fix: 43.56, unit: 2.90 }, reg: { fix: 33.66, unit: 2.24 } },
        { key: "2026-06", label: "26年6月分", docomo: { fix: 44.55, unit: 2.97 }, reg: { fix: 33.66, unit: 2.24 } },
        { key: "2026-07", label: "26年7月分", docomo: { fix: 46.04, unit: 3.07 }, reg: { fix: 33.66, unit: 2.24 } },
        { key: "2026-08", label: "26年8月分(補助込)", docomo: { fix: -0.52, unit: -0.03 }, reg: { fix: -18.84, unit: -1.26 } },
      ],
      // Green還元率(関西・region.json 2026-07-26確認)
      greenPointData: { plat1: 20, plat2High: 20, plat2Low: 10, gold: 10, goldOther: 9, normal: 5, normalOther: 4, noLineCard: 2, noLineOther: 1 },
    },
    // 四国: 2026-07-26調査・検証済み。四電モデル料金(260kWh・26年6月8,454円/7月8,501円)を完全再現
    // 出典: https://www.yonden.co.jp/customer/price/plan/juryo_a.html
    //       https://www.yonden.co.jp/customer/price/fuel_adjustments/
    //       https://denki.docomo.ne.jp/unitprice/menu/FL22000.JSON (area08)
    // 現在は燃料価格が基準(80,000円/kl)を下回りマイナス調整中→規制と自由(ドコモ)が同値
    shikoku: {
      label: "四国電力エリア",
      verifiedOn: "2026-07-26",
      regName: "四国電力 従量電灯A",
      koufuriDiscount: 55,
      minKwh: 11,
      minChargeBasic: 666.89,
      minChargeGreen: 1166.89, // Basic+500円/月
      tiers: [
        { upTo: 120, unit: 30.65 },
        { upTo: 300, unit: 37.27 },
        { upTo: Infinity, unit: 40.78 },
      ],
      fuelPresets: [
        { key: "2026-05", label: "26年5月分", docomo: { fix: -76.57, unit: -6.96 }, reg: { fix: -76.57, unit: -6.96 } },
        { key: "2026-06", label: "26年6月分", docomo: { fix: -76.23, unit: -6.93 }, reg: { fix: -76.23, unit: -6.93 } },
        { key: "2026-07", label: "26年7月分", docomo: { fix: -74.20, unit: -6.75 }, reg: { fix: -74.20, unit: -6.75 } },
        { key: "2026-08", label: "26年8月分(補助込)", docomo: { fix: -107.78, unit: -9.80 }, reg: { fix: -107.78, unit: -9.80 } },
      ],
      // Green還元率(★四国は関西より低い・region.json 2026-07-26確認)
      greenPointData: { plat1: 12, plat2High: 12, plat2Low: 6, gold: 6, goldOther: 5, normal: 4, normalOther: 3, noLineCard: 2, noLineOther: 1 },
    },
  },
};

// ============================================================
// メイン計算
// input: {
//   area,                // "kansai" | "shikoku"
//   kwh, plan,           // 使用量 / "basic"|"green"
//   fuelFix, fuelUnit,   // 燃調: 最低料金部分(円/月)・超過分(円/kWh)
//   saieneUnit, pointPct, gasSet,
//   regFuelFix, regFuelUnit, // 比較用: 規制料金の燃調(省略可)
// }
// ============================================================
function calcDenki(input) {
  const C = DENKI_CONSTANTS;
  const A = C.areas[input.area] || C.areas.kansai;
  const kwh = Math.max(0, input.kwh || 0);
  const plan = input.plan === "green" ? "green" : "basic";

  // ---- 1. 最低料金+電力量料金(ポイント還元の対象部分) ----
  const minCharge = plan === "green" ? A.minChargeGreen : A.minChargeBasic;
  let tierDetail = [];
  let energy = minCharge;
  let prev = A.minKwh;
  for (const t of A.tiers) {
    if (kwh <= prev) break;
    const use = Math.min(kwh, t.upTo) - prev;
    tierDetail.push({ upTo: t.upTo, unit: t.unit, use, amount: use * t.unit });
    energy += use * t.unit;
    prev = t.upTo;
  }

  // ---- 2. 燃料費等調整(最低料金部分=定額、超過分×単価。マイナスあり) ----
  const fuelFix = Number(input.fuelFix) || 0;
  const fuelUnit = Number(input.fuelUnit) || 0;
  const fuelOver = kwh > A.minKwh ? (kwh - A.minKwh) * fuelUnit : 0;
  const fuel = fuelFix + fuelOver;

  // ---- 3. 再エネ賦課金(使用量×単価・1円未満切捨て) ----
  const saieneUnit = Number(input.saieneUnit) || 0;
  const saiene = Math.floor(kwh * saieneUnit);

  // ---- 4. 合計(1円未満切捨て) ----
  const total = Math.floor(energy + fuel + saiene);

  // ---- 5. dポイント(対象=最低料金+電力量料金の税抜100円ごと・概算) ----
  const pct = (Number(input.pointPct) || 0) + (input.gasSet ? C.gasSetBonusPct : 0);
  const taxExcl = Math.floor(energy / 1.1);
  const points = Math.floor(taxExcl / 100) * pct;
  const net = total - points;

  // ---- 6. 比較: 地域電力の従量電灯A(規制料金)。Green比較は成立しないためBasic料金で計算 ----
  let reg = null;
  if (input.regFuelFix !== undefined && input.regFuelUnit !== undefined) {
    const rEnergy = energy - minCharge + A.minChargeBasic;
    const rFuel = (Number(input.regFuelFix) || 0) + (kwh > A.minKwh ? (kwh - A.minKwh) * (Number(input.regFuelUnit) || 0) : 0);
    const rTotal = Math.floor(rEnergy + rFuel + saiene);
    reg = { total: rTotal, totalWithKoufuri: rTotal - (A.koufuriDiscount || 0), fuel: rFuel, diff: total - rTotal, name: A.regName };
  }

  return {
    area: input.area || "kansai", areaLabel: A.label, minKwh: A.minKwh,
    kwh, plan, minCharge, tierDetail,
    energy, fuel, fuelFix, fuelOver, saiene, total,
    pct, taxExcl, points, net, reg,
  };
}

// Node.jsテスト用(ブラウザでは無視される)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DENKI_CONSTANTS, calcDenki };
}
