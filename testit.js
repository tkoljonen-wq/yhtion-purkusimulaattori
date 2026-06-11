// Ajaa HTML-tiedoston todellisen <script>-lohkon DOM-stubeilla ja testaa laskennan
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/yhtion_purkusimulaattori.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const inputDefaults = {};
for (const m of html.matchAll(/<input id="(\w+)"[^>]*value="([^"]*)"/g)) inputDefaults[m[1]] = m[2];

const elements = {};
function getEl(id) {
  if (!elements[id]) elements[id] = {
    value: inputDefaults[id] !== undefined ? inputDefaults[id] : '0',
    innerHTML: '', textContent: '', clientWidth: 800, clientHeight: 340,
    addEventListener() {},
  };
  return elements[id];
}
const documentStub = { getElementById: getEl };
const windowStub = { addEventListener() {} };

const api = new Function('document', 'window', script + `
  return { simulateCandidate, pickRecommendation, collectInputs, earnedTaxSimple, withdrawalForNetNeed, run };
`)(documentStub, windowStub);

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

// --- Testi 1: oletusarvot, suositus = aidosti pienin aste ---
const inputs = api.collectInputs();
const results = [];
for (let y = 0; y <= inputs.years; y++) results.push(api.simulateCandidate(inputs, y));
console.log('\nOletusarvot:');
results.forEach(r => console.log(`  vuosi ${String(r.liquidationYear).padStart(2)}: eff ${(r.shareholderEffectiveRate*100).toFixed(3)} %  netto ${Math.round(r.totalNetToShareholders)} €${r.depleted ? ' (varat loppu v.' + r.depletedYear + ')' : ''}`));
const best = api.pickRecommendation(results);
const trueMin = results.filter(r => !r.depleted).reduce((a, b) => b.shareholderEffectiveRate < a.shareholderEffectiveRate ? b : a);
console.log(`Suositus: vuosi ${best.liquidationYear} (${(best.shareholderEffectiveRate*100).toFixed(3)} %)`);
check('suositus on pienimmän veroasteen vuosi', best.liquidationYear === trueMin.liquidationYear);

// --- Testi 2: varojen ehtyminen ei tuota NaN/Infinity ---
const small = { ...inputs, marketValue: 5000, bookValue: 4000, distributableReserves: 1000, annualDividend: 0, years: 8 };
let badNumber = false, anyDepleted = false;
for (let y = 0; y <= 8; y++) {
  const r = api.simulateCandidate(small, y);
  if (r.depleted) anyDepleted = true;
  for (const k of ['preLiquidationNetAssets', 'liquidationCorpTax', 'totalNetToShareholders', 'shareholderEffectiveRate', 'allInEffectiveRate']) {
    if (!isFinite(r[k])) { badNumber = true; console.log(`  ei-äärellinen ${k} vuonna ${y}: ${r[k]}`); }
  }
  r.yearly.forEach(row => { if (!isFinite(row.endMarketValue) || !isFinite(row.distributableReserves)) badNumber = true; });
}
check('ehtymisskenaario: kaikki luvut äärellisiä', !badNumber);
check('ehtymisskenaario: depleted-lippu asetetaan', anyDepleted);

// --- Testi 3: all-in-aste kun jakaja 0 (velat >= varat, ei osinkoja) ---
const broke = { ...inputs, marketValue: 100000, bookValue: 100000, liabilities: 200000, annualDividend: 0, distributableReserves: 0, years: 2 };
const rBroke = api.simulateCandidate(broke, 0);
check('all-in-aste 0 kun bruttojako 0', rBroke.allInEffectiveRate === 0 && rBroke.shareholderEffectiveRate === 0);

// --- Testi 4: yhteisöveron kulువähennys: nosto pelkkiin kuluihin, voitto <= kulut -> vero 0 ---
const wd1 = api.withdrawalForNetNeed(2000, 600000, 400000, 0.20, 2000);
// voitto-osuus 1/3 -> 2000*1/3 = 667 < 2000 -> ei veroa, nosto = tarve
check('kulut vähennetään veropohjasta (vero 0, kun voitto < kulut)', Math.abs(wd1.corpTax) < 1e-9 && Math.abs(wd1.withdrawal - 2000) < 1e-9);
// suurempi tarve: vero = (voitto - kulut) * 20 % ja netto täsmää
const wd2 = api.withdrawalForNetNeed(32000, 600000, 400000, 0.20, 2000);
const netto2 = wd2.withdrawal - wd2.corpTax;
const vero2 = Math.max(0, wd2.realizedGain - 2000) * 0.20;
check('noston algebra täsmää kuluvähennyksellä', Math.abs(netto2 - 32000) < 1e-6 && Math.abs(wd2.corpTax - vero2) < 1e-6);

// --- Testi 5: ansiotuloveron marginaali 40 t€ kohdalla ~39 % ---
const marg = api.earnedTaxSimple(41000) - api.earnedTaxSimple(40000);
console.log(`Marginaalivero 40–41 t€: ${(marg/10).toFixed(2)} %`);
check('marginaali 40 t€: 35–43 %', marg / 1000 > 0.35 && marg / 1000 < 0.43);

// --- Testi 6: run() toimii päästä päähän eikä tulosta NaN ---
api.run();
const compHtml = getEl('comparisonTable').innerHTML;
const yearHtml = getEl('yearlyTable').innerHTML;
check('run() tuottaa taulukot', compHtml.includes('<tbody>') && yearHtml.includes('<tbody>'));
check('taulukoissa ei NaN/epälukuja', !/NaN|epäluku|Infinity|∞/.test(compHtml + yearHtml));

// --- Testi 7: vuosi 0 käsin laskettu tarkistus (19,97 %) ---
const r0 = results[0];
check('vuosi 0: eff 19,97 % (käsin laskettu)', Math.abs(r0.shareholderEffectiveRate - 0.1997142857) < 1e-4);

console.log(failures ? `\n${failures} TESTIÄ EPÄONNISTUI` : '\nKaikki testit OK');
process.exit(failures ? 1 : 0);
