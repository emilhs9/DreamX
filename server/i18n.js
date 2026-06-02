const dictionaries = {
  az: {
    "Authentication required.": "Giriş tələb olunur.",
    "Invalid token type.": "Token tipi yanlışdır.",
    "Account unavailable.": "Hesab əlçatan deyil.",
    "Session expired.": "Sessiyanın vaxtı bitib.",
    "Invalid email or password.": "E-poçt və ya şifrə yanlışdır.",
    "Invalid credentials.": "Məlumatlar yanlışdır.",
    "This account is banned.": "Bu hesab bloklanıb.",
    "Uploaded file is too large.": "Yüklənən fayl çox böyükdür.",
    "Project not found.": "Layihə tapılmadı.",
    "LaunchPad is in maintenance mode.": "DreamX texniki xidmətdədir.",
    "Internal server error.": "Daxili server xətası.",
    "CSRF token is missing or invalid.": "CSRF token yoxdur və ya yanlışdır.",
    "Name is required.": "Ad tələb olunur.",
    "Name must be at least 2 characters.": "Ad ən az 2 simvol olmalıdır.",
    "Name is too long.": "Ad çox uzundur.",
    "Email is required.": "E-poçt tələb olunur.",
    "Enter a valid email address.": "Düzgün e-poçt ünvanı yaz.",
    "Email is too long.": "E-poçt çox uzundur.",
    "Password is required.": "Şifrə tələb olunur.",
    "Password must be at least 8 characters.": "Şifrə ən az 8 simvol olmalıdır.",
    "Password must be at most 128 characters.": "Şifrə ən çox 128 simvol ola bilər.",
    "Password must include uppercase, lowercase, and a number.": "Şifrə böyük hərf, kiçik hərf və rəqəm içərməlidir.",
    "An account with this email already exists.": "Bu e-poçt ilə hesab artıq mövcuddur."
  },
  tr: {
    "Authentication required.": "Oturum açmanız gerekir.",
    "Invalid email or password.": "E-posta veya parola hatalı.",
    "Invalid credentials.": "Geçersiz bilgiler.",
    "This account is banned.": "Bu hesap engellendi.",
    "Uploaded file is too large.": "Yüklenen dosya çok büyük.",
    "Project not found.": "Proje bulunamadı.",
    "Internal server error.": "Sunucu hatası.",
    "Enter a valid email address.": "Geçerli bir e-posta adresi yaz.",
    "Password must include uppercase, lowercase, and a number.": "Parola büyük harf, küçük harf ve rakam içermelidir.",
    "Password must be at least 8 characters.": "Parola en az 8 karakter olmalıdır."
  },
  ru: {
    "Authentication required.": "Требуется вход.",
    "Invalid email or password.": "Неверная почта или пароль.",
    "Invalid credentials.": "Неверные данные.",
    "This account is banned.": "Аккаунт заблокирован.",
    "Uploaded file is too large.": "Файл слишком большой.",
    "Project not found.": "Проект не найден.",
    "Internal server error.": "Внутренняя ошибка сервера.",
    "Enter a valid email address.": "Введите корректный email.",
    "Password must include uppercase, lowercase, and a number.": "Пароль должен содержать заглавную букву, строчную букву и цифру.",
    "Password must be at least 8 characters.": "Пароль должен быть не короче 8 символов."
  },
  ar: {
    "Authentication required.": "تسجيل الدخول مطلوب.",
    "Invalid email or password.": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "Invalid credentials.": "بيانات الدخول غير صحيحة.",
    "This account is banned.": "تم حظر هذا الحساب.",
    "Uploaded file is too large.": "الملف المرفوع كبير جدا.",
    "Project not found.": "المشروع غير موجود.",
    "Internal server error.": "خطأ داخلي في الخادم.",
    "Enter a valid email address.": "أدخل بريدا إلكترونيا صحيحا.",
    "Password must include uppercase, lowercase, and a number.": "يجب أن تحتوي كلمة المرور على حرف كبير وحرف صغير ورقم.",
    "Password must be at least 8 characters.": "يجب ألا تقل كلمة المرور عن 8 أحرف."
  }
};

function preferredLanguage(req) {
  const header = String(req.get("accept-language") || "en").toLowerCase();
  const [first] = header.split(",");
  const code = first.trim().split("-")[0];
  return dictionaries[code] ? code : "en";
}

function translateError(req, message) {
  const language = preferredLanguage(req);
  return dictionaries[language]?.[message] || message;
}

module.exports = { translateError };
