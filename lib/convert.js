// Local, deterministic unit conversion. No LLM math — that's exactly the
// "confidently wrong" failure the house rule forbids ("show nothing rather than
// something false"). Unknown unit pairs are refused, not guessed.

// Each table maps a unit (and its common aliases) to a base unit:
// length -> meters, mass -> grams, volume -> liters.
const LENGTH = {
  mm: 0.001, cm: 0.01, m: 1, meter: 1, metre: 1, km: 1000,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
  yd: 0.9144, yard: 0.9144, yards: 0.9144,
  mi: 1609.344, mile: 1609.344, miles: 1609.344,
};

const MASS = {
  mg: 0.001, g: 1, gram: 1, grams: 1, kg: 1000, kilo: 1000, kilos: 1000,
  oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125,
  lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237,
  st: 6350.29318, stone: 6350.29318,
  t: 1_000_000, tonne: 1_000_000, tonnes: 1_000_000,
};

const VOLUME = {
  ml: 0.001, l: 1, liter: 1, litre: 1, liters: 1, litres: 1,
  tsp: 0.00492892, tbsp: 0.0147868,
  cup: 0.236588, cups: 0.236588,
  pt: 0.473176, pint: 0.473176, pints: 0.473176,
  qt: 0.946353, quart: 0.946353, quarts: 0.946353,
  gal: 3.785411784, gallon: 3.785411784, gallons: 3.785411784,
  floz: 0.0295735, 'fl oz': 0.0295735,
};

const TEMP = new Set(['c', 'celsius', 'f', 'fahrenheit', 'k', 'kelvin']);

const normUnit = u => String(u).trim().toLowerCase();

function convertTemp(v, from, to) {
  let c; // to celsius first
  if (from[0] === 'c') c = v;
  else if (from[0] === 'f') c = (v - 32) * 5 / 9;
  else c = v - 273.15; // kelvin

  if (to[0] === 'c') return c;
  if (to[0] === 'f') return c * 9 / 5 + 32;
  return c + 273.15;
}

// Returns { ok: true, value } or { ok: false }.
function convert(value, from, to) {
  from = normUnit(from);
  to = normUnit(to);

  if (TEMP.has(from) && TEMP.has(to)) {
    return { ok: true, value: convertTemp(value, from, to) };
  }
  for (const table of [LENGTH, MASS, VOLUME]) {
    if (table[from] != null && table[to] != null) {
      return { ok: true, value: value * table[from] / table[to] };
    }
  }
  return { ok: false };
}

// Trim float noise to at most 4 significant-ish decimals.
function round(n) {
  return Math.round(n * 10000) / 10000;
}

module.exports = { convert, round };
