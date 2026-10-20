// ==========================================================
// common.js — أدوات مشتركة: واجهة، أمان، مراقبة، جلسات
// ==========================================================
import { auth, db } from "./firebase-config.js";
import { ref, push, update, get, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// حماية XSS: كل نص قادم من المستخدم/القاعدة يمر من هنا قبل innerHTML
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const fmtDate = (ts) => ts ? new Date(ts).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "—";
export function timeAgo(ts) {
    if (!ts) return "—";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 10) return "الآن";
    if (s < 60) return `منذ ${s} ثانية`;
    const m = Math.floor(s / 60); if (m < 60) return `منذ ${m} دقيقة`;
    const h = Math.floor(m / 60); if (h < 24) return `منذ ${h} ساعة`;
    const d = Math.floor(h / 24); if (d < 30) return `منذ ${d} يوم`;
    return fmtDate(ts);
}
export const hueOf = (s = "") => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

// ---------- الثيم ----------
export function initTheme() {
    let t = "dark"; try { t = localStorage.getItem("pm-theme") || "dark"; } catch { }
    document.documentElement.dataset.theme = t;
}
export function toggleTheme() {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("pm-theme", t); } catch { }
}

// ---------- Toast ----------
export function toast(msg, type = "info", ms = 3400) {
    let st = $(".toast-stack"); if (!st) { st = document.createElement("div"); st.className = "toast-stack"; document.body.appendChild(st); }
    const icons = { success: "fa-circle-check", error: "fa-circle-xmark", warn: "fa-triangle-exclamation", info: "fa-circle-info" };
    const el = document.createElement("div"); el.className = `toast ${type}`;
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${esc(msg)}</span>`;
    st.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = ".3s"; setTimeout(() => el.remove(), 300); }, ms);
}

// ---------- نوافذ ----------
export function openModal(inner, { wide = false, onClose } = {}) {
    const wrap = document.createElement("div"); wrap.className = "modal-wrap";
    wrap.innerHTML = `<div class="modal-card ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${inner}</div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("show"));
    let closed = false;
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    const close = (v) => { if (closed) return; closed = true; wrap.classList.remove("show"); document.removeEventListener("keydown", onKey); setTimeout(() => wrap.remove(), 200); onClose?.(v); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(null); });
    wrap.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(null); });
    return { wrap, close };
}
export function openDrawer(inner) {
    const wrap = document.createElement("div"); wrap.className = "drawer-wrap";
    wrap.innerHTML = `<aside class="drawer">${inner}</aside>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("show"));
    const close = () => { wrap.classList.remove("show"); setTimeout(() => wrap.remove(), 280); };
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
    return { wrap, close };
}
export function confirmDialog({ title = "تأكيد", message = "", confirmText = "تأكيد", danger = false } = {}) {
    return new Promise(res => {
        const { wrap, close } = openModal(`<div class="modal-head"><h3>${esc(title)}</h3></div><p class="modal-msg">${esc(message)}</p><div class="modal-foot"><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirmText)}</button><button class="btn btn-ghost" data-close>إلغاء</button></div>`, { onClose: v => res(v === true) });
        $("[data-ok]", wrap).addEventListener("click", () => close(true));
    });
}
export function askText({ title, label = "", placeholder = "", multiline = false, confirmText = "إرسال", value = "" } = {}) {
    return new Promise(res => {
        const f = multiline ? `<textarea class="input" id="ask-i" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="input" id="ask-i" placeholder="${esc(placeholder)}" value="${esc(value)}">`;
        const { wrap, close } = openModal(`<div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div><div class="field"><label>${esc(label)}</label>${f}</div><div class="modal-foot"><button class="btn btn-primary" data-ok>${esc(confirmText)}</button><button class="btn btn-ghost" data-close>إلغاء</button></div>`, { onClose: v => res(typeof v === "string" ? v : null) });
        const i = $("#ask-i", wrap); setTimeout(() => i.focus(), 60);
        const go = () => { const v = i.value.trim(); if (v) close(v); else i.focus(); };
        $("[data-ok]", wrap).addEventListener("click", go);
        if (!multiline) i.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    });
}

// ---------- كلمات المرور ----------
export function passwordStrength(pw = "") {
    if (!pw) return { level: 0, label: "—", color: "#64748b", pct: 0, strong: false };
    let s = 0;
    if (pw.length >= 8) s++; if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
    const level = s <= 2 ? 1 : s === 3 ? 2 : s === 4 ? 3 : 4;
    const map = [null, ["ضعيفة", "#ef4444", 25], ["متوسطة", "#f59e0b", 50], ["قوية", "#22c55e", 78], ["ممتازة", "#06b6d4", 100]][level];
    return { level, label: map[0], color: map[1], pct: map[2], strong: level >= 3 };
}
export function generatePassword(len = 16, o = {}) {
    const { upper = true, lower = true, digits = true, symbols = true } = o;
    const sets = [];
    if (lower) sets.push("abcdefghijkmnopqrstuvwxyz"); if (upper) sets.push("ABCDEFGHJKLMNPQRSTUVWXYZ");
    if (digits) sets.push("23456789"); if (symbols) sets.push("!@#$%^&*()-_=+[]{};:,.?");
    if (!sets.length) sets.push("abcdefghijkmnopqrstuvwxyz", "23456789");
    const all = sets.join("");
    const rnd = (n) => { const a = new Uint32Array(1), lim = Math.floor(0xFFFFFFFF / n) * n; let x; do { crypto.getRandomValues(a); x = a[0]; } while (x >= lim); return x % n; };
    const out = sets.map(s => s[rnd(s.length)]);
    while (out.length < len) out.push(all[rnd(all.length)]);
    for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1);[out[i], out[j]] = [out[j], out[i]]; }
    return out.join("");
}
export async function copyText(text, clearAfter = 0) {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    if (clearAfter) { clearTimeout(copyText._t); copyText._t = setTimeout(() => navigator.clipboard?.writeText("").catch(() => { }), clearAfter); }
}
export function friendlyAuthError(code = "") {
    const m = {
        "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة", "auth/wrong-password": "البريد أو كلمة المرور غير صحيحة",
        "auth/user-not-found": "البريد أو كلمة المرور غير صحيحة", "auth/invalid-email": "صيغة البريد الإلكتروني غير صحيحة",
        "auth/too-many-requests": "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة", "auth/network-request-failed": "تعذر الاتصال بالإنترنت",
        "auth/user-disabled": "هذا الحساب معطّل", "auth/email-already-in-use": "هذا البريد مستخدم مسبقاً",
        "auth/weak-password": "كلمة المرور ضعيفة جداً", "auth/requires-recent-login": "لأسباب أمنية سجّل الدخول من جديد ثم أعد المحاولة"
    };
    return m[code] || "حدث خطأ غير متوقع، حاول مرة أخرى";
}

// ---------- تصدير ----------
export function toCSV(rows, cols) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return "\ufeff" + [cols.map(c => q(c.label)).join(","), ...rows.map(r => cols.map(c => q(c.get(r))).join(","))].join("\r\n");
}
export function downloadFile(name, content, mime = "text/csv;charset=utf-8") {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type: mime })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- مراقبة الأخطاء (Telemetry) ----------
const crumbs = []; const seen = new Map(); let sentCount = 0;
const sysCtx = () => ({ userAgent: navigator.userAgent, platform: navigator.platform || "", language: navigator.language, screenResolution: `${screen.width}x${screen.height}`, viewportSize: `${innerWidth}x${innerHeight}`, onlineStatus: navigator.onLine, currentUrl: location.pathname });
export function crumb(category, message) { crumbs.push({ t: new Date().toISOString(), category, message }); if (crumbs.length > 20) crumbs.shift(); }
export async function logError(err, ctx = {}) {
    try {
        const e = err instanceof Error ? err : new Error(String(err));
        if (/ResizeObserver|Script error/i.test(e.message)) return;
        const sig = e.message + (ctx.context || ""), now = Date.now();
        if ((seen.get(sig) || 0) > now - 60000 || sentCount >= 25) return; // منع الإغراق
        seen.set(sig, now); sentCount++;
        const u = auth.currentUser;
        const payload = { userId: u?.uid || "anonymous", userEmail: u?.email || "N/A", errorName: e.name || "Error", errorMessage: e.message.slice(0, 500), errorStack: String(e.stack || "").slice(0, 3000), contextInfo: ctx, breadcrumbs: crumbs.slice(-15), systemContext: sysCtx(), timestamp: now, status: "NEW", severity: ctx.severity || "HIGH" };
        await push(ref(db, "telemetry_errors"), JSON.parse(JSON.stringify(payload)));
    } catch { /* لا نكرر الخطأ */ }
}
export function initTelemetry() {
    addEventListener("error", ev => logError(ev.error || new Error(ev.message), { source: ev.filename, lineno: ev.lineno, severity: "CRITICAL" }));
    addEventListener("unhandledrejection", ev => logError(ev.reason instanceof Error ? ev.reason : new Error(String(ev.reason)), { source: "UnhandledPromiseRejection", severity: "HIGH" }));
    document.addEventListener("click", ev => { const t = ev.target.closest("button,a"); if (t) crumb("click", `${t.tagName}#${t.id || "-"} ${t.dataset.act || ""}`); }, true);
}

// ---------- الجلسات والحضور ----------
export function startPresence(user, role = "user") {
    const r = ref(db, `active_sessions/${user.uid}`);
    const beat = () => update(r, { uid: user.uid, email: user.email, role, status: "ONLINE", lastSeen: Date.now(), currentPath: location.pathname.split("/").pop() || "index", systemInfo: sysCtx() }).catch(() => { });
    onValue(ref(db, ".info/connected"), s => { if (s.val()) { onDisconnect(r).update({ status: "OFFLINE", lastSeen: serverTimestamp() }); update(r, { startedAt: Date.now() }).catch(() => { }); beat(); } });
    setInterval(beat, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(); });
}
export async function logout(msg = "") {
    try { if (auth.currentUser) await update(ref(db, `active_sessions/${auth.currentUser.uid}`), { status: "OFFLINE", lastSeen: Date.now() }); } catch { }
    await signOut(auth).catch(() => { });
    location.replace("index.html" + (msg ? `?reason=${msg}` : ""));
}
// مراقبة حالة الحساب: تعطيل / إنهاء جلسة من الأدمن / وضع الصيانة
function watchSession(user, admin) {
    onValue(ref(db, `users/${user.uid}`), s => {
        const p = s.val();
        if (!p || p.disabled) return logout(p ? "disabled" : "noprofile");
        const since = Date.parse(user.metadata.lastSignInTime) || 0;
        if (p.forceLogoutAt && p.forceLogoutAt > since + 1000) logout("kicked");
    });
    if (!admin) onValue(ref(db, "settings/maintenance"), s => {
        const m = s.val(); let o = $("#maint-lock");
        if (m?.enabled) {
            if (!o) { o = document.createElement("div"); o.id = "maint-lock"; o.className = "overlay-lock"; document.body.appendChild(o); }
            o.innerHTML = `<div><div class="logo" style="margin:0 auto 18px"><i class="fa-solid fa-screwdriver-wrench"></i></div><h2>النظام تحت الصيانة</h2><p class="muted" style="margin-top:8px">${esc(m.message || "سنعود قريباً")}</p></div>`;
        } else o?.remove();
    });
}
export function bootSession({ admin = false } = {}) {
    return new Promise(resolve => {
        const unsub = onAuthStateChanged(auth, async user => {
            unsub();
            if (!user) { location.replace("index.html"); return; }
            try {
                const profile = (await get(ref(db, `users/${user.uid}`))).val();
                if (!profile || profile.disabled) return logout(profile ? "disabled" : "noprofile");
                if (admin && !profile.isAdmin) { location.replace("dashboard.html"); return; }
                watchSession(user, admin);
                onAuthStateChanged(auth, u => { if (!u) location.replace("index.html"); });
                resolve({ user, profile });
            } catch (e) { logError(e, { context: "bootSession" }); toast("تعذر التحقق من الجلسة", "error"); }
        });
    });
}
export function startIdleLock(minutes, onTimeout) {
    let t, w; const reset = () => { clearTimeout(t); clearTimeout(w); w = setTimeout(() => toast("سيتم تسجيل خروجك بعد دقيقة لعدم النشاط", "warn", 8000), (minutes - 1) * 60000); t = setTimeout(onTimeout, minutes * 60000); };
    ["mousemove", "keydown", "touchstart", "click", "scroll"].forEach(ev => addEventListener(ev, reset, { passive: true })); reset();
}
