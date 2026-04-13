# 📊 دليل قواعد البيانات - منصة إنقاذ حياة

## 🎯 **مفهوم قاعدة البيانات المشتركة**

### **ماذا يعني؟**
```
🌐 منصة ويب واحدة
├── خادم واحد (server.js)
├── قاعدة بيانات واحدة (data/app-data.json)
├── جميع المستخدمين يحفظون بياناتهم في نفس المكان
└── يمكنهم التواصل مع بعضهم
```

---

## 📁 **ملفات قاعدة البيانات**

### **1. data/app-data.json (الملف الرئيسي)**
```json
{
  "users": [
    {
      "id": "user_123456",
      "fullName": "أحمد محمد",
      "email": "ahmed@email.com",
      "password": "$2b$10$hashed_password_here",
      "bloodType": "O+",
      "governorate": "صنعاء",
      "region": "شارع الستين",
      "phone": "+967771234567",
      "showPhone": true,
      "isAvailable": true,
      "hasHealthCondition": false,
      "healthConditions": [],
      "healthNotes": null,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "messages": [
    {
      "id": "msg_123456",
      "from": "user_123456",
      "to": "user_789012",
      "text": "أحتاج متبرع بفصيلة O+ في صنعاء",
      "isUrgent": false,
      "isRead": false,
      "createdAt": "2024-01-01T12:00:00.000Z"
    }
  ]
}
```

---

## 🖥️ **كود الخادم (server.js)**

### **1. إعدادات قاعدة البيانات**
```javascript
const fs = require('fs');
const path = require('path');

// مسار ملف قاعدة البيانات
const DATA_FILE = path.join(__dirname, 'data', 'app-data.json');

// قراءة البيانات من الملف
function readData() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // إذا كان الملف غير موجود، أنشئه
        return { users: [], messages: [] };
    }
}

// حفظ البيانات في الملف
function saveData(data) {
    // تأكد من وجود مجلد data
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
```

### **2. دوال المستخدمين**
```javascript
// الحصول على جميع المستخدمين
function getAllUsers() {
    const data = readData();
    return data.users;
}

// البحث عن مستخدم بالإيميل
function findUserByEmail(email) {
    const data = readData();
    return data.users.find(user => user.email === email);
}

// إضافة مستخدم جديد
function addUser(userData) {
    const data = readData();
    const newUser = {
        id: 'user_' + Date.now(),
        ...userData,
        createdAt: new Date().toISOString()
    };
    data.users.push(newUser);
    saveData(data);
    return newUser;
}

// تحديث بيانات مستخدم
function updateUser(userId, updates) {
    const data = readData();
    const userIndex = data.users.findIndex(user => user.id === userId);
    if (userIndex !== -1) {
        data.users[userIndex] = { ...data.users[userIndex], ...updates };
        saveData(data);
        return data.users[userIndex];
    }
    return null;
}
```

### **3. دوال الرسائل**
```javascript
// الحصول على جميع الرسائل
function getAllMessages() {
    const data = readData();
    return data.messages;
}

// إرسال رسالة جديدة
function addMessage(messageData) {
    const data = readData();
    const newMessage = {
        id: 'msg_' + Date.now(),
        ...messageData,
        createdAt: new Date().toISOString()
    };
    data.messages.push(newMessage);
    saveData(data);
    return newMessage;
}

// الحصول على رسائل مستخدم معين
function getUserMessages(userId) {
    const data = readData();
    return data.messages.filter(msg => 
        msg.from === userId || msg.to === userId
    );
}
```

---

## 🔌 **API Endpoints**

### **1. تسجيل المستخدمين**
```javascript
// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
    try {
        const { fullName, email, password, bloodType, governorate, region, phone } = req.body;
        
        // التحقق من وجود المستخدم
        const existingUser = findUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'المستخدم موجود بالفعل' });
        }
        
        // تشفير كلمة المرور
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // إضافة المستخدم الجديد
        const newUser = addUser({
            fullName,
            email,
            password: hashedPassword,
            bloodType,
            governorate,
            region,
            phone,
            showPhone: true,
            isAvailable: true,
            hasHealthCondition: false,
            healthConditions: [],
            healthNotes: null
        });
        
        // إنشاء توكن JWT
        const token = jwt.sign({ userId: newUser.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.status(201).json({
            message: 'تم التسجيل بنجاح',
            token,
            user: {
                id: newUser.id,
                fullName: newUser.fullName,
                email: newUser.email,
                bloodType: newUser.bloodType,
                governorate: newUser.governorate,
                region: newUser.region,
                phone: newUser.phone,
                showPhone: newUser.showPhone
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'فشل التسجيل' });
    }
});
```

### **2. تسجيل الدخول**
```javascript
// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // البحث عن المستخدم
        const user = findUserByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }
        
        // التحقق من كلمة المرور
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }
        
        // إنشاء توكن JWT
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            message: 'تم تسجيل الدخول بنجاح',
            token,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                bloodType: user.bloodType,
                governorate: user.governorate,
                region: user.region,
                phone: user.phone,
                showPhone: user.showPhone
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'فشل تسجيل الدخول' });
    }
});
```

---

## 🔄 **كيف يعمل النظام**

### **1. عندما يسجل مستخدم جديد:**
```
1. المستخدم يملأ النموذج في index.html
2. JavaScript يرسل البيانات إلى /api/auth/register
3. الخادم يتحقق من البيانات
4. الخادم يشفر كلمة المرور
5. الخادم يحفظ المستخدم في data/app-data.json
6. الخادم يرسل توكن JWT للمتصفح
7. JavaScript يحفظ التوكن في localStorage
```

### **2. عندما يبحث مستخدم عن متبرع:**
```
1. المستخدم يختار الفلاتر في صفحة البحث
2. JavaScript يرسل طلب إلى /api/donors
3. الخادم يقرأ data/app-data.json
4. الخادم يطبق الفلاتر (فصيلة دم، محافظة، عمر)
5. الخادم يرجع النتائج المطابقة
6. JavaScript يعرض النتائج في الصفحة
```

### **3. عندما يرسل مستخدم رسالة:**
```
1. المستخدم يكتب رسالة ويضغط إرسال
2. JavaScript يرسل الرسالة إلى /api/messages
3. الخادم يتحقق من التوكن
4. الخادم يحفظ الرسالة في data/app-data.json
5. الخادم يرسل إشعار للمستخدم المستقبل
6. المستخدم المستقبل يرى الرسالة في صفحة الرسائل
```

---

## 🛡️ **الأمان**

### **1. تشفير كلمات المرور**
```javascript
const bcrypt = require('bcryptjs');
const hashedPassword = await bcrypt.hash(password, 10);
```

### **2. توكنات JWT**
```javascript
const jwt = require('jsonwebtoken');
const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
```

### **3. حماية البيانات**
```javascript
// التحقق من التوكن في كل طلب
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'غير مصرح' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'توكن غير صالح' });
    }
};
```

---

## 🎯 **كيف تستخدم هذا في أي مشروع آخر؟**

### **1. انسخ الملفات الأساسية:**
```
📁 مشروع_جديد/
├── server.js (الخادم)
├── data/
│   └── app-data.json (قاعدة البيانات)
├── routes/
│   ├── auth.js (مسارات المصادقة)
│   ├── donors.js (مسارات المتبرعين)
│   └── messages.js (مسارات الرسائل)
└── package.json (الاعتمادات)
```

### **2. عدل حسب احتياجاتك:**
```javascript
// في server.js - عدل البيانات حسب مشروعك
const users = [
    {
        id: 'user_1',
        fullName: 'اسم المستخدم',
        email: 'user@example.com',
        // ... باقي البيانات حسب مشروعك
    }
];
```

### **3. شغّل الخادم:**
```bash
cd مشروع_جديد
npm install express bcryptjs jsonwebtoken
npm start
```

---

## 📋 **الخلاصة**

### **ماذا يفعل هذا الكود؟**
1. **يحفظ البيانات بشكل دائم** في ملف JSON
2. **يشارك البيانات بين جميع المستخدمين**
3. **يحمي البيانات** بالتشفير والتوكنات
4. **يوفر API** للواجهة الأمامية
5. **يعمل كمنصة ويب حقيقية** مشتركة

### **الميزات الرئيسية:**
- ✅ **تسجيل مستخدمين**
- ✅ **تسجيل دخول آمن**
- ✅ **حفظ بيانات بشكل دائم**
- ✅ **مشاركة البيانات بين المستخدمين**
- ✅ **إرسال رسائل**
- ✅ **بحث وفلترة**
- ✅ **حماية الأمان**

**هذا هو الكود الكامل لقاعدة بيانات مشتركة تعمل كمنصة ويب حقيقية!** 🎉
