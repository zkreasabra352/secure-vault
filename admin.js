import { auth, db } from "./firebase-config.js";
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut as signOutAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ref, get, set, update, push, remove, onValue, query, limitToLast, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { $, $$, esc, toast, openModal, openDrawer, confirmDialog, askText, passwordStrength, generatePassword, copyText, friendlyAuthError, fmtDate, timeAgo, hueOf, debounce, toCSV, downloadFile, initTheme, toggleTheme, initTelemetry, logError, startPresence, bootSession, logout } from "./common.js";

initTheme(); initTelemetry();
const { user: me } = await bootSession({ admin: true });
startPresence(me, "admin");

// ============================== الحالة ==============================
const S = { users: {}, sessions: {}, accs: {}, accTotal: 0, errors: [], audit: [], notifs: {}, maint: null, sel: new Set(), page: 1, loaded: { users: false } };
const TITLES = { overview: "نظرة عامة", users: "المستخدمون", sessions: "الجلسات الحية", errors: "سجل الأخطاء", create: "إنشاء مستخدم", notifs: "الإشعارات", audit: "سجل العمليات", settings: "إعدادات النظام" };
const isOnline = (uid) => { const s = S.sessions[uid]; return !!s && s.status === "ONLINE" && Date.now() - (s.lastSeen || 0) < 75000; };
const uids = () => Object.keys(S.users);
const emailOf = (uid) => S.users[uid]?.email || uid;
const accCount = (uid) => (S.accs[uid] || []).length;

$("#me-email").textContent = me.email; $("#me-av").textContent = (me.email || "A")[0].toUpperCase();
$("#theme-btn").onclick = toggleTheme; $("#logout-btn").onclick = () => logout();

// ============================== التنقل ==============================
function showView(v) {
    if (!TITLES[v]) v = "overview";
    $$(".view").forEach(el => el.classList.toggle("active", el.id === "v-" + v));
    $$("#nav a").forEach(a => a.classList.toggle("active", a.dataset.view === v));
    $("#page-title").textContent = TITLES[v]; location.hash = v;
    $("#side").classList.remove("open"); $("#backdrop").classList.remove("show");
    if (v === "create" && !$("#n-pass").value) newPass();
}
$("#nav").addEventListener("click", e => { const a = e.target.closest("[data-view]"); if (a) showView(a.dataset.view); });
$("#burger").onclick = () => { $("#side").classList.add("open"); $("#backdrop").classList.add("show"); };
$("#backdrop").onclick = () => { $("#side").classList.remove("open"); $("#backdrop").classList.remove("show"); };
addEventListener("hashchange", () => showView(location.hash.slice(1)));
$("#gsearch").addEventListener("keydown", e => { if (e.key === "Enter") { $("#u-q").value = e.target.value; S.page = 1; showView("users"); renderUsers(); } });
addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#gsearch").focus(); } });
$("#refresh").onclick = async () => { await loadAccounts(); toast("تم تحديث البيانات", "success"); };

// ============================== سجل العمليات ==============================
async function audit(action, target, details = "") {
    try { await push(ref(db, "audit_log"), { by: me.email, byUid: me.uid, action, target: target || "", details, ts: Date.now() }); } catch (e) { logError(e, { context: "audit" }); }
}
async function run(label, fn) { try { await fn(); } catch (e) { toast(`فشل: ${label}`, "error"); logError(e, { context: label }); return false; } return true; }
const notSelf = (uid, what) => uid === me.uid ? (toast(`لا يمكنك ${what} حسابك الخاص`, "warn"), false) : true;

// ============================== مستمعات البيانات ==============================
onValue(ref(db, "users"), s => { S.users = s.val() || {}; S.loaded.users = true; for (const u of [...S.sel]) if (!S.users[u]) S.sel.delete(u); renderAll(); }, e => logError(e, { context: "users stream" }));
onValue(ref(db, "active_sessions"), s => { S.sessions = s.val() || {}; renderLive(); }, e => logError(e, { context: "sessions stream" }));
onValue(query(ref(db, "telemetry_errors"), limitToLast(300)), s => { S.errors = Object.entries(s.val() || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); renderErrors(); renderKpis(); renderFeeds(); }, e => logError(e, { context: "errors stream" }));
onValue(query(ref(db, "audit_log"), limitToLast(300)), s => { S.audit = Object.entries(s.val() || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.ts - a.ts); renderAudit(); renderFeeds(); });
onValue(ref(db, "notifications"), s => { S.notifs = s.val() || {}; renderNotifHistory(); }, () => { });
onValue(ref(db, "settings/maintenance"), s => { S.maint = s.val(); $("#m-on").checked = !!S.maint?.enabled; $("#m-state").textContent = S.maint?.enabled ? "مفعّل" : "متوقف"; if (document.activeElement !== $("#m-msg")) $("#m-msg").value = S.maint?.message || ""; });
async function loadAccounts() {
    try {
        const v = (await get(ref(db, "accounts"))).val() || {}; S.accs = {}; S.accTotal = 0;
        for (const [uid, list] of Object.entries(v)) { S.accs[uid] = Object.entries(list).map(([k, { pass, ...rest }]) => ({ key: k, ...rest })); S.accTotal += S.accs[uid].length; } // نُسقط كلمات المرور المشفرة فوراً
    } catch (e) { logError(e, { context: "loadAccounts" }); }
    renderAll();
}
loadAccounts();
setInterval(renderLive, 15000);

// ============================== الرسوم البيانية ==============================
function barChart(el, labels, vals) {
    const W = 560, H = 190, p = 26, max = Math.max(1, ...vals), bw = (W - p * 2) / vals.length;
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>` +
        vals.map((v, i) => { const h = (H - p * 2) * v / max, x = W - p - (i + 1) * bw + 4; return `<rect x="${x}" y="${H - p - Math.max(h, 3)}" width="${bw - 8}" height="${Math.max(h, 3)}" rx="6" fill="url(#bg)" opacity="${v ? 1 : .25}"/>${v ? `<text class="val" x="${x + (bw - 8) / 2}" y="${H - p - h - 6}" text-anchor="middle">${v}</text>` : ""}${i % 2 === 0 ? `<text x="${x + (bw - 8) / 2}" y="${H - 8}" text-anchor="middle">${labels[i]}</text>` : ""}`; }).join("") + `</svg>`;
}
function donut(el, parts) {
    const total = parts.reduce((a, b) => a + b.value, 0) || 1, R = 54, C = 2 * Math.PI * R; let off = 0;
    el.innerHTML = `<div class="row" style="gap:24px;flex-wrap:wrap;justify-content:center"><svg viewBox="0 0 140 140" width="170" height="170"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="18"/>` +
        parts.map(p => { const len = C * p.value / total, c = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.color}" stroke-width="18" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`; off += len; return c; }).join("") +
        `<text x="70" y="68" text-anchor="middle" style="fill:var(--text);font-size:24px;font-weight:800">${parts.reduce((a, b) => a + b.value, 0)}</text><text x="70" y="86" text-anchor="middle" style="fill:var(--muted);font-size:10px">مستخدم</text></svg>` +
        `<div class="legend" style="flex-direction:column;margin:0">${parts.map(p => `<span><i style="background:${p.color}"></i>${p.label}: <b>${p.value}</b></span>`).join("")}</div></div>`;
}

// ============================== العرض ==============================
function renderAll() { renderKpis(); renderCharts(); renderUsers(); renderLive(); renderNotifTargets(); renderFeeds(); renderSys(); }

function renderKpis() {
    const U = Object.values(S.users), n = U.length, ver = U.filter(u => u.isVerified).length, dis = U.filter(u => u.disabled).length;
    const online = uids().filter(isOnline).length, crit = S.errors.filter(e => e.severity === "CRITICAL" && e.status !== "RESOLVED").length;
    const k = (c, ic, v, l, s = "") => `<div class="card kpi" style="--c:${c}"><div class="ic"><i class="fa-solid ${ic}"></i></div><div class="v">${v}</div><div class="l">${l}</div><div class="s">${s}</div></div>`;
    $("#kpis").innerHTML = k("#22c55e", "fa-signal", online, "متصلون الآن", "نشطون خلال آخر دقيقة") + k("#38bdf8", "fa-users", n, "إجمالي المستخدمين", `${U.filter(u => u.isAdmin).length} مدير`) + k("#a78bfa", "fa-circle-check", ver, "حسابات موثقة", n ? Math.round(ver / n * 100) + "% من المستخدمين" : "") + k("#facc15", "fa-key", S.accTotal, "كلمات مرور محفوظة", n ? `بمعدل ${(S.accTotal / n).toFixed(1)} لكل مستخدم` : "") + k("#ef4444", "fa-bug", crit, "أخطاء حرجة مفتوحة", `${S.errors.filter(e => e.status === "NEW" || !e.status).length} غير مراجعة`) + k("#f97316", "fa-ban", dis, "حسابات معطّلة");
    $("#c-users").textContent = n; $("#c-sessions").textContent = online;
    const c = $("#c-errors"); const open = S.errors.filter(e => (e.status || "NEW") === "NEW").length; c.textContent = open; c.classList.toggle("hidden", !open);
}
function renderCharts() {
    const days = [], vals = [], now = new Date(); now.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); const a = +d, b = a + 864e5; days.push(d.toLocaleDateString("ar-EG", { day: "numeric", month: "numeric" })); vals.push(Object.values(S.users).filter(u => u.createdAt >= a && u.createdAt < b).length); }
    barChart($("#ch-new"), days, vals);
    const U = Object.values(S.users);
    donut($("#ch-mix"), [{ label: "موثقون", value: U.filter(u => u.isVerified && !u.disabled).length, color: "#22c55e" }, { label: "غير موثقين", value: U.filter(u => !u.isVerified && !u.disabled).length, color: "#f59e0b" }, { label: "معطّلون", value: U.filter(u => u.disabled).length, color: "#ef4444" }, { label: "مديرون", value: U.filter(u => u.isAdmin).length, color: "#7c5cff" }]);
}
function renderFeeds() {
    $("#feed-audit").innerHTML = S.audit.slice(0, 7).map(a => `<div class="it"><div class="ic"><i class="fa-solid fa-pen-to-square"></i></div><div><div><b>${esc(a.action)}</b> — ${esc(a.target)}</div><div class="muted small">${esc(a.by)} · ${timeAgo(a.ts)}</div></div></div>`).join("") || `<div class="empty">لا توجد عمليات بعد</div>`;
    $("#feed-err").innerHTML = S.errors.slice(0, 6).map(e => `<div class="it"><div class="ic" style="color:${e.severity === "CRITICAL" ? "#ef4444" : "#f59e0b"}"><i class="fa-solid fa-triangle-exclamation"></i></div><div style="min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${esc(e.errorName)}</b>: ${esc(e.errorMessage)}</div><div class="muted small">${esc(e.userEmail)} · ${timeAgo(e.timestamp)}</div></div></div>`).join("") || `<div class="empty"><i class="fa-solid fa-circle-check"></i>لا توجد أخطاء 🎉</div>`;
}
function renderSys() {
    $("#sys-info").innerHTML = [["المستخدمون", uids().length], ["كلمات المرور المحفوظة", S.accTotal], ["سجلات الأخطاء", S.errors.length], ["سجل العمليات", S.audit.length], ["أنت", me.email], ["المشروع", auth.app.options.projectId]].map(([a, b]) => `<div><b>${a}</b>${esc(b)}</div>`).join("");
}

// ---------- المستخدمون ----------
function filteredUsers() {
    const q = $("#u-q").value.trim().toLowerCase(), f = $("#u-filter").value, so = $("#u-sort").value;
    let list = uids().filter(uid => {
        const u = S.users[uid];
        if (f === "online" && !isOnline(uid)) return false; if (f === "verified" && !u.isVerified) return false; if (f === "unverified" && u.isVerified) return false;
        if (f === "disabled" && !u.disabled) return false; if (f === "admin" && !u.isAdmin) return false; if (f === "empty" && accCount(uid)) return false;
        if (!q) return true;
        return (u.email || "").toLowerCase().includes(q) || uid.toLowerCase().includes(q) || (S.accs[uid] || []).some(a => (a.site || "").toLowerCase().includes(q) || (a.user || "").toLowerCase().includes(q));
    });
    const by = { new: (a, b) => (S.users[b].createdAt || 0) - (S.users[a].createdAt || 0), old: (a, b) => (S.users[a].createdAt || 0) - (S.users[b].createdAt || 0), email: (a, b) => emailOf(a).localeCompare(emailOf(b)), accs: (a, b) => accCount(b) - accCount(a), login: (a, b) => (S.users[b].lastLoginAt || 0) - (S.users[a].lastLoginAt || 0) };
    return list.sort(by[so]);
}
function renderUsers() {
    const list = filteredUsers(), per = +$("#u-per").value, max = Math.max(1, Math.ceil(list.length / per)); S.page = Math.min(S.page, max);
    const rows = list.slice((S.page - 1) * per, S.page * per);
    $("#u-info").textContent = `${list.length} مستخدم · صفحة ${S.page} من ${max}`;
    $("#u-body").innerHTML = rows.map(uid => {
        const u = S.users[uid], on = isOnline(uid);
        return `<tr class="click" data-uid="${esc(uid)}"><td><input type="checkbox" class="check" data-sel ${S.sel.has(uid) ? "checked" : ""}></td>
 <td><div class="row"><div class="avatar sm" style="--h:${hueOf(u.email)}">${esc((u.email || "?")[0].toUpperCase())}</div><div style="min-width:0"><div style="font-weight:700;word-break:break-all">${esc(u.email || "—")}</div><div class="muted small mono">${esc(uid.slice(0, 12))}…</div></div></div></td>
 <td><div class="row wrap" style="gap:5px"><span class="badge ${on ? "ok" : ""}"><span class="dot ${on ? "on" : ""}"></span>${on ? "متصل" : "غير متصل"}</span>${u.isVerified ? '<span class="badge info">موثق</span>' : '<span class="badge warn">غير موثق</span>'}${u.isAdmin ? '<span class="badge vio">مدير</span>' : ""}${u.disabled ? '<span class="badge bad">معطّل</span>' : ""}</div></td>
 <td><b>${accCount(uid)}</b> <span class="muted small">حساب</span></td><td class="hide-m muted small">${timeAgo(u.lastLoginAt)}</td><td class="hide-m muted small">${fmtDate(u.createdAt)}</td>
 <td><button class="icon-btn" data-open><i class="fa-solid fa-ellipsis-vertical"></i></button></td></tr>`;
    }).join("") || `<tr><td colspan="7"><div class="empty"><i class="fa-solid fa-user-slash"></i>${S.loaded.users ? "لا توجد نتائج مطابقة" : "جارٍ التحميل..."}</div></td></tr>`;
    $("#u-all").checked = rows.length > 0 && rows.every(u => S.sel.has(u)); renderBulk();
}
["#u-q", "#u-filter", "#u-sort", "#u-per"].forEach(id => $(id).addEventListener(id === "#u-q" ? "input" : "change", debounce(() => { S.page = 1; renderUsers(); }, 150)));
$("#u-prev").onclick = () => { S.page = Math.max(1, S.page - 1); renderUsers(); };
$("#u-next").onclick = () => { S.page++; renderUsers(); };
$("#u-all").onchange = e => { $$("#u-body tr").forEach(tr => { const u = tr.dataset.uid; if (!u) return; e.target.checked ? S.sel.add(u) : S.sel.delete(u); }); renderUsers(); };
$("#u-body").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-uid]"); if (!tr) return; const uid = tr.dataset.uid;
    if (e.target.matches("[data-sel]")) { e.target.checked ? S.sel.add(uid) : S.sel.delete(uid); renderBulk(); return; }
    showUser(uid);
});
function renderBulk() {
    const b = $("#u-bulk"), n = S.sel.size; b.classList.toggle("hidden", !n);
    b.innerHTML = `<b>${n} محدد</b><span class="grow"></span>
 <button class="btn btn-ok btn-sm" data-b="verify"><i class="fa-solid fa-circle-check"></i> توثيق</button><button class="btn btn-ghost btn-sm" data-b="unverify">إلغاء التوثيق</button>
 <button class="btn btn-ghost btn-sm" data-b="disable"><i class="fa-solid fa-ban"></i> تعطيل</button><button class="btn btn-ghost btn-sm" data-b="enable">تفعيل</button>
 <button class="btn btn-ghost btn-sm" data-b="logout"><i class="fa-solid fa-right-from-bracket"></i> إنهاء الجلسات</button><button class="btn btn-ghost btn-sm" data-b="notify"><i class="fa-solid fa-bell"></i> إشعار</button>
 <button class="btn btn-danger btn-sm" data-b="delete"><i class="fa-solid fa-trash"></i> حذف</button><button class="icon-btn" data-b="clear" title="إلغاء التحديد"><i class="fa-solid fa-xmark"></i></button>`;
}
$("#u-bulk").addEventListener("click", async e => {
    const k = e.target.closest("[data-b]")?.dataset.b; if (!k) return;
    const targets = [...S.sel]; if (k === "clear") { S.sel.clear(); return renderUsers(); }
    const others = targets.filter(u => u !== me.uid), n = others.length;
    if (["disable", "logout", "delete"].includes(k) && !n) return toast("لا يمكن تطبيق هذه العملية على حسابك الخاص", "warn");
    if (k === "verify" || k === "unverify") { await Promise.all(targets.map(u => update(ref(db, `users/${u}`), { isVerified: k === "verify" }))); await audit(k === "verify" ? "توثيق جماعي" : "إلغاء توثيق جماعي", `${targets.length} مستخدم`); toast("تم التنفيذ", "success"); }
    else if (k === "enable") { await Promise.all(targets.map(u => update(ref(db, `users/${u}`), { disabled: false }))); await audit("تفعيل جماعي", `${targets.length} مستخدم`); toast("تم التفعيل", "success"); }
    else if (k === "disable") { if (!await confirmDialog({ title: "تعطيل الحسابات", message: `سيتم تعطيل ${n} حساب وإخراجهم فوراً.`, confirmText: "تعطيل", danger: true })) return; await Promise.all(others.map(u => update(ref(db, `users/${u}`), { disabled: true, forceLogoutAt: serverTimestamp() }))); await audit("تعطيل جماعي", `${n} مستخدم`); toast("تم التعطيل", "success"); }
    else if (k === "logout") { await Promise.all(others.map(u => update(ref(db, `users/${u}`), { forceLogoutAt: serverTimestamp() }))); await audit("إنهاء جلسات جماعي", `${n} مستخدم`); toast("تم إنهاء الجلسات", "success"); }
    else if (k === "notify") { const m = await askText({ title: `إشعار إلى ${targets.length} مستخدم`, label: "نص الرسالة", multiline: true }); if (m) await sendNotif(targets, m, "info"); }
    else if (k === "delete") { if (!await confirmDialog({ title: "حذف المستخدمين", message: `سيتم حذف بيانات ${n} مستخدم وكل حساباتهم المحفوظة نهائياً.\nملاحظة: حساب الدخول نفسه يبقى في Firebase Authentication ويُحذف من هناك.`, confirmText: "حذف نهائي", danger: true })) return; for (const u of others) await wipeUser(u); S.sel.clear(); toast("تم الحذف", "success"); await loadAccounts(); }
});
$("#u-export").onclick = () => {
    const rows = filteredUsers(); downloadFile(`users-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows, [{ label: "البريد", get: u => emailOf(u) }, { label: "UID", get: u => u }, { label: "موثق", get: u => S.users[u].isVerified ? "نعم" : "لا" }, { label: "مدير", get: u => S.users[u].isAdmin ? "نعم" : "لا" }, { label: "معطّل", get: u => S.users[u].disabled ? "نعم" : "لا" }, { label: "عدد الحسابات", get: u => accCount(u) }, { label: "تاريخ التسجيل", get: u => fmtDate(S.users[u].createdAt) }, { label: "آخر دخول", get: u => fmtDate(S.users[u].lastLoginAt) }]));
    audit("تصدير مستخدمين", `${rows.length} سجل`);
};

// ---------- عمليات المستخدم ----------
async function wipeUser(uid) {
    const email = emailOf(uid);
    await update(ref(db), { [`users/${uid}`]: null, [`accounts/${uid}`]: null, [`notifications/${uid}`]: null, [`active_sessions/${uid}`]: null });
    await audit("حذف مستخدم", email);
}
async function sendNotif(list, message, type) {
    const batch = Date.now().toString(36), ups = {};
    list.forEach(uid => { const k = push(ref(db, `notifications/${uid}`)).key; ups[`notifications/${uid}/${k}`] = { message, type, timestamp: Date.now(), batch, by: me.email }; });
    if (await run("إرسال الإشعار", () => update(ref(db), ups))) { await audit("إرسال إشعار", `${list.length} مستخدم`, message.slice(0, 80)); toast(`تم الإرسال إلى ${list.length} مستخدم`, "success"); return true; }
}
function showUser(uid) {
    const u = S.users[uid]; if (!u) return; const accs = S.accs[uid] || [], on = isOnline(uid), self = uid === me.uid, ss = S.sessions[uid];
    const { wrap, close } = openDrawer(`<div class="row between"><h3 style="font-size:18px">تفاصيل المستخدم</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
 <div class="row" style="margin:16px 0"><div class="avatar" style="--h:${hueOf(u.email)};width:56px;height:56px;font-size:22px">${esc((u.email || "?")[0].toUpperCase())}</div><div style="min-width:0"><div style="font-weight:800;word-break:break-all">${esc(u.email)}</div><div class="row wrap" style="gap:5px;margin-top:4px"><span class="badge ${on ? "ok" : ""}">${on ? "متصل" : "غير متصل"}</span>${u.isVerified ? '<span class="badge info">موثق</span>' : '<span class="badge warn">غير موثق</span>'}${u.isAdmin ? '<span class="badge vio">مدير</span>' : ""}${u.disabled ? '<span class="badge bad">معطّل</span>' : ""}</div></div></div>
 <div class="detail-grid"><div><b>المعرّف</b><span class="mono small" style="word-break:break-all">${esc(uid)}</span></div><div><b>الحسابات المحفوظة</b>${accs.length}</div><div><b>تاريخ التسجيل</b>${fmtDate(u.createdAt)}</div><div><b>آخر دخول</b>${fmtDate(u.lastLoginAt)}</div>${ss ? `<div><b>الجهاز</b><span class="small">${esc(ss.systemInfo?.platform || "—")} · ${esc(ss.systemInfo?.viewportSize || "")}</span></div><div><b>آخر ظهور</b>${timeAgo(ss.lastSeen)}</div>` : ""}</div>
 <div class="act-grid">
  <button class="btn ${u.isVerified ? "btn-ghost" : "btn-ok"}" data-a="verify"><i class="fa-solid fa-circle-check"></i> ${u.isVerified ? "إلغاء التوثيق" : "توثيق الحساب"}</button>
  <button class="btn ${u.disabled ? "btn-ok" : "btn-ghost"}" data-a="disable" ${self ? "disabled" : ""}><i class="fa-solid fa-ban"></i> ${u.disabled ? "إعادة التفعيل" : "تعطيل الحساب"}</button>
  <button class="btn btn-ghost" data-a="logout" ${self ? "disabled" : ""}><i class="fa-solid fa-right-from-bracket"></i> إنهاء كل الجلسات</button>
  <button class="btn btn-ghost" data-a="reset"><i class="fa-solid fa-envelope"></i> رابط إعادة كلمة المرور</button>
  <button class="btn btn-ghost" data-a="notify"><i class="fa-solid fa-bell"></i> إرسال إشعار</button>
  <button class="btn btn-ghost" data-a="admin" ${self ? "disabled" : ""}><i class="fa-solid fa-user-shield"></i> ${u.isAdmin ? "سحب صلاحية المدير" : "ترقية إلى مدير"}</button>
  <button class="btn btn-danger" data-a="wipe"><i class="fa-solid fa-eraser"></i> مسح الحسابات المحفوظة</button>
  <button class="btn btn-danger" data-a="delete" ${self ? "disabled" : ""}><i class="fa-solid fa-trash"></i> حذف المستخدم</button></div>
 <div class="field"><label>ملاحظة إدارية خاصة</label><textarea class="input" id="d-note" placeholder="ملاحظات لا يراها المستخدم...">${esc(u.adminNote)}</textarea><button class="btn btn-ghost btn-sm" data-a="note" style="align-self:flex-start">حفظ الملاحظة</button></div>
 <h4 style="margin:18px 0 8px">المواقع المحفوظة (${accs.length})</h4><p class="muted small" style="margin-bottom:8px">تُعرض البيانات الوصفية فقط — كلمات المرور لا تُعرض ولا تُحمَّل في لوحة الأدمن.</p>
 ${accs.map(a => `<div class="acc-row" style="margin-bottom:6px"><div class="avatar sm" style="--h:${hueOf(a.site)}">${esc((a.site || "?")[0].toUpperCase())}</div><div class="grow" style="min-width:0"><div style="font-weight:700">${esc(a.site)}</div><div class="muted small" style="overflow:hidden;text-overflow:ellipsis">${esc(a.user)}${a.email ? " · " + esc(a.email) : ""}</div></div></div>`).join("") || '<div class="muted small">لا توجد حسابات.</div>'}`);
    wrap.addEventListener("click", async e => {
        const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return; const U = () => update(ref(db, `users/${uid}`), {});
        if (a === "verify") { if (await run("التوثيق", () => update(ref(db, `users/${uid}`), { isVerified: !u.isVerified }))) { audit(u.isVerified ? "إلغاء توثيق" : "توثيق", u.email); toast("تم التحديث", "success"); close(); } }
        else if (a === "disable") {
            if (!notSelf(uid, "تعطيل")) return;
            if (!u.disabled && !await confirmDialog({ title: "تعطيل الحساب", message: `سيُمنع ${u.email} من الدخول وتُحجب بياناته فوراً.`, confirmText: "تعطيل", danger: true })) return;
            if (await run("التعطيل", () => update(ref(db, `users/${uid}`), u.disabled ? { disabled: false } : { disabled: true, forceLogoutAt: serverTimestamp() }))) { audit(u.disabled ? "إعادة تفعيل" : "تعطيل", u.email); toast("تم", "success"); close(); }
        }
        else if (a === "logout") { if (await run("إنهاء الجلسات", async () => { await update(ref(db, `users/${uid}`), { forceLogoutAt: serverTimestamp() }); await update(ref(db, `active_sessions/${uid}`), { status: "OFFLINE" }).catch(() => { }); })) { audit("إنهاء جلسات", u.email); toast("تم إخراج المستخدم من جميع أجهزته", "success"); close(); } }
        else if (a === "reset") { if (await run("إرسال الرابط", () => sendPasswordResetEmail(auth, u.email))) { audit("إرسال رابط إعادة كلمة المرور", u.email); toast("تم إرسال الرابط إلى بريد المستخدم", "success"); } }
        else if (a === "notify") { const m = await askText({ title: "إشعار إلى " + u.email, label: "نص الرسالة", multiline: true }); if (m && await sendNotif([uid], m, "info")) close(); }
        else if (a === "admin") {
            if (!notSelf(uid, "تغيير صلاحيات")) return;
            if (!await confirmDialog({ title: u.isAdmin ? "سحب صلاحية المدير" : "ترقية إلى مدير", message: u.isAdmin ? `سيفقد ${u.email} صلاحيات الإدارة.` : `سيحصل ${u.email} على تحكم كامل بالنظام.`, confirmText: "تأكيد", danger: !u.isAdmin })) return;
            if (await run("تغيير الصلاحية", () => update(ref(db, `users/${uid}`), { isAdmin: !u.isAdmin }))) { audit(u.isAdmin ? "سحب صلاحية مدير" : "منح صلاحية مدير", u.email); toast("تم", "success"); close(); }
        }
        else if (a === "wipe") { if (!await confirmDialog({ title: "مسح الحسابات المحفوظة", message: `سيتم حذف ${accs.length} حساب محفوظ لدى ${u.email} نهائياً.`, confirmText: "مسح", danger: true })) return; if (await run("المسح", () => remove(ref(db, `accounts/${uid}`)))) { audit("مسح حسابات مستخدم", u.email, `${accs.length} حساب`); await loadAccounts(); toast("تم المسح", "success"); close(); } }
        else if (a === "delete") { if (!notSelf(uid, "حذف")) return; if (!await confirmDialog({ title: "حذف المستخدم", message: `سيتم حذف ${u.email} وكل بياناته نهائياً.\nحساب الدخول يبقى في Firebase Authentication ويُحذف من هناك.`, confirmText: "حذف نهائي", danger: true })) return; if (await run("الحذف", () => wipeUser(uid))) { toast("تم الحذف", "success"); await loadAccounts(); close(); } }
        else if (a === "note") { if (await run("حفظ الملاحظة", () => update(ref(db, `users/${uid}`), { adminNote: $("#d-note", wrap).value.trim() }))) toast("تم حفظ الملاحظة", "success"); }
    });
}

// ---------- الجلسات ----------
function renderLive() {
    renderKpis();
    const f = $("#s-filter").value, list = Object.entries(S.sessions).map(([uid, s]) => ({ uid, ...s, on: isOnline(uid) })).filter(s => f === "all" || s.on).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    $("#s-body").innerHTML = list.map(s => `<tr><td><div class="row"><div class="avatar sm" style="--h:${hueOf(s.email)}">${esc((s.email || "?")[0].toUpperCase())}</div><div style="min-width:0"><b style="word-break:break-all">${esc(s.email || "—")}</b> ${s.role === "admin" ? '<span class="badge vio">مدير</span>' : ""}</div></div></td>
 <td class="small">${esc(s.systemInfo?.platform || "—")}<br><span class="muted">${esc(s.systemInfo?.viewportSize || "")} · ${esc(s.systemInfo?.language || "")}</span></td><td><code class="small">${esc(s.currentPath || "—")}</code></td>
 <td class="small">${s.startedAt && s.lastSeen ? Math.max(1, Math.round((s.lastSeen - s.startedAt) / 60000)) + " دقيقة" : "—"}</td><td class="small muted">${timeAgo(s.lastSeen)}</td>
 <td><span class="badge ${s.on ? "ok" : ""}"><span class="dot ${s.on ? "on" : ""}"></span>${s.on ? "متصل" : "غير متصل"}</span></td>
 <td>${s.uid === me.uid ? '<span class="muted small">أنت</span>' : `<button class="btn btn-danger btn-sm" data-kick="${esc(s.uid)}"><i class="fa-solid fa-right-from-bracket"></i> إنهاء</button>`}</td></tr>`).join("") || `<tr><td colspan="7"><div class="empty"><i class="fa-solid fa-tower-broadcast"></i>لا توجد جلسات</div></td></tr>`;
}
$("#s-filter").onchange = renderLive;
$("#s-body").addEventListener("click", async e => {
    const uid = e.target.closest("[data-kick]")?.dataset.kick; if (!uid) return;
    if (!await confirmDialog({ title: "إنهاء الجلسة", message: `سيُخرَج ${emailOf(uid)} من جميع أجهزته فوراً.`, confirmText: "إنهاء", danger: true })) return;
    if (await run("إنهاء الجلسة", async () => { await update(ref(db, `users/${uid}`), { forceLogoutAt: serverTimestamp() }); await update(ref(db, `active_sessions/${uid}`), { status: "OFFLINE" }); })) { audit("إنهاء جلسة", emailOf(uid)); toast("تم إنهاء الجلسة", "success"); }
});

// ---------- الأخطاء ----------
function renderErrors() {
    const q = $("#e-q").value.trim().toLowerCase(), sv = $("#e-sev").value, st = $("#e-st").value;
    const list = S.errors.filter(e => (!sv || e.severity === sv) && (!st || (e.status || "NEW") === st) && (!q || `${e.errorMessage} ${e.errorName} ${e.userEmail}`.toLowerCase().includes(q)));
    const sevC = { CRITICAL: "bad", HIGH: "warn" };
    $("#e-body").innerHTML = list.map(e => `<tr><td class="small muted">${fmtDate(e.timestamp)}</td><td class="small">${esc(e.userEmail)}</td>
 <td style="max-width:320px"><b class="small" style="color:#f87171">${esc(e.errorName)}</b><div class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.errorMessage)}</div></td>
 <td><span class="badge ${sevC[e.severity] || "info"}">${esc(e.severity)}</span></td>
 <td><select class="input" data-st="${esc(e.id)}" style="padding:5px 8px;font-size:13px;min-width:110px"><option value="NEW" ${(e.status || "NEW") === "NEW" ? "selected" : ""}>جديد</option><option value="INVESTIGATING" ${e.status === "INVESTIGATING" ? "selected" : ""}>قيد الفحص</option><option value="RESOLVED" ${e.status === "RESOLVED" ? "selected" : ""}>تم الحل</option></select></td>
 <td><div class="row" style="gap:2px"><button class="icon-btn" data-insp="${esc(e.id)}" title="فحص"><i class="fa-solid fa-magnifying-glass"></i></button><button class="icon-btn" data-del="${esc(e.id)}" style="color:#ff7b7b" title="حذف"><i class="fa-regular fa-trash-can"></i></button></div></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty"><i class="fa-solid fa-circle-check"></i>لا توجد أخطاء مطابقة</div></td></tr>`;
}
["#e-q", "#e-sev", "#e-st"].forEach(id => $(id).addEventListener(id === "#e-q" ? "input" : "change", debounce(renderErrors, 150)));
$("#e-body").addEventListener("change", e => { const id = e.target.dataset.st; if (id) run("تحديث الحالة", () => update(ref(db, `telemetry_errors/${id}`), { status: e.target.value })); });
$("#e-body").addEventListener("click", async e => {
    const insp = e.target.closest("[data-insp]")?.dataset.insp, del = e.target.closest("[data-del]")?.dataset.del;
    if (del) { await run("حذف الخطأ", () => remove(ref(db, `telemetry_errors/${del}`))); return; }
    if (!insp) return; const d = S.errors.find(x => x.id === insp); if (!d) return;
    openModal(`<div class="modal-head"><h3 style="color:#f87171">${esc(d.errorName)}</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div><p style="margin-bottom:12px">${esc(d.errorMessage)}</p>
 <div class="detail-grid"><div><b>المستخدم</b>${esc(d.userEmail)}</div><div><b>الوقت</b>${fmtDate(d.timestamp)}</div><div><b>السياق</b>${esc(d.contextInfo?.context || d.contextInfo?.source || "—")}</div><div><b>المستوى</b>${esc(d.severity)}</div></div>
 <h4 style="margin:10px 0 6px">خطوات المستخدم قبل الخطأ</h4><pre class="code">${esc(JSON.stringify(d.breadcrumbs || [], null, 2))}</pre>
 <h4 style="margin:10px 0 6px">بيئة الجهاز</h4><pre class="code">${esc(JSON.stringify(d.systemContext || {}, null, 2))}</pre>
 <h4 style="margin:10px 0 6px">Stack Trace</h4><pre class="code" style="color:#f87171">${esc(d.errorStack || "—")}</pre>`, { wide: true });
});
$("#e-clear-res").onclick = async () => { const ids = S.errors.filter(e => e.status === "RESOLVED").map(e => e.id); if (!ids.length) return toast("لا توجد أخطاء محلولة", "info"); if (await confirmDialog({ title: "حذف المحلولة", message: `حذف ${ids.length} خطأ محلول؟`, danger: true, confirmText: "حذف" })) { await run("الحذف", () => update(ref(db), Object.fromEntries(ids.map(i => [`telemetry_errors/${i}`, null])))); audit("حذف أخطاء محلولة", `${ids.length} سجل`); } };
$("#e-clear-all").onclick = async () => { if (!S.errors.length) return; if (await confirmDialog({ title: "مسح كل السجلات", message: `سيتم حذف ${S.errors.length} سجل خطأ نهائياً.`, danger: true, confirmText: "مسح الكل" })) { await run("المسح", () => remove(ref(db, "telemetry_errors"))); audit("مسح سجل الأخطاء", "الكل"); } };

// ---------- سجل العمليات ----------
function renderAudit() {
    const q = $("#a-q").value.trim().toLowerCase();
    $("#a-body").innerHTML = S.audit.filter(a => !q || `${a.action} ${a.target} ${a.by} ${a.details}`.toLowerCase().includes(q)).map(a => `<tr><td class="small muted">${fmtDate(a.ts)}</td><td class="small">${esc(a.by)}</td><td><span class="badge vio">${esc(a.action)}</span></td><td class="small">${esc(a.target)}</td><td class="small muted">${esc(a.details)}</td></tr>`).join("") || `<tr><td colspan="5"><div class="empty"><i class="fa-solid fa-clipboard-list"></i>لا توجد عمليات</div></td></tr>`;
}
$("#a-q").addEventListener("input", debounce(renderAudit, 150));
$("#a-export").onclick = () => downloadFile("audit-log.csv", toCSV(S.audit, [{ label: "الوقت", get: a => fmtDate(a.ts) }, { label: "المدير", get: a => a.by }, { label: "العملية", get: a => a.action }, { label: "الهدف", get: a => a.target }, { label: "التفاصيل", get: a => a.details }]));

// ---------- إنشاء مستخدم ----------
function newPass() { const p = $("#n-pass"); p.value = generatePassword(14); meter(); }
function meter() { const s = passwordStrength($("#n-pass").value); $("#n-bar").style.cssText = `width:${s.pct}%;background:${s.color}`; }
$("#n-gen").onclick = newPass; $("#n-pass").addEventListener("input", meter);
$("#n-copy").onclick = async () => { await copyText($("#n-pass").value); toast("تم النسخ", "success"); };
$("#n-go").onclick = async () => {
    const email = $("#n-email").value.trim(), pw = $("#n-pass").value, isAdmin = $("#n-admin").checked, isVerified = $("#n-ver").checked;
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("أدخل بريداً صحيحاً", "warn");
    if (pw.length < 8) return toast("كلمة المرور 8 أحرف على الأقل", "warn");
    if (isAdmin && !await confirmDialog({ title: "إنشاء مدير", message: "هذا الحساب سيملك تحكماً كاملاً بالنظام. متأكد؟", confirmText: "نعم، أنشئه", danger: true })) return;
    const btn = $("#n-go"); btn.disabled = true;
    try {
        const sec = getApps().find(a => a.name === "Secondary") || initializeApp(auth.app.options, "Secondary"), sa = getAuth(sec);
        const res = await createUserWithEmailAndPassword(sa, email, pw); await signOutAuth(sa);
        await set(ref(db, `users/${res.user.uid}`), { email, isVerified, isAdmin, disabled: false, createdAt: Date.now(), createdBy: me.email });
        await audit(isAdmin ? "إنشاء مدير" : "إنشاء مستخدم", email); await loadAccounts();
        const { wrap } = openModal(`<div class="modal-head"><h3>✅ تم إنشاء الحساب</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div><p class="muted small" style="margin-bottom:12px">انسخ بيانات الدخول الآن وسلّمها للمستخدم — لن تظهر كلمة المرور مرة أخرى.</p><pre class="code mono" id="cred">${esc(email)}\n${esc(pw)}</pre><div class="modal-foot"><button class="btn btn-primary" id="cred-copy"><i class="fa-regular fa-copy"></i> نسخ</button><button class="btn btn-ghost" data-close>إغلاق</button></div>`);
        $("#cred-copy", wrap).onclick = async () => { await copyText(`البريد: ${email}\nكلمة المرور: ${pw}`); toast("تم النسخ", "success"); };
        $("#n-email").value = ""; $("#n-admin").checked = false; newPass();
    } catch (e) { toast(friendlyAuthError(e.code), "error"); if (!e.code) logError(e, { context: "createUser" }); }
    btn.disabled = false;
};

// ---------- الإشعارات ----------
function renderNotifTargets() { const s = $("#b-one"), cur = s.value; s.innerHTML = uids().map(u => `<option value="${esc(u)}">${esc(emailOf(u))}</option>`).join(""); if (cur) s.value = cur; }
$("#b-aud").onchange = e => $("#b-one-w").classList.toggle("hidden", e.target.value !== "one");
$("#b-send").onclick = async () => {
    const msg = $("#b-msg").value.trim(), aud = $("#b-aud").value; if (!msg) return toast("اكتب نص الرسالة", "warn");
    const list = aud === "one" ? [$("#b-one").value] : uids().filter(u => aud === "all" || (aud === "verified" && S.users[u].isVerified) || (aud === "admins" && S.users[u].isAdmin) || (aud === "online" && isOnline(u)));
    if (!list.length) return toast("لا يوجد مستلمون ضمن هذه الفئة", "warn");
    if (await sendNotif(list, msg, $("#b-type").value)) $("#b-msg").value = "";
};
function renderNotifHistory() {
    const groups = new Map();
    for (const [uid, items] of Object.entries(S.notifs)) for (const [id, n] of Object.entries(items)) { const g = n.batch || `${n.message}|${n.timestamp}`; if (!groups.has(g)) groups.set(g, { message: n.message, type: n.type, ts: n.timestamp, paths: [], read: 0 }); const o = groups.get(g); o.paths.push(`notifications/${uid}/${id}`); if (n.read) o.read++; }
    const list = [...groups.entries()].sort((a, b) => b[1].ts - a[1].ts);
    $("#b-hist").innerHTML = list.map(([g, o]) => `<div class="notif ${esc(o.type || "info")}"><div class="row between"><div style="min-width:0">${esc(o.message)}</div><button class="icon-btn" data-nd="${esc(g)}" title="حذف من الجميع" style="color:#ff7b7b"><i class="fa-regular fa-trash-can"></i></button></div><div class="muted small" style="margin-top:4px">${fmtDate(o.ts)} · ${o.paths.length} مستلم · ${o.read} قرأها</div></div>`).join("") || `<div class="empty"><i class="fa-regular fa-paper-plane"></i>لم تُرسل إشعارات بعد</div>`;
    $("#b-hist")._g = groups;
}
$("#b-hist").addEventListener("click", async e => {
    const g = e.target.closest("[data-nd]")?.dataset.nd, o = $("#b-hist")._g?.get(g); if (!o) return;
    if (await confirmDialog({ title: "حذف الإشعار", message: `سيُحذف من صناديق ${o.paths.length} مستخدم.`, danger: true, confirmText: "حذف" })) { await run("الحذف", () => update(ref(db), Object.fromEntries(o.paths.map(p => [p, null])))); audit("حذف إشعار", `${o.paths.length} مستلم`, o.message.slice(0, 60)); }
});

// ---------- الإعدادات ----------
$("#m-save").onclick = async () => {
    const on = $("#m-on").checked;
    if (on && !await confirmDialog({ title: "تفعيل وضع الصيانة", message: "سيُحجب جميع المستخدمين العاديين عن النظام فوراً.", danger: true, confirmText: "تفعيل" })) { $("#m-on").checked = false; return; }
    if (await run("حفظ الإعدادات", () => set(ref(db, "settings/maintenance"), { enabled: on, message: $("#m-msg").value.trim(), by: me.email, at: Date.now() }))) { audit(on ? "تفعيل وضع الصيانة" : "إيقاف وضع الصيانة", "النظام"); toast("تم حفظ الإعدادات", "success"); }
};
$("#reload-accs").onclick = async () => { await loadAccounts(); toast("تم إعادة الاحتساب", "success"); };

showView(location.hash.slice(1) || "overview");
