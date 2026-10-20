import { auth, db } from "./firebase-config.js";
import { updatePassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ref, push, set, update, remove, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { encryptData, decryptData } from "./crypto.js";
import { $, $$, esc, toast, openModal, confirmDialog, passwordStrength, generatePassword, copyText, friendlyAuthError, initTheme, toggleTheme, initTelemetry, logError, startPresence, bootSession, logout, startIdleLock, hueOf, timeAgo, debounce } from "./common.js";

initTheme(); initTelemetry();
const { user, profile } = await bootSession();
startPresence(user, "user");
startIdleLock(15, () => logout("idle"));

const CATS = ["عام", "بنوك ومال", "تواصل اجتماعي", "عمل", "تسوق", "ترفيه", "أخرى"];
let accounts = {}, plain = new Map(), dupKeys = new Set();
let state = { q: "", cat: "all", sort: "new" };

// ---------- الواجهة العلوية ----------
$("#me-email").textContent = user.email;
$("#me-btn").textContent = (user.email || "?")[0].toUpperCase();
$("#me-badge").innerHTML = profile.isVerified ? '<span class="badge ok"><i class="fa-solid fa-circle-check"></i> حساب موثق</span>' : '<span class="badge warn">غير موثق</span>';
$("#me-btn").onclick = (e) => { e.stopPropagation(); $("#me-menu").classList.toggle("hidden"); };
document.addEventListener("click", () => $("#me-menu").classList.add("hidden"));
$("#m-out").onclick = () => logout();
$("#m-theme").onclick = toggleTheme;
$("#m-gen").onclick = openGenerator;
$("#m-pass").onclick = openChangePass;
$("#add-btn").onclick = () => openAccountModal();
$("#search").addEventListener("input", debounce(e => { state.q = e.target.value.trim().toLowerCase(); render(); }, 120));
$("#sort").onchange = e => { state.sort = e.target.value; render(); };
document.addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $("#search").focus(); } });

// ---------- تحميل الحسابات ----------
onValue(ref(db, `accounts/${user.uid}`), snap => {
    accounts = snap.val() || {};
    plain = new Map(Object.entries(accounts).map(([k, a]) => [k, decryptData(a.pass, user.uid)]));
    const seen = new Map(); dupKeys = new Set();
    plain.forEach((p, k) => { if (!p) return; if (seen.has(p)) { dupKeys.add(k); dupKeys.add(seen.get(p)); } else seen.set(p, k); });
    renderStats(); renderCats(); render();
}, err => { logError(err, { context: "loadAccounts" }); $("#list").innerHTML = `<div class="card empty" style="grid-column:1/-1"><i class="fa-solid fa-lock"></i>لا يمكن قراءة بياناتك حالياً (قد يكون النظام تحت الصيانة).</div>`; });

function renderStats() {
    const keys = Object.keys(accounts), n = keys.length;
    let strong = 0, weak = 0;
    keys.forEach(k => { const s = passwordStrength(plain.get(k) || ""); if (s.strong) strong++; else weak++; });
    $("#k-total").textContent = n; $("#k-strong").textContent = strong; $("#k-weak").textContent = weak; $("#k-dup").textContent = dupKeys.size;
    const score = n ? Math.max(0, Math.min(100, Math.round(strong / n * 100 - dupKeys.size * 4))) : 0;
    const ring = $("#ring"); ring.style.setProperty("--p", score); ring.style.setProperty("--ringc", score >= 75 ? "#22c55e" : score >= 45 ? "#f59e0b" : "#ef4444");
    $("#score").textContent = n ? score + "%" : "—";
    $("#score-note").textContent = !n ? "أضف حساباتك لنحلّلها" : score >= 75 ? "وضعك الأمني ممتاز" : score >= 45 ? "جيد، يمكن تحسينه" : "حسّن كلمات المرور الضعيفة";
}
function renderCats() {
    const used = new Set(Object.values(accounts).map(a => a.category || "عام"));
    const favs = Object.values(accounts).some(a => a.favorite);
    const items = [["all", "الكل"], ...(favs ? [["fav", "★ المفضلة"]] : []), ...CATS.filter(c => used.has(c)).map(c => [c, c])];
    $("#cats").innerHTML = items.map(([v, l]) => `<span class="chip ${state.cat === v ? "on" : ""}" data-cat="${esc(v)}">${esc(l)}</span>`).join("");
}
$("#cats").addEventListener("click", e => { const c = e.target.closest("[data-cat]"); if (!c) return; state.cat = c.dataset.cat; renderCats(); render(); });

function render() {
    let keys = Object.keys(accounts).filter(k => {
        const a = accounts[k];
        if (state.cat === "fav" && !a.favorite) return false;
        if (!["all", "fav"].includes(state.cat) && (a.category || "عام") !== state.cat) return false;
        return !state.q || [a.site, a.user, a.email, a.note, a.category].some(v => (v || "").toLowerCase().includes(state.q));
    });
    const by = { new: (a, b) => (accounts[b].createdAt || 0) - (accounts[a].createdAt || 0), old: (a, b) => (accounts[a].createdAt || 0) - (accounts[b].createdAt || 0), az: (a, b) => (accounts[a].site || "").localeCompare(accounts[b].site || "", "ar"), weak: (a, b) => passwordStrength(plain.get(a) || "").level - passwordStrength(plain.get(b) || "").level };
    keys.sort(by[state.sort]); keys.sort((a, b) => (accounts[b].favorite ? 1 : 0) - (accounts[a].favorite ? 1 : 0));
    if (!keys.length) { $("#list").innerHTML = `<div class="card empty" style="grid-column:1/-1"><i class="fa-solid fa-vault"></i>${Object.keys(accounts).length ? "لا توجد نتائج مطابقة" : "خزنتك فارغة — أضف أول حساب بزر «حساب جديد»"}</div>`; return; }
    $("#list").innerHTML = keys.map((k, i) => {
        const a = accounts[k], pw = plain.get(k), st = passwordStrength(pw || "");
        return `<article class="card acc-card" data-key="${esc(k)}" style="animation-delay:${Math.min(i, 12) * 30}ms">
 <div class="acc-head"><div class="avatar" style="--h:${hueOf(a.site)}">${esc((a.site || "?")[0].toUpperCase())}</div>
  <div class="grow"><h3>${esc(a.site)}</h3><span class="chip">${esc(a.category || "عام")}</span></div>
  <button class="icon-btn fav ${a.favorite ? "on" : ""}" data-act="fav" title="مفضلة"><i class="fa-${a.favorite ? "solid" : "regular"} fa-star"></i></button></div>
 <div class="acc-row"><span class="lbl">المستخدم</span><span class="val">${esc(a.user)}</span><button class="icon-btn" data-act="cu" title="نسخ"><i class="fa-regular fa-copy"></i></button></div>
 ${a.email ? `<div class="acc-row"><span class="lbl">البريد</span><span class="val mono">${esc(a.email)}</span><button class="icon-btn" data-act="ce" title="نسخ"><i class="fa-regular fa-copy"></i></button></div>` : ""}
 <div class="acc-row"><span class="lbl">كلمة المرور</span><span class="val mono" data-pw>••••••••••</span><button class="icon-btn" data-act="eye" title="إظهار"><i class="fa-regular fa-eye"></i></button><button class="icon-btn" data-act="cp" title="نسخ"><i class="fa-regular fa-copy"></i></button></div>
 <div class="strength"><i style="width:${st.pct}%;background:${st.color}"></i></div>
 <div class="row wrap" style="gap:6px">${pw === null ? '<span class="badge bad">تعذر فك التشفير</span>' : `<span class="badge" style="--c:${st.color}">${st.label}</span>`}${dupKeys.has(k) ? '<span class="badge warn"><i class="fa-solid fa-clone"></i> مكررة</span>' : ""}</div>
 ${a.note ? `<div class="muted small">${esc(a.note)}</div>` : ""}
 <div class="row between" style="margin-top:auto"><span class="muted small">${timeAgo(a.updatedAt || a.createdAt)}</span><div class="row" style="gap:2px"><button class="icon-btn" data-act="edit" title="تعديل"><i class="fa-solid fa-pen"></i></button><button class="icon-btn" data-act="del" title="حذف" style="color:#ff7b7b"><i class="fa-regular fa-trash-can"></i></button></div></div></article>`;
    }).join("");
}

// لا نمرر أي بيانات حساسة عبر HTML — نقرأها من الذاكرة بالمفتاح فقط
$("#list").addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const card = b.closest("[data-key]"), key = card.dataset.key, a = accounts[key], act = b.dataset.act;
    if (act === "cu") { await copyText(a.user); toast("تم نسخ اسم المستخدم", "success"); }
    else if (act === "ce") { await copyText(a.email); toast("تم نسخ البريد", "success"); }
    else if (act === "cp") { await copyText(plain.get(key) || "", 20000); toast("تم نسخ كلمة المرور — ستُمسح من الحافظة بعد 20 ثانية", "success"); }
    else if (act === "eye") {
        const el = $("[data-pw]", card), ic = $("i", b);
        if (el.dataset.on) { el.textContent = "••••••••••"; delete el.dataset.on; ic.className = "fa-regular fa-eye"; }
        else { el.textContent = plain.get(key) ?? "⚠ تعذر فك التشفير"; el.dataset.on = 1; ic.className = "fa-regular fa-eye-slash"; setTimeout(() => { if (el.dataset.on) { el.textContent = "••••••••••"; delete el.dataset.on; ic.className = "fa-regular fa-eye"; } }, 15000); }
    }
    else if (act === "fav") update(ref(db, `accounts/${user.uid}/${key}`), { favorite: !a.favorite }).catch(er => { toast("فشل التحديث", "error"); logError(er, { context: "fav" }); });
    else if (act === "edit") openAccountModal(key);
    else if (act === "del") {
        if (await confirmDialog({ title: "حذف الحساب", message: `سيتم حذف «${a.site}» نهائياً ولا يمكن التراجع.`, confirmText: "حذف", danger: true }))
            remove(ref(db, `accounts/${user.uid}/${key}`)).then(() => toast("تم الحذف", "success")).catch(er => { toast("فشل الحذف", "error"); logError(er, { context: "deleteAccount" }); });
    }
});

// ---------- إضافة / تعديل ----------
function openAccountModal(key) {
    const a = key ? accounts[key] : {}, curPw = key ? (plain.get(key) || "") : "";
    const { wrap, close } = openModal(`<div class="modal-head"><h3>${key ? "تعديل الحساب" : "إضافة حساب جديد"}</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
 <div class="field"><label>الموقع / الخدمة *</label><input class="input" id="f-site" value="${esc(a.site)}" placeholder="Google"></div>
 <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label>اسم المستخدم *</label><input class="input" id="f-user" value="${esc(a.user)}" dir="ltr"></div>
 <div class="field"><label>البريد</label><input class="input" id="f-email" type="email" value="${esc(a.email)}" dir="ltr"></div></div>
 <div class="field"><label>كلمة المرور *</label><div class="input-wrap two"><input class="input mono" id="f-pass" type="password" value="${esc(curPw)}" autocomplete="new-password"><button type="button" class="icon-btn" id="f-eye"><i class="fa-regular fa-eye"></i></button><button type="button" class="icon-btn" id="f-gen" title="توليد"><i class="fa-solid fa-wand-magic-sparkles"></i></button></div>
  <div class="strength"><i id="f-bar" style="width:0"></i></div><span class="small muted" id="f-lbl"></span></div>
 <div class="field"><label>التصنيف</label><select class="input" id="f-cat">${CATS.map(c => `<option ${c === (a.category || "عام") ? "selected" : ""}>${c}</option>`).join("")}</select></div>
 <div class="field"><label>ملاحظات</label><textarea class="input" id="f-note" style="min-height:64px">${esc(a.note)}</textarea></div>
 <div class="modal-foot"><button class="btn btn-primary" id="f-save"><i class="fa-solid fa-lock"></i> حفظ مشفراً</button><button class="btn btn-ghost" data-close>إلغاء</button></div>`);
    const p = $("#f-pass", wrap);
    const meter = () => { const s = passwordStrength(p.value); $("#f-bar", wrap).style.cssText = `width:${s.pct}%;background:${s.color}`; $("#f-lbl", wrap).textContent = p.value ? "القوة: " + s.label : ""; };
    p.addEventListener("input", meter); meter();
    $("#f-eye", wrap).onclick = () => { p.type = p.type === "password" ? "text" : "password"; };
    $("#f-gen", wrap).onclick = () => { p.value = generatePassword(18); p.type = "text"; meter(); };
    $("#f-save", wrap).onclick = async () => {
        const v = id => $(id, wrap).value.trim();
        const rec = { site: v("#f-site"), user: v("#f-user"), email: v("#f-email"), category: $("#f-cat", wrap).value, note: v("#f-note"), pass: encryptData(p.value, user.uid), v: 1, updatedAt: Date.now() };
        if (!rec.site || !rec.user || !p.value) return toast("املأ الحقول المطلوبة (*)", "warn");
        const btn = $("#f-save", wrap); btn.disabled = true;
        try {
            if (key) await update(ref(db, `accounts/${user.uid}/${key}`), rec);
            else await set(push(ref(db, `accounts/${user.uid}`)), { ...rec, createdAt: Date.now(), favorite: false });
            toast("تم الحفظ مشفراً ✓", "success"); close();
        } catch (er) { btn.disabled = false; toast("فشل الحفظ", "error"); logError(er, { context: "saveAccount" }); }
    };
    setTimeout(() => $("#f-site", wrap).focus(), 80);
}

// ---------- مولّد كلمات المرور ----------
function openGenerator() {
    const { wrap } = openModal(`<div class="modal-head"><h3>مولّد كلمات المرور</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
 <div class="input-wrap two"><input class="input mono" id="g-out" readonly><button class="icon-btn" id="g-copy"><i class="fa-regular fa-copy"></i></button><button class="icon-btn" id="g-new"><i class="fa-solid fa-rotate"></i></button></div>
 <div class="strength" style="margin:10px 0 4px"><i id="g-bar"></i></div><div class="small muted" id="g-lbl" style="margin-bottom:16px"></div>
 <div class="field"><label>الطول: <b id="g-len-v">18</b></label><input type="range" id="g-len" min="8" max="40" value="18" style="accent-color:var(--primary)"></div>
 <div class="row wrap" style="gap:16px"><label class="row"><input type="checkbox" class="check" id="g-u" checked> أحرف كبيرة</label><label class="row"><input type="checkbox" class="check" id="g-l" checked> صغيرة</label><label class="row"><input type="checkbox" class="check" id="g-d" checked> أرقام</label><label class="row"><input type="checkbox" class="check" id="g-s" checked> رموز</label></div>`);
    const gen = () => { const o = $("#g-out", wrap); o.value = generatePassword(+$("#g-len", wrap).value, { upper: $("#g-u", wrap).checked, lower: $("#g-l", wrap).checked, digits: $("#g-d", wrap).checked, symbols: $("#g-s", wrap).checked }); const s = passwordStrength(o.value); $("#g-bar", wrap).style.cssText = `width:${s.pct}%;background:${s.color}`; $("#g-lbl", wrap).textContent = "القوة: " + s.label; $("#g-len-v", wrap).textContent = $("#g-len", wrap).value; };
    $$("input", wrap).forEach(i => i.addEventListener("input", () => i.id !== "g-out" && gen()));
    $("#g-new", wrap).onclick = gen; $("#g-copy", wrap).onclick = async () => { await copyText($("#g-out", wrap).value, 20000); toast("تم النسخ", "success"); }; gen();
}

// ---------- تغيير كلمة مرور الحساب ----------
function openChangePass() {
    const { wrap, close } = openModal(`<div class="modal-head"><h3>تغيير كلمة المرور</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
 <div class="field"><label>كلمة المرور الجديدة (8 أحرف على الأقل)</label><input class="input" id="np1" type="password" autocomplete="new-password"></div>
 <div class="field"><label>تأكيد كلمة المرور</label><input class="input" id="np2" type="password" autocomplete="new-password"></div>
 <div class="modal-foot"><button class="btn btn-primary" id="np-go">تحديث</button><button class="btn btn-ghost" data-close>إلغاء</button></div>`);
    $("#np-go", wrap).onclick = async () => {
        const a = $("#np1", wrap).value, b = $("#np2", wrap).value;
        if (a.length < 8) return toast("كلمة المرور يجب ألا تقل عن 8 أحرف", "warn");
        if (a !== b) return toast("كلمتا المرور غير متطابقتين", "warn");
        try { await updatePassword(auth.currentUser, a); toast("تم تغيير كلمة المرور", "success"); close(); }
        catch (er) { toast(friendlyAuthError(er.code), "error"); if (er.code !== "auth/requires-recent-login") logError(er, { context: "updatePassword" }); }
    };
}

// ---------- الإشعارات ----------
let notifs = [], firstNotif = true;
onValue(ref(db, `notifications/${user.uid}`), snap => {
    const v = snap.val() || {}, prev = new Set(notifs.map(n => n.id));
    notifs = Object.entries(v).map(([id, n]) => ({ id, ...n })).sort((a, b) => b.timestamp - a.timestamp);
    const un = notifs.filter(n => !n.read).length, bn = $("#bell-n");
    bn.textContent = un; bn.classList.toggle("hidden", !un);
    if (!firstNotif) notifs.filter(n => !prev.has(n.id)).forEach(n => toast("📢 " + n.message, n.type === "warning" ? "warn" : "info", 7000));
    firstNotif = false;
});
$("#bell-btn").onclick = () => {
    const { wrap } = openModal(`<div class="modal-head"><h3>الإشعارات</h3><button class="icon-btn" data-close><i class="fa-solid fa-xmark"></i></button></div>
 <div id="nl">${notifs.length ? notifs.map(n => `<div class="notif ${esc(n.type || "info")} ${n.read ? "" : "unread"}"><div>${esc(n.message)}</div><div class="muted small" style="margin-top:4px">${timeAgo(n.timestamp)} · إدارة النظام</div></div>`).join("") : '<div class="empty"><i class="fa-regular fa-bell-slash"></i>لا توجد إشعارات</div>'}</div>
 ${notifs.length ? '<div class="modal-foot"><button class="btn btn-ghost btn-sm" id="n-read">تحديد الكل كمقروء</button><button class="btn btn-danger btn-sm" id="n-clear">مسح الكل</button></div>' : ""}`);
    $("#n-read", wrap)?.addEventListener("click", () => { notifs.filter(n => !n.read).forEach(n => update(ref(db, `notifications/${user.uid}/${n.id}`), { read: true }).catch(() => { })); toast("تم", "success"); });
    $("#n-clear", wrap)?.addEventListener("click", () => { notifs.forEach(n => remove(ref(db, `notifications/${user.uid}/${n.id}`)).catch(() => { })); toast("تم المسح", "success"); });
};
