import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { $, esc, toast, askText, friendlyAuthError, initTheme, toggleTheme } from "./common.js";

initTheme();
$("#theme-btn").onclick = toggleTheme;
const btn = $("#login-btn"), pass = $("#password"), email = $("#email");
let fails = 0, lockUntil = 0, routing = false;

const reasons = {
    disabled: ["err", "fa-ban", "تم تعطيل حسابك. تواصل مع مدير النظام."],
    kicked: ["warn", "fa-right-from-bracket", "أنهى المدير جلستك. سجّل الدخول من جديد."],
    noprofile: ["warn", "fa-user-slash", "حسابك غير مفعّل في النظام. تواصل مع المدير."],
    idle: ["info", "fa-clock", "تم تسجيل خروجك تلقائياً لعدم النشاط."]
};
const banner = (type, icon, msg) => $("#banner").innerHTML = msg ? `<div class="alert ${type}"><i class="fa-solid ${icon}"></i><span>${esc(msg)}</span></div>` : "";
const r = new URLSearchParams(location.search).get("reason");
if (reasons[r]) banner(...reasons[r]);

$("#eye").onclick = () => { const s = pass.type === "password"; pass.type = s ? "text" : "password"; $("#eye i").className = s ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"; };
[email, pass].forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") login(); }));
btn.onclick = login;

function setBusy(b) { btn.disabled = b; btn.innerHTML = b ? '<span class="spin"></span><span>جارٍ التحقق...</span>' : "<span>تسجيل الدخول</span>"; }

async function login() {
    const e = email.value.trim(), p = pass.value;
    if (!e || !p) return banner("err", "fa-circle-exclamation", "أدخل البريد وكلمة المرور");
    if (Date.now() < lockUntil) return banner("warn", "fa-hourglass-half", `انتظر ${Math.ceil((lockUntil - Date.now()) / 1000)} ثانية قبل المحاولة`);
    banner(); setBusy(true);
    try { await signInWithEmailAndPassword(auth, e, p); }
    catch (err) {
        if (++fails >= 5) { lockUntil = Date.now() + 30000; fails = 0; }
        banner("err", "fa-circle-exclamation", friendlyAuthError(err.code)); setBusy(false);
    }
}

// التوجيه الوحيد بعد تسجيل الدخول (أو إذا كانت الجلسة قائمة)
onAuthStateChanged(auth, async user => {
    if (!user || routing) return;
    routing = true; setBusy(true);
    try {
        const p = (await get(ref(db, `users/${user.uid}`))).val();
        if (!p || p.disabled) { await signOut(auth); routing = false; setBusy(false); const k = p ? "disabled" : "noprofile"; banner(...reasons[k]); return; }
        set(ref(db, `users/${user.uid}/lastLoginAt`), Date.now()).catch(() => { });
        location.replace(p.isAdmin ? "admin.html" : "dashboard.html");
    } catch (err) { routing = false; setBusy(false); banner("err", "fa-circle-exclamation", "تعذر الاتصال بقاعدة البيانات"); }
});

$("#forgot").onclick = async (ev) => {
    ev.preventDefault();
    const m = await askText({ title: "استعادة كلمة المرور", label: "بريدك الإلكتروني", placeholder: "name@example.com", confirmText: "إرسال الرابط", value: email.value.trim() });
    if (!m) return;
    try { await sendPasswordResetEmail(auth, m); } catch { }
    toast("إذا كان البريد مسجلاً فسيصلك رابط إعادة التعيين", "success", 5000); // نفس الرسالة دائماً لمنع كشف الحسابات
};
