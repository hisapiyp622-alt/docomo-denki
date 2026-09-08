// ドコモでんきシミュレーター — 料金計算ロジック(純粋関数)
// Mプラン(従量電灯A相当)・複数エリア対応。DOMには一切触れない。
//
// ============================================================
// 単価定数(確認日は各エリアのverifiedOn。一次情報で確認・算術検証済み)
// 出典:
//  - ドコモでんき料金単価表: https://denki.docomo.ne.jp/plan/price/
//  - 燃料費等調整単価: https://denki.docomo.ne.jp/fuel-cost/
//    過去分の実データ: https://denki.docomo.ne.jp/unitprice/adjust/FL21000_adjust_yyyyMM.JSON
//    (エリアコード: 06=関西 pattern10 / 08=四国 pattern301。⚠️07は中国電力なので注意)
//    各プリセットのsaiene=その月の再エネ賦課金単価(〜26年4月分3.98/26年5月分〜4.18)
//    reg(規制料金の燃調・比較用)は検証済みの月のみ。nullの月は比較非表示
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

  // Greenのエリア別還元率から選択肢を生成(★検針月で新旧の料率表が切り替わる)
  // 2026年11月検針分(10月使用分)からdカードPLATINUMの還元率・条件が変更
  // 出典: https://denki.docomo.ne.jp/plan/green_kansai/ (新旧2表を掲載・2026-09-04確認)
  greenRatesFor(areaKey, monthKey) {
    const A = this.areas[areaKey] || this.areas.kansai;
    const isNew = (monthKey || "") >= "2026-11";
    return { rates: isNew ? A.greenPointNew : A.greenPointOld, isNew };
  },

  greenPointOptions(areaKey, monthKey) {
    const { rates: g, isNew } = this.greenRatesFor(areaKey, monthKey);
    // PLATINUMは新旧で条件名が変わる(初年度/2年目以降 → 入会2か月目まで/3か月目以降)
    const platHi = isNew ? "入会2か月目まで・月20万円以上" : "初年度・2年目以降の月20万円以上";
    const platMid = isNew ? "3か月目以降の月10〜20万円" : "2年目以降の月10〜20万円";
    const platLow = isNew ? "3か月目以降の月10万円未満" : "2年目以降の月10万円未満";
    return [
      { key: "g_normal", label: `対象回線 × 一般dカード払い(${g.normal}%)`, pct: g.normal },
      { key: "g_gold", label: `対象回線 × dカードGOLD/GOLD U払い(${g.gold}%)`, pct: g.gold },
      { key: "g_plat_hi", label: `対象回線 × PLATINUM払い ${platHi}(${g.platHi}%)`, pct: g.platHi },
      { key: "g_plat_mid", label: `対象回線 × PLATINUM払い ${platMid}(${g.platMid}%)`, pct: g.platMid },
      { key: "g_plat_low", label: `対象回線 × PLATINUM払い ${platLow}(${g.platLow}%)`, pct: g.platLow },
      { key: "g_goldOther", label: `対象回線 × GOLD/PLATINUM会員でdカード以外(${g.goldOther}%)`, pct: g.goldOther },
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
        { key: "2025-10", label: "25年10月分", saiene: 3.98, docomo: { fix: 9.6, unit: 0.64 }, reg: null },
        { key: "2025-11", label: "25年11月分", saiene: 3.98, docomo: { fix: 39.35, unit: 2.62 }, reg: null },
        { key: "2025-12", label: "25年12月分", saiene: 3.98, docomo: { fix: 39.11, unit: 2.61 }, reg: null },
        { key: "2026-01", label: "26年1月分", saiene: 3.98, docomo: { fix: 39.11, unit: 2.61 }, reg: null },
        { key: "2026-02", label: "26年2月分", saiene: 3.98, docomo: { fix: -28.64, unit: -1.91 }, reg: null },
        { key: "2026-03", label: "26年3月分", saiene: 3.98, docomo: { fix: -26.91, unit: -1.79 }, reg: null },
        { key: "2026-04", label: "26年4月分", saiene: 3.98, docomo: { fix: 20.32, unit: 1.35 }, reg: null },
        { key: "2026-05", label: "26年5月分", saiene: 4.18, docomo: { fix: 43.56, unit: 2.9 }, reg: { fix: 33.66, unit: 2.24 } },
        { key: "2026-06", label: "26年6月分", saiene: 4.18, docomo: { fix: 44.55, unit: 2.97 }, reg: { fix: 33.66, unit: 2.24 } },
        { key: "2026-07", label: "26年7月分", saiene: 4.18, docomo: { fix: 46.04, unit: 3.07 }, reg: { fix: 33.66, unit: 2.24 } },
        { key: "2026-08", label: "26年8月分", saiene: 4.18, docomo: { fix: -0.52, unit: -0.03 }, reg: { fix: -18.84, unit: -1.26 } },
        { key: "2026-09", label: "26年9月分", saiene: 4.18, docomo: { fix: -10.57, unit: -0.7 }, reg: null },
        { key: "2026-10", label: "26年10月分", saiene: 4.18, docomo: { fix: 12.84, unit: 0.86 }, reg: null },
      ],
      // Green還元率(関西・公式ページの新旧2表から・2026-09-04確認)
      greenPointOld: { platHi: 20, platMid: 15, platLow: 10, gold: 10, goldOther: 9, normal: 5, normalOther: 4, noLineCard: 2, noLineOther: 1 },
      greenPointNew: { platHi: 12, platMid: 11, platLow: 10, gold: 10, goldOther: 9, normal: 5, normalOther: 4, noLineCard: 2, noLineOther: 1 },
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
        { key: "2025-10", label: "25年10月分", saiene: 3.98, docomo: { fix: -102.63, unit: -9.33 }, reg: null },
        { key: "2025-11", label: "25年11月分", saiene: 3.98, docomo: { fix: -80.13, unit: -7.28 }, reg: null },
        { key: "2025-12", label: "25年12月分", saiene: 3.98, docomo: { fix: -79.62, unit: -7.24 }, reg: null },
        { key: "2026-01", label: "26年1月分", saiene: 3.98, docomo: { fix: -78.6, unit: -7.15 }, reg: null },
        { key: "2026-02", label: "26年2月分", saiene: 3.98, docomo: { fix: -127.93, unit: -11.63 }, reg: null },
        { key: "2026-03", label: "26年3月分", saiene: 3.98, docomo: { fix: -127.09, unit: -11.55 }, reg: null },
        { key: "2026-04", label: "26年4月分", saiene: 3.98, docomo: { fix: -93.58, unit: -8.51 }, reg: null },
        { key: "2026-05", label: "26年5月分", saiene: 4.18, docomo: { fix: -76.57, unit: -6.96 }, reg: { fix: -76.57, unit: -6.96 } },
        { key: "2026-06", label: "26年6月分", saiene: 4.18, docomo: { fix: -76.23, unit: -6.93 }, reg: { fix: -76.23, unit: -6.93 } },
        { key: "2026-07", label: "26年7月分", saiene: 4.18, docomo: { fix: -74.2, unit: -6.75 }, reg: { fix: -74.2, unit: -6.75 } },
        { key: "2026-08", label: "26年8月分", saiene: 4.18, docomo: { fix: -107.78, unit: -9.8 }, reg: { fix: -107.78, unit: -9.8 } },
        { key: "2026-09", label: "26年9月分", saiene: 4.18, docomo: { fix: -111.84, unit: -10.17 }, reg: null },
        { key: "2026-10", label: "26年10月分", saiene: 4.18, docomo: { fix: -97.11, unit: -8.83 }, reg: null },
      ],
      // Green還元率(★四国は関西より低い・公式ページの新旧2表から・2026-09-04確認)
      greenPointOld: { platHi: 12, platMid: 9, platLow: 6, gold: 6, goldOther: 5, normal: 4, normalOther: 3, noLineCard: 2, noLineOther: 1 },
      greenPointNew: { platHi: 8, platMid: 7, platLow: 6, gold: 6, goldOther: 5, normal: 4, normalOther: 3, noLineCard: 2, noLineOther: 1 },
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
