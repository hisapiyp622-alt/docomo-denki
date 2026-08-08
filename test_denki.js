// ドコモでんきシミュレーター 計算ロジックのユニットテスト
// 実行: node test_denki.js
const { DENKI_CONSTANTS, calcDenki } = require("./denki.js");

let failed = 0;
function eq(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "OK " : "NG "} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

// ★関西・黄金ケース: 関電公式モデル(従量電灯A・260kWh・2026年7月分・口振割引込7,843円)
const g = calcDenki({ area: "kansai", kwh: 260, plan: "basic", fuelFix: 33.66, fuelUnit: 2.24, saieneUnit: 4.18, pointPct: 0, regFuelFix: 33.66, regFuelUnit: 2.24 });
console.log("=== 関西・黄金ケース: 関電モデル260kWh・26年7月分 ===");
eq("energy(6,230.03)", Math.round(g.energy * 100) / 100, 6230.03);
eq("燃調(582.46)", Math.round(g.fuel * 100) / 100, 582.46);
eq("再エネ(1,086)", g.saiene, 1086);
eq("合計(7,898)", g.total, 7898);
eq("口振割引後(7,843)=関電公式モデル", g.reg.totalWithKoufuri, 7843);

console.log("\n=== 関西ドコモBasic 260kWh 26年7月分 ===");
const d = calcDenki({ area: "kansai", kwh: 260, plan: "basic", fuelFix: 46.04, fuelUnit: 3.07, saieneUnit: 4.18, pointPct: 2, regFuelFix: 33.66, regFuelUnit: 2.24 });
eq("燃調(798.19)", Math.round(d.fuel * 100) / 100, 798.19);
eq("合計(8,114)", d.total, 8114);
eq("税抜対象(5,663)", d.taxExcl, 5663);
eq("dポイント(112)", d.points, 112);
eq("実質(8,002)", d.net, 8002);
eq("関電比較差(+216)", d.reg.diff, 216);

console.log("\n=== 関西Green 260kWh 26年7月分 ===");
const gr = calcDenki({ area: "kansai", kwh: 260, plan: "green", fuelFix: 46.04, fuelUnit: 3.07, saieneUnit: 4.18, pointPct: 10 });
eq("合計(8,614)=Basic+500", gr.total, 8614);
eq("dポイント(610)", gr.points, 610);
eq("実質(8,004)", gr.net, 8004);

console.log("\n=== 関西10kWh(最低料金圏)・段階境界 ===");
const s = calcDenki({ area: "kansai", kwh: 10, plan: "basic", fuelFix: 46.04, fuelUnit: 3.07, saieneUnit: 4.18, pointPct: 0 });
eq("energy(522.58)", s.energy, 522.58);
eq("燃調(46.04・定額のみ)", s.fuel, 46.04);
eq("合計(609)", s.total, 609);
eq("120kWh(2,644)", calcDenki({ area: "kansai", kwh: 120, plan: "basic", fuelFix: 0, fuelUnit: 0, saieneUnit: 0, pointPct: 0 }).total, 2644);
eq("300kWh(7,254)", calcDenki({ area: "kansai", kwh: 300, plan: "basic", fuelFix: 0, fuelUnit: 0, saieneUnit: 0, pointPct: 0 }).total, 7254);
eq("301kWh(7,283)", calcDenki({ area: "kansai", kwh: 301, plan: "basic", fuelFix: 0, fuelUnit: 0, saieneUnit: 0, pointPct: 0 }).total, 7283);

console.log("\n=== ガスセット+2% ===");
const gs = calcDenki({ area: "kansai", kwh: 260, plan: "basic", fuelFix: 46.04, fuelUnit: 3.07, saieneUnit: 4.18, pointPct: 2, gasSet: true });
eq("還元率4%", gs.pct, 4);
eq("dポイント(224)", gs.points, 224);

// ★四国・黄金ケース: 四電公式モデル(従量電灯A・260kWh・口振割引55円込・再エネ込)
console.log("\n=== 四国・黄金ケース: 四電モデル260kWh ===");
const sk7 = calcDenki({ area: "shikoku", kwh: 260, plan: "basic", fuelFix: -74.20, fuelUnit: -6.75, saieneUnit: 4.18, pointPct: 0, regFuelFix: -74.20, regFuelUnit: -6.75 });
eq("energy(9,225.54)", Math.round(sk7.energy * 100) / 100, 9225.54);
eq("燃調(-1,754.95)", Math.round(sk7.fuel * 100) / 100, -1754.95);
eq("合計(8,556)", sk7.total, 8556);
eq("口振割引後(8,501)=四電26年7月モデル", sk7.reg.totalWithKoufuri, 8501);
const sk6 = calcDenki({ area: "shikoku", kwh: 260, plan: "basic", fuelFix: -76.23, fuelUnit: -6.93, saieneUnit: 4.18, pointPct: 0, regFuelFix: -76.23, regFuelUnit: -6.93 });
eq("6月分・口振割引後(8,454)=四電26年6月モデル", sk6.reg.totalWithKoufuri, 8454);

console.log("\n=== 四国Green・境界 ===");
eq("Green合計(9,056)=Basic+500", calcDenki({ area: "shikoku", kwh: 260, plan: "green", fuelFix: -74.20, fuelUnit: -6.75, saieneUnit: 4.18, pointPct: 10 }).total, 9056);
const sk11 = calcDenki({ area: "shikoku", kwh: 11, plan: "basic", fuelFix: -74.20, fuelUnit: -6.75, saieneUnit: 4.18, pointPct: 0 });
eq("11kWh: energy(666.89)", sk11.energy, 666.89);
eq("11kWh: 合計(637)", sk11.total, 637);
eq("120kWh(4,007)", calcDenki({ area: "shikoku", kwh: 120, plan: "basic", fuelFix: 0, fuelUnit: 0, saieneUnit: 0, pointPct: 0 }).total, 4007);

console.log("\n=== Green還元率のエリア別データ(region.json) ===");
eq("関西GOLD(10)", DENKI_CONSTANTS.areas.kansai.greenPointData.gold, 10);
eq("四国GOLD(6)", DENKI_CONSTANTS.areas.shikoku.greenPointData.gold, 6);
eq("四国PLATINUM初年度(12)", DENKI_CONSTANTS.areas.shikoku.greenPointData.plat1, 12);
eq("四国一般dカード(4)", DENKI_CONSTANTS.areas.shikoku.greenPointData.normal, 4);
eq("四国オプション数(7)", DENKI_CONSTANTS.greenPointOptions("shikoku").length, 7);
eq("関西g_plat pct(20)", DENKI_CONSTANTS.greenPointOptions("kansai").find(o => o.key === "g_plat").pct, 20);

console.log("\n=== 過去1年分プリセットの整合性 ===");
for (const [name, A] of Object.entries(DENKI_CONSTANTS.areas)) {
  eq(`${name} プリセット数(13)`, A.fuelPresets.length, 13);
  let bad = 0;
  for (const p of A.fuelPresets) {
    // 定額部分 ≒ minKwh × 単価(公式の丸めで最大±0.08円ズレ)
    if (Math.abs(p.docomo.fix - p.docomo.unit * A.minKwh) > 0.08) bad++;
    // 再エネ年度切替: 〜26年4月分=3.98、26年5月分〜=4.18
    const expectSaiene = p.key >= "2026-05" ? 4.18 : 3.98;
    if (p.saiene !== expectSaiene) bad++;
  }
  eq(`${name} 全13ヶ月の定額×単価整合+再エネ年度(0件不整合)`, bad, 0);
}
// 既知値スポット: 関西26年2月分(補助込マイナス)・四国25年9月分
eq("関西26年2月分(-1.91)", DENKI_CONSTANTS.areas.kansai.fuelPresets.find(p => p.key === "2026-02").docomo.unit, -1.91);
eq("四国25年9月分(-9.59)", DENKI_CONSTANTS.areas.shikoku.fuelPresets.find(p => p.key === "2025-09").docomo.unit, -9.59);

console.log(failed === 0 ? "\n✅ 全テスト成功" : `\n❌ ${failed}件失敗`);
process.exit(failed === 0 ? 0 : 1);
