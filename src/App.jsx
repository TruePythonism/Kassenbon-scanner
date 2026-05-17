import { useState, useRef, useCallback, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const C = {
  bg: "#0a0c10", surface: "#13161e", card: "#181c27", border: "#222639",
  accent: "#34d399", accentDim: "#0d2e1f", accentText: "#6ee7b7",
  text: "#eef0f6", muted: "#5a6278", danger: "#f87171",
  blue: "#60a5fa", orange: "#fb923c", purple: "#c084fc",
  yellow: "#fbbf24", cyan: "#22d3ee", pink: "#fb7185", gray: "#94a3b8",
};
const CAT_COLORS = {
  Lebensmittel: "#34d399", Getränke: "#60a5fa", Haushalt: "#fbbf24",
  Hygiene: "#c084fc", Snacks: "#fb923c", Tiefkühlkost: "#22d3ee",
  Backwaren: "#fb7185", Sonstiges: "#94a3b8",
};
const CAT_ICONS = {
  Lebensmittel: "🥦", Getränke: "🥤", Haushalt: "🧹",
  Hygiene: "🧴", Snacks: "🍫", Tiefkühlkost: "🧊",
  Backwaren: "🥐", Sonstiges: "📦",
};
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; overscroll-behavior: none; }
  body { background: #0a0c10; color: #eef0f6; font-family: 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; }
  button { -webkit-appearance: none; font-family: 'DM Sans', sans-serif; }
  ::-webkit-scrollbar { display: none; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
  @keyframes beam { 0% { top:6%; opacity:1; } 85% { opacity:1; } 100% { top:90%; opacity:0; } }
  @keyframes popIn { 0% { transform:scale(.88) translateX(-50%); opacity:0; } 100% { transform:scale(1) translateX(-50%); opacity:1; } }
`;
const LS_KEY = "kassenbon-receipts-v1";
function loadReceipts() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}
function saveReceipts(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch(e) { console.warn(e); }
}
async function analyzeReceipt(base64) {
  const prompt = `Du bist ein Kassenbon-Experte. Analysiere dieses Bon-Foto.
Antworte NUR mit JSON (kein Markdown):
{"store":"Geschäftsname","date":"YYYY-MM-DD","total":12.34,"items":[{"name":"Produkt","quantity":1,"price":1.99,"category":"Lebensmittel"}]}
Kategorien: Lebensmittel, Getränke, Haushalt, Hygiene, Snacks, Tiefkühlkost, Backwaren, Sonstiges
date: heutiges Datum falls nicht lesbar. total: Gesamtbetrag als Zahl. Falls kein Bon: total:0, items:[].`;
  const res = await fetch("/api/analyze", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 1200,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        { type: "text", text: prompt }
      ]}]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data.content?.map(b => b.text || "").join("") || "{}";
  const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  if (!parsed.date || parsed.date.includes("Y")) parsed.date = new Date().toISOString().slice(0,10);
  return parsed;
}
const chf = n => `CHF ${Number(n||0).toFixed(2)}`;
const todayStr = () => new Date().toISOString().slice(0,10);
const mk = d => (d || todayStr()).slice(0,7);
const mlabel = s => new Date(s+"-01").toLocaleString("de-CH",{month:"long",year:"numeric"});
function byCat(items) {
  const m = {};
  items.forEach(it => {
    const c = it.category || "Sonstiges";
    if (!m[c]) m[c] = { category:c, total:0, count:0 };
    m[c].total += (it.price||0)*(it.quantity||1);
    m[c].count += (it.quantity||1);
  });
  return Object.values(m).sort((a,b) => b.total - a.total);
}
function byItem(items) {
  const m = {};
  items.forEach(it => {
    if (!m[it.name]) m[it.name] = { name:it.name, category:it.category, total:0, count:0 };
    m[it.name].total += (it.price||0)*(it.quantity||1);
    m[it.name].count += (it.quantity||1);
  });
  return Object.values(m).sort((a,b) => b.total - a.total);
}
function Spinner() {
  return <div style={{ width:28, height:28, border:"3px solid #0d2e1f", borderTop:"3px solid #34d399", borderRadius:"50%", animation:"spin .8s linear infinite" }} />;
}
function Badge({ cat }) {
  return <span style={{ fontSize:11, fontWeight:600, padding:"2px 7px", borderRadius:6, background:"#0d2e1f", color:CAT_COLORS[cat]||"#94a3b8", whiteSpace:"nowrap" }}>{CAT_ICONS[cat]||"📦"} {cat}</span>;
}
function ScannerView({ onResult }) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [step, setStep] = useState("");
  const [error, setError] = useState(null);
  const camRef = useRef();
  const libRef = useRef();
  const process = useCallback(async (selectedFile) => {
    if (!selectedFile?.type.startsWith("image/")) { setError("Bitte ein Bild auswählen."); return; }
    setError(null); setLoading(true); setStep("Bild vorbereiten…");
    const reader = new FileReader();
    reader.onload = async (e) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        setPreview(dataUrl);
        setStep("KI analysiert Bon…");
        try {
          const result = await analyzeReceipt(dataUrl.split(",")[1]);
          result._id = Date.now();
          result._date = result.date || todayStr();
          onResult(result);
        } catch(err) {
          setError("Fehler: " + (err.message || "Unbekannt"));
        } finally { setLoading(false); setPreview(null); setStep(""); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(selectedFile);
  }, [onResult]);
  return (
    <div style={{ padding:"0 16px", animation:"fadeUp .35s ease" }}>
      <div style={{ background:"linear-gradient(145deg,#0d2e1f,#080f0a)", border:"1.5px solid #222639", borderRadius:20, padding:28, textAlign:"center", marginBottom:16, position:"relative", overflow:"hidden", minHeight:280, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        {loading && <div style={{ position:"absolute", left:0, right:0, height:2, background:"linear-gradient(90deg,transparent,#34d399,transparent)", animation:"beam 1.8s ease-in-out infinite", zIndex:5 }} />}
        {loading ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
            {preview && <img src={preview} alt="" style={{ width:90, height:130, objectFit:"cover", borderRadius:10, opacity:.55, border:"1px solid #222639" }} />}
            <Spinner />
            <div style={{ color:"#34d399", fontFamily:"'Space Mono',monospace", fontSize:12, animation:"pulse 1.8s infinite" }}>{step}</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize:52, marginBottom:14 }}>🧾</div>
            <div style={{ fontSize:21, fontWeight:800, marginBottom:6 }}>Bon scannen</div>
            <div style={{ color:"#5a6278", fontSize:13, marginBottom:26, lineHeight:1.6 }}>Fotografiere deinen Kassenbon –<br/>die KI erkennt alles automatisch</div>
            <button onClick={() => camRef.current?.click()} style={{ display:"block", width:"100%", background:"#34d399", color:"#06150e", border:"none", borderRadius:14, padding:"15px 0", fontWeight:800, fontSize:16, cursor:"pointer", marginBottom:10 }}>📷 Kamera öffnen</button>
            <button onClick={() => libRef.current?.click()} style={{ display:"block", width:"100%", background:"#13161e", color:"#eef0f6", border:"1px solid #222639", borderRadius:14, padding:"13px 0", fontWeight:600, fontSize:15, cursor:"pointer" }}>🖼️ Aus Fotos wählen</button>
          </>
        )}
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={e => process(e.target.files[0])} />
        <input ref={libRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e => process(e.target.files[0])} />
      </div>
      {error && <div style={{ background:"#2a1010", border:"1px solid #f87171", borderRadius:12, padding:"12px 14px", color:"#f87171", fontSize:13, marginBottom:16 }}>⚠️ {error}</div>}
      <div style={{ background:"#13161e", borderRadius:14, padding:16 }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#5a6278", marginBottom:10, letterSpacing:1 }}>TIPPS</div>
        {[["💡","Gute Beleuchtung nutzen"],["📐","Bon flach hinlegen"],["🔍","Ganzen Bon im Bild"],["⚡","Analyse: ~5–10 Sek."]].map(([i,t]) => (
          <div key={t} style={{ display:"flex", gap:10, marginBottom:7, fontSize:13, color:"#5a6278", alignItems:"center" }}><span>{i}</span><span>{t}</span></div>
        ))}
      </div>
    </div>
  );
}
function ReceiptCard({ r, onDelete }) {
  const [open, setOpen] = useState(false);
  const total = r.total || (r.items||[]).reduce((s,it) => s+(it.price||0)*(it.quantity||1),0);
  return (
    <div style={{ background:"#181c27", border:"1px solid #222639", borderRadius:14, overflow:"hidden" }}>
      <div onClick={() => setOpen(o=>!o)} style={{ padding:"14px 16px", display:"flex", alignItems:"center", gap:12, cursor:"pointer", userSelect:"none", WebkitUserSelect:"none" }}>
        <div style={{ width:42, height:42, background:"#0d2e1f", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🧾</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:2 }}>{r.store||"Unbekannt"}</div>
          <div style={{ color:"#5a6278", fontSize:12, fontFamily:"'Space Mono',monospace" }}>{r._date} · {(r.items||[]).length} Artikel</div>
        </div>
        <div style={{ textAlign:"right", flexShrink:0 }}>
          <div style={{ fontWeight:800, color:"#34d399", fontFamily:"'Space Mono',monospace", fontSize:14 }}>{chf(total)}</div>
          <div style={{ color:"#5a6278", fontSize:16 }}>{open?"⌃":"⌄"}</div>
        </div>
      </div>
      {open && (
        <div style={{ borderTop:"1px solid #222639" }}>
          {(r.items||[]).map((it,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", padding:"10px 16px", borderBottom:"1px solid #222639", gap:10 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:3 }}>{it.name}</div>
                <Badge cat={it.category||"Sonstiges"} />
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                {(it.quantity||1)>1 && <div style={{ fontSize:11, color:"#5a6278", fontFamily:"'Space Mono',monospace" }}>{it.quantity}×{chf(it.price)}</div>}
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:13, fontWeight:700 }}>{chf((it.price||0)*(it.quantity||1))}</div>
              </div>
            </div>
          ))}
          <div style={{ padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <button onClick={() => onDelete(r._id)} style={{ background:"transparent", border:"1px solid #f87171", color:"#f87171", borderRadius:10, padding:"8px 16px", cursor:"pointer", fontSize:13, fontWeight:600 }}>🗑️ Löschen</button>
            <div style={{ fontFamily:"'Space Mono',monospace", fontSize:12, color:"#5a6278" }}>Total: <span style={{ color:"#34d399", fontWeight:700 }}>{chf(total)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
function StatsView({ receipts }) {
  const months = [...new Set(receipts.map(r => mk(r._date)))].sort().reverse();
  const [sel, setSel] = useState(months[0] || mk(todayStr()));
  useEffect(() => { if (months.length && !months.includes(sel)) setSel(months[0]); }, [months.join(",")]);
  const filtered = receipts.filter(r => mk(r._date) === sel);
  const allItems = filtered.flatMap(r => r.items||[]);
  const catData = byCat(allItems);
  const itemData = byItem(allItems);
  const totalSpend = filtered.reduce((s,r) => s+(r.total||(r.items||[]).reduce((a,i)=>a+(i.price||0)*(i.quantity||1),0)),0);
  if (!receipts.length) return (
    <div style={{ textAlign:"center", padding:"60px 20px", color:"#5a6278" }}>
      <div style={{ fontSize:52, marginBottom:16 }}>📊</div>
      <div style={{ fontSize:17, fontWeight:600, marginBottom:8 }}>Noch keine Daten</div>
      <div style={{ fontSize:14 }}>Scanne deinen ersten Bon!</div>
    </div>
  );
  return (
    <div style={{ padding:"0 16px", animation:"fadeUp .35s ease" }}>
      <div style={{ display:"flex", gap:8, marginBottom:20, overflowX:"auto", paddingBottom:4 }}>
        {months.map(m => (
          <button key={m} onClick={() => setSel(m)} style={{ flexShrink:0, background:m===sel?"#34d399":"#13161e", color:m===sel?"#06150e":"#5a6278", border:`1px solid ${m===sel?"#34d399":"#222639"}`, borderRadius:20, padding:"7px 16px", cursor:"pointer", fontSize:13, fontWeight:700 }}>{mlabel(m)}</button>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
        {[{icon:"💶",val:chf(totalSpend),label:"Ausgaben"},{icon:"🛒",val:filtered.length,label:"Einkäufe"},{icon:"📦",val:allItems.reduce((s,i)=>s+(i.quantity||1),0),label:"Artikel"}].map(k => (
          <div key={k.label} style={{ background:"#181c27", border:"1px solid #222639", borderRadius:14, padding:"14px 8px", textAlign:"center" }}>
            <div style={{ fontSize:22, marginBottom:6 }}>{k.icon}</div>
            <div style={{ fontFamily:"'Space Mono',monospace", fontWeight:700, fontSize:k.label==="Ausgaben"?12:20, color:"#34d399", marginBottom:3, wordBreak:"break-all" }}>{k.val}</div>
            <div style={{ color:"#5a6278", fontSize:11, fontWeight:600 }}>{k.label}</div>
          </div>
        ))}
      </div>
      {!allItems.length ? (
        <div style={{ textAlign:"center", color:"#5a6278", padding:40 }}>Keine Daten für {mlabel(sel)}</div>
      ) : (<>
        <div style={{ background:"#181c27", border:"1px solid #222639", borderRadius:16, padding:18, marginBottom:16 }}>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:16 }}>Nach Kategorie</div>
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie data={catData} dataKey="total" nameKey="category" cx="50%" cy="50%" outerRadius={82} innerRadius={46} paddingAngle={3}>
                {catData.map((e,i) => <Cell key={i} fill={CAT_COLORS[e.category]||"#94a3b8"} />)}
              </Pie>
              <Tooltip formatter={v=>chf(v)} contentStyle={{ background:"#181c27", border:"1px solid #222639", borderRadius:10, fontFamily:"'Space Mono',monospace", fontSize:12 }} />
              <Legend iconSize={9} formatter={v=><span style={{ fontSize:12, color:"#eef0f6" }}>{CAT_ICONS[v]||"📦"} {v}</span>} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:8 }}>
            {catData.map(c => (
              <div key={c.category} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:9, height:9, borderRadius:"50%", background:CAT_COLORS[c.category]||"#94a3b8", flexShrink:0 }} />
                <div style={{ flex:1, fontSize:13 }}>{c.category}</div>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:11, color:"#5a6278" }}>{c.count}×</div>
                <div style={{ fontFamily:"'Space Mono',monospace", fontSize:13, fontWeight:700, color:CAT_COLORS[c.category]||"#94a3b8", minWidth:70, textAlign:"right" }}>{chf(c.total)}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background:"#181c27", border:"1px solid #222639", borderRadius:16, padding:18, marginBottom:16 }}>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:16 }}>Top-Ausgaben</div>
          <ResponsiveContainer width="100%" height={Math.max(150, itemData.slice(0,7).length*38)}>
            <BarChart data={itemData.slice(0,7)} layout="vertical" margin={{ left:0, right:20 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={115} tick={{ fill:"#eef0f6", fontSize:11 }} />
              <Tooltip formatter={v=>chf(v)} contentStyle={{ background:"#181c27", border:"1px solid #222639", borderRadius:10, fontFamily:"'Space Mono',monospace", fontSize:12 }} />
              <Bar dataKey="total" radius={[0,6,6,0]}>
                {itemData.slice(0,7).map((e,i) => <Cell key={i} fill={CAT_COLORS[e.category]||"#60a5fa"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:"#181c27", border:"1px solid #222639", borderRadius:16, overflow:"hidden", marginBottom:16 }}>
          <div style={{ padding:"14px 16px", fontWeight:700, fontSize:15, borderBottom:"1px solid #222639", display:"flex", justifyContent:"space-between" }}>
            <span>Alle Artikel</span>
            <span style={{ fontFamily:"'Space Mono',monospace", fontSize:12, color:"#5a6278", fontWeight:400, alignSelf:"center" }}>{itemData.length} Produkte</span>
          </div>
          {itemData.map((it,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", padding:"11px 16px", borderBottom:i<itemData.length-1?"1px solid #222639":"none", gap:10 }}>
              <div style={{ width:32, height:32, background:"#0d2e1f", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{CAT_ICONS[it.category]||"📦"}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.name}</div>
                <div style={{ fontSize:11, color:"#5a6278", marginTop:2 }}>{it.count}× gekauft</div>
              </div>
              <div style={{ fontFamily:"'Space Mono',monospace", fontSize:13, fontWeight:700, color:"#34d399", flexShrink:0 }}>{chf(it.total)}</div>
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}
export default function App() {
  const [receipts, setReceipts] = useState(() => loadReceipts());
  const [tab, setTab] = useState("scan");
  const [toast, setToast] = useState(null);
  useEffect(() => { saveReceipts(receipts); }, [receipts]);
  const showToast = (msg, warn=false) => { setToast({ msg, warn }); setTimeout(() => setToast(null), 3200); };
  const handleResult = (r) => { setReceipts(p => [r, ...p]); showToast(`✅ ${r.store||"Bon"} · ${(r.items||[]).length} Artikel erkannt`); setTab("bons"); };
  const handleDelete = (id) => { setReceipts(p => p.filter(r => r._id !== id)); showToast("🗑️ Bon gelöscht", true); };
  const totalAll = receipts.reduce((s,r) => s+(r.total||0), 0);
  const tabs = [{ id:"scan", icon:"📷", label:"Scannen" },{ id:"bons", icon:"🧾", label:receipts.length?`Bons (${receipts.length})`:"Bons" },{ id:"stats", icon:"📊", label:"Statistik" }];
  return (
    <>
      <style>{css}</style>
      <div style={{ maxWidth:430, margin:"0 auto", minHeight:"100vh", display:"flex", flexDirection:"column", background:"#0a0c10" }}>
        <div style={{ padding:"16px 16px 0", paddingTop:"max(env(safe-area-inset-top,16px),16px)" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, paddingTop:4 }}>
            <div>
              <div style={{ fontFamily:"'Space Mono',monospace", fontSize:10, color:"#34d399", letterSpacing:2, marginBottom:3 }}>AUSGABEN-TRACKER</div>
              <div style={{ fontSize:24, fontWeight:800, letterSpacing:-.5 }}>Kassenbons</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontFamily:"'Space Mono',monospace", fontSize:14, fontWeight:700, color:"#34d399" }}>{chf(totalAll)}</div>
              <div style={{ fontSize:11, color:"#5a6278" }}>{receipts.length} Bons gesamt</div>
            </div>
          </div>
        </div>
        {toast && <div style={{ position:"fixed", top:"max(env(safe-area-inset-top,16px),16px)", left:"50%", transform:"translateX(-50%)", background:toast.warn?"#2a1a0a":"#0d2e1f", border:`1px solid ${toast.warn?"#fb923c":"#34d399"}`, color:toast.warn?"#fb923c":"#6ee7b7", borderRadius:14, padding:"12px 20px", fontSize:13, fontWeight:600, zIndex:999, animation:"popIn .2s ease", maxWidth:310, textAlign:"center", boxShadow:"0 8px 32px rgba(0,0,0,.5)", whiteSpace:"nowrap" }}>{toast.msg}</div>}
        <div style={{ flex:1, overflowY:"auto", paddingBottom:90 }}>
          {tab==="scan" && <ScannerView onResult={handleResult} />}
          {tab==="bons" && (
            <div style={{ padding:"0 16px", display:"flex", flexDirection:"column", gap:10, animation:"fadeUp .35s ease" }}>
              {!receipts.length ? (
                <div style={{ textAlign:"center", padding:"60px 20px", color:"#5a6278" }}>
                  <div style={{ fontSize:52, marginBottom:16 }}>🧾</div>
                  <div style={{ fontSize:17, fontWeight:600, marginBottom:8 }}>Noch keine Bons</div>
                  <div style={{ fontSize:14 }}>Scanne deinen ersten Kassenbon!</div>
                </div>
              ) : receipts.map(r => <ReceiptCard key={r._id} r={r} onDelete={handleDelete} />)}
            </div>
          )}
          {tab==="stats" && <StatsView receipts={receipts} />}
        </div>
        <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, zIndex:100, background:"#13161eee", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderTop:"1px solid #222639", paddingBottom:"env(safe-area-inset-bottom,0px)", display:"flex" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex:1, background:"none", border:"none", cursor:"pointer", padding:"10px 4px 10px", display:"flex", flexDirection:"column", alignItems:"center", gap:3, color:tab===t.id?"#34d399":"#5a6278", transition:"color .15s" }}>
              <span style={{ fontSize:22 }}>{t.icon}</span>
              <span style={{ fontSize:10, fontWeight:tab===t.id?700:500, letterSpacing:.3 }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
