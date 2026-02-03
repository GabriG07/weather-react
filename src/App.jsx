import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  MapPin,
  Loader2,
  Droplets,
  Wind,
  Eye,
  Thermometer,
  Star,
  StarOff,
  RefreshCcw,
  Sun,
  Moon,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";


//Chaves para persistência no localstorage, com versionamento para o caso de mudanças no formato no futuro
const STORAGE_KEYS = {
  favorites: "wx_favorites_v1",
  lastPlace: "wx_last_place_v1",
  settings: "wx_settings_v1",
};

const clamp = (n, a, b) => Math.max(a, Math.min(b, n)); //garente que um numero (n) fique dentro do intervalo [a, b]

//Faz o parse do json, retornando o fallback em caso de erro
function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadLS(key, fallback) {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key);
  return v ? safeJsonParse(v, fallback) : fallback;
}

function saveLS(key, value) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function formatTemp(t) {
  if (t == null || Number.isNaN(t)) return "–";
  return `${Math.round(t)}°`;
}

function formatSpeed(v, unit) {
  if (v == null || Number.isNaN(v)) return "–";
  return unit === "imperial" ? `${Math.round(v)} mph` : `${Math.round(v)} km/h`;
}

function formatDistance(v, unit) {
  if (v == null || Number.isNaN(v)) return "–";
  // open-meteo visibility is meters
  const km = v / 1000;
  if (unit === "imperial") {
    const miles = km * 0.621371;
    return miles >= 1 ? `${miles.toFixed(1)} mi` : `${Math.round(miles * 5280)} ft`;
  }
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(v)} m`;
}

function formatTimeLabel(iso, locale = "pt-BR") {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDayLabel(iso, locale = "pt-BR") {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, { weekday: "short" });
  } catch {
    return "";
  }
}

function wxEmoji(code, isDay) {
  // https://open-meteo.com/en/docs
  if (code == null) return "❔";
  if (code === 0) return isDay ? "☀️" : "🌙";
  if ([1, 2].includes(code)) return isDay ? "🌤️" : "☁️";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55].includes(code)) return "🌦️";
  if ([56, 57].includes(code)) return "🌧️";
  if ([61, 63, 65].includes(code)) return "🌧️";
  if ([66, 67].includes(code)) return "🌧️";
  if ([71, 73, 75, 77].includes(code)) return "🌨️";
  if ([80, 81, 82].includes(code)) return "🌧️";
  if ([85, 86].includes(code)) return "🌨️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "🌡️";
}

function wxLabelPT(code) {
  if (code == null) return "–";
  const map = {
    0: "Céu limpo",
    1: "Principalmente limpo",
    2: "Parcialmente nublado",
    3: "Nublado",
    45: "Neblina",
    48: "Neblina com gelo",
    51: "Garoa fraca",
    53: "Garoa moderada",
    55: "Garoa forte",
    56: "Garoa congelante fraca",
    57: "Garoa congelante forte",
    61: "Chuva fraca",
    63: "Chuva moderada",
    65: "Chuva forte",
    66: "Chuva congelante fraca",
    67: "Chuva congelante forte",
    71: "Neve fraca",
    73: "Neve moderada",
    75: "Neve forte",
    77: "Grãos de neve",
    80: "Pancadas fracas",
    81: "Pancadas moderadas",
    82: "Pancadas fortes",
    85: "Pancadas de neve fracas",
    86: "Pancadas de neve fortes",
    95: "Trovoada",
    96: "Trovoada com granizo fraco",
    99: "Trovoada com granizo forte",
  };
  return map[code] || "Condição variável";
}

function bgGradientFromTemp(tempC, isDay, theme) {
  const t = clamp(tempC ?? 20, -5, 40);
  const cool = t < 14;
  const hot = t > 28;

  if (theme === "dark") {
    //Dark theme
    if (!isDay) return "from-zinc-950 via-zinc-950 to-indigo-950";
    if (hot) return "from-zinc-950 to-amber-900";
    if (cool) return "from-zinc-900 via-sky-900 to-sky-500";
    return "from-zinc-900 via-zinc-950 to-gray-900";
  }

  //Light theme
  const base = "from-white via-white";
  if (!isDay) return `${base} to-indigo-100`;
  if (hot) return `${base} to-amber-100`;
  if (cool) return `${base} to-sky-100`;
  return `${base} to-emerald-50`;
}

//Normaliza um resultado de geocoding para um formato consistente
//Ajuda a não depender do shape exato retornado pela API
function normalizePlace(p) {
  if (!p) return null;
  return {
    id: p.id ?? `${p.latitude},${p.longitude}`,
    name: p.name,
    admin1: p.admin1,
    country: p.country,
    latitude: p.latitude,
    longitude: p.longitude,
    timezone: p.timezone,
  };
}

function placeLabel(p) {
  if (!p) return "";
  const parts = [p.name, p.admin1, p.country].filter(Boolean);
  return parts.join(", ");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Open-Meteo endpoints
async function geocode(query, count = 6, language = "pt") {
  const q = encodeURIComponent(query.trim());
  const url = `/wx-geo/v1/search?name=${q}&count=${count}&language=${language}&format=json`;
  const data = await fetchJson(url);
  return (data?.results || []).map(normalizePlace);
}


// Reverse geocode via Nominatim
async function reverseGeocodeOSM(lat, lon, language = "pt-BR") {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=${language}`;

  const data = await fetchJson(url);
  const a = data?.address || {};

  const name = a.city || a.town || a.village || a.county || "Minha localização";
  const admin1 = a.state || "";
  const country = a.country || "";

  return [{
    id: `osm:${lat},${lon}`,
    name,
    admin1,
    country,
    latitude: lat,
    longitude: lon,
    timezone: "auto",
  }];
}

//Busca previsao no Open-Meteo
async function fetchForecast(place, unit = "metric") {
  const tempUnit = unit === "imperial" ? "fahrenheit" : "celsius";
  const windUnit = unit === "imperial" ? "mph" : "kmh";

  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    timezone: place.timezone || "auto",
    temperature_unit: tempUnit,
    wind_speed_unit: windUnit,
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "weather_code",
      "wind_speed_10m",
      "visibility",
      "is_day",
    ].join(","),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "weather_code",
      "wind_speed_10m",
      "visibility",
      "precipitation_probability",
    ].join(","),
    daily: ["weather_code", "temperature_2m_max", "temperature_2m_min", "sunrise", "sunset"].join(","),
    forecast_days: "7",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  return fetchJson(url);
}

//Monta a série horária a partir do momento atual
function buildHourlySeries(data, nowISO, hours = 24, locale = "pt-BR") {
  const times = data?.hourly?.time || [];
  const temps = data?.hourly?.temperature_2m || [];
  const feels = data?.hourly?.apparent_temperature || [];
  const pop = data?.hourly?.precipitation_probability || [];

  const now = nowISO ? new Date(nowISO).getTime() : Date.now();
  let startIdx = 0;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (t >= now) {
      startIdx = i;
      break;
    }
  }

  const out = [];
  for (let i = startIdx; i < Math.min(times.length, startIdx + hours); i++) {
    out.push({
      time: formatTimeLabel(times[i], locale),
      temp: temps[i],
      feels: feels[i],
      pop: pop[i],
      iso: times[i],
    });
  }
  return out;
}

//Monta série diária com labels (Seg, Ter, ...).
function buildDailySeries(data, locale = "pt-BR") {
  const t = data?.daily?.time || [];
  const max = data?.daily?.temperature_2m_max || [];
  const min = data?.daily?.temperature_2m_min || [];
  const code = data?.daily?.weather_code || [];
  const sunrise = data?.daily?.sunrise || [];
  const sunset = data?.daily?.sunset || [];

  return t.map((day, i) => ({
    day,
    label: formatDayLabel(day, locale).replace(/^./, (c) => c.toLocaleUpperCase(locale)),
    max: max[i],
    min: min[i],
    code: code[i],
    sunrise: sunrise[i],
    sunset: sunset[i],
  }));
}

function isSamePlace(a, b) {
  if (!a || !b) return false;
  const keyA = `${a.latitude.toFixed(4)}:${a.longitude.toFixed(4)}`;
  const keyB = `${b.latitude.toFixed(4)}:${b.longitude.toFixed(4)}`;
  return keyA === keyB;
}

function Pill({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/60 bg-white/70 px-4 py-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-900/40">
      <div className="rounded-xl border border-zinc-200/60 bg-white p-2 dark:border-white/10 dark:bg-zinc-950/40">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{value}</div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-3xl border border-zinc-200/60 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-900/40">
      <div className="h-6 w-52 rounded bg-zinc-200/70 dark:bg-white/10" />
      <div className="mt-4 h-10 w-36 rounded bg-zinc-200/70 dark:bg-white/10" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl bg-zinc-200/70 dark:bg-white/10" />
        ))}
      </div>
    </div>
  );
}

function ErrorCard({ title, message, onRetry }) {
  return (
    <div className="rounded-3xl border border-rose-200/60 bg-rose-50/70 p-6 shadow-sm backdrop-blur dark:border-rose-400/20 dark:bg-rose-950/30">
      <div className="text-sm font-semibold text-rose-900 dark:text-rose-100">{title}</div>
      <div className="mt-2 text-sm text-rose-700 dark:text-rose-200">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700"
        >
          <RefreshCcw className="h-4 w-4" /> Tentar de novo
        </button>
      )}
    </div>
  );
}

function TopBar({
  query,
  setQuery,
  suggestions,
  isSearching,
  onPick,
  onLocate,
  unit,
  setUnit,
  theme,
  setTheme,
}) {
  const inputRef = useRef(null);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="relative w-full md:max-w-xl">
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
          <Search className="h-5 w-5" />
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cidade… (ex.: São Paulo, Recife, Porto Alegre)"
          className="w-full rounded-2xl border border-zinc-200/60 bg-white/70 py-3 pl-11 pr-12 text-sm shadow-sm backdrop-blur outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-300 dark:border-white/10 dark:bg-zinc-900/40 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-300">
          {isSearching ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        </div>

        <AnimatePresence>
          {suggestions.length > 0 && query.trim().length > 1 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-zinc-200/60 bg-white/90 shadow-lg backdrop-blur dark:border-white/10 dark:bg-zinc-950/70"
            >
              <ul className="max-h-80 overflow-auto">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => {
                        onPick(s);
                        setQuery("");
                        inputRef.current?.blur();
                      }}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-zinc-50 dark:hover:bg-white/5"
                    >
                      <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">{placeLabel(s)}</span>
                      <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                        {s.latitude.toFixed(2)}, {s.longitude.toFixed(2)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onLocate}
          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200/60 bg-white/70 px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm backdrop-blur hover:bg-white dark:border-white/10 dark:bg-zinc-900/40 dark:text-zinc-50 dark:hover:bg-zinc-900/70"
          title="Usar minha localização"
        >
          <MapPin className="h-4 w-4" /> Localização
        </button>

        <div className="inline-flex overflow-hidden rounded-2xl border border-zinc-200/60 bg-white/70 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-900/40">
          <button
            onClick={() => setUnit("metric")}
            className={`px-4 py-2.5 text-sm font-semibold ${unit === "metric"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-700 hover:bg-white dark:text-zinc-200 dark:hover:bg-white/5"
              }`}
          >
            °C
          </button>
          <button
            onClick={() => setUnit("imperial")}
            className={`px-4 py-2.5 text-sm font-semibold ${unit === "imperial"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-700 hover:bg-white dark:text-zinc-200 dark:hover:bg-white/5"
              }`}
          >
            °F
          </button>
        </div>

        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200/60 bg-white/70 px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm backdrop-blur hover:bg-white dark:border-white/10 dark:bg-zinc-900/40 dark:text-zinc-50 dark:hover:bg-zinc-900/70"
          title="Alternar tema"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Claro" : "Escuro"}
        </button>
      </div>
    </div>
  );
}

function FavoriteChips({ favorites, current, onPick, onToggle }) {
  if (!favorites.length) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {favorites.map((p) => {
        const active = current && isSamePlace(current, p);
        return (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className={`group inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm shadow-sm backdrop-blur transition ${active
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
              : "border-zinc-200/60 bg-white/70 text-zinc-900 hover:bg-white dark:border-white/10 dark:bg-zinc-900/40 dark:text-zinc-50 dark:hover:bg-zinc-900/70"
              }`}
            title={placeLabel(p)}
          >
            <span className="max-w-[16rem] truncate font-semibold">{p.name}</span>
            <span className={`text-xs ${active ? "text-white/80 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
              {p.country}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onToggle(p);
              }}
              className={`ml-1 inline-flex rounded-xl p-1 ${active ? "hover:bg-white/15 dark:hover:bg-zinc-900/10" : "hover:bg-zinc-50 dark:hover:bg-white/5"}`}
              title="Remover dos favoritos"
              role="button"
              tabIndex={0}
            >
              <StarOff className="h-4 w-4" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CurrentCard({ place, data, unit, onToggleFavorite, isFavorite }) {
  const current = data?.current || {};
  const isDay = Boolean(current?.is_day);

  const wxCode = current?.weather_code;
  const temp = current?.temperature_2m;
  const feels = current?.apparent_temperature;
  const humidity = current?.relative_humidity_2m;
  const wind = current?.wind_speed_10m;
  const visibility = current?.visibility;

  return (
    <div className="rounded-3xl border border-zinc-200/60 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-900/40">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="text-3xl" aria-hidden>
              {wxEmoji(wxCode, isDay)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">{placeLabel(place)}</div>
              <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{wxLabelPT(wxCode)}</div>
            </div>
          </div>

          <div className="mt-4 flex items-end gap-3">
            <div className="text-5xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{formatTemp(temp)}</div>
            <div className="pb-1 text-sm text-zinc-600 dark:text-zinc-300">
              Sensação {formatTemp(feels)} • {unit === "imperial" ? "°F" : "°C"}
            </div>
          </div>
        </div>

        <button
          onClick={onToggleFavorite}
          className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition ${isFavorite
            ? "bg-amber-500 text-white hover:bg-amber-600"
            : "border border-zinc-200/60 bg-white/70 text-zinc-900 hover:bg-white dark:border-white/10 dark:bg-zinc-950/40 dark:text-zinc-50 dark:hover:bg-zinc-900/70"
            }`}
          title={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
        >
          <Star className="h-4 w-4" /> {isFavorite ? "Favorito" : "Favoritar"}
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Pill icon={Droplets} label="Umidade" value={`${humidity ?? "–"}%`} />
        <Pill icon={Wind} label="Vento" value={formatSpeed(wind, unit)} />
        <Pill icon={Eye} label="Visibilidade" value={formatDistance(visibility, unit)} />
        <Pill icon={Thermometer} label="Unidade" value={unit === "imperial" ? "Fahrenheit" : "Celsius"} />
      </div>
    </div>
  );
}

function HourlyCard({ series, unit }) {
  if (!series?.length) return null;

  return (
    <div className="rounded-3xl border border-zinc-200/60 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Próximas horas</div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">Temperatura e chance de chuva</div>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{unit === "imperial" ? "°F" : "°C"}</div>
      </div>

      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="time" tick={{ fontSize: 12 }} interval={2} />
            <YAxis tick={{ fontSize: 12 }} domain={["dataMin - 2", "dataMax + 2"]} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload;
                return (
                  <div className="rounded-2xl border border-zinc-200/60 bg-white/90 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-white/10 dark:bg-zinc-950/80">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-50">{label}</div>
                    <div className="mt-1 text-zinc-700 dark:text-zinc-200">
                      Temp: <span className="font-semibold">{Math.round(p.temp)}°</span>
                    </div>
                    <div className="text-zinc-700 dark:text-zinc-200">
                      Sensação: <span className="font-semibold">{Math.round(p.feels)}°</span>
                    </div>
                    <div className="text-zinc-700 dark:text-zinc-200">
                      Chuva: <span className="font-semibold">{p.pop ?? 0}%</span>
                    </div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="temp" fillOpacity={0.25} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        {series.slice(0, 8).map((h) => (
          <div
            key={h.iso}
            className="rounded-2xl border border-zinc-200/60 bg-white/60 px-3 py-2 text-center text-xs shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-950/30"
          >
            <div className="text-zinc-500 dark:text-zinc-400">{h.time}</div>
            <div className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">{Math.round(h.temp)}°</div>
            <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">{h.pop ?? 0}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyCard({ days }) {
  if (!days?.length) return null;

  return (
    <div className="rounded-3xl border border-zinc-200/60 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-900/40">
      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Próximos dias</div>
      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">Máxima, mínima e condição</div>

      <div className="mt-4 grid gap-2">
        {days.slice(0, 7).map((d) => (
          <div
            key={d.day}
            className="flex items-center justify-between rounded-2xl border border-zinc-200/60 bg-white/60 px-4 py-3 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-950/30"
          >
            <div className="flex items-center gap-3">
              <div className="text-xl" aria-hidden>
                {wxEmoji(d.code, true)}
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{d.label}</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-300">{wxLabelPT(d.code)}</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{formatTemp(d.max)}</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">{formatTemp(d.min)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="mt-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
      <div>
        Dados: Open‑Meteo
      </div>
    </div>
  );
}


// -------------App -------------
export default function App() {
  const locale = "pt-BR";

  const [settings, setSettings] = useState(() => loadLS(STORAGE_KEYS.settings, { unit: "metric", theme: "dark" }));
  const unit = settings.unit;
  const theme = settings.theme;

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const [favorites, setFavorites] = useState(() => loadLS(STORAGE_KEYS.favorites, []));
  const [place, setPlace] = useState(() => loadLS(STORAGE_KEYS.lastPlace, null));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [forecast, setForecast] = useState(null);

  const isFavorite = useMemo(() => favorites.some((f) => isSamePlace(f, place)), [favorites, place]);

  // Aplica tema ao html root
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    saveLS(STORAGE_KEYS.settings, settings);
  }, [settings, theme]);

  // PersistÊncia das localidades favoritas
  useEffect(() => saveLS(STORAGE_KEYS.favorites, favorites), [favorites]);
  useEffect(() => saveLS(STORAGE_KEYS.lastPlace, place), [place]);

  // Debounced search
  useEffect(() => {
    let alive = true;
    if (query.trim().length < 2) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await geocode(query, 6, "pt");
        if (!alive) return;
        setSuggestions(res);
      } catch {
        if (!alive) return;
        setSuggestions([]);
      } finally {
        if (!alive) return;
        setIsSearching(false);
      }
    }, 350);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  async function loadForecast(nextPlace) {
    if (!nextPlace) return;
    setError(null);
    setLoading(true);
    try {
      const data = await fetchForecast(nextPlace, unit);
      setForecast(data);
    } catch (e) {
      setForecast(null);
      setError({
        title: "Não consegui carregar a previsão",
        message: "Verifique sua conexão e tente novamente. Se persistir, pode ser instabilidade do provedor de dados.",
        raw: String(e?.message || e),
      });
    } finally {
      setLoading(false);
    }
  }

  // Recarrega a previsão quando local ou unidade muda 
  useEffect(() => {
    if (!place) return;
    loadForecast(place);
  }, [place, unit]);

  // Primeiro carregamento: se não tem nenhum lugar ainda, vai no default
  useEffect(() => {
    if (place) return;
    // Default: São Paulo
    setPlace({
      id: "default-sp",
      name: "São Paulo",
      admin1: "SP",
      country: "Brasil",
      latitude: -23.5505,
      longitude: -46.6333,
      timezone: "America/Sao_Paulo",
    });
  }, [place]);

  function toggleFavorite(p = place) {
    if (!p) return;
    setFavorites((prev) => {
      const exists = prev.some((f) => isSamePlace(f, p));
      if (exists) return prev.filter((f) => !isSamePlace(f, p));
      return [p, ...prev].slice(0, 12);
    });
  }

  async function locateMe() {
    setError(null);
    setLoading(true);

    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) reject(new Error("Geolocation unavailable"));
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
        });
      });

      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      // Sempre seta um place "básico" (sem reverse)
      const fallbackPlace = {
        id: `gps:${lat},${lon}`,
        name: "Minha localização",
        admin1: "",
        country: "",
        latitude: lat,
        longitude: lon,
        timezone: "auto",
      };

      try {
        const places = await reverseGeocodeOSM(lat, lon, "pt-BR");
        if (places?.[0]) setPlace(places[0]);
      } catch {
        // fica com fallback
        setPlace(fallbackPlace);
      }
      setQuery("");
      setSuggestions([]);

    } catch (err) {
      setError({
        title: "Não consegui acessar sua localização",
        message: "Permita o acesso à localização no navegador ou busque sua cidade manualmente.",
        raw: String(err?.message || err),
      });
    } finally {
      setLoading(false);
    }
  }


  const current = forecast?.current;
  const tempForBg = useMemo(() => {
    //Se estiver em imperial, faz uma conversão para Cº apenas para decidir o gradiente do bg
    const t = current?.temperature_2m;
    if (t == null) return 20;
    return unit === "imperial" ? (t - 32) * (5 / 9) : t;
  }, [current?.temperature_2m, unit]);

  const isDay = Boolean(current?.is_day);
  const gradient = bgGradientFromTemp(tempForBg, isDay, theme);

  const hourlySeries = useMemo(
    () => (forecast ? buildHourlySeries(forecast, forecast?.current?.time, 24, locale) : []),
    [forecast]
  );
  const dailySeries = useMemo(() => (forecast ? buildDailySeries(forecast, locale) : []), [forecast]);

  return (
    <div className={`min-h-screen bg-gradient-to-b ${gradient} text-zinc-900 dark:text-zinc-50`}>
      <div className="mx-auto max-w-5xl px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex flex-col gap-6"
        >
          <header className="flex flex-col gap-2">
            <div className="text-3xl font-semibold tracking-tight">Previsão do Tempo</div>
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              Busque cidades, use sua localização e salve favoritos.
            </div>
          </header>

          <TopBar
            query={query}
            setQuery={setQuery}
            suggestions={suggestions}
            isSearching={isSearching}
            onPick={(p) => {
              setPlace(p);
              setSuggestions([]);
            }}
            onLocate={locateMe}
            unit={unit}
            setUnit={(u) => setSettings((s) => ({ ...s, unit: u }))}
            theme={theme}
            setTheme={(t) => setSettings((s) => ({ ...s, theme: t }))}
          />

          <FavoriteChips
            favorites={favorites}
            current={place}
            onPick={(p) => setPlace(p)}
            onToggle={(p) => toggleFavorite(p)}
          />

          <AnimatePresence mode="wait">
            {error ? (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ErrorCard
                  title={error.title}
                  message={error.message}
                  onRetry={() => {
                    if (place) loadForecast(place);
                  }}
                />
                {error.raw ? (
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Detalhe: {error.raw}</div>
                ) : null}
              </motion.div>
            ) : loading && !forecast ? (
              <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <SkeletonCard />
              </motion.div>
            ) : place && forecast ? (
              <motion.div
                key="content"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.25 }}
                className="grid gap-4"
              >
                <CurrentCard
                  place={place}
                  data={forecast}
                  unit={unit}
                  isFavorite={isFavorite}
                  onToggleFavorite={() => toggleFavorite(place)}
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <HourlyCard series={hourlySeries} unit={unit} />
                  <DailyCard days={dailySeries} />
                </div>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ErrorCard title="Selecione uma cidade" message="Busque uma cidade acima para ver a previsão." />
              </motion.div>
            )}
          </AnimatePresence>

          <Footer />
        </motion.div>
      </div>
    </div>
  );
}
