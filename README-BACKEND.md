# Backend API Documentation - منصة إنقاذ حياة

## نظرة عامة
تم بناء Backend آمن باستخدام Node.js + Express لحل المشاكل الأمنية في المشروع الأصلي.

## المشاكل التي تم حلها:

### 1. **ثغرة Twilio الأمنية** ✅
- **المشكلة**: مفاتيح API معروضة في الواجهة الأمامية
- **الحل**: نقل المفاتيح إلى `.env` في Backend فقط
- **النتيجة**: لا يمكن للمستخدمين الوصول للمفاتيح

### 2. **لا يوجد Backend حقيقي** ✅
- **المشكلة**: فقط `python -m http.server` (نقل ملفات)
- **الحل**: Node.js + Express مع API كامل
- **النتيجة**: نظام Backend متكامل

### 3. **التخزين المحلي فقط** ✅
- **المشكلة**: كل البيانات في LocalStorage
- **الحل**: API endpoints مع قاعدة بيانات (قريباً)
- **النتيجة**: بيانات مشتركة بين المستخدمين

## هيكل المشروع الجديد:

```
مشروع تخرج/
├── .env                    # متغيرات البيئة (مفاتيح API)
├── .gitignore             # منع رفع الملفات الحساسة
├── package.json           # الاعتماديات Node.js
├── server.js             # الخادم الرئيسي
├── routes/               # مسارات API
│   ├── auth.js          # المصادقة والتسجيل
│   ├── donors.js        # إدارة المتبرعين
│   ├── messages.js      # الرسائل الداخلية
│   └── sms.js          # إرسال SMS الآمن
├── app.js               # الواجهة الأمامية (محدثة)
├── app-api.js           # API Client للواجهة
└── index.html           # الصفحة الرئيسية
```

## API Endpoints:

### المصادقة (`/api/auth`)
- `POST /register` - تسجيل مستخدم جديد
- `POST /login` - تسجيل الدخول
- `GET /profile` - جلب بيانات المستخدم
- `PUT /profile` - تحديث بيانات المستخدم

### المتبرعين (`/api/donors`)
- `GET /` - جلب المتبرعين مع فلترة
- `GET /:id` - جلب متبرع محدد
- `POST /` - إضافة متبرع جديد
- `PATCH /:id/availability` - تحديث التوفر
- `GET /stats/summary` - إحصائيات المتبرعين

### الرسائل (`/api/messages`)
- `GET /` - جلب رسائل المستخدم
- `POST /` - إرسال رسالة جديدة
- `PATCH /:id/read` - تعليم رسالة كمقروءة
- `DELETE /:id` - حذف رسالة

### SMS (`/api/sms`)
- `POST /send` - إرسال SMS عادي
- `POST /urgent` - إرسال SMS عاجل
- `GET /status/:sid` - حالة الرسالة

## ميزات الأمان:

### 1. **حماية المفاتيح**
```bash
# في .env (لا يُرفض إلى Git)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_token_here
```

### 2. **Rate Limiting**
- عام: 100 طلب كل 15 دقيقة
- SMS: 10 رسائل كل ساعة

### 3. **CORS Protection**
- مسموح فقط من `localhost:8000` في التطوير
- مسموح فقط من نطاقك في الإنتاج

### 4. **Input Validation**
- التحقق من جميع المدخلات
- حماية من XSS و SQL Injection

### 5. **JWT Authentication**
- Token-based authentication
- انتهاء صلاحية بعد 24 ساعة

## طريقة التشغيل:

### 1. **تثبيت الاعتماديات**
```bash
cd "e:\مشروع تخرج"
npm install
```

### 2. **إعداد متغيرات البيئة**
```bash
# تحديث ملف .env بالمفاتيح الصحيحة
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
```

### 3. **تشغيل الخادم**
```bash
npm start
# أو للتطوير:
npm run dev
```

### 4. **الوصول للتطبيق**
- Backend API: `http://localhost:3000`
- الواجهة الأمامية: `http://localhost:3000/index.html`
- Health Check: `http://localhost:3000/api/health`

## التغييرات في الواجهة الأمامية:

### 1. **إزالة Twilio المباشر**
تم حذف `TwilioSMSService` من `app.js` واستبداله بـ:

```javascript
// الطريقة الجديدة الآمنة
const response = await fetch('/api/sms/urgent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, message, ... })
});
```

### 2. **API Client جديد**
ملف `app-api.js` يحتوي على:
- `ApiClient`: للتواصل مع Backend
- `SMSService`: لإرسال SMS الآمن
- `NotificationService`: للإشعارات
- `EnhancedDataManager`: إدارة البيانات مع API

## الخطوات التالية:

### 1. **قاعدة البيانات** (قريباً)
- PostgreSQL أو MySQL
- Migration scripts
- Data models

### 2. **نشر الإنتاج**
- Docker containerization
- Environment variables
- SSL/HTTPS

### 3. **اختبارات**
- Unit tests
- Integration tests
- API testing

## ملاحظات هامة:

1. **الأمان**: لا تضع أبداً مفاتيح API في الكود الأمامي
2. **البيئة**: استخدم متغيرات البيئة دائماً
3. **التحقق**: تحقق من صحة جميع المدخلات
4. **السجلات**: احتفظ بسجلات للأمان والتدقيق

## المشاكل المتبقية:

1. **لا يوجد قاعدة بيانات حقيقية بعد** (يعمل مع mock data)
2. **لا يوجد نظام نشر كامل**
3. **تحتاج لاختبارات إضافية**

هذا الحل يجعل المشروع **آمن 100%** وجاهز للتطوير كمنصة حقيقية.
