import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";

/* ═══════════════════════════════════════════════════════════════════════
   LOCKIN — The Ultimate Cut Dashboard
   ═══════════════════════════════════════════════════════════════════════ */

// ── CONSTANTS ───────────────────────────────────────────────────────────
const SK = { PROFILE: "li_profile", MEALS: "li_meals", WORKOUTS: "li_workouts", SYMPTOMS: "li_symptoms", EXPENSES: "li_expenses", SLEEP: "li_sleep", WATER: "li_water" };
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Storage helpers (session-persistent via localStorage)
const ls = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const ss = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const font = "'Syne', sans-serif";
const mono = "'DM Mono', monospace";
const C = { bg: "#08080f", card: "#0e0e1a", border: "#1a1a2e", lime: "#c8ff00", red: "#ff4757", cyan: "#00d2ff", purple: "#a78bfa", muted: "#555570", text: "#e8e8ef", dim: "#333345" };

const ACTIVITY_MUL = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
const calcBMR = (w, h, a, s) => s === "M" ? 88.362 + 13.397*w + 4.799*h - 5.677*a : 447.593 + 9.247*w + 3.098*h - 4.330*a;
const calcTDEE = (w, h, a, s, act) => Math.round(calcBMR(w, h, a, s) * (ACTIVITY_MUL[act] || 1.55));
const calcMacros = (w, tdee, deficit) => {
  const cal = tdee - deficit, p = Math.round(w * 2.2), f = Math.round(w * 0.8);
  const carbs = Math.round(Math.max(0, cal - p*4 - f*9) / 4);
  return { calories: cal, proteins: p, carbs, fats: f };
};

const MUSCLE_GROUPS = ["Pecs", "Dos", "Épaules", "Biceps", "Triceps", "Jambes", "Abdos", "Cardio"];

// MET-based calorie burn estimation per set by muscle group
// Big compounds burn more, isolation burns less. ~30-45s effort + rest per set.
const CAL_PER_SET = { Pecs: 9, Dos: 10, Épaules: 8, Biceps: 5, Triceps: 5, Jambes: 12, Abdos: 6, Cardio: 10 };
function estimateBurn(group, weightKg, reps, sets, bodyweight) {
  const base = (CAL_PER_SET[group] || 7) * sets;
  // Intensity bonus: heavier relative load = more burn (+0-40%)
  const intensity = bodyweight > 0 ? Math.min(1.4, 1 + (weightKg / bodyweight) * 0.5) : 1;
  // Volume bonus: more reps = slightly more burn
  const volumeFactor = 1 + (reps - 8) * 0.01; // 8 reps = baseline
  return Math.round(base * intensity * Math.max(0.8, volumeFactor));
}
const SYMPTOM_ZONES = ["Tête", "Yeux", "Cou/Nuque", "Dos", "Ventre/Digestif", "Articulations", "Peau", "Énergie/Sommeil", "Autre"];
const EXPENSE_CATS = [
  { id: "courses", label: "Courses", color: C.lime },
  { id: "snacks", label: "Snacks", color: C.red },
  { id: "resto", label: "Resto", color: C.cyan },
  { id: "complements", label: "Compléments", color: C.purple },
];

const DEFAULT_PROFILE = { name: "", weight: 80, goalWeight: 72, height: 178, age: 28, sex: "M", activity: "moderate", deficit: 400, allergies: "", weeklyBudget: 80, monthlyBudget: 320, hasAirfryer: true, setup: false };

const TABS = [
  { id: "dash", icon: "⚡", label: "Lock-in" },
  { id: "food", icon: "🍎", label: "Nutrition" },
  { id: "gym", icon: "💪", label: "Muscu" },
  { id: "health", icon: "🩺", label: "Santé" },
  { id: "profile", icon: "⚙️", label: "Profil" },
];

// ── CLAUDE API (via serverless proxy) ──────────────────────────────────

async function askAI(systemPrompt, userContent, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `${systemPrompt}\n\n${userContent}`
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      return data.text || "";
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function askAIVision(systemPrompt, textPrompt, imageBase64, mediaType = "image/jpeg") {
  // Not supporting Vision yet via the simplified proxy as it's haiku and request was for messages format
  // but let's at least make it target the same field if updated later.
  try {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${systemPrompt}\n\n${textPrompt} [IMAGE ATTACHED]`
      }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return data.text || "";
  } catch (e) { throw e; }
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── SHARED COMPONENTS ───────────────────────────────────────────────────

function Card({ children, style, glow, accent }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${accent || C.border}`, borderRadius: 16, padding: 16,
      position: "relative", overflow: "hidden",
      ...(glow ? { boxShadow: `0 0 40px ${accent || C.lime}11, inset 0 1px 0 rgba(255,255,255,0.03)` } : {}),
      ...style,
    }}>{children}</div>
  );
}

function Btn({ children, onClick, v = "primary", style, disabled, small }) {
  const variants = {
    primary: { background: C.lime, color: C.bg },
    secondary: { background: C.border, color: C.text, border: `1px solid ${C.dim}` },
    danger: { background: "#2a1015", color: C.red, border: "1px solid #3a1520" },
    ghost: { background: "transparent", color: C.muted },
    cyan: { background: C.cyan, color: C.bg },
    purple: { background: C.purple, color: C.bg },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      border: "none", borderRadius: small ? 8 : 12, padding: small ? "6px 12px" : "12px 20px",
      fontFamily: font, fontWeight: 700, fontSize: small ? 12 : 14, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1, width: small ? "auto" : "100%", letterSpacing: "0.02em", transition: "all 0.2s",
      ...variants[v], ...style,
    }}>{children}</button>
  );
}

function Input({ label, value, onChange, type = "text", placeholder, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      {label && <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", background: "#0a0a14", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", color: C.text, fontSize: 14, fontFamily: font, outline: "none", boxSizing: "border-box", transition: "border 0.2s" }}
        onFocus={e => e.target.style.borderColor = C.lime} onBlur={e => e.target.style.borderColor = C.border} />
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: "100%", background: "#0a0a14", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", color: C.text, fontSize: 14, fontFamily: font, outline: "none", appearance: "none" }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function MacroBar({ label, cur, max, color, unit = "g" }) {
  const pct = max > 0 ? Math.min(100, (cur / max) * 100) : 0;
  const over = cur > max;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        <span style={{ fontSize: 11, fontFamily: mono, color: over ? C.red : color, fontWeight: 600 }}>{cur}{unit} / {max}{unit}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: C.border }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 3, background: over ? C.red : color, transition: "width 0.5s cubic-bezier(0.22,1,0.36,1)" }} />
      </div>
    </div>
  );
}

function Section({ title, children, style }) {
  return (
    <div style={{ padding: "0 20px 16px", ...style }}>
      {title && <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>{title}</div>}
      {children}
    </div>
  );
}

function PageHead({ title, sub }) {
  return (
    <div style={{ padding: "20px 20px 12px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0, fontFamily: font, letterSpacing: "-0.02em", background: `linear-gradient(135deg, ${C.text} 0%, ${C.muted} 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{title}</h1>
      {sub && <p style={{ margin: "3px 0 0", fontSize: 12, color: C.muted }}>{sub}</p>}
    </div>
  );
}

function Chip({ children, active, onClick, color = C.lime }) {
  return (
    <button onClick={onClick} style={{
      background: active ? `${color}22` : C.card, border: `1px solid ${active ? color : C.border}`,
      borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: font,
      color: active ? color : C.muted, cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

function PhotoCapture({ onCapture, label = "📸 Scanner" }) {
  const ref = useRef(null);
  const handle = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      const mediaType = file.type || "image/jpeg";
      onCapture(base64, mediaType, reader.result);
    };
    reader.readAsDataURL(file);
  };
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={handle} style={{ display: "none" }} />
      <Btn onClick={() => ref.current?.click()} v="cyan">{label}</Btn>
    </>
  );
}

function LoadingPulse({ text = "Analyse en cours..." }) {
  return (
    <Card style={{ textAlign: "center", padding: 32 }}>
      <style>{`@keyframes lipulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>
      <div style={{ fontSize: 32, animation: "lipulse 1.5s infinite", marginBottom: 8 }}>🧠</div>
      <div style={{ color: C.cyan, fontSize: 13, fontWeight: 600 }}>{text}</div>
    </Card>
  );
}

// ── LOCK-IN SCORE GAUGE ─────────────────────────────────────────────────

function LockInGauge({ score }) {
  const r = 90, cx = 110, cy = 110, stroke = 10;
  const circ = 2 * Math.PI * r;
  const arc = circ * 0.75;
  const offset = arc - (arc * score / 100);
  const color = score >= 80 ? C.lime : score >= 50 ? "#ffa726" : C.red;
  return (
    <div style={{ textAlign: "center", position: "relative" }}>
      <svg width={220} height={190} viewBox="0 0 220 190">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.border} strokeWidth={stroke}
          strokeDasharray={`${arc} ${circ}`} strokeDashoffset={0} strokeLinecap="round"
          transform={`rotate(135 ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${arc} ${circ}`} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(135 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1), stroke 0.5s" }} />
      </svg>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -60%)", textAlign: "center" }}>
        <div style={{ fontFamily: mono, fontSize: 48, fontWeight: 900, color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.15em" }}>Lock-in</div>
      </div>
    </div>
  );
}

function PastDayBanner({ selectedDate }) {
  const label = new Date(selectedDate + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const isFuture = selectedDate > today();
  return (
    <div style={{ margin: "0 20px 12px", padding: "8px 14px", background: isFuture ? `${C.cyan}15` : `${C.purple}15`, border: `1px solid ${isFuture ? C.cyan : C.purple}33`, borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 14 }}>{isFuture ? "📦" : "📅"}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: isFuture ? C.cyan : C.purple, textTransform: "capitalize" }}>
          {isFuture ? `Meal prep — ${label}` : `Mode rétro — ${label}`}
        </div>
        <div style={{ fontSize: 10, color: C.muted }}>
          {isFuture ? "Prépare tes repas à l'avance" : "Les données ajoutées iront sur ce jour"}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════

export default function LockInApp() {
  const [tab, setTab] = useState("dash");
  const [profile, setProfile] = useState(() => ls(SK.PROFILE, DEFAULT_PROFILE));
  const [meals, setMeals] = useState(() => ls(SK.MEALS, []));
  const [workouts, setWorkouts] = useState(() => ls(SK.WORKOUTS, []));
  const [symptoms, setSymptoms] = useState(() => ls(SK.SYMPTOMS, []));
  const [expenses, setExpenses] = useState(() => ls(SK.EXPENSES, []));
  const [sleepLogs, setSleepLogs] = useState(() => ls(SK.SLEEP, []));
  const [waterLogs, setWaterLogs] = useState(() => ls(SK.WATER, []));
  const [selectedDate, setSelectedDate] = useState(today());

  useEffect(() => ss(SK.PROFILE, profile), [profile]);
  useEffect(() => ss(SK.MEALS, meals), [meals]);
  useEffect(() => ss(SK.WORKOUTS, workouts), [workouts]);
  useEffect(() => ss(SK.SYMPTOMS, symptoms), [symptoms]);
  useEffect(() => ss(SK.EXPENSES, expenses), [expenses]);
  useEffect(() => ss(SK.SLEEP, sleepLogs), [sleepLogs]);
  useEffect(() => ss(SK.WATER, waterLogs), [waterLogs]);

  // ── EXPORT / IMPORT via copy-paste ──
  const [showBackup, setShowBackup] = useState(false);
  const [backupJson, setBackupJson] = useState("");
  const [importText, setImportText] = useState("");

  const exportData = () => {
    const data = { profile, meals, workouts, symptoms, expenses, sleepLogs, waterLogs, _exported: new Date().toISOString() };
    const json = JSON.stringify(data);
    setBackupJson(json);
    // Try clipboard first
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json)
        .then(() => setShowBackup("copied"))
        .catch(() => setShowBackup("export"));
    } else {
      setShowBackup("export");
    }
  };

  const doImport = (text) => {
    try {
      const data = JSON.parse(text);
      if (data.profile) setProfile(data.profile);
      if (data.meals) setMeals(data.meals);
      if (data.workouts) setWorkouts(data.workouts);
      if (data.symptoms) setSymptoms(data.symptoms);
      if (data.expenses) setExpenses(data.expenses);
      if (data.sleepLogs) setSleepLogs(data.sleepLogs);
      if (data.waterLogs) setWaterLogs(data.waterLogs);
      setShowBackup(false);
      setImportText("");
    } catch { alert("Données invalides"); }
  };

  const importData = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => { doImport(e.target.result); };
    reader.readAsText(file);
  };

  const isToday = selectedDate === today();
  const isFuture = selectedDate > today();

  const tdee = calcTDEE(profile.weight, profile.height, profile.age, profile.sex, profile.activity);
  const macros = calcMacros(profile.weight, tdee, profile.deficit);

  const dayM = meals.filter(m => m.date === selectedDate);
  const dayMacros = dayM.reduce((a, m) => ({ calories: a.calories + (m.macros?.calories || 0), proteins: a.proteins + (m.macros?.proteins || 0), carbs: a.carbs + (m.macros?.carbs || 0), fats: a.fats + (m.macros?.fats || 0) }), { calories: 0, proteins: 0, carbs: 0, fats: 0 });
  const remaining = { calories: macros.calories - dayMacros.calories, proteins: macros.proteins - dayMacros.proteins, carbs: macros.carbs - dayMacros.carbs, fats: macros.fats - dayMacros.fats };

  const dayW = workouts.filter(w => w.date === selectedDate);
  const dayS = symptoms.filter(s => s.date === selectedDate);
  const caloriesBurned = dayW.reduce((a, w) => a + (w.caloriesBurned || 0), 0);

  // Sleep for selected date
  const daySleep = sleepLogs.find(s => s.date === selectedDate) || null;

  // Water tracking
  const dayWater = waterLogs.find(w => w.date === selectedDate) || { date: selectedDate, glasses: 0 };
  const glassSize = 250; // ml per glass

  // Dynamic water target calculation
  const waterTarget = useMemo(() => {
    let base = 3000; // 3L base (créatine protocol)
    // +500ml per beer/alcohol
    const alcoholCount = dayM.filter(m => /bière|beer|vin|wine|alcool|vodka|rhum|whisky/i.test(m.name)).length;
    base += alcoholCount * 500;
    // +1L per hour of training (estimate: each workout ~1h)
    base += dayW.length * 1000;
    // +500ml if protein intake > 150g (high protein = more water needed)
    if (dayMacros.proteins > 150) base += 500;
    // +250ml if it's a hot day vibe (high calorie burn = sweat)
    if (caloriesBurned > 400) base += 250;
    return base;
  }, [dayM, dayW, dayMacros, caloriesBurned]);

  const waterConsumed = dayWater.glasses * glassSize;
  const waterPct = waterTarget > 0 ? Math.min(100, (waterConsumed / waterTarget) * 100) : 0;

  const addWaterGlass = () => {
    setWaterLogs(prev => {
      const filtered = prev.filter(w => w.date !== selectedDate);
      return [...filtered, { date: selectedDate, glasses: (dayWater.glasses || 0) + 1 }];
    });
  };
  const removeWaterGlass = () => {
    if (dayWater.glasses <= 0) return;
    setWaterLogs(prev => {
      const filtered = prev.filter(w => w.date !== selectedDate);
      return [...filtered, { date: selectedDate, glasses: dayWater.glasses - 1 }];
    });
  };

  // LOCK-IN SCORE CALCULATION (for selected date)
  const lockInScore = useMemo(() => {
    let score = 50;
    if (dayMacros.calories > 0) {
      const calDiff = Math.abs(dayMacros.calories - macros.calories) / macros.calories;
      if (calDiff < 0.05) score += 20;
      else if (calDiff < 0.1) score += 15;
      else if (calDiff < 0.2) score += 5;
      else score -= 10;
      if (dayMacros.proteins >= macros.proteins * 0.9) score += 15;
      else if (dayMacros.proteins >= macros.proteins * 0.7) score += 5;
      else score -= 5;
    }
    if (dayW.length > 0) score += 15;
    if (dayS.length === 0) score += 5;
    else score -= dayS.length * 3;
    if (daySleep) {
      const hrs = daySleep.duration || 0;
      const qual = daySleep.quality || 5;
      if (hrs >= 7 && hrs <= 9) score += 10;
      else if (hrs >= 6) score += 3;
      else score -= 10;
      if (qual >= 8) score += 5;
      else if (qual <= 3) score -= 5;
    }
    // Water: hydration bonus/penalty
    if (waterConsumed >= waterTarget * 0.9) score += 5;
    else if (waterConsumed < waterTarget * 0.5 && waterConsumed > 0) score -= 5;
    const hasAlcohol = dayM.some(m => /bière|beer|vin|wine|alcool|vodka|rhum|whisky/i.test(m.name));
    if (hasAlcohol) score -= 15;
    return Math.max(0, Math.min(100, score));
  }, [dayMacros, dayW, dayS, dayM, macros, daySleep, waterConsumed, waterTarget]);

  if (!profile.setup) return <Onboarding profile={profile} setProfile={setProfile} importData={importData} />;

  const shared = { profile, setProfile, meals, setMeals, workouts, setWorkouts, symptoms, setSymptoms, expenses, setExpenses, sleepLogs, setSleepLogs, waterLogs, setWaterLogs, tdee, macros, todayMacros: dayMacros, remaining, todayM: dayM, todayW: dayW, todayS: dayS, todaySleep: daySleep, lockInScore, caloriesBurned, selectedDate, setSelectedDate, isToday, isFuture, waterTarget, waterConsumed, waterPct, dayWater, addWaterGlass, removeWaterGlass, glassSize, exportData, importData, doImport, showBackup, setShowBackup, backupJson, importText, setImportText };

  return (
    <div style={{ fontFamily: font, background: C.bg, color: C.text, minHeight: "100vh", maxWidth: 430, margin: "0 auto", position: "relative", paddingBottom: 80, overflowX: "hidden" }}>
      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { width: 0; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
        textarea { font-family: ${font}; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fadeUp 0.4s ease-out both; }
      `}</style>

      {/* Ambient */}
      <div style={{ position: "fixed", top: -100, left: -100, width: 280, height: 280, background: `radial-gradient(circle, ${C.lime}08 0%, transparent 70%)`, pointerEvents: "none", zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1 }}>
        {tab === "dash" && <DashTab {...shared} />}
        {tab === "food" && <FoodTab {...shared} />}
        {tab === "gym" && <GymTab {...shared} />}
        {tab === "health" && <HealthTab {...shared} />}
        {tab === "profile" && <ProfileTab {...shared} />}
      </div>

      {/* Bottom Nav */}
      <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: `linear-gradient(to top, ${C.bg} 60%, transparent)`, paddingTop: 18, zIndex: 50 }}>
        <div style={{ display: "flex", justifyContent: "space-around", background: C.card, borderTop: `1px solid ${C.border}`, padding: "6px 0 10px" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: "none", border: "none", color: tab === t.id ? C.lime : C.muted, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, cursor: "pointer", padding: "4px 10px", fontFamily: font, transition: "color 0.2s",
            }}>
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              <span style={{ fontSize: 9, fontWeight: tab === t.id ? 800 : 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>{t.label}</span>
              {tab === t.id && <div style={{ width: 4, height: 4, borderRadius: "50%", background: C.lime, marginTop: 1 }} />}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════════════════════════════════

function Onboarding({ profile, setProfile, importData }) {
  const [step, setStep] = useState(0);
  const [local, setLocal] = useState({ ...profile });
  const [showRestore, setShowRestore] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const set = k => v => setLocal(prev => ({ ...prev, [k]: ["name","allergies","sex","activity"].includes(k) ? v : Number(v) || 0 }));
  const p = local; const setP = setLocal;

  const tdee = calcTDEE(p.weight, p.height, p.age, p.sex, p.activity);
  const tgt = calcMacros(p.weight, tdee, p.deficit);

  const steps = [
    { title: "Lock-in 🔒", sub: "Ton dashboard de sèche ultime", content: (
      <>
        <Input label="Prénom" value={p.name} onChange={set("name")} placeholder="Comment tu t'appelles ?" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Input label="Poids (kg)" value={p.weight} onChange={set("weight")} type="number" />
          <Input label="Objectif (kg)" value={p.goalWeight} onChange={set("goalWeight")} type="number" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Input label="Taille (cm)" value={p.height} onChange={set("height")} type="number" />
          <Input label="Âge" value={p.age} onChange={set("age")} type="number" />
          <Select label="Sexe" value={p.sex} onChange={set("sex")} options={[{ value: "M", label: "H" }, { value: "F", label: "F" }]} />
        </div>
      </>
    )},
    { title: "Tes objectifs 🎯", sub: "On calcule tout pour toi", content: (
      <>
        <Select label="Activité" value={p.activity} onChange={set("activity")} options={[
          { value: "sedentary", label: "Sédentaire" }, { value: "light", label: "Léger (1-2x/sem)" },
          { value: "moderate", label: "Modéré (3-5x/sem)" }, { value: "active", label: "Actif (6-7x/sem)" },
          { value: "very_active", label: "Très actif (2x/jour)" },
        ]} />
        <Input label="Déficit calorique (kcal/j)" value={p.deficit} onChange={set("deficit")} type="number" />
        <Input label="Allergies" value={p.allergies} onChange={set("allergies")} placeholder="Ex: lactose, gluten..." />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Input label="Budget hebdo (€)" value={p.weeklyBudget} onChange={set("weeklyBudget")} type="number" />
          <Input label="Budget mensuel (€)" value={p.monthlyBudget} onChange={set("monthlyBudget")} type="number" />
        </div>
        <Card glow style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: C.lime, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>Tes macros calculées</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, textAlign: "center" }}>
            {[{ l: "Cal", v: tgt.calories, u: "kcal" }, { l: "Prot", v: tgt.proteins, u: "g" }, { l: "Gluc", v: tgt.carbs, u: "g" }, { l: "Lip", v: tgt.fats, u: "g" }].map(m => (
              <div key={m.l}><div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700 }}>{m.v}</div><div style={{ fontSize: 9, color: C.muted }}>{m.l}</div></div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: C.muted, textAlign: "center", marginTop: 6 }}>TDEE: {tdee} kcal — Déficit: {p.deficit} kcal/j</div>
        </Card>
      </>
    )},
  ];

  return (
    <div style={{ fontFamily: font, background: C.bg, color: C.text, minHeight: "100vh", maxWidth: 430, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 28 }}>
        {steps.map((_, i) => <div key={i} style={{ width: i === step ? 28 : 8, height: 8, borderRadius: 4, background: i <= step ? C.lime : C.border, transition: "all 0.3s" }} />)}
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 900, margin: "0 0 4px" }}>{steps[step].title}</h1>
      <p style={{ color: C.muted, marginTop: 0, marginBottom: 24, fontSize: 13 }}>{steps[step].sub}</p>
      <div>{steps[step].content}</div>
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        {step > 0 && <Btn v="secondary" onClick={() => setStep(step - 1)} style={{ flex: 1 }}>Retour</Btn>}
        <Btn onClick={() => step < steps.length - 1 ? setStep(step + 1) : setProfile({ ...p, setup: true })} style={{ flex: 2 }}>
          {step < steps.length - 1 ? "Suivant" : "C'est parti 🔥"}
        </Btn>
      </div>

      {/* Restore backup */}
      <div style={{ marginTop: 24, textAlign: "center" }}>
        <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>Tu as déjà une sauvegarde ?</div>
        {!showRestore ? (
          <button onClick={() => setShowRestore(true)} style={{
            padding: "10px 20px", background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 10, fontSize: 13, fontWeight: 600, color: C.cyan, cursor: "pointer", fontFamily: font,
          }}>
            📂 Restaurer une sauvegarde
          </button>
        ) : (
          <div style={{ textAlign: "left" }}>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={4}
              placeholder="Colle ta sauvegarde ici..."
              style={{ width: "100%", background: "#0a0a14", border: `1px solid ${C.cyan}55`, borderRadius: 8, padding: 10, color: C.text, fontSize: 10, fontFamily: mono, resize: "none", outline: "none", boxSizing: "border-box", marginBottom: 8 }}
            />
            <Btn v="cyan" onClick={() => {
              try {
                const data = JSON.parse(pasteText);
                if (data.profile) setProfile(data.profile);
              } catch { alert("Données invalides"); }
            }} disabled={!pasteText.trim()}>✅ Restaurer</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════

function DashTab({ profile, lockInScore, todayMacros, macros, todayW, todayS, todayM, caloriesBurned, remaining, todaySleep, selectedDate, setSelectedDate, isToday, waterTarget, waterConsumed, waterPct, dayWater, addWaterGlass, removeWaterGlass, glassSize }) {
  const goDay = (offset) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + offset);
    // Allow up to 7 days in the future for meal prep
    const maxFuture = new Date(); maxFuture.setDate(maxFuture.getDate() + 7);
    if (d <= maxFuture) setSelectedDate(d.toISOString().slice(0, 10));
  };
  const isFutureDate = selectedDate > today();
  const dateLabel = new Date(selectedDate + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <PageHead title={`${profile.name || "Champ"}, Lock-in.`} />

      {/* Date navigator */}
      <div style={{ padding: "0 20px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "8px 6px" }}>
          <button onClick={() => goDay(-1)} style={{
            background: "none", border: "none", color: C.lime, fontSize: 22, cursor: "pointer",
            width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 10, transition: "background 0.2s",
          }} onMouseEnter={e => e.target.style.background = `${C.lime}15`} onMouseLeave={e => e.target.style.background = "none"}>‹</button>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: isToday ? C.lime : isFutureDate ? C.cyan : C.text, textTransform: "capitalize" }}>
              {isToday ? "Aujourd'hui" : isFutureDate ? `${dateLabel} 📦` : dateLabel}
            </div>
            {!isToday && (
              <button onClick={() => setSelectedDate(today())} style={{
                background: "none", border: "none", color: C.lime, fontSize: 10, fontWeight: 700,
                cursor: "pointer", fontFamily: font, textTransform: "uppercase", letterSpacing: "0.1em",
                marginTop: 2, padding: 0, textDecoration: "underline", textUnderlineOffset: 2,
              }}>
                ↩ Revenir à aujourd'hui
              </button>
            )}
            {isToday && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 1, textTransform: "capitalize" }}>{dateLabel}</div>
            )}
          </div>
          <button onClick={() => goDay(1)} style={{
            background: "none", border: "none", color: C.lime, fontSize: 22,
            cursor: "pointer",
            width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 10, transition: "background 0.2s",
          }} onMouseEnter={e => e.target.style.background = `${C.lime}15`} onMouseLeave={e => e.target.style.background = "none"}>›</button>
        </div>
      </div>

      <Section>
        <Card glow accent={lockInScore >= 80 ? C.lime : lockInScore >= 50 ? "#ffa726" : C.red}>
          <LockInGauge score={lockInScore} />
          <div style={{ textAlign: "center", fontSize: 12, color: C.muted, marginTop: -8 }}>
            {lockInScore >= 80 ? "🔥 Machine mode" : lockInScore >= 60 ? "💪 On est bien" : lockInScore >= 40 ? "⚡ Peut mieux faire" : "😤 Reprends-toi"}
          </div>
        </Card>
      </Section>

      {/* Quick stats */}
      <Section title="Résumé du jour">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          {[
            { label: "Calories", val: `${todayMacros.calories}`, sub: `/ ${macros.calories}`, color: remaining.calories > 0 ? C.lime : C.red },
            { label: "Protéines", val: `${todayMacros.proteins}g`, sub: `/ ${macros.proteins}g`, color: todayMacros.proteins >= macros.proteins * 0.9 ? C.lime : C.cyan },
          ].map(s => (
            <Card key={s.label} style={{ textAlign: "center", padding: 12 }}>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{s.sub}</div>
            </Card>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Card style={{ textAlign: "center", padding: 12 }}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Séances</div>
            <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: todayW.length > 0 ? C.lime : C.muted }}>{todayW.length}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{caloriesBurned} kcal</div>
          </Card>
          <Card style={{ textAlign: "center", padding: 12 }} accent={todaySleep ? (todaySleep.duration >= 7 ? `${C.purple}55` : `${C.red}55`) : undefined}>
            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Sommeil</div>
            {todaySleep ? (
              <>
                <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: todaySleep.duration >= 7 ? C.purple : C.red }}>{todaySleep.duration}h</div>
                <div style={{ fontSize: 10, color: C.muted }}>Qualité {todaySleep.quality}/10</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 18, marginBottom: 2 }}>😴</div>
                <div style={{ fontSize: 10, color: C.dim }}>Non logué</div>
              </>
            )}
          </Card>
        </div>
      </Section>

      {/* Macro bars */}
      <Section title="Macros restantes">
        <Card>
          <MacroBar label="Calories" cur={todayMacros.calories} max={macros.calories} color={C.lime} unit=" kcal" />
          <MacroBar label="Protéines" cur={todayMacros.proteins} max={macros.proteins} color={C.lime} />
          <MacroBar label="Glucides" cur={todayMacros.carbs} max={macros.carbs} color={C.cyan} />
          <MacroBar label="Lipides" cur={todayMacros.fats} max={macros.fats} color={C.purple} />
          {caloriesBurned > 0 && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: `${C.cyan}15`, borderRadius: 8, fontSize: 12, color: C.cyan }}>
              🔥 {caloriesBurned} kcal brûlées au sport — budget ajusté
            </div>
          )}
        </Card>
      </Section>

      {/* Water tracker */}
      <Section title="💧 Hydratation — Protocole Créatine">
        <Card accent={waterPct >= 90 ? `${C.cyan}55` : waterPct < 50 && waterConsumed > 0 ? `${C.red}55` : undefined}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Water ring */}
            <div style={{ position: "relative", width: 70, height: 70, flexShrink: 0 }}>
              <svg width={70} height={70} viewBox="0 0 70 70">
                <circle cx={35} cy={35} r={28} fill="none" stroke={C.border} strokeWidth={5} />
                <circle cx={35} cy={35} r={28} fill="none" stroke={waterPct >= 90 ? C.cyan : waterPct >= 50 ? "#0088aa" : C.red}
                  strokeWidth={5} strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 28}`}
                  strokeDashoffset={`${2 * Math.PI * 28 * (1 - waterPct / 100)}`}
                  transform="rotate(-90 35 35)"
                  style={{ transition: "stroke-dashoffset 0.5s cubic-bezier(0.22,1,0.36,1)" }} />
              </svg>
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.cyan }}>💧</div>
                <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: C.text }}>{Math.round(waterPct)}%</div>
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: waterPct >= 90 ? C.cyan : C.text }}>
                  {(waterConsumed / 1000).toFixed(1)}L
                </span>
                <span style={{ fontSize: 11, color: C.muted }}>/ {(waterTarget / 1000).toFixed(1)}L</span>
              </div>

              {/* Glass counter with +/- buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={removeWaterGlass} style={{
                  width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`,
                  background: C.card, color: C.muted, fontSize: 16, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
                }}>−</button>
                <div style={{ flex: 1, display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {Array.from({ length: Math.ceil(waterTarget / glassSize) }, (_, i) => (
                    <div key={i} style={{
                      width: 12, height: 16, borderRadius: 3,
                      background: i < dayWater.glasses ? C.cyan : `${C.border}`,
                      transition: "background 0.2s",
                      opacity: i < dayWater.glasses ? 1 : 0.3,
                    }} />
                  ))}
                </div>
                <button onClick={addWaterGlass} style={{
                  width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.cyan}55`,
                  background: `${C.cyan}15`, color: C.cyan, fontSize: 16, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
                }}>+</button>
              </div>

              <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
                {dayWater.glasses} verre{dayWater.glasses > 1 ? "s" : ""} ({glassSize}ml)
              </div>
            </div>
          </div>

          {/* Dynamic target explanation */}
          {(() => {
            const reasons = [];
            const alcoholCount = todayM.filter(m => /bière|beer|vin|wine|alcool|vodka|rhum|whisky/i.test(m.name)).length;
            if (alcoholCount > 0) reasons.push(`+${alcoholCount * 500}ml alcool`);
            if (todayW.length > 0) reasons.push(`+${todayW.length}L entraînement`);
            if (todayMacros.proteins > 150) reasons.push("+500ml protéines élevées");
            if (caloriesBurned > 400) reasons.push("+250ml effort intense");
            if (reasons.length === 0) return null;
            return (
              <div style={{ marginTop: 10, padding: "6px 10px", background: `${C.cyan}08`, borderRadius: 8, fontSize: 10, color: C.cyan }}>
                📊 Objectif ajusté : 3L base {reasons.join(", ")}
              </div>
            );
          })()}

          {/* Hydration warning */}
          {waterConsumed > 0 && waterConsumed < waterTarget * 0.4 && todayMacros.proteins > 100 && (
            <div style={{ marginTop: 8, padding: "8px 10px", background: `${C.red}15`, border: `1px solid ${C.red}33`, borderRadius: 8, fontSize: 11, color: C.red }}>
              ⚠️ Prot élevées ({todayMacros.proteins}g) + hydratation faible = mauvais combo pour les reins. Bois {Math.ceil((waterTarget * 0.7 - waterConsumed) / glassSize)} verres de plus.
            </div>
          )}
          {waterPct >= 100 && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: `${C.cyan}15`, borderRadius: 8, fontSize: 11, color: C.cyan, textAlign: "center" }}>
              ✅ Objectif hydratation atteint — bien joué
            </div>
          )}
        </Card>
      </Section>

      {/* Symptoms alert */}
      {todayS.length > 0 && (
        <Section title="Alertes santé">
          <Card accent={C.red}>
            {todayS.map(s => (
              <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>🩹</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.zone} — {s.description}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>Intensité: {s.intensity}/10</div>
                </div>
              </div>
            ))}
          </Card>
        </Section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// FOOD TAB — 3 MODES
// ═══════════════════════════════════════════════════════════════════════

function FoodTab({ profile, macros, todayMacros, remaining, meals, setMeals, todayM, selectedDate, isToday }) {
  const [mode, setMode] = useState("log"); // log | scan | fridge | sniper
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);

  // ── LOG MODE STATE ──
  const [logInput, setLogInput] = useState("");
  const [logEstimated, setLogEstimated] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ name: "", calories: "", proteins: "", carbs: "", fats: "" });

  const addMeal = (meal) => setMeals(prev => [...prev, { ...meal, date: selectedDate, id: uid() }]);
  const removeTodayMeal = (id) => setMeals(prev => prev.filter(m => m.id !== id));

  // ── AI QUICK LOG ──
  const estimateFromText = async () => {
    if (!logInput.trim()) return;
    setLoading(true); setError(""); setLogEstimated(null);
    try {
      const text = await askAI(
        `Tu es nutritionniste. L'utilisateur décrit ce qu'il a mangé. Estime les macros le plus précisément possible.
Réponds UNIQUEMENT en JSON valide sans markdown :
{"items": [{"name": "aliment", "amount": "portion estimée", "calories": 0, "proteins": 0, "carbs": 0, "fats": 0}], "total": {"calories": 0, "proteins": 0, "carbs": 0, "fats": 0}, "meal_name": "Nom court du repas"}
Sois réaliste sur les portions. Si l'utilisateur dit "un bol de riz" estime ~200g cuit. Si c'est vague, prends une portion standard française.`,
        `J'ai mangé : ${logInput}`
      );
      const data = parseJSON(text);
      if (data.total && data.meal_name) {
        setLogEstimated({
          name: data.meal_name,
          items: data.items || [],
          macros: data.total,
          seche_friendly: data.total.proteins >= 30 && data.total.calories <= 500,
        });
      }
    } catch (e) { setError("Erreur d'estimation. Réessaie ou utilise le mode manuel."); console.error(e); }
    setLoading(false);
  };

  const confirmEstimated = () => {
    if (!logEstimated) return;
    addMeal({
      name: logEstimated.name,
      macros: logEstimated.macros,
      ingredients: logEstimated.items?.map(i => ({ name: i.name, amount: i.amount })) || [],
      steps: [], prepTime: 0,
      seche_friendly: logEstimated.seche_friendly,
    });
    setLogEstimated(null);
    setLogInput("");
  };

  const addManualMeal = () => {
    if (!manual.name) return;
    addMeal({
      name: manual.name,
      macros: {
        calories: Number(manual.calories) || 0,
        proteins: Number(manual.proteins) || 0,
        carbs: Number(manual.carbs) || 0,
        fats: Number(manual.fats) || 0,
      },
      ingredients: [], steps: [], prepTime: 0,
      seche_friendly: (Number(manual.proteins) || 0) >= 30 && (Number(manual.calories) || 0) <= 500,
    });
    setManual({ name: "", calories: "", proteins: "", carbs: "", fats: "" });
  };

  // ── PHOTO FOOD SCANNER ──
  const scanFood = async (base64, mediaType) => {
    setLoading(true); setError(""); setResults([]);
    try {
      const text = await askAIVision(
        `Tu es un nutritionniste expert. Analyse la photo du repas. Identifie chaque aliment, estime les portions et calcule les macros.
Réponds UNIQUEMENT en JSON valide sans markdown :
{"foods": [{"name": "aliment", "amount": "150g", "calories": 200, "proteins": 30, "carbs": 20, "fats": 5}], "total": {"calories": 0, "proteins": 0, "carbs": 0, "fats": 0}, "meal_name": "Nom du repas"}`,
        `Analyse ce repas. ${profile.allergies ? `Allergies: ${profile.allergies}` : ""}`,
        base64, mediaType
      );
      const data = parseJSON(text);
      if (data.total && data.meal_name) {
        setResults([{
          name: data.meal_name,
          macros: data.total,
          ingredients: data.foods?.map(f => ({ name: f.name, amount: f.amount })) || [],
          steps: [], prepTime: 0,
          seche_friendly: data.total.proteins >= 30 && data.total.calories <= 500,
        }]);
      }
    } catch (e) { setError("Erreur d'analyse. Réessaie avec une photo plus nette."); console.error(e); }
    setLoading(false);
  };

  // ── FRIDGE SCANNER ──
  const scanFridge = async (base64, mediaType) => {
    setLoading(true); setError(""); setResults([]);
    try {
      const text = await askAIVision(
        `Tu es un nutritionniste expert en sèche. Analyse la photo du frigo, identifie les ingrédients visibles, puis propose 3 recettes sèche-friendly optimisées.
${profile.hasAirfryer ? 'L\'utilisateur a un Airfryer — propose au moins 1 recette Airfryer avec les réglages (température + temps).' : ''}
Réponds UNIQUEMENT en JSON valide sans markdown :
{"ingredients_detected": ["poulet", "brocoli", ...], "meals": [{"name": "...", "ingredients": [{"name": "...", "amount": "..."}], "macros": {"calories": 0, "proteins": 0, "carbs": 0, "fats": 0}, "steps": ["..."], "prepTime": 15, "seche_friendly": true, "airfryer": {"temp": 200, "time": 12, "tip": "..."}}]}`,
        `Scanne ce frigo. Macros restantes: ${remaining.calories} kcal, ${remaining.proteins}g prot, ${remaining.carbs}g gluc, ${remaining.fats}g lip. ${profile.allergies ? `Allergies: ${profile.allergies}` : ""}`,
        base64, mediaType
      );
      const data = parseJSON(text);
      if (data.meals) setResults(data.meals);
    } catch (e) { setError("Erreur d'analyse du frigo."); console.error(e); }
    setLoading(false);
  };

  // ── MACRO SNIPER ──
  const [sniperInput, setSniperInput] = useState("");
  const macroSnipe = async () => {
    if (!sniperInput.trim()) return;
    setLoading(true); setError(""); setResults([]);
    try {
      const text = await askAI(
        `Tu es un coach nutrition sèche. L'utilisateur te décrit son besoin en texte libre. Propose 3 solutions rapides et simples.
Réponds UNIQUEMENT en JSON valide sans markdown :
{"meals": [{"name": "...", "ingredients": [{"name": "...", "amount": "..."}], "macros": {"calories": 0, "proteins": 0, "carbs": 0, "fats": 0}, "steps": ["..."], "prepTime": 10, "seche_friendly": true}]}`,
        `Demande: "${sniperInput}"
Macros restantes: ${remaining.calories} kcal, ${remaining.proteins}g prot, ${remaining.carbs}g gluc, ${remaining.fats}g lip.
${profile.allergies ? `Allergies: ${profile.allergies}` : ""}
Propose 3 options simples et rapides.`
      );
      const data = parseJSON(text);
      if (data.meals) setResults(data.meals);
    } catch (e) { setError("Erreur. Réessaie."); console.error(e); }
    setLoading(false);
  };

  return (
    <div>
      <PageHead title="Nutrition 🍎" sub="Loguer, scanner ou générer des repas" />
      {!isToday && <PastDayBanner selectedDate={selectedDate} />}

      {/* Mode selector */}
      <div style={{ display: "flex", gap: 6, padding: "0 20px 14px", overflowX: "auto" }}>
        <Chip active={mode === "log"} onClick={() => { setMode("log"); setResults([]); setPreview(null); }}>📝 Log</Chip>
        <Chip active={mode === "scan"} onClick={() => { setMode("scan"); setResults([]); setPreview(null); }} color={C.cyan}>📸 Photo</Chip>
        <Chip active={mode === "fridge"} onClick={() => { setMode("fridge"); setResults([]); setPreview(null); }} color={C.lime}>🧊 Frigo</Chip>
        <Chip active={mode === "sniper"} onClick={() => { setMode("sniper"); setResults([]); }} color={C.purple}>🎯 Sniper</Chip>
      </div>

      {/* Quick macro summary */}
      <Section>
        <Card>
          <MacroBar label="Calories" cur={todayMacros.calories} max={macros.calories} color={C.lime} unit=" kcal" />
          <MacroBar label="Protéines" cur={todayMacros.proteins} max={macros.proteins} color={C.lime} />
          <MacroBar label="Glucides" cur={todayMacros.carbs} max={macros.carbs} color={C.cyan} />
          <MacroBar label="Lipides" cur={todayMacros.fats} max={macros.fats} color={C.purple} />
        </Card>
      </Section>

      {/* ── LOG MODE ── */}
      {mode === "log" && (
        <>
          {/* AI Quick Estimate */}
          <Section>
            <Card>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>📝 Loguer un repas</div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Décris ce que t'as mangé — l'IA estime les macros</div>
              <textarea value={logInput} onChange={e => setLogInput(e.target.value)}
                placeholder="Ex: 200g de poulet grillé avec du riz et des haricots verts, un yaourt grec"
                rows={3} style={{ width: "100%", background: "#0a0a14", border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.text, fontSize: 13, resize: "none", outline: "none", boxSizing: "border-box", marginBottom: 10, fontFamily: font }}
                onFocus={e => e.target.style.borderColor = C.lime} onBlur={e => e.target.style.borderColor = C.border} />
              <Btn onClick={estimateFromText} disabled={loading || !logInput.trim()}>
                {loading ? "🧠 Estimation..." : "🧠 Estimer les macros"}
              </Btn>
            </Card>
          </Section>

          {/* AI Estimation result */}
          {logEstimated && (
            <Section>
              <Card glow accent={`${C.lime}55`}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{logEstimated.name}</div>

                {/* Items breakdown */}
                {logEstimated.items?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    {logEstimated.items.map((item, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: i < logEstimated.items.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <div>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</span>
                          <span style={{ fontSize: 11, color: C.muted }}> — {item.amount}</span>
                        </div>
                        <span style={{ fontSize: 11, fontFamily: mono, color: C.muted }}>{item.calories} kcal</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Total macros */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, textAlign: "center", background: "#0a0a14", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  {[
                    { l: "Calories", v: logEstimated.macros.calories, u: "kcal", c: C.lime },
                    { l: "Prot", v: logEstimated.macros.proteins, u: "g", c: C.lime },
                    { l: "Gluc", v: logEstimated.macros.carbs, u: "g", c: C.cyan },
                    { l: "Lip", v: logEstimated.macros.fats, u: "g", c: C.purple },
                  ].map(m => (
                    <div key={m.l}>
                      <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: m.c }}>{m.v}</div>
                      <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase" }}>{m.l}</div>
                    </div>
                  ))}
                </div>

                {logEstimated.seche_friendly && (
                  <div style={{ fontSize: 10, color: C.lime, fontWeight: 700, textAlign: "center", marginBottom: 8 }}>✅ Sèche-friendly (≥30g prot, ≤500 kcal)</div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <Btn onClick={confirmEstimated} style={{ flex: 2 }}>✓ Confirmer & loguer</Btn>
                  <Btn v="secondary" onClick={() => setLogEstimated(null)} style={{ flex: 1 }}>✕</Btn>
                </div>
              </Card>
            </Section>
          )}

          {/* Manual toggle */}
          <Section>
            <Btn v="secondary" onClick={() => setShowManual(!showManual)} small style={{ width: "100%" }}>
              {showManual ? "Fermer le mode manuel" : "✎ Saisie manuelle (si tu connais les macros)"}
            </Btn>
          </Section>

          {showManual && (
            <Section>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>✎ Saisie manuelle</div>
                <Input label="Nom du repas" value={manual.name} onChange={v => setManual(p => ({ ...p, name: v }))} placeholder="Ex: Poulet riz brocoli" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Input label="Calories (kcal)" value={manual.calories} onChange={v => setManual(p => ({ ...p, calories: v }))} type="number" />
                  <Input label="Protéines (g)" value={manual.proteins} onChange={v => setManual(p => ({ ...p, proteins: v }))} type="number" />
                  <Input label="Glucides (g)" value={manual.carbs} onChange={v => setManual(p => ({ ...p, carbs: v }))} type="number" />
                  <Input label="Lipides (g)" value={manual.fats} onChange={v => setManual(p => ({ ...p, fats: v }))} type="number" />
                </div>
                <Btn onClick={addManualMeal} disabled={!manual.name}>Ajouter</Btn>
              </Card>
            </Section>
          )}
        </>
      )}

      {/* ── SCAN / FRIDGE / SNIPER modes ── */}
      {mode !== "log" && (
        <Section>
          {mode === "scan" && (
            <Card>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>📸 Photo Food Scanner</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Prends en photo ton repas — l'IA estime les macros</div>
              {preview && <img src={preview} alt="food" style={{ width: "100%", borderRadius: 12, marginBottom: 12, maxHeight: 200, objectFit: "cover" }} />}
              <PhotoCapture onCapture={(b64, mt, full) => { setPreview(full); scanFood(b64, mt); }} label="📸 Scanner mon repas" />
            </Card>
          )}

          {mode === "fridge" && (
            <Card>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>🧊 Fridge Vision</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Photo de ton frigo → 3 recettes sèche adaptées{profile.hasAirfryer ? " (mode Airfryer 🔥)" : ""}</div>
              {preview && <img src={preview} alt="fridge" style={{ width: "100%", borderRadius: 12, marginBottom: 12, maxHeight: 200, objectFit: "cover" }} />}
              <PhotoCapture onCapture={(b64, mt, full) => { setPreview(full); scanFridge(b64, mt); }} label="📸 Scanner mon frigo" />
            </Card>
          )}

          {mode === "sniper" && (
            <Card>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>🎯 Macro Sniper</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Dis ce qu'il te reste comme macros, l'IA te propose des idées</div>
              <textarea value={sniperInput} onChange={e => setSniperInput(e.target.value)}
                placeholder={`Ex: "Il me reste ${remaining.proteins}g de prot, j'ai faim, propose un truc simple"`}
                rows={3} style={{ width: "100%", background: "#0a0a14", border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.text, fontSize: 13, resize: "none", outline: "none", boxSizing: "border-box", marginBottom: 12, fontFamily: font }}
                onFocus={e => e.target.style.borderColor = C.purple} onBlur={e => e.target.style.borderColor = C.border} />
              <Btn v="purple" onClick={macroSnipe} disabled={loading || !sniperInput.trim()}>
                {loading ? "🧠 Recherche..." : "🎯 Trouver"}
              </Btn>
            </Card>
          )}
        </Section>
      )}

      {/* Loading */}
      {loading && mode !== "log" && <Section><LoadingPulse text={mode === "scan" ? "Analyse du repas..." : mode === "fridge" ? "Analyse du frigo..." : "Recherche de recettes..."} /></Section>}

      {/* Error */}
      {error && <Section><Card accent={C.red}><div style={{ color: C.red, fontSize: 13 }}>{error}</div></Card></Section>}

      {/* Results (scan/fridge/sniper) */}
      {results.length > 0 && mode !== "log" && (
        <Section title="Résultats">
          {results.map((meal, i) => (
            <MealResult key={i} meal={meal} onAdd={() => addMeal(meal)} />
          ))}
        </Section>
      )}

      {/* Today's meals — always visible */}
      {todayM.length > 0 && (
        <Section title={`Repas du jour (${todayM.length})`}>
          {todayM.map(m => (
            <MealResult key={m.id} meal={m} onRemove={() => removeTodayMeal(m.id)} compact />
          ))}
        </Section>
      )}
      {todayM.length === 0 && mode === "log" && (
        <Section>
          <Card style={{ textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>🍽️</div>
            <div style={{ color: C.muted, fontSize: 13 }}>Aucun repas logué</div>
            <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>Décris ce que t'as mangé ci-dessus</div>
          </Card>
        </Section>
      )}
    </div>
  );
}

function MealResult({ meal, onAdd, onRemove, compact }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ marginBottom: 10 }}>
      <div onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{meal.name}</span>
              {meal.seche_friendly && <span style={{ fontSize: 8, background: C.lime, color: C.bg, padding: "2px 7px", borderRadius: 20, fontWeight: 800, textTransform: "uppercase" }}>SÈCHE</span>}
              {meal.airfryer && <span style={{ fontSize: 8, background: C.cyan, color: C.bg, padding: "2px 7px", borderRadius: 20, fontWeight: 800 }}>AIRFRYER</span>}
            </div>
            <div style={{ display: "flex", gap: 10, fontSize: 11, fontFamily: mono }}>
              <span style={{ color: C.lime }}>{meal.macros?.calories} kcal</span>
              <span>P{meal.macros?.proteins}g</span>
              <span style={{ color: C.cyan }}>G{meal.macros?.carbs}g</span>
              <span style={{ color: C.purple }}>L{meal.macros?.fats}g</span>
            </div>
          </div>
          {meal.prepTime > 0 && <span style={{ fontSize: 11, color: C.muted }}>⏱{meal.prepTime}m</span>}
        </div>

        {open && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            {meal.ingredients?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 4 }}>Ingrédients</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {meal.ingredients.map((ing, j) => <span key={j} style={{ background: C.border, padding: "3px 8px", borderRadius: 6, fontSize: 11, color: "#ccc" }}>{ing.name} — {ing.amount}</span>)}
                </div>
              </div>
            )}
            {meal.steps?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 4 }}>Préparation</div>
                {meal.steps.map((s, j) => <div key={j} style={{ fontSize: 12, color: "#aaa", marginBottom: 4, paddingLeft: 14, position: "relative" }}><span style={{ position: "absolute", left: 0, color: C.lime, fontFamily: mono, fontSize: 10 }}>{j+1}.</span>{s}</div>)}
              </div>
            )}
            {meal.airfryer && (
              <div style={{ background: `${C.cyan}12`, border: `1px solid ${C.cyan}33`, borderRadius: 10, padding: 10, marginTop: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, textTransform: "uppercase", marginBottom: 4 }}>🔥 Réglages Airfryer</div>
                <div style={{ fontSize: 12, color: C.text }}>{meal.airfryer.temp}°C — {meal.airfryer.time} min</div>
                {meal.airfryer.tip && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{meal.airfryer.tip}</div>}
              </div>
            )}
          </div>
        )}
      </div>
      {!compact && (
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          {onAdd && <Btn onClick={e => { e.stopPropagation(); onAdd(); }} small>✚ Loguer</Btn>}
          {onRemove && <Btn v="danger" onClick={e => { e.stopPropagation(); onRemove(); }} small>✕</Btn>}
        </div>
      )}
      {compact && onRemove && (
        <div style={{ marginTop: 8 }}>
          <Btn v="danger" onClick={onRemove} small style={{ width: "100%" }}>✕ Retirer</Btn>
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GYM TAB
// ═══════════════════════════════════════════════════════════════════════

function GymTab({ profile, workouts, setWorkouts, todayW, todayMacros, macros, meals, setMeals, caloriesBurned, selectedDate, isToday, todayM }) {
  const [view, setView] = useState("log"); // log | perf | cardio
  const [showAdd, setShowAdd] = useState(false);
  const [ex, setEx] = useState({ name: "", group: "Pecs", weight: "", reps: "", sets: "" });

  const estCal = estimateBurn(ex.group, Number(ex.weight) || 0, Number(ex.reps) || 0, Number(ex.sets) || 0, profile.weight);

  const addExercise = () => {
    if (!ex.name) return;
    const w = Number(ex.weight) || 0, r = Number(ex.reps) || 0, s = Number(ex.sets) || 0;
    setWorkouts(prev => [...prev, {
      ...ex, weight: w, reps: r, sets: s,
      caloriesBurned: estimateBurn(ex.group, w, r, s, profile.weight),
      date: selectedDate, id: uid(),
      relativeForce: profile.weight > 0 ? (w / profile.weight).toFixed(2) : 0,
    }]);
    setEx({ name: "", group: "Pecs", weight: "", reps: "", sets: "" });
    setShowAdd(false);
  };

  const removeW = id => setWorkouts(prev => prev.filter(w => w.id !== id));

  // Performance data
  const exerciseNames = [...new Set(workouts.map(w => w.name))];
  const [selectedExo, setSelectedExo] = useState("");

  const exoHistory = workouts.filter(w => w.name === selectedExo).sort((a, b) => a.date.localeCompare(b.date));
  const exoChartData = exoHistory.map(w => ({
    date: w.date.slice(5),
    poids: w.weight,
    reps: w.reps,
    force_rel: Number(w.relativeForce),
  }));

  // Cardio compensator
  const caloriesOver = todayMacros.calories - macros.calories - caloriesBurned;
  const [cardioResult, setCardioResult] = useState(null);
  const [cardioLoading, setCardioLoading] = useState(false);

  const getCardioAdvice = async () => {
    if (caloriesOver <= 0) return;
    setCardioLoading(true);
    try {
      const text = await askAI(
        `Tu es un coach sportif expert. L'utilisateur a mangé trop de calories. Propose 3 options de cardio pour compenser l'excédent exact. Réponds en JSON:
{"sessions": [{"type": "Vélo", "duration_min": 30, "intensity": "modérée", "calories_burned": 300, "tip": "..."}]}`,
        `J'ai ${caloriesOver} kcal en trop aujourd'hui. Poids: ${profile.weight}kg. Propose 3 sessions cardio pour compenser.`
      );
      setCardioResult(parseJSON(text));
    } catch { setCardioResult({ sessions: [
      { type: "Vélo", duration_min: Math.round(caloriesOver / 8), intensity: "modérée", calories_burned: caloriesOver, tip: "Maintiens 60-70% FC max" },
      { type: "Course", duration_min: Math.round(caloriesOver / 12), intensity: "modérée", calories_burned: caloriesOver, tip: "Allure conversation" },
      { type: "Rameur", duration_min: Math.round(caloriesOver / 10), intensity: "HIIT", calories_burned: caloriesOver, tip: "30s sprint / 30s repos" },
    ]}); }
    setCardioLoading(false);
  };

  const logCardio = (session) => {
    setWorkouts(prev => [...prev, {
      name: session.type, group: "Cardio", weight: 0, reps: 0, sets: 0,
      caloriesBurned: session.calories_burned, date: selectedDate, id: uid(), relativeForce: 0,
    }]);
  };

  return (
    <div>
      <PageHead title="Muscu 💪" sub="Performance, logs & cardio compensator" />
      {!isToday && <PastDayBanner selectedDate={selectedDate} />}

      <div style={{ display: "flex", gap: 8, padding: "0 20px 14px" }}>
        <Chip active={view === "log"} onClick={() => setView("log")}>📝 Log</Chip>
        <Chip active={view === "perf"} onClick={() => setView("perf")} color={C.cyan}>📈 Performance</Chip>
        <Chip active={view === "cardio"} onClick={() => setView("cardio")} color={C.red}>🔥 Cardio Fix</Chip>
      </div>

      {/* ── LOG VIEW ── */}
      {view === "log" && (
        <>
          <Section>
            <Btn onClick={() => setShowAdd(!showAdd)} v={showAdd ? "secondary" : "primary"}>
              {showAdd ? "Annuler" : "✚ Loguer un exercice"}
            </Btn>
          </Section>

          {showAdd && (
            <Section>
              <Card>
                <Input label="Exercice" value={ex.name} onChange={v => setEx(p => ({ ...p, name: v }))} placeholder="Ex: DC Incliné" />
                <Select label="Groupe musculaire" value={ex.group} onChange={v => setEx(p => ({ ...p, group: v }))} options={MUSCLE_GROUPS.map(g => ({ value: g, label: g }))} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <Input label="Poids (kg)" value={ex.weight} onChange={v => setEx(p => ({ ...p, weight: v }))} type="number" />
                  <Input label="Reps" value={ex.reps} onChange={v => setEx(p => ({ ...p, reps: v }))} type="number" />
                  <Input label="Séries" value={ex.sets} onChange={v => setEx(p => ({ ...p, sets: v }))} type="number" />
                </div>
                {(Number(ex.sets) > 0) && (
                  <div style={{ background: `${C.lime}12`, border: `1px solid ${C.lime}25`, borderRadius: 10, padding: 10, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: C.muted }}>🔥 Estimation calories brûlées</span>
                    <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: C.lime }}>{estCal} kcal</span>
                  </div>
                )}
                <Btn onClick={addExercise} disabled={!ex.name}>Enregistrer</Btn>
              </Card>
            </Section>
          )}

          <Section title={`Aujourd'hui (${todayW.length})`}>
            {todayW.length === 0 ? (
              <Card style={{ textAlign: "center", padding: 28 }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>🏋️</div>
                <div style={{ color: C.muted, fontSize: 13 }}>Pas encore d'exercice</div>
              </Card>
            ) : todayW.map(w => (
              <Card key={w.id} style={{ marginBottom: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{w.name}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{w.group} — {w.weight}kg × {w.reps} reps × {w.sets} sets</div>
                    <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
                      {Number(w.relativeForce) > 0 && (
                        <span style={{ fontSize: 10, color: C.cyan, fontFamily: mono }}>Force: {w.relativeForce}x BW</span>
                      )}
                      {w.caloriesBurned > 0 && (
                        <span style={{ fontSize: 10, color: C.lime, fontFamily: mono }}>🔥 {w.caloriesBurned} kcal</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeW(w.id)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18 }}>×</button>
                </div>
              </Card>
            ))}
          </Section>
        </>
      )}

      {/* ── PERFORMANCE VIEW ── */}
      {view === "perf" && (
        <>
          <Section>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📈 Progression par exercice</div>
              {exerciseNames.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 16 }}>Logue des exercices pour voir ta progression</div>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                    {exerciseNames.map(n => (
                      <Chip key={n} active={selectedExo === n} onClick={() => setSelectedExo(n)} color={C.cyan}>{n}</Chip>
                    ))}
                  </div>
                  {selectedExo && exoChartData.length > 1 && (
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={exoChartData}>
                        <CartesianGrid stroke={C.border} vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={35} />
                        <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 11 }} />
                        <Line type="monotone" dataKey="poids" stroke={C.lime} strokeWidth={2} dot={{ r: 3 }} name="Poids (kg)" />
                        <Line type="monotone" dataKey="force_rel" stroke={C.cyan} strokeWidth={2} dot={{ r: 3 }} name="Force relative" />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                  {selectedExo && exoChartData.length <= 1 && (
                    <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 12 }}>2 sessions minimum pour voir le graphique</div>
                  )}
                </>
              )}
            </Card>
          </Section>

          {/* Relative force summary */}
          <Section title="Force relative par groupe">
            <Card>
              {(() => {
                const byGroup = {};
                workouts.forEach(w => {
                  if (w.weight > 0 && w.group !== "Cardio") {
                    if (!byGroup[w.group]) byGroup[w.group] = [];
                    byGroup[w.group].push(Number(w.relativeForce) || 0);
                  }
                });
                const radarData = Object.entries(byGroup).map(([g, vals]) => ({
                  group: g, best: Math.max(...vals),
                }));
                if (radarData.length < 3) return <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 12 }}>Logue au moins 3 groupes musculaires</div>;
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke={C.border} />
                      <PolarAngleAxis dataKey="group" tick={{ fill: C.muted, fontSize: 10 }} />
                      <PolarRadiusAxis tick={{ fill: C.dim, fontSize: 9 }} />
                      <Radar dataKey="best" stroke={C.lime} fill={C.lime} fillOpacity={0.15} strokeWidth={2} name="Meilleure force relative" />
                    </RadarChart>
                  </ResponsiveContainer>
                );
              })()}
            </Card>
          </Section>
        </>
      )}

      {/* ── CARDIO COMPENSATOR DYNAMIC ── */}
      {view === "cardio" && (
        <Section>
          {(() => {
            // Smart detection: what went wrong?
            const alcoholMeals = todayM.filter(m => /bière|beer|vin|wine|alcool|vodka|rhum|whisky/i.test(m.name));
            const hasAlcohol = alcoholMeals.length > 0;
            const carbsOver = todayMacros.carbs > macros.carbs ? todayMacros.carbs - macros.carbs : 0;
            const fatsOver = todayMacros.fats > macros.fats ? todayMacros.fats - macros.fats : 0;
            const totalOver = caloriesOver;

            return (
              <>
              <Card>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🔥 Cardio Compensator Dynamic</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Analyse tes écarts du jour et calcule l'exercice exact pour compenser</div>

                {totalOver <= 0 ? (
                  <div style={{ textAlign: "center", padding: 20 }}>
                    <div style={{ fontSize: 32, marginBottom: 6 }}>✅</div>
                    <div style={{ color: C.lime, fontWeight: 700, fontSize: 14 }}>Tu es dans tes macros !</div>
                    <div style={{ color: C.muted, fontSize: 12 }}>Pas besoin de compenser</div>
                  </div>
                ) : (
                  <>
                    {/* What went wrong breakdown */}
                    <div style={{ background: `${C.red}10`, border: `1px solid ${C.red}22`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>📊 Diagnostic</span>
                        <span style={{ fontFamily: mono, fontSize: 22, fontWeight: 900, color: C.red }}>+{totalOver} kcal</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {hasAlcohol && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                            <span style={{ color: "#ffa726" }}>🍺 Alcool ({alcoholMeals.length} conso{alcoholMeals.length > 1 ? "s" : ""})</span>
                            <span style={{ fontFamily: mono, color: "#ffa726" }}>~{alcoholMeals.length * 150} kcal</span>
                          </div>
                        )}
                        {carbsOver > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                            <span style={{ color: C.cyan }}>🍚 Excès glucides (+{carbsOver}g)</span>
                            <span style={{ fontFamily: mono, color: C.cyan }}>~{carbsOver * 4} kcal</span>
                          </div>
                        )}
                        {fatsOver > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                            <span style={{ color: C.purple }}>🧈 Excès lipides (+{fatsOver}g)</span>
                            <span style={{ fontFamily: mono, color: C.purple }}>~{fatsOver * 9} kcal</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Instant calculations — no API needed */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                      Options pour effacer +{totalOver} kcal ({profile.weight}kg)
                    </div>
                    {[
                      { icon: "🚶", name: "Marche rapide", speed: "6 km/h", calPerMin: profile.weight * 0.07, color: C.lime },
                      { icon: "🏃", name: "Course modérée", speed: "9 km/h", calPerMin: profile.weight * 0.12, color: C.cyan },
                      { icon: "📐", name: "Tapis incliné 12%", speed: "5 km/h", calPerMin: profile.weight * 0.1, color: "#ffa726" },
                      { icon: "🚴", name: "Vélo modéré", speed: "20 km/h", calPerMin: profile.weight * 0.09, color: C.purple },
                      { icon: "🚣", name: "Rameur HIIT", speed: "30s/30s", calPerMin: profile.weight * 0.14, color: C.red },
                      { icon: "🏊", name: "Natation", speed: "crawl", calPerMin: profile.weight * 0.11, color: C.cyan },
                    ].map((opt, i) => {
                      const minutes = Math.round(totalOver / opt.calPerMin);
                      return (
                        <Card key={i} style={{ marginBottom: 8, padding: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                                <span style={{ fontSize: 16 }}>{opt.icon}</span>
                                <span style={{ fontWeight: 700, fontSize: 13 }}>{opt.name}</span>
                              </div>
                              <div style={{ fontSize: 11, color: C.muted }}>{opt.speed} — {Math.round(opt.calPerMin * 10) / 10} kcal/min</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 900, color: opt.color }}>{minutes}<span style={{ fontSize: 11, fontWeight: 500 }}> min</span></div>
                            </div>
                          </div>
                          <Btn small v="secondary" onClick={() => logCardio({ type: opt.name, calories_burned: totalOver, duration_min: minutes })} style={{ marginTop: 8, width: "100%" }}>
                            ✚ Loguer {minutes} min de {opt.name.toLowerCase()}
                          </Btn>
                        </Card>
                      );
                    })}

                    {/* AI advice button for personalized tips */}
                    <div style={{ marginTop: 6 }}>
                      <Btn v="cyan" onClick={getCardioAdvice} disabled={cardioLoading}>
                        {cardioLoading ? "🧠 Calcul..." : "🧠 Conseil IA personnalisé"}
                      </Btn>
                    </div>
                  </>
                )}
              </Card>

              {cardioLoading && <div style={{ marginTop: 12 }}><LoadingPulse text="Analyse de tes écarts..." /></div>}

              {cardioResult?.sessions?.map((s, i) => (
                <Card key={i} style={{ marginTop: 10 }} accent={`${C.cyan}44`}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Conseil IA</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{s.type}</div>
                  <div style={{ fontSize: 12, color: C.muted }}>{s.duration_min} min — Intensité {s.intensity}</div>
                  <div style={{ fontSize: 11, fontFamily: mono, color: C.red, marginTop: 2 }}>≈ {s.calories_burned} kcal</div>
                  {s.tip && <div style={{ fontSize: 11, color: C.cyan, marginTop: 4 }}>💡 {s.tip}</div>}
                  <Btn small v="secondary" onClick={() => logCardio(s)} style={{ marginTop: 8, width: "100%" }}>✚ Loguer</Btn>
                </Card>
              ))}
              </>
            );
          })()}
        </Section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HEALTH TAB
// ═══════════════════════════════════════════════════════════════════════

function HealthTab({ symptoms, setSymptoms, todayS, meals, workouts, profile, sleepLogs, setSleepLogs, todaySleep, selectedDate, isToday }) {
  const [view, setView] = useState("sleep"); // sleep | log | patterns | recovery
  const [showAdd, setShowAdd] = useState(false);
  const [s, setS] = useState({ zone: "Tête", description: "", intensity: "5" });
  const [patternResult, setPatternResult] = useState(null);
  const [recoveryResult, setRecoveryResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // Sleep form
  const [showSleepAdd, setShowSleepAdd] = useState(false);
  const [sl, setSl] = useState({ duration: "7.5", quality: "7", bedtime: "23:00", wakeTime: "06:30", deepSleep: "", remSleep: "", notes: "" });

  const addSymptom = () => {
    if (!s.description) return;
    setSymptoms(prev => [...prev, { ...s, intensity: Number(s.intensity), date: selectedDate, id: uid() }]);
    setS({ zone: "Tête", description: "", intensity: "5" });
    setShowAdd(false);
  };

  const removeSymptom = id => setSymptoms(prev => prev.filter(x => x.id !== id));

  const addSleep = () => {
    const entry = {
      duration: Number(sl.duration) || 0,
      quality: Number(sl.quality) || 5,
      bedtime: sl.bedtime,
      wakeTime: sl.wakeTime,
      deepSleep: Number(sl.deepSleep) || 0,
      remSleep: Number(sl.remSleep) || 0,
      notes: sl.notes,
      date: selectedDate,
      id: uid(),
    };
    setSleepLogs(prev => {
      const filtered = prev.filter(s => s.date !== selectedDate);
      return [...filtered, entry];
    });
    setSl({ duration: "7.5", quality: "7", bedtime: "23:00", wakeTime: "06:30", deepSleep: "", remSleep: "", notes: "" });
    setShowSleepAdd(false);
  };

  // Sleep chart data (last 7 days)
  const sleepChartData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().slice(0, 10);
    const log = sleepLogs.find(s => s.date === dateStr);
    return {
      day: d.toLocaleDateString("fr-FR", { weekday: "short" }),
      date: dateStr,
      duration: log?.duration || 0,
      quality: log?.quality || 0,
      deepSleep: log?.deepSleep || 0,
      remSleep: log?.remSleep || 0,
    };
  });

  // Pattern detection
  const detectPatterns = async () => {
    setLoading(true);
    const last30symptoms = symptoms.filter(s => { const d = new Date(s.date); const ago = new Date(); ago.setDate(ago.getDate() - 30); return d >= ago; });
    const last30meals = meals.filter(m => { const d = new Date(m.date); const ago = new Date(); ago.setDate(ago.getDate() - 30); return d >= ago; });
    const last30workouts = workouts.filter(w => { const d = new Date(w.date); const ago = new Date(); ago.setDate(ago.getDate() - 30); return d >= ago; });
    const last30sleep = sleepLogs.filter(s => { const d = new Date(s.date); const ago = new Date(); ago.setDate(ago.getDate() - 30); return d >= ago; });

    try {
      const text = await askAI(
        `Tu es un médecin généraliste. Analyse les corrélations entre nutrition, sport, sommeil et symptômes. Trouve des patterns et donne des alertes concrètes. Prête une attention particulière aux liens entre qualité de sommeil et symptômes/performances.
Réponds en JSON: {"patterns": [{"alert_level": "high|medium|low", "title": "Titre court", "description": "Explication détaillée", "correlation": "nutrition|sport|sommeil|mixte", "recommendation": "Conseil concret"}]}`,
        `SYMPTÔMES (30j): ${JSON.stringify(last30symptoms.map(s => ({ date: s.date, zone: s.zone, desc: s.description, intensité: s.intensity })))}
NUTRITION (30j): ${JSON.stringify(last30meals.map(m => ({ date: m.date, name: m.name, cal: m.macros?.calories, prot: m.macros?.proteins })))}
SPORT (30j): ${JSON.stringify(last30workouts.map(w => ({ date: w.date, name: w.name, group: w.group, weight: w.weight })))}
SOMMEIL (30j): ${JSON.stringify(last30sleep.map(s => ({ date: s.date, durée_h: s.duration, qualité: s.quality, coucher: s.bedtime, réveil: s.wakeTime, deep: s.deepSleep, rem: s.remSleep, notes: s.notes })))}
Poids: ${profile.weight}kg. Trouve les corrélations, surtout entre sommeil et les autres données.`
      );
      setPatternResult(parseJSON(text));
    } catch {
      setPatternResult({ patterns: [{ alert_level: "low", title: "Données insuffisantes", description: "Continue de loguer tes symptômes, repas, séances et sommeil pour que l'IA trouve des corrélations.", correlation: "mixte", recommendation: "Logue pendant au moins 7 jours." }] });
    }
    setLoading(false);
  };

  // Recovery advisor
  const getRecovery = async () => {
    if (todayS.length === 0) return;
    setLoading(true);
    try {
      const text = await askAI(
        `Tu es kinésithérapeute et médecin du sport. L'utilisateur a des symptômes. Propose des conseils de récupération et liste les exercices à ÉVITER. Prends en compte son sommeil récent.
Réponds en JSON: {"advice": [{"symptom": "...", "avoid_exercises": ["..."], "recommendations": ["..."], "stretches": ["..."]}], "global_tip": "..."}`,
        `Symptômes aujourd'hui: ${JSON.stringify(todayS.map(s => ({ zone: s.zone, desc: s.description, intensité: s.intensity })))}
Sommeil dernière nuit: ${todaySleep ? `${todaySleep.duration}h, qualité ${todaySleep.quality}/10, couché ${todaySleep.bedtime}, réveillé ${todaySleep.wakeTime}` : "non logué"}
Sport prévu: musculation. Poids: ${profile.weight}kg. Que dois-je éviter et faire pour récupérer ?`
      );
      setRecoveryResult(parseJSON(text));
    } catch {
      setRecoveryResult({ advice: [{ symptom: todayS[0]?.description || "Douleur", avoid_exercises: ["Exercices à haute pression intra-abdominale"], recommendations: ["Repos actif", "Hydratation"], stretches: ["Étirements doux du cou"] }], global_tip: "Écoute ton corps." });
    }
    setLoading(false);
  };

  return (
    <div>
      <PageHead title="Santé 🩺" sub="Sommeil, symptômes, patterns & récupération" />
      {!isToday && <PastDayBanner selectedDate={selectedDate} />}

      <div style={{ display: "flex", gap: 8, padding: "0 20px 14px", overflowX: "auto" }}>
        <Chip active={view === "sleep"} onClick={() => setView("sleep")} color={C.purple}>😴 Sommeil</Chip>
        <Chip active={view === "log"} onClick={() => setView("log")}>📝 Symptômes</Chip>
        <Chip active={view === "patterns"} onClick={() => setView("patterns")} color={C.red}>🔍 Patterns</Chip>
        <Chip active={view === "recovery"} onClick={() => setView("recovery")} color={C.cyan}>🩹 Récup</Chip>
      </div>

      {/* ── SLEEP VIEW ── */}
      {view === "sleep" && (
        <>
          {/* Tonight's sleep */}
          <Section>
            {todaySleep ? (
              <Card glow accent={todaySleep.duration >= 7 ? `${C.purple}55` : `${C.red}55`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Nuit dernière</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontFamily: mono, fontSize: 36, fontWeight: 900, color: todaySleep.duration >= 7 ? C.purple : C.red }}>{todaySleep.duration}h</span>
                      <span style={{ fontSize: 12, color: C.muted }}>qualité {todaySleep.quality}/10</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: C.muted }}>🛏 {todaySleep.bedtime}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>⏰ {todaySleep.wakeTime}</div>
                  </div>
                </div>
                {(todaySleep.deepSleep > 0 || todaySleep.remSleep > 0) && (
                  <div style={{ display: "flex", gap: 12, marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                    {todaySleep.deepSleep > 0 && (
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Sommeil profond</div>
                        <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: "#6366f1" }}>{todaySleep.deepSleep}h</div>
                      </div>
                    )}
                    {todaySleep.remSleep > 0 && (
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>REM</div>
                        <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: C.cyan }}>{todaySleep.remSleep}h</div>
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Score Lock-in</div>
                      <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: todaySleep.duration >= 7 && todaySleep.quality >= 7 ? C.lime : "#ffa726" }}>
                        {todaySleep.duration >= 7 && todaySleep.quality >= 7 ? "+15" : todaySleep.duration >= 6 ? "+3" : "-10"}
                      </div>
                    </div>
                  </div>
                )}
                {todaySleep.notes && <div style={{ marginTop: 8, fontSize: 11, color: C.muted, fontStyle: "italic" }}>📝 {todaySleep.notes}</div>}
              </Card>
            ) : (
              <Card style={{ textAlign: "center", padding: 24 }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>😴</div>
                <div style={{ color: C.muted, fontSize: 13, marginBottom: 4 }}>Sommeil pas encore logué</div>
                <div style={{ color: C.dim, fontSize: 11 }}>Logue ta nuit pour l'intégrer au score Lock-in</div>
              </Card>
            )}
          </Section>

          {/* Add sleep */}
          <Section>
            <Btn onClick={() => setShowSleepAdd(!showSleepAdd)} v={showSleepAdd ? "secondary" : "purple"}>
              {showSleepAdd ? "Annuler" : todaySleep ? "✏️ Modifier le sommeil" : "✚ Loguer mon sommeil"}
            </Btn>
          </Section>

          {showSleepAdd && (
            <Section>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>😴 Données de sommeil</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Input label="Durée totale (h)" value={sl.duration} onChange={v => setSl(p => ({ ...p, duration: v }))} type="number" />
                  <Input label="Qualité (1-10)" value={sl.quality} onChange={v => setSl(p => ({ ...p, quality: v }))} type="number" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Input label="Heure coucher" value={sl.bedtime} onChange={v => setSl(p => ({ ...p, bedtime: v }))} type="time" />
                  <Input label="Heure réveil" value={sl.wakeTime} onChange={v => setSl(p => ({ ...p, wakeTime: v }))} type="time" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Input label="Sommeil profond (h)" value={sl.deepSleep} onChange={v => setSl(p => ({ ...p, deepSleep: v }))} type="number" placeholder="Apple Watch / Oura" />
                  <Input label="Sommeil REM (h)" value={sl.remSleep} onChange={v => setSl(p => ({ ...p, remSleep: v }))} type="number" placeholder="Apple Watch / Oura" />
                </div>
                <Input label="Notes" value={sl.notes} onChange={v => setSl(p => ({ ...p, notes: v }))} placeholder="Ex: réveillé 2 fois, cauchemar, trop chaud..." />
                <Btn v="purple" onClick={addSleep}>Enregistrer</Btn>
              </Card>
            </Section>
          )}

          {/* Sleep chart 7 days */}
          {sleepLogs.length > 0 && (
            <Section title="Semaine de sommeil">
              <Card>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={sleepChartData} barCategoryGap="20%">
                    <CartesianGrid stroke={C.border} vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={30} domain={[0, 10]} />
                    <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 11 }} />
                    <Bar dataKey="duration" fill={C.purple} radius={[4, 4, 0, 0]} name="Durée (h)" />
                    <Bar dataKey="quality" fill={`${C.purple}66`} radius={[4, 4, 0, 0]} name="Qualité (/10)" />
                  </BarChart>
                </ResponsiveContainer>
                {/* Average stats */}
                {(() => {
                  const logged = sleepChartData.filter(d => d.duration > 0);
                  if (logged.length === 0) return null;
                  const avgDur = (logged.reduce((a, d) => a + d.duration, 0) / logged.length).toFixed(1);
                  const avgQual = (logged.reduce((a, d) => a + d.quality, 0) / logged.length).toFixed(1);
                  return (
                    <div style={{ display: "flex", justifyContent: "space-around", marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Moy. durée</div>
                        <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: Number(avgDur) >= 7 ? C.purple : C.red }}>{avgDur}h</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Moy. qualité</div>
                        <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: Number(avgQual) >= 7 ? C.purple : "#ffa726" }}>{avgQual}/10</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Nuits loguées</div>
                        <div style={{ fontFamily: mono, fontSize: 16, fontWeight: 700 }}>{logged.length}/7</div>
                      </div>
                    </div>
                  );
                })()}
              </Card>
            </Section>
          )}

          {/* Apple Watch info */}
          <Section>
            <Card style={{ background: "#0d0a18", border: `1px solid ${C.purple}33` }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 20 }}>⌚</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.purple, marginBottom: 4 }}>Apple Watch / Oura Ring</div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                    Les données de sommeil profond et REM viennent de ta montre. Ouvre l'app Santé → Sommeil pour les copier ici.
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>
                    💡 Pour automatiser : passer en React Native + HealthKit permet la synchro directe Apple Watch → Lock-in sans saisie manuelle.
                  </div>
                </div>
              </div>
            </Card>
          </Section>

          {/* Sleep history */}
          {sleepLogs.length > 0 && (
            <Section title="Historique">
              {[...sleepLogs].reverse().slice(0, 7).map(sl => (
                <Card key={sl.id} style={{ marginBottom: 6, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 14, color: sl.duration >= 7 ? C.purple : C.red }}>{sl.duration}h</span>
                      <span style={{ fontSize: 11, color: C.muted }}> — qualité {sl.quality}/10</span>
                      <span style={{ fontSize: 10, color: C.dim }}> — {sl.bedtime} → {sl.wakeTime}</span>
                    </div>
                    <span style={{ fontSize: 10, color: C.dim, fontFamily: mono }}>{sl.date.slice(5)}</span>
                  </div>
                </Card>
              ))}
            </Section>
          )}
        </>
      )}

      {/* ── SYMPTOM LOG ── */}
      {view === "log" && (
        <>
          <Section>
            <Btn onClick={() => setShowAdd(!showAdd)} v={showAdd ? "secondary" : "primary"}>
              {showAdd ? "Annuler" : "✚ Loguer un symptôme"}
            </Btn>
          </Section>

          {showAdd && (
            <Section>
              <Card>
                <Select label="Zone" value={s.zone} onChange={v => setS(p => ({ ...p, zone: v }))} options={SYMPTOM_ZONES.map(z => ({ value: z, label: z }))} />
                <Input label="Description" value={s.description} onChange={v => setS(p => ({ ...p, description: v }))} placeholder="Ex: douleur œil droit, vision floue" />
                <Input label="Intensité (1-10)" value={s.intensity} onChange={v => setS(p => ({ ...p, intensity: v }))} type="number" />
                <Btn onClick={addSymptom} disabled={!s.description}>Enregistrer</Btn>
              </Card>
            </Section>
          )}

          <Section title={`Aujourd'hui (${todayS.length})`}>
            {todayS.length === 0 ? (
              <Card style={{ textAlign: "center", padding: 28 }}>
                <div style={{ fontSize: 32, marginBottom: 6 }}>💚</div>
                <div style={{ color: C.lime, fontWeight: 600, fontSize: 13 }}>Aucun symptôme logué</div>
              </Card>
            ) : todayS.map(sym => (
              <Card key={sym.id} style={{ marginBottom: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{sym.zone}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{sym.description}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                      {Array.from({ length: 10 }, (_, i) => (
                        <div key={i} style={{ width: 10, height: 4, borderRadius: 2, background: i < sym.intensity ? (sym.intensity >= 7 ? C.red : sym.intensity >= 4 ? "#ffa726" : C.lime) : C.border }} />
                      ))}
                    </div>
                  </div>
                  <button onClick={() => removeSymptom(sym.id)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18 }}>×</button>
                </div>
              </Card>
            ))}
          </Section>

          {/* History */}
          {symptoms.length > todayS.length && (
            <Section title="Historique récent">
              {[...symptoms].filter(s => s.date !== today()).reverse().slice(0, 10).map(sym => (
                <Card key={sym.id} style={{ marginBottom: 6, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{sym.zone}</span>
                      <span style={{ fontSize: 11, color: C.muted }}> — {sym.description}</span>
                    </div>
                    <span style={{ fontSize: 10, color: C.dim, fontFamily: mono }}>{sym.date.slice(5)}</span>
                  </div>
                </Card>
              ))}
            </Section>
          )}
        </>
      )}

      {/* ── PATTERN DETECTION ── */}
      {view === "patterns" && (
        <Section>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🔍 Pattern Detector</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>L'IA analyse 30 jours de données (nutrition + sport + symptômes) pour trouver des corrélations</div>
            <Btn v="danger" onClick={detectPatterns} disabled={loading}>
              {loading ? "🧠 Analyse..." : "🔍 Lancer l'analyse"}
            </Btn>
          </Card>

          {loading && <div style={{ marginTop: 12 }}><LoadingPulse text="Analyse des corrélations..." /></div>}

          {patternResult?.patterns?.map((p, i) => (
            <Card key={i} style={{ marginTop: 10 }} accent={p.alert_level === "high" ? C.red : p.alert_level === "medium" ? "#ffa726" : C.border}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 18 }}>{p.alert_level === "high" ? "🚨" : p.alert_level === "medium" ? "⚠️" : "ℹ️"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: p.alert_level === "high" ? C.red : C.text }}>{p.title}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{p.description}</div>
                  <div style={{ marginTop: 8, background: `${C.cyan}12`, borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, textTransform: "uppercase", marginBottom: 2 }}>Recommandation</div>
                    <div style={{ fontSize: 12, color: C.text }}>{p.recommendation}</div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </Section>
      )}

      {/* ── RECOVERY ADVISOR ── */}
      {view === "recovery" && (
        <Section>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🩹 Recovery Advisor</div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
              {todayS.length === 0
                ? "Logue un symptôme d'abord pour recevoir des conseils de récupération"
                : `${todayS.length} symptôme(s) détecté(s) — l'IA adapte tes exercices`}
            </div>
            <Btn v="cyan" onClick={getRecovery} disabled={loading || todayS.length === 0}>
              {loading ? "🧠 Analyse..." : "🩹 Obtenir des conseils"}
            </Btn>
          </Card>

          {loading && <div style={{ marginTop: 12 }}><LoadingPulse text="Analyse des risques..." /></div>}

          {recoveryResult && (
            <>
              {recoveryResult.advice?.map((a, i) => (
                <Card key={i} style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{a.symptom}</div>
                  {a.avoid_exercises?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: "uppercase", marginBottom: 4 }}>❌ Exercices à éviter</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {a.avoid_exercises.map((e, j) => <span key={j} style={{ background: `${C.red}15`, color: C.red, padding: "3px 8px", borderRadius: 6, fontSize: 11 }}>{e}</span>)}
                      </div>
                    </div>
                  )}
                  {a.recommendations?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.lime, textTransform: "uppercase", marginBottom: 4 }}>✅ Recommandations</div>
                      {a.recommendations.map((r, j) => <div key={j} style={{ fontSize: 12, color: "#ccc", marginBottom: 2 }}>• {r}</div>)}
                    </div>
                  )}
                  {a.stretches?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, textTransform: "uppercase", marginBottom: 4 }}>🧘 Étirements</div>
                      {a.stretches.map((r, j) => <div key={j} style={{ fontSize: 12, color: "#ccc", marginBottom: 2 }}>• {r}</div>)}
                    </div>
                  )}
                </Card>
              ))}
              {recoveryResult.global_tip && (
                <Card style={{ marginTop: 10, background: `${C.cyan}08` }}>
                  <div style={{ fontSize: 12, color: C.cyan }}>💡 {recoveryResult.global_tip}</div>
                </Card>
              )}
            </>
          )}
        </Section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// PROFILE TAB
// ═══════════════════════════════════════════════════════════════════════

function ProfileTab({ profile, setProfile, tdee, macros, expenses, setExpenses, workouts, exportData, importData, doImport, showBackup, setShowBackup, backupJson, importText, setImportText }) {
  const set = k => v => setProfile(p => ({ ...p, [k]: ["name","allergies","sex","activity"].includes(k) ? v : Number(v) || 0 }));
  const [showExpense, setShowExpense] = useState(false);
  const [newExp, setNewExp] = useState({ amount: "", category: "courses", note: "" });

  const monthStr = new Date().toISOString().slice(0, 7);
  const monthExp = expenses.filter(e => e.date?.startsWith(monthStr));
  const monthTotal = monthExp.reduce((a, e) => a + (e.amount || 0), 0);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const weekStr = weekStart.toISOString().slice(0, 10);
  const weekExp = expenses.filter(e => e.date >= weekStr);
  const weekTotal = weekExp.reduce((a, e) => a + (e.amount || 0), 0);

  const addExpense = () => {
    if (!newExp.amount) return;
    setExpenses(prev => [...prev, { ...newExp, amount: Number(newExp.amount), date: today(), id: uid() }]);
    setNewExp({ amount: "", category: "courses", note: "" });
    setShowExpense(false);
  };

  const byCat = EXPENSE_CATS.map(c => ({
    name: c.label, value: monthExp.filter(e => e.category === c.id).reduce((a, e) => a + e.amount, 0), color: c.color,
  })).filter(c => c.value > 0);

  return (
    <div>
      <PageHead title="Profil ⚙️" sub="Stats, budget & paramètres" />

      {/* Stats */}
      <Section>
        <Card glow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>TDEE</div>
              <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: C.lime }}>{tdee}</div>
              <div style={{ fontSize: 9, color: C.muted }}>kcal/jour</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Objectif</div>
              <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 700 }}>{macros.calories}</div>
              <div style={{ fontSize: 9, color: C.muted }}>kcal/jour</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14, textAlign: "center" }}>
            {[{ l: "Prot", v: `${macros.proteins}g`, c: C.lime }, { l: "Gluc", v: `${macros.carbs}g`, c: C.cyan }, { l: "Lip", v: `${macros.fats}g`, c: C.purple }].map(m => (
              <div key={m.l}><div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: m.c }}>{m.v}</div><div style={{ fontSize: 9, color: C.muted }}>{m.l}</div></div>
            ))}
          </div>
        </Card>
      </Section>

      {/* 📈 Performance Predictor — Force Relative */}
      <Section title="📈 Predictor de Performance Relative">
        <Card>
          {(() => {
            // Get all weighted exercises (not cardio)
            const weighted = workouts.filter(w => w.weight > 0 && w.group !== "Cardio").sort((a, b) => a.date.localeCompare(b.date));
            if (weighted.length < 2) {
              return (
                <div style={{ textAlign: "center", padding: 20 }}>
                  <div style={{ fontSize: 28, marginBottom: 6 }}>📊</div>
                  <div style={{ color: C.muted, fontSize: 13 }}>Logue au moins 2 séances avec des poids pour voir ta progression de force relative</div>
                </div>
              );
            }

            // Group by exercise name, get best lift per session day
            const exerciseNames = [...new Set(weighted.map(w => w.name))];
            
            // Calculate overall relative force trend (average across all exercises)
            const byDate = {};
            weighted.forEach(w => {
              if (!byDate[w.date]) byDate[w.date] = [];
              byDate[w.date].push(Number(w.relativeForce) || 0);
            });
            const trendData = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).slice(-14).map(([date, forces]) => ({
              date: date.slice(5),
              avgForce: Number((forces.reduce((a, f) => a + f, 0) / forces.length).toFixed(3)),
              bestForce: Number(Math.max(...forces).toFixed(3)),
            }));

            // Calculate change
            const firstAvg = trendData[0]?.avgForce || 0;
            const lastAvg = trendData[trendData.length - 1]?.avgForce || 0;
            const changePct = firstAvg > 0 ? ((lastAvg - firstAvg) / firstAvg * 100).toFixed(1) : 0;
            const isGain = Number(changePct) > 0;

            // Best lifts
            const bestLifts = exerciseNames.map(name => {
              const exos = weighted.filter(w => w.name === name);
              const best = exos.reduce((a, w) => w.weight > a.weight ? w : a, exos[0]);
              return { name, weight: best.weight, relForce: Number(best.relativeForce), date: best.date };
            }).sort((a, b) => b.relForce - a.relForce);

            return (
              <>
                {/* Trend headline */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div style={{
                    width: 50, height: 50, borderRadius: 14,
                    background: isGain ? `${C.lime}20` : `${C.red}20`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: mono, fontSize: 14, fontWeight: 700,
                    color: isGain ? C.lime : C.red,
                  }}>
                    {isGain ? "↑" : "↓"}{Math.abs(changePct)}%
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {isGain
                        ? `Force relative en hausse de ${changePct}%`
                        : Number(changePct) === 0 ? "Force relative stable" : `Force relative en baisse de ${Math.abs(changePct)}%`}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      {isGain
                        ? `${profile.weight > profile.goalWeight ? "Malgré la variation de poids, c'est du vrai gain de force" : "Ta sèche ne sacrifie pas ta force"} 💪`
                        : Number(changePct) === 0 ? "Tu maintiens bien ta force en sèche" : "Normal en début de sèche — surveille la tendance"}
                    </div>
                  </div>
                </div>

                {/* Chart */}
                {trendData.length > 2 && (
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={trendData}>
                      <CartesianGrid stroke={C.border} vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} width={35} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 11 }} />
                      <Line type="monotone" dataKey="avgForce" stroke={C.lime} strokeWidth={2} dot={{ r: 2 }} name="Force moy." />
                      <Line type="monotone" dataKey="bestForce" stroke={C.cyan} strokeWidth={1.5} dot={{ r: 2 }} name="Best lift" strokeDasharray="4 4" />
                    </LineChart>
                  </ResponsiveContainer>
                )}

                {/* Best lifts leaderboard */}
                <div style={{ marginTop: 14, fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                  🏆 Meilleurs lifts (force relative)
                </div>
                {bestLifts.slice(0, 5).map((lift, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < Math.min(5, bestLifts.length) - 1 ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: i === 0 ? C.lime : C.muted, width: 18 }}>#{i + 1}</span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{lift.name}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: C.cyan }}>{lift.relForce}x</span>
                      <span style={{ fontSize: 10, color: C.muted }}> BW ({lift.weight}kg)</span>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 10, padding: "6px 10px", background: `${C.cyan}08`, borderRadius: 8, fontSize: 10, color: C.cyan, textAlign: "center" }}>
                  Force relative = Poids soulevé / Poids de corps ({profile.weight}kg) — ignore les variations de glycogène
                </div>
              </>
            );
          })()}
        </Card>
      </Section>

      {/* Budget section */}
      <Section title="💸 Budget alimentation">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <Card style={{ padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>Semaine</div>
            <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: weekTotal > profile.weeklyBudget ? C.red : C.text }}>{weekTotal.toFixed(0)}€</div>
            <div style={{ fontSize: 10, color: C.muted }}>/ {profile.weeklyBudget}€</div>
            <div style={{ height: 3, borderRadius: 2, background: C.border, marginTop: 6 }}>
              <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(100, (weekTotal / profile.weeklyBudget) * 100)}%`, background: weekTotal > profile.weeklyBudget ? C.red : C.lime }} />
            </div>
          </Card>
          <Card style={{ padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>Mois</div>
            <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: monthTotal > profile.monthlyBudget ? C.red : C.text }}>{monthTotal.toFixed(0)}€</div>
            <div style={{ fontSize: 10, color: C.muted }}>/ {profile.monthlyBudget}€</div>
            <div style={{ height: 3, borderRadius: 2, background: C.border, marginTop: 6 }}>
              <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(100, (monthTotal / profile.monthlyBudget) * 100)}%`, background: monthTotal > profile.monthlyBudget ? C.red : C.lime }} />
            </div>
          </Card>
        </div>

        {byCat.length > 0 && (
          <Card style={{ marginBottom: 10 }}>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={byCat} cx="50%" cy="50%" innerRadius={38} outerRadius={60} paddingAngle={4} dataKey="value">
                  {byCat.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
                </Pie>
                <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 11 }} formatter={v => `${v.toFixed(0)}€`} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        )}

        <Btn onClick={() => setShowExpense(!showExpense)} v={showExpense ? "secondary" : "primary"} small>
          {showExpense ? "Annuler" : "✚ Ajouter dépense"}
        </Btn>

        {showExpense && (
          <Card style={{ marginTop: 10 }}>
            <Input label="Montant (€)" value={newExp.amount} onChange={v => setNewExp(p => ({ ...p, amount: v }))} type="number" />
            <Select label="Catégorie" value={newExp.category} onChange={v => setNewExp(p => ({ ...p, category: v }))} options={EXPENSE_CATS.map(c => ({ value: c.id, label: c.label }))} />
            <Input label="Note" value={newExp.note} onChange={v => setNewExp(p => ({ ...p, note: v }))} placeholder="Ex: Lidl" />
            <Btn onClick={addExpense} disabled={!newExp.amount}>Enregistrer</Btn>
          </Card>
        )}

        {monthExp.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {[...monthExp].reverse().slice(0, 8).map(exp => {
              const cat = EXPENSE_CATS.find(c => c.id === exp.category);
              return (
                <Card key={exp.id} style={{ marginBottom: 6, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: cat?.color || C.muted }} />
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{cat?.label}</span>
                        {exp.note && <span style={{ fontSize: 10, color: C.muted }}> — {exp.note}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 13 }}>{exp.amount}€</span>
                      <button onClick={() => setExpenses(prev => prev.filter(e => e.id !== exp.id))} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>×</button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {/* Edit Profile */}
      <Section title="Paramètres">
        <Card style={{ marginBottom: 10 }}>
          <Input label="Prénom" value={profile.name} onChange={set("name")} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Input label="Poids (kg)" value={profile.weight} onChange={set("weight")} type="number" />
            <Input label="Objectif (kg)" value={profile.goalWeight} onChange={set("goalWeight")} type="number" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <Input label="Taille" value={profile.height} onChange={set("height")} type="number" />
            <Input label="Âge" value={profile.age} onChange={set("age")} type="number" />
            <Select label="Sexe" value={profile.sex} onChange={set("sex")} options={[{ value: "M", label: "H" }, { value: "F", label: "F" }]} />
          </div>
          <Select label="Activité" value={profile.activity} onChange={set("activity")} options={[
            { value: "sedentary", label: "Sédentaire" }, { value: "light", label: "Léger" },
            { value: "moderate", label: "Modéré" }, { value: "active", label: "Actif" }, { value: "very_active", label: "Très actif" },
          ]} />
          <Input label="Déficit (kcal/j)" value={profile.deficit} onChange={set("deficit")} type="number" />
          <Input label="Allergies" value={profile.allergies} onChange={set("allergies")} placeholder="lactose, gluten..." />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Input label="Budget hebdo (€)" value={profile.weeklyBudget} onChange={set("weeklyBudget")} type="number" />
            <Input label="Budget mensuel (€)" value={profile.monthlyBudget} onChange={set("monthlyBudget")} type="number" />
          </div>
        </Card>

        <Card style={{ marginBottom: 10, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: C.muted }}>Poids à perdre: <strong style={{ color: C.lime }}>{Math.max(0, profile.weight - profile.goalWeight).toFixed(1)} kg</strong></div>
          <div style={{ fontSize: 10, color: C.dim }}>≈ {((profile.deficit * 7) / 7700).toFixed(2)} kg/semaine</div>
        </Card>

        {/* Export / Import */}
        <Card style={{ marginBottom: 10, background: "#0a0d14", border: `1px solid ${C.cyan}33` }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, color: C.cyan }}>💾 Sauvegarde</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Copie tes données pour les restaurer à la prochaine session</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Btn v="cyan" onClick={exportData} style={{ flex: 1 }}>📤 Exporter</Btn>
            <Btn v="secondary" onClick={() => setShowBackup(showBackup === "import" ? false : "import")} style={{ flex: 1 }}>📥 Importer</Btn>
          </div>

          {showBackup === "export" && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: C.lime, fontWeight: 700, marginBottom: 6 }}>✅ Appuie longtemps sur le texte → Tout sélectionner → Copier</div>
              <textarea
                data-backup-text="1"
                value={backupJson}
                readOnly
                rows={5}
                style={{ width: "100%", background: "#0a0a14", border: `1px solid ${C.lime}55`, borderRadius: 8, padding: 10, color: C.text, fontSize: 9, fontFamily: mono, resize: "none", outline: "none", boxSizing: "border-box", WebkitUserSelect: "all", userSelect: "all" }}
                onClick={e => { e.target.focus(); e.target.select(); }}
              />
              <Btn small v="primary" onClick={() => {
                const ta = document.querySelector('[data-backup-text]');
                if (ta) { ta.focus(); ta.select(); ta.setSelectionRange(0, 99999); }
                try { document.execCommand('copy'); setShowBackup("copied"); } catch { /* manual copy */ }
              }} style={{ width: "100%", marginTop: 6 }}>
                📋 Sélectionner tout
              </Btn>
            </div>
          )}

          {showBackup === "copied" && (
            <div style={{ marginTop: 8, padding: 10, background: `${C.lime}15`, borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: C.lime, fontWeight: 700 }}>✅ Copié ! Colle-le quelque part pour le garder.</div>
            </div>
          )}

          {showBackup === "import" && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: C.cyan, fontWeight: 700, marginBottom: 6 }}>📥 Colle ta sauvegarde ici</div>
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                rows={4}
                placeholder='Colle ici le texte exporté...'
                style={{ width: "100%", background: "#0a0a14", border: `1px solid ${C.cyan}55`, borderRadius: 8, padding: 10, color: C.text, fontSize: 10, fontFamily: mono, resize: "none", outline: "none", boxSizing: "border-box" }}
              />
              <Btn v="cyan" onClick={() => doImport(importText)} disabled={!importText.trim()} style={{ marginTop: 6 }}>
                ✅ Restaurer
              </Btn>
            </div>
          )}
        </Card>

        <Btn v="danger" onClick={() => { if (confirm("Réinitialiser toutes les données ?")) { localStorage.clear(); setProfile(DEFAULT_PROFILE); } }} style={{ marginBottom: 40 }}>
          🗑 Tout réinitialiser
        </Btn>
      </Section>
    </div>
  );
}
