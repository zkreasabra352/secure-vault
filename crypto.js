// تشفير AES عبر CryptoJS (متوافق مع البيانات القديمة: المفتاح = uid المستخدم)
export function encryptData(text, secretKey) {
    return text ? CryptoJS.AES.encrypt(text, secretKey).toString() : "";
}
// يرجع null عند الفشل بدل نص خطأ حتى لا يُحتسب كأنه كلمة مرور
export function decryptData(ciphertext, secretKey) {
    if (!ciphertext) return "";
    try {
        const s = CryptoJS.AES.decrypt(ciphertext, secretKey).toString(CryptoJS.enc.Utf8);
        return s || null;
    } catch { return null; }
}
