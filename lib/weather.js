// Real weather via Open-Meteo. No API key, no dependency — Node 18+ has global
// fetch built in. Two calls: geocode the place name, then fetch the forecast.
// Geocode results are cached in-memory to be polite.

const geoCache = new Map();

const WEATHER_CODES = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'foggy', 48: 'rimy fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  85: 'snow showers', 86: 'snow showers',
  95: 'a thunderstorm', 96: 'a thunderstorm with hail', 99: 'a thunderstorm with hail',
};

async function geocode(place) {
  const key = place.toLowerCase().trim();
  if (geoCache.has(key)) return geoCache.get(key);

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const hit = json.results?.[0];
  const loc = hit
    ? {
        lat: hit.latitude,
        lon: hit.longitude,
        label: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', '),
      }
    : null;
  geoCache.set(key, loc);
  return loc;
}

// Returns { label, temp, feels, desc, wind } (Celsius, km/h) or null if the
// place can't be found. Numbers are real — never invented.
async function getWeather(place) {
  const loc = await geocode(place);
  if (!loc) return null;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
    + '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m';
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const c = json.current;
  if (!c) return null;

  return {
    label: loc.label,
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    desc: WEATHER_CODES[c.weather_code] ?? 'doing something',
    wind: Math.round(c.wind_speed_10m),
  };
}

module.exports = { getWeather };
