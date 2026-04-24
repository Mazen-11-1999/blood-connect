// ——— واجهة المنصة ———
const API_BASE = '/api';

async function apiFetch(path, options = {}) {
    const token = localStorage.getItem('bloodConnect_token');
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let res;
    try {
        res = await fetch(API_BASE + path, { ...options, headers });
    } catch (e) {
        const m = e && e.message === 'Failed to fetch'
            ? 'تعذر الاتصال. تحقق من الإنترنت ثم جرّب مرة أخرى بعد لحظات.'
            : (e && e.message) || 'تعذر الاتصال';
        throw new Error(m);
    }
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch (_) {
        data = {};
    }
    if (!res.ok) {
        if (res.status === 429) {
            throw new Error('طلبات كثيرة. انتظر دقيقة ثم حدّث الصفحة.');
        }
        if (res.status >= 502 && res.status <= 504) {
            throw new Error(`الخدمة غير متاحة مؤقتاً (${res.status}). جرّب بعد قليل.`);
        }
        const ct = res.headers && res.headers.get && res.headers.get('content-type');
        const looksJson = ct && ct.includes('application/json');
        let msg = data.error
            || (Array.isArray(data.errors) && data.errors[0] && (data.errors[0].msg || data.errors[0].message));
        if (!msg && text && looksJson) {
            const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
            msg = snippet ? `خطأ ${res.status}: ${snippet}` : `تعذر إكمال الطلب (${res.status})`;
        } else if (!msg) {
            msg = `تعذر إكمال الطلب (${res.status})`;
        }
        if (!msg) msg = `خطأ ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

/** Web Push — إشعار حتى مع إغلاق التبويب (يتطلب إعداد مفاتيح في بيئة التشغيل) */
async function tryRegisterWebPush() {
    const user = dataManager.getCurrentUser();
    if (!user || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
        const r = await fetch('/api/push/vapid-public-key');
        const j = await r.json();
        if (!j.publicKey) return;
        const reg = await navigator.serviceWorker.ready;
        const appKey = urlBase64ToUint8Array(j.publicKey);
        let sub = await reg.pushManager.getSubscription();
        if (sub) {
            const cur = sub.options.applicationServerKey;
            let same = false;
            if (cur && cur.byteLength === appKey.byteLength) {
                same = true;
                for (let i = 0; i < cur.byteLength; i++) {
                    if (cur[i] !== appKey[i]) {
                        same = false;
                        break;
                    }
                }
            }
            if (!same) {
                await sub.unsubscribe();
                sub = null;
            }
        }
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: appKey
            });
        }
        await apiFetch('/push/subscribe', {
            method: 'POST',
            body: JSON.stringify({ subscription: sub.toJSON() })
        });
    } catch (e) {
        console.warn('Web Push:', e);
    }
}

const dataManager = {
    getCurrentUser() {
        const u = localStorage.getItem('bloodConnect_user');
        if (u) {
            try {
                return JSON.parse(u);
            } catch (_) {
                return null;
            }
        }
        const legacy = localStorage.getItem('bloodConnect_currentUser');
        if (!legacy || legacy === 'null') return null;
        try {
            return JSON.parse(legacy);
        } catch (_) {
            return null;
        }
    },

    setSession(user, token) {
        if (token) localStorage.setItem('bloodConnect_token', token);
        localStorage.setItem('bloodConnect_user', JSON.stringify(user));
        localStorage.setItem('bloodConnect_currentUser', JSON.stringify(user));
    },

    clearCurrentUser() {
        localStorage.removeItem('bloodConnect_token');
        localStorage.removeItem('bloodConnect_user');
        localStorage.setItem('bloodConnect_currentUser', JSON.stringify(null));
    },

    async register(payload) {
        const result = await apiFetch('/auth/register', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        this.setSession(result.user, result.token);
        return result.user;
    },

    async login(email, password) {
        const result = await apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        this.setSession(result.user, result.token);
        return result.user;
    },

    async getDonors(filters = {}) {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => {
            if (v !== undefined && v !== null && String(v).trim() !== '') {
                params.set(k, v);
            }
        });
        const q = params.toString();
        const result = await apiFetch('/donors' + (q ? '?' + q : ''));
        return result.donors || [];
    },

    async getDonorById(id) {
        return await apiFetch('/donors/' + encodeURIComponent(id));
    },

    async addMessage(message) {
        const body = {
            senderId: message.senderId,
            recipientId: message.recipientId,
            senderName: message.senderName,
            recipientName: message.recipientName,
            content: message.message,
            message: message.message,
            senderPhone: message.phone || '',
            phone: message.phone,
            isUrgent: !!message.isUrgent,
            urgency: message.isUrgent ? 'urgent' : 'normal',
            neededDateTime: message.neededDateTime || null
        };
        return await apiFetch('/messages', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    },

    async getMessagesForUser(userId) {
        const result = await apiFetch('/messages?userId=' + encodeURIComponent(userId) + '&type=all');
        return result.messages || [];
    },

    async markMessageAsRead(messageId) {
        await apiFetch('/messages/' + encodeURIComponent(messageId) + '/read', { method: 'PATCH' });
        this.updateMessageCount();
    },

    async confirmHelpAsNeedy(messageId) {
        return await apiFetch('/messages/' + encodeURIComponent(messageId) + '/confirm-needy', {
            method: 'PATCH'
        });
    },

    async confirmHelpAsDonor(messageId) {
        return await apiFetch('/messages/' + encodeURIComponent(messageId) + '/confirm-donor', {
            method: 'PATCH'
        });
    },

    async updateDonor(id, updates) {
        const result = await apiFetch('/auth/profile', {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
        if (result.user) {
            this.setSession(result.user, localStorage.getItem('bloodConnect_token'));
            return result.user;
        }
        return null;
    },

    async deleteAccount() {
        await apiFetch('/auth/account', { method: 'DELETE' });
        this.clearCurrentUser();
        return true;
    },

    async getStats() {
        return await apiFetch('/donors/stats/summary');
    },

    /** إن مُرِّرتَ مصفوفة رسائل من طلب سابق، لا يُعاد طلب الشبكة (يُفيد مع pollInboxAndNotifications) */
    updateMessageCount(messagesFromCache) {
        const currentUser = this.getCurrentUser();
        const badge = document.getElementById('messageCount');
        if (!currentUser || !badge) return;
        if (Array.isArray(messagesFromCache)) {
            const n = messagesFromCache.filter(
                m => !m.read && m.recipientId === currentUser.id
            ).length;
            badge.textContent = n;
            badge.style.display = n > 0 ? 'inline' : 'none';
            return;
        }
        apiFetch('/messages?userId=' + encodeURIComponent(currentUser.id) + '&type=all')
            .then(result => {
                const n = result.unreadCount || 0;
                badge.textContent = n;
                badge.style.display = n > 0 ? 'inline' : 'none';
            })
            .catch(() => {});
    }
};

function closeMobileNav() {
    const nav = document.getElementById('mainNavbar');
    const btn = document.getElementById('navMobileToggle');
    if (!nav || !nav.classList.contains('mobile-nav-open')) return;
    nav.classList.remove('mobile-nav-open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

// إدارة الصفحات
function showPage(pageId, clickedElement) {
    // إخفاء جميع الصفحات
    const pages = document.querySelectorAll('.page');
    if (pages && pages.length > 0) {
        pages.forEach(page => {
            if (page && page.classList) {
                page.classList.remove('active');
            }
        });
    }

    // إظهار الصفحة المطلوبة
    const page = document.getElementById(pageId);
    if (page) {
        try {
            if (page.classList && typeof page.classList.add === 'function') {
                page.classList.add('active');
            }
        } catch (error) {
            console.error('خطأ في إظهار الصفحة:', error);
        }
    }

    // تحديث الروابط النشطة
    const navLinks = document.querySelectorAll('.nav-link');
    if (navLinks && navLinks.length > 0) {
        navLinks.forEach(link => {
            if (link && link.classList) {
                link.classList.remove('active');
            }
        });
    }

    // تحديث الرابط النشط إذا تم النقر عليه
    if (clickedElement && clickedElement.classList && typeof clickedElement.classList.add === 'function') {
        clickedElement.classList.add('active');
    } else {
        // البحث عن الرابط المناسب للصفحة
        if (navLinks && navLinks.length > 0) {
            navLinks.forEach(link => {
                if (link && link.getAttribute) {
                    const onclickAttr = link.getAttribute('onclick');
                    if (onclickAttr && onclickAttr.includes(`'${pageId}'`)) {
                        if (link.classList && typeof link.classList.add === 'function') {
                            link.classList.add('active');
                        }
                    }
                }
            });
        }
    }

    if (pageId === 'home') {
        if (typeof startAnnouncementCarousel === 'function') {
            startAnnouncementCarousel();
        }
        if (typeof startAwarenessCardQuotes === 'function') {
            startAwarenessCardQuotes();
        }
        if (typeof startHomeSpiritQuoteRotation === 'function') {
            startHomeSpiritQuoteRotation();
        }
        if (typeof initGiveHeroSlider === 'function') {
            initGiveHeroSlider();
        }
    } else {
        if (typeof stopAnnouncementCarousel === 'function') {
            stopAnnouncementCarousel();
        }
        if (typeof stopAwarenessCardQuotes === 'function') {
            stopAwarenessCardQuotes();
        }
        if (typeof stopHomeSpiritQuoteRotation === 'function') {
            stopHomeSpiritQuoteRotation();
        }
        if (typeof stopGiveHeroAutoplay === 'function') {
            stopGiveHeroAutoplay();
        }
    }

    if (pageId === 'heroes') {
        if (typeof startHeroesEncouragementRotation === 'function') {
            startHeroesEncouragementRotation();
        }
    } else if (typeof stopHeroesEncouragementRotation === 'function') {
        stopHeroesEncouragementRotation();
    }

    // تحميل محتوى الصفحة
    try {
        if (typeof loadPageContent === 'function') {
            loadPageContent(pageId);
        }
    } catch (error) {
        console.error('خطأ في تحميل محتوى الصفحة:', error);
    }

    if (typeof closeMobileNav === 'function') {
        closeMobileNav();
    }
}

function loadPageContent(pageId) {
    try {
        switch (pageId) {
            case 'home':
                if (typeof updateHomeStats === 'function') {
                    updateHomeStats();
                }
                // إعادة تشغيل السلايدر عند العودة للصفحة الرئيسية
                setTimeout(() => {
                    if (typeof initSlider === 'function') {
                        initSlider();
                    }
                }, 100);
                break;
            case 'search':
                // إيقاف السلايدر عند مغادرة الصفحة الرئيسية
                if (typeof stopSlider === 'function') {
                    stopSlider();
                }
                break;
            case 'messages':
                if (typeof stopSlider === 'function') {
                    stopSlider();
                }
                if (typeof loadMessages === 'function') {
                    loadMessages();
                }
                break;
            case 'profile':
                if (typeof stopSlider === 'function') {
                    stopSlider();
                }
                if (typeof loadProfile === 'function') {
                    loadProfile();
                }
                break;
            case 'register':
                if (typeof stopSlider === 'function') {
                    stopSlider();
                }
                break;
            case 'login':
                if (typeof stopSlider === 'function') {
                    stopSlider();
                }
                break;
            case 'heroes':
                if (typeof stopSlider === 'function') {
                    stopSlider();
                }
                if (typeof stopHeroImagesSlider === 'function') {
                    stopHeroImagesSlider();
                }
                setTimeout(() => {
                    if (typeof initHeroImagesSlider === 'function') {
                        initHeroImagesSlider();
                    }
                }, 100);
                break;
            case 'heroesGallery':
                if (typeof stopSlider === 'function') {
                    stopSlider();
                }
                if (typeof stopHeroImagesSlider === 'function') {
                    stopHeroImagesSlider();
                }
                if (typeof loadHeroesGallery === 'function') {
                    setTimeout(() => {
                        loadHeroesGallery();
                    }, 100);
                }
                break;
        }
    } catch (error) {
        console.error('خطأ في loadPageContent:', error);
    }
}

/** أرقام بالعربية (تنسيق محلي) — يتعامل مع 0 وNaN بشكل صحيح */
function formatArNumber(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '٠';
    try {
        return x.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
    } catch {
        return String(Math.trunc(x));
    }
}

/** بعد الشريحة/العبارة (ميلي ثانية) — اضبطها هنا لإبطاء التنقل */
const MS_ANNOUNCEMENT_CAROUSEL = 6000;
const MS_AWARENESS_CARD_TAGLINE = 6000;
const MS_HERO_MAIN_SLIDER = 8000;
const MS_GO_TO_SLIDE_RESUME = 5000;
const MS_REGISTER_SUCCESS_QUOTE = 5500;
/** فحص صندوق الرسائل + الشارة + إشعارات المتصفح — طلب واحد كل فترة (لا تكرار كل ثانيتين) */
const POLL_INBOX_MS = 30000;

/** متبرع واحد → «متبرعاً»، وإلا «متبرعين» */
function arDonorWordForCount(n) {
    const x = Math.floor(Number(n)) || 0;
    return x === 1 ? 'متبرعاً' : 'متبرعين';
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatHeroLocation(governorate, region) {
    const g = String(governorate || '').trim();
    const r = String(region || '').trim();
    if (g && r) return `${g} — ${r}`;
    if (g) return g;
    if (r) return r;
    return '—';
}

/** إجمالي المتبرعين في سطر المنصة */
function arTotalDonorsLabel(n) {
    const x = Math.max(0, Math.floor(Number(n)) || 0);
    if (x === 0) return `${formatArNumber(0)} متبرع مسجّل`;
    if (x === 1) return `${formatArNumber(1)} متبرع مسجّل`;
    return `${formatArNumber(x)} متبرعين مسجّلين`;
}

let awarenessBarInitialized = false;

const LS_STATS_EXIT = 'bc_stats_last_exit_v1';
const SS_STATS_PREV = 'bc_stats_prev_poll_v1';

/** آخر إحصائيات لحفظها عند مغادرة الصفحة (مقارنة الزيارات) */
let lastStatsSnapshot = null;
/** يُعرض فرق «منذ آخر زيارة» مرة واحدة لكل تحميل للصفحة */
let motivationalVisitDeltaShown = false;

/** شرائح الإعلان التوعوي (مدة البقاء: `MS_ANNOUNCEMENT_CAROUSEL`) */
const ANNOUNCEMENT_SLIDES = [
    {
        tag: 'صدقة جارية بضغطة زر',
        body: 'تسجيلك وتطوعك قد يكتب لك به أجرٌ مستمر ما دامت هذه المنصة تنقذ الأرواح.'
    },
    {
        tag: 'وَمَنْ تَطَوَّعَ خَيْرًا فَإِنَّ اللَّهَ شَاكِرٌ عَلِيمٌ',
        body: 'استشعر شكر الله لك على هذه الخطوة البسيطة.'
    },
    {
        tag: 'خبيئة صالحة',
        body: 'اجعل تسجيلك في هذا الموقع عملاً بينك وبين الله، تدخره ليوم لا ينفع فيه مال ولا بنون.'
    },
    {
        tag: 'تفريج كربة',
        body: 'قال ﷺ: (مَن فرَّج عن مسلمٍ كُربةً، فرَّج اللهُ عنه كُربةً من كُربِ يومِ القيامة)؛ تخيّل عظم الأجر عندما تفرّج كربة مريض يبحث عن حياة.'
    },
    {
        tag: 'كل ٣ ثوانٍ يحتاج شخص لنقل دم',
        body: 'تبرعك يصنع الفارق — سجّل وكن جزءاً من شبكة الأمل.'
    }
];

let announcementCarouselInterval = null;
let announcementSlideIndex = 0;

function renderAnnouncementSlide(index) {
    const slides = ANNOUNCEMENT_SLIDES;
    const tagEl = document.getElementById('announcementTagline');
    const bodyEl = document.getElementById('announcementBody');
    const dots = document.querySelectorAll('#announcementDots button');
    if (!tagEl || !bodyEl) return;
    const i = ((index % slides.length) + slides.length) % slides.length;
    const s = slides[i];
    tagEl.textContent = s.tag;
    bodyEl.textContent = s.body;
    dots.forEach((d, di) => d.classList.toggle('is-active', di === i));
}

function restartAnnouncementInterval() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (announcementCarouselInterval) clearInterval(announcementCarouselInterval);
    announcementCarouselInterval = setInterval(() => {
        announcementSlideIndex = (announcementSlideIndex + 1) % ANNOUNCEMENT_SLIDES.length;
        renderAnnouncementSlide(announcementSlideIndex);
    }, MS_ANNOUNCEMENT_CAROUSEL);
}

function startAnnouncementCarousel() {
    if (window.__announcementCarouselActive) return;
    window.__announcementCarouselActive = true;

    const dotsWrap = document.getElementById('announcementDots');
    if (dotsWrap && dotsWrap.children.length === 0) {
        ANNOUNCEMENT_SLIDES.forEach((_, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('aria-label', `شريحة ${i + 1}`);
            b.addEventListener('click', () => {
                announcementSlideIndex = i;
                renderAnnouncementSlide(i);
                restartAnnouncementInterval();
            });
            dotsWrap.appendChild(b);
        });
    }

    announcementSlideIndex = 0;
    renderAnnouncementSlide(0);

    const stripEl = document.getElementById('motivationalStrip');
    if (stripEl) stripEl.classList.add('announcement-bar--loaded');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    restartAnnouncementInterval();
}

function stopAnnouncementCarousel() {
    window.__announcementCarouselActive = false;
    if (announcementCarouselInterval) {
        clearInterval(announcementCarouselInterval);
        announcementCarouselInterval = null;
    }
}

/** عبارات قصيرة دوّارة داخل بطاقة الهدف (`MS_AWARENESS_CARD_TAGLINE`) */
const AWARENESS_CARD_TAGLINES = [
    'صدقة جارية بضغطة زر — أجرٌ قد يستمر بما دامت أرواحٌ تُنقذ.',
    'قطرة دم تروي أملاً — كن سبباً فيها.',
    'تفريج كربة مريض بحث عن حياة — أجرٌ عظيم عند الله.',
    'معاً نبلغ أبعد — كل اسم جديد يحمل أملاً لغيره.'
];

let awarenessCardQuoteInterval = null;
let awarenessCardQuoteIndex = 0;

function renderAwarenessCardTagline(i) {
    const el = document.getElementById('awarenessCardTagline');
    if (!el) return;
    const lines = AWARENESS_CARD_TAGLINES;
    const idx = ((i % lines.length) + lines.length) % lines.length;
    el.textContent = lines[idx];
    el.classList.remove('awareness-tagline--flash');
    void el.offsetWidth;
    el.classList.add('awareness-tagline--flash');
}

function restartAwarenessCardQuoteInterval() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (awarenessCardQuoteInterval) clearInterval(awarenessCardQuoteInterval);
    awarenessCardQuoteInterval = setInterval(() => {
        awarenessCardQuoteIndex = (awarenessCardQuoteIndex + 1) % AWARENESS_CARD_TAGLINES.length;
        renderAwarenessCardTagline(awarenessCardQuoteIndex);
    }, MS_AWARENESS_CARD_TAGLINE);
}

function startAwarenessCardQuotes() {
    if (window.__awarenessCardQuotesActive) return;
    window.__awarenessCardQuotesActive = true;
    awarenessCardQuoteIndex = 0;
    renderAwarenessCardTagline(0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    restartAwarenessCardQuoteInterval();
}

function stopAwarenessCardQuotes() {
    window.__awarenessCardQuotesActive = false;
    if (awarenessCardQuoteInterval) {
        clearInterval(awarenessCardQuoteInterval);
        awarenessCardQuoteInterval = null;
    }
}

/** جمل تشجيعية — الصفحة الرئيسية + نافذة نجاح التسجيل */
const SPIRIT_ENCOURAGEMENT_QUOTES = [
    'كن واحداً من صناع الحياة',
    'ومن أحياها فكأنما أحيا الناس جميعاً.. أجرك عند الله لا يضيع.',
    'صدقةٌ جارية، ونبضٌ يبقى.. هنيئاً لقلوبٍ اختارها الله لتكون سبباً في حياة الآخرين.',
    'في كل قطرةٍ بذلتها، أجرٌ يسبقك إلى جنات النعيم.',
    'عطاءٌ يُرى أثره في الدنيا، ويُجنى ثوابه في الآخرة.. جزاكم الله خيراً.',
    'ما نقص مالٌ من صدقة، وما نقص جسدٌ من بذل.. فكيف إذا كان البذلُ حياة؟',
    'يوم القيامة.. ستجدون عطاءكم نوراً يسعى بين أيديكم.',
    'تبرعكم للدم هو تجارةٌ رابحة مع الله.. والله لا يخلف الميعاد.',
    'جعلكم الله مفاتيح للخير، مغاليق للشر.. وأثابكم خير الجزاء.'
];

const REGISTER_SUCCESS_QUOTES = SPIRIT_ENCOURAGEMENT_QUOTES;

let registerSuccessQuoteInterval = null;
let homeSpiritQuoteTimer = null;

function openRegisterSuccessModal() {
    const modal = document.getElementById('registerSuccessModal');
    const quoteEl = document.getElementById('registerSuccessQuote');
    if (!modal) return;
    let qi = 0;
    if (quoteEl) {
        quoteEl.textContent = REGISTER_SUCCESS_QUOTES[0];
        if (registerSuccessQuoteInterval) clearInterval(registerSuccessQuoteInterval);
        registerSuccessQuoteInterval = null;
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            registerSuccessQuoteInterval = setInterval(() => {
                qi = (qi + 1) % REGISTER_SUCCESS_QUOTES.length;
                quoteEl.textContent = REGISTER_SUCCESS_QUOTES[qi];
            }, MS_REGISTER_SUCCESS_QUOTE);
        }
    }
    modal.classList.add('active');
}

function closeRegisterSuccessModal() {
    const modal = document.getElementById('registerSuccessModal');
    if (registerSuccessQuoteInterval) {
        clearInterval(registerSuccessQuoteInterval);
        registerSuccessQuoteInterval = null;
    }
    if (modal) modal.classList.remove('active');
}

const MS_HOME_SPIRIT_QUOTE = 9000;

function startHomeSpiritQuoteRotation() {
    const el = document.getElementById('homeSpiritLine');
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = SPIRIT_ENCOURAGEMENT_QUOTES[0];
        return;
    }
    stopHomeSpiritQuoteRotation();
    let idx = 0;
    el.textContent = SPIRIT_ENCOURAGEMENT_QUOTES[0];
    homeSpiritQuoteTimer = setInterval(() => {
        idx = (idx + 1) % SPIRIT_ENCOURAGEMENT_QUOTES.length;
        el.classList.add('is-transitioning');
        setTimeout(() => {
            el.textContent = SPIRIT_ENCOURAGEMENT_QUOTES[idx];
            el.classList.remove('is-transitioning');
        }, 240);
    }, MS_HOME_SPIRIT_QUOTE);
}

function stopHomeSpiritQuoteRotation() {
    if (homeSpiritQuoteTimer) {
        clearInterval(homeSpiritQuoteTimer);
        homeSpiritQuoteTimer = null;
    }
}

/** سلايدر العطاء — أعلى الصفحة الرئيسية */
let giveHeroSlideIdx = 0;
let giveHeroTimer = null;
let giveHeroScrollBound = false;
let giveHeroScrollRaf = 0;
let giveHeroHasPainted = false;

function giveHeroApplySlide(index, direction) {
    const root = document.getElementById('giveHeroSlider');
    if (!root) return;
    const slides = root.querySelectorAll('.give-slide');
    const dots = root.querySelectorAll('.give-hero-dot');
    if (slides.length === 0) return;
    const n = slides.length;
    const i = ((index % n) + n) % n;
    const dir =
        direction === 1 || direction === -1 || direction === 0 ? direction : 0;
    slides.forEach((s, j) => {
        const on = j === i;
        s.classList.toggle('active', on);
        s.setAttribute('aria-hidden', on ? 'false' : 'true');
        s.classList.remove('give-slide--enter-next', 'give-slide--enter-prev');
        const bg = s.querySelector('.give-slide-bg');
        if (bg) {
            bg.classList.toggle(
                'give-slide-bg--animating',
                on && s.classList.contains('give-slide--photo') && !s.classList.contains('give-slide--full-banner')
            );
        }
    });
    const allowEnter =
        giveHeroHasPainted &&
        dir !== 0 &&
        typeof window.matchMedia === 'function' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (allowEnter) {
        const el = slides[i];
        if (dir === 1) {
            el.classList.add('give-slide--enter-next');
        } else {
            el.classList.add('give-slide--enter-prev');
        }
        window.setTimeout(() => {
            el.classList.remove('give-slide--enter-next', 'give-slide--enter-prev');
        }, 700);
    }
    dots.forEach((d, j) => {
        d.classList.toggle('active', j === i);
        d.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    const activeDot = dots[i];
    if (activeDot && typeof activeDot.scrollIntoView === 'function') {
        const reduceMot =
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        try {
            activeDot.scrollIntoView({
                block: 'nearest',
                inline: 'center',
                behavior: reduceMot ? 'auto' : 'smooth'
            });
        } catch {
            activeDot.scrollIntoView(reduceMot);
        }
    }
    const cur = slides[i];
    root.classList.toggle('give-hero-slider--verse', !!(cur && cur.classList.contains('give-slide--verse')));
    giveHeroSlideIdx = i;
}

function restartGiveHeroAutoplay() {
    stopGiveHeroAutoplay();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    giveHeroTimer = setInterval(() => {
        giveHeroApplySlide(giveHeroSlideIdx + 1, 1);
    }, 7000);
}

function stopGiveHeroAutoplay() {
    if (giveHeroTimer) {
        clearInterval(giveHeroTimer);
        giveHeroTimer = null;
    }
}

function initGiveHeroTouchOnce() {
    const root = document.getElementById('giveHeroSlider');
    if (!root || root.dataset.giveTouchBound === '1') return;
    root.dataset.giveTouchBound = '1';
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const threshold = 52;

    const endSwipeVisual = () => {
        root.classList.remove('give-hero-slider--touch-active', 'give-hero-slider--swiping');
        root.style.removeProperty('--give-swipe-px');
    };

    root.addEventListener(
        'touchstart',
        (e) => {
            const t = e.touches && e.touches[0];
            if (!t) return;
            startX = t.screenX;
            startY = t.screenY;
            tracking = true;
            root.classList.add('give-hero-slider--touch-active');
        },
        { passive: true }
    );
    root.addEventListener(
        'touchmove',
        (e) => {
            if (!tracking) return;
            const t = e.touches && e.touches[0];
            if (!t) return;
            const dx = t.screenX - startX;
            const dy = t.screenY - startY;
            if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
            root.classList.add('give-hero-slider--swiping');
            const max = 88;
            const damp = 0.42;
            const clamped = Math.max(-max, Math.min(max, dx * damp));
            root.style.setProperty('--give-swipe-px', `${clamped}px`);
        },
        { passive: true }
    );
    root.addEventListener(
        'touchcancel',
        () => {
            tracking = false;
            endSwipeVisual();
        },
        { passive: true }
    );
    root.addEventListener(
        'touchend',
        (e) => {
            tracking = false;
            const ct = e.changedTouches && e.changedTouches[0];
            if (!ct) {
                endSwipeVisual();
                return;
            }
            const endX = ct.screenX;
            const dx = endX - startX;
            endSwipeVisual();
            if (Math.abs(dx) < threshold) return;
            if (dx < 0) {
                giveHeroStep(1);
            } else {
                giveHeroStep(-1);
            }
        },
        { passive: true }
    );
}

function bindGiveHeroScrollEffect() {
    const root = document.getElementById('giveHeroSlider');
    if (!root || giveHeroScrollBound) return;
    giveHeroScrollBound = true;

    const updateShift = () => {
        giveHeroScrollRaf = 0;
        const rect = root.getBoundingClientRect();
        const viewportH = window.innerHeight || document.documentElement.clientHeight || 1;
        const centerDelta = rect.top + rect.height / 2 - viewportH / 2;
        const maxShift = 16;
        const shift = Math.max(-maxShift, Math.min(maxShift, (-centerDelta / viewportH) * 22));
        root.style.setProperty('--give-scroll-shift', `${shift.toFixed(2)}px`);
    };

    const onScrollLike = () => {
        if (giveHeroScrollRaf) return;
        giveHeroScrollRaf = requestAnimationFrame(updateShift);
    };

    window.addEventListener('scroll', onScrollLike, { passive: true });
    window.addEventListener('resize', onScrollLike);
    updateShift();
}

function initGiveHeroSlider() {
    const root = document.getElementById('giveHeroSlider');
    if (!root) return;
    initGiveHeroTouchOnce();
    bindGiveHeroScrollEffect();
    if (root.dataset.giveNavBound !== '1') {
        root.dataset.giveNavBound = '1';
        root.addEventListener('mouseenter', stopGiveHeroAutoplay);
        root.addEventListener('mouseleave', restartGiveHeroAutoplay);
        root.addEventListener('focusin', stopGiveHeroAutoplay);
        root.addEventListener('focusout', restartGiveHeroAutoplay);
        root.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                giveHeroStep(1);
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                giveHeroStep(-1);
                return;
            }
            if (e.key === 'Home') {
                e.preventDefault();
                giveHeroGoTo(0);
                return;
            }
            if (e.key === 'End') {
                e.preventDefault();
                const slides = root.querySelectorAll('.give-slide');
                if (slides.length > 0) {
                    giveHeroGoTo(slides.length - 1);
                }
            }
        });
    }
    giveHeroApplySlide(0, 0);
    requestAnimationFrame(() => {
        giveHeroHasPainted = true;
    });
    restartGiveHeroAutoplay();
}

function giveHeroStep(delta) {
    const d = delta > 0 ? 1 : -1;
    giveHeroApplySlide(giveHeroSlideIdx + delta, d);
    restartGiveHeroAutoplay();
}

function giveHeroGoTo(index) {
    const root = document.getElementById('giveHeroSlider');
    if (!root) return;
    const slides = root.querySelectorAll('.give-slide');
    const n = slides.length;
    if (n === 0) return;
    const t = ((index % n) + n) % n;
    if (t === giveHeroSlideIdx) {
        restartGiveHeroAutoplay();
        return;
    }
    const forward = (t - giveHeroSlideIdx + n) % n;
    const backward = (giveHeroSlideIdx - t + n) % n;
    const dir = forward <= backward ? 1 : -1;
    giveHeroApplySlide(t, dir);
    restartGiveHeroAutoplay();
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopGiveHeroAutoplay();
        stopHeroesCarouselAutoplay();
    } else {
        const home = document.getElementById('home');
        if (home && home.classList.contains('active')) {
            restartGiveHeroAutoplay();
        }
        const heroesPage = document.getElementById('heroes');
        if (heroesPage && heroesPage.classList.contains('active')) {
            restartHeroesCarouselAutoplay();
        }
    }
});

/**
 * سطر إجمالي المنصة + فروق الزيارة/التحديث (الإعلان المتحرك يُدار بـ startAnnouncementCarousel).
 */
function updateMotivationalStrip(stats) {
    const platformEl = document.getElementById('motivationalPlatformLine');
    const subEl = document.getElementById('motivationalStripSub');
    const stripEl = document.getElementById('motivationalStrip');
    if (!platformEl || !stats) return;

    const a = stats.awareness || {};
    const monthCount = Number(a.donorsRegisteredThisMonth) || 0;
    const totalDonors = Number(stats.totalDonors) || 0;
    const totalMsg = Number(stats.totalMessages) || 0;
    const matches = Number(stats.successfulMatches) || 0;

    const platformLine = `إجمالي المنصة: ${arTotalDonorsLabel(totalDonors)} · ${formatArNumber(totalMsg)} طلب مساعدة · ${formatArNumber(matches)} تأكيد مزدوج ناجح.`;
    platformEl.textContent = platformLine;

    const subParts = [];

    if (!motivationalVisitDeltaShown) {
        try {
            const prevExit = JSON.parse(localStorage.getItem(LS_STATS_EXIT) || 'null');
            if (prevExit && typeof prevExit.totalDonors === 'number') {
                const dD = totalDonors - prevExit.totalDonors;
                const dM = matches - (prevExit.matches || 0);
                if (dD > 0 || dM > 0) {
                    const bits = [];
                    if (dD > 0) {
                        bits.push(
                            `+<strong>${formatArNumber(dD)}</strong> ${dD === 1 ? 'متبرعاً' : 'متبرعين'} على المنصة`
                        );
                    }
                    if (dM > 0) {
                        bits.push(`+<strong>${formatArNumber(dM)}</strong> تأكيداً مزدوجاً ناجحاً`);
                    }
                    subParts.push(`منذ آخر زيارة لك للموقع: ${bits.join('، و')}.`);
                }
            }
        } catch (_) {
            /* ignore */
        }
        motivationalVisitDeltaShown = true;
    }

    try {
        const prevPoll = JSON.parse(sessionStorage.getItem(SS_STATS_PREV) || 'null');
        if (prevPoll && typeof prevPoll.totalDonors === 'number') {
            const dD = totalDonors - prevPoll.totalDonors;
            const dMonth = monthCount - (prevPoll.monthCount || 0);
            if (dD > 0 || dMonth > 0) {
                const bits = [];
                if (dD > 0) {
                    bits.push(
                        `+<strong>${formatArNumber(dD)}</strong> ${dD === 1 ? 'متبرعاً' : 'متبرعين'} على المنصة`
                    );
                }
                if (dMonth > 0) {
                    bits.push(`+<strong>${formatArNumber(dMonth)}</strong> تسجيلاً هذا الشهر`);
                }
                subParts.push(`منذ آخر تحديث للصفحة: ${bits.join('، و')}.`);
            }
        }
    } catch (_) {
        /* ignore */
    }

    try {
        sessionStorage.setItem(
            SS_STATS_PREV,
            JSON.stringify({
                totalDonors,
                monthCount,
                matches,
                t: Date.now()
            })
        );
    } catch (_) {
        /* ignore */
    }

    if (subEl) {
        if (subParts.length) {
            subEl.innerHTML = subParts.join('<br>');
            subEl.hidden = false;
        } else {
            subEl.innerHTML = '';
            subEl.hidden = true;
        }
    }

    lastStatsSnapshot = stats;
    if (stripEl) {
        stripEl.classList.add('announcement-bar--loaded');
    }
}

window.addEventListener('pagehide', () => {
    if (!lastStatsSnapshot) return;
    try {
        const awareness = lastStatsSnapshot.awareness || {};
        localStorage.setItem(
            LS_STATS_EXIT,
            JSON.stringify({
                totalDonors: lastStatsSnapshot.totalDonors ?? 0,
                matches: lastStatsSnapshot.successfulMatches ?? 0,
                totalMessages: lastStatsSnapshot.totalMessages ?? 0,
                monthCount: awareness.donorsRegisteredThisMonth ?? 0,
                t: Date.now()
            })
        );
    } catch (_) {
        /* ignore */
    }
});

/** بطاقة الهدف — نصوص بشرية وأرقام واضحة من الاستجابة */
function updateAwarenessFromStats(stats) {
    const a = stats && stats.awareness;
    const subtitleEl = document.getElementById('awarenessGoalSubtitle');
    const fillEl = document.getElementById('awarenessProgressFill');
    const labelEl = document.getElementById('awarenessProgressLabel');
    const barEl = document.getElementById('awarenessProgressBar');
    const footerEl = document.getElementById('awarenessWeekFooter');
    const cardEl = document.getElementById('awarenessGoalCard');
    const tipEl = document.getElementById('awarenessGoalTip');
    if (!a || !subtitleEl || !fillEl || !labelEl || !footerEl) return;

    const goal = Number(a.monthlyGoal);
    const goalSafe = Number.isFinite(goal) && goal > 0 ? goal : 500;
    const monthCount = Math.max(0, Number(a.donorsRegisteredThisMonth) || 0);
    const weekCount = Math.max(0, Number(a.donorsRegisteredThisWeek) || 0);
    const pct = Math.min(100, Math.max(0, Number(a.monthlyProgressPercent) || 0));
    const goalMet = monthCount >= goalSafe && goalSafe > 0;

    const g = formatArNumber(goalSafe);
    const m = formatArNumber(monthCount);

    if (goalMet) {
        subtitleEl.innerHTML =
            `هذا الشهر: سجّل معنا <strong>${m}</strong> ${arDonorWordForCount(monthCount)} — بفضل الله ثم بكم تحقّق هدفنا البالغ <strong>${g}</strong> متبرعاً جديداً.`;
        if (tipEl) {
            tipEl.textContent = 'بارك الله فيكم — شاركوا الرابط مع من تحبون ليوسّع الخير أثره.';
        }
    } else if (monthCount === 0) {
        subtitleEl.innerHTML =
            `نسعى معاً إلى <strong>${g}</strong> متبرعاً جديداً هذا الشهر. كن أول من يترك بصمة خير معنا.`;
        if (tipEl) {
            tipEl.textContent = 'ادعُ أهلك وأصدقاءك — الخير يكبر حين يتعدّد.';
        }
    } else {
        subtitleEl.innerHTML =
            `هدفنا هذا الشهر: <strong>${g}</strong> متبرعاً جديداً — وسجّل معنا حتى الآن <strong>${m}</strong> ${arDonorWordForCount(monthCount)}.`;
        if (tipEl) {
            tipEl.textContent = 'شارك الرابط مع من تحب — معاً نكمل الطريق إلى الهدف.';
        }
    }

    if (cardEl) {
        cardEl.classList.toggle('awareness-goal-card--complete', goalMet);
    }
    fillEl.classList.toggle('awareness-progress-fill--complete', goalMet);

    if (barEl) {
        barEl.setAttribute('aria-valuenow', String(Math.min(100, pct)));
    }

    const applyWidth = () => {
        fillEl.style.width = `${Math.min(100, pct)}%`;
    };

    if (!awarenessBarInitialized) {
        fillEl.style.width = '0%';
        awarenessBarInitialized = true;
        requestAnimationFrame(() => requestAnimationFrame(applyWidth));
    } else {
        applyWidth();
    }

    if (goalMet) {
        labelEl.textContent = 'اكتمل الهدف — بفضل الله ثم تبرعكم';
    } else {
        labelEl.textContent = `${formatArNumber(pct)}٪ من الهدف الشهري`;
    }

    if (goalMet) {
        footerEl.innerHTML =
            `شكراً لـ <strong>${m}</strong> ${arDonorWordForCount(monthCount)} معنا هذا الشهر — أنتم من يصنع الفرق.` +
            (weekCount > 0
                ? `<br><span class="awareness-footer-note">هذا الأسبوع انضمّ <strong>${formatArNumber(
                      weekCount
                  )}</strong> ${arDonorWordForCount(weekCount)} منهم.</span>`
                : '');
    } else if (weekCount === 0) {
        footerEl.textContent = 'هذا الأسبوع: كن أول من يضيف بصمة خير جديدة.';
    } else {
        footerEl.innerHTML = `هذا الأسبوع انضمّ <strong>${formatArNumber(
            weekCount
        )}</strong> ${arDonorWordForCount(weekCount)} — شكراً لكم.`;
    }
}

// تحديث إحصائيات الصفحة الرئيسية
async function updateHomeStats() {
    try {
        const stats = await apiFetch('/donors/stats/summary');
        document.getElementById('totalDonors').textContent = stats.totalDonors ?? 0;
        document.getElementById('totalRequests').textContent = stats.totalMessages ?? 0;
        document.getElementById('totalMatches').textContent = stats.successfulMatches ?? 0;
        updateAwarenessFromStats(stats);
        updateMotivationalStrip(stats);
    } catch (e) {
        console.warn('تعذر تحميل الإحصائيات. تحقق من الاتصال.', e);
    }
}

// إظهار/إخفاء تفاصيل الحالة الصحية
function toggleHealthDetails() {
    const hasCondition = document.getElementById('hasHealthCondition').value;
    const healthSection = document.getElementById('healthDetailsSection');
    const healthNotes = document.getElementById('healthNotes');
    const healthCheckboxes = document.querySelectorAll('input[name="healthConditions"]');

    if (hasCondition === 'yes') {
        healthSection.style.display = 'block';
    } else {
        healthSection.style.display = 'none';
        // إلغاء تحديد جميع الخيارات
        healthCheckboxes.forEach(cb => cb.checked = false);
        if (healthNotes) {
            healthNotes.value = '';
        }
    }
}

// قوائم المحافظات من yemen-governorates.js (بدون سقطرى) — المنطقة نص حر في #region
document.addEventListener('DOMContentLoaded', function () {
    populateSearchGovernorates();
    document.getElementById('navMobileToggle')?.addEventListener('click', function () {
        const nav = document.getElementById('mainNavbar');
        if (!nav) return;
        const open = nav.classList.toggle('mobile-nav-open');
        this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    window.addEventListener(
        'resize',
        function () {
            if (window.innerWidth > 768 && typeof closeMobileNav === 'function') {
                closeMobileNav();
            }
        },
        { passive: true }
    );
    document.getElementById('navQrLink')?.addEventListener('click', function () {
        if (window.innerWidth <= 768 && typeof closeMobileNav === 'function') {
            closeMobileNav();
        }
    });
    document.getElementById('registerSuccessClose')?.addEventListener('click', closeRegisterSuccessModal);
    document.getElementById('registerSuccessOk')?.addEventListener('click', closeRegisterSuccessModal);
    document.getElementById('registerSuccessModal')?.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'registerSuccessModal') {
            closeRegisterSuccessModal();
        }
    });
});

/** يملأ #governorate و #searchGovernorate من القائمة الرسمية */
async function populateSearchGovernorates() {
    if (typeof initYemenGovernorateDropdowns === 'function') {
        initYemenGovernorateDropdowns();
    }
}

// تسجيل متبرع جديد
document.getElementById('registerForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();

    const hasHealthCondition = document.getElementById('hasHealthCondition').value;
    const selectedConditions = [];
    if (hasHealthCondition === 'yes') {
        document.querySelectorAll('input[name="healthConditions"]:checked').forEach(cb => {
            selectedConditions.push(cb.value);
        });
    }

    const healthNotes = hasHealthCondition === 'yes'
        ? document.getElementById('healthNotes').value || null
        : null;

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    if (password !== confirmPassword) {
        alert('كلمة المرور وتأكيدها غير متطابقتين');
        return;
    }

    const payload = {
        fullName: document.getElementById('fullName').value.trim(),
        email,
        password,
        age: parseInt(document.getElementById('age').value, 10),
        bloodType: document.getElementById('bloodType').value,
        governorate: document.getElementById('governorate').value.trim(),
        region: document.getElementById('region').value.trim(),
        phone: document.getElementById('phone').value.trim() || '',
        showPhone: document.getElementById('privacySettings').checked,
        hasHealthCondition: hasHealthCondition === 'yes',
        healthConditions: selectedConditions,
        healthNotes,
        avatarUrl: (document.getElementById('avatarUrl')?.value || '').trim() || undefined
    };

    try {
        await dataManager.register(payload);
        openRegisterSuccessModal();
        this.reset();
        toggleHealthDetails();
        void populateSearchGovernorates();
        void updateHomeStats();
        showPage('profile', null);
        await loadProfile();
        void tryRegisterWebPush();
    } catch (err) {
        alert('فشل التسجيل: ' + (err.message || err));
    }
});

document.getElementById('loginForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    try {
        await dataManager.login(email, password);
        alert('مرحباً بك!');
        void populateSearchGovernorates();
        void updateHomeStats();
        showPage('profile', null);
        await loadProfile();
        dataManager.updateMessageCount();
        void tryRegisterWebPush();
    } catch (err) {
        alert('فشل تسجيل الدخول: ' + (err.message || err));
    }
});

// البحث عن متبرعين
async function searchDonors() {
    const bloodType = document.getElementById('searchBloodType').value;
    const governorate = document.getElementById('searchGovernorate').value.trim();
    const region = document.getElementById('searchRegion').value.trim();
    const age = document.getElementById('searchAge').value;

    const filters = {};
    if (bloodType) filters.bloodType = bloodType;
    if (governorate) filters.governorate = governorate;
    if (region) filters.region = region;
    if (age) filters.age = age;

    try {
        const donors = await dataManager.getDonors(filters);
        displaySearchResults(donors);
    } catch (err) {
        alert('تعذر البحث: ' + (err.message || err));
    }
}

function displaySearchResults(donors) {
    const resultsContainer = document.getElementById('searchResults');

    if (donors.length === 0) {
        resultsContainer.innerHTML = '<p class="no-results">لم يتم العثور على متبرعين متطابقين</p>';
        return;
    }

    resultsContainer.innerHTML = donors.map(donor => {
        const loc = escapeHtml(
            [donor.governorate, donor.region].filter(Boolean).join(' — ') || '—'
        );
        const phoneRow =
            donor.showPhone && donor.phone
                ? `<p><i class="fas fa-phone"></i> ${escapeHtml(String(donor.phone))}</p>`
                : '<p><i class="fas fa-phone-slash"></i> الرقم مخفي - استخدم الرسائل للتواصل</p>';
        const openArgs = `${JSON.stringify(String(donor.id))}, ${JSON.stringify(String(donor.fullName || ''))}`;
        return `
        <div class="donor-card">
            <div class="donor-info">
                <span class="blood-badge">${escapeHtml(String(donor.bloodType || ''))}</span>
                <h3>${escapeHtml(String(donor.fullName || ''))}</h3>
                <p><i class="fas fa-birthday-cake"></i> العمر: ${donor.age != null ? donor.age + ' سنة' : '—'}</p>
                <p><i class="fas fa-map-marker-alt"></i> ${loc}</p>
                ${phoneRow}
            </div>
            <div>
                <button type="button" class="btn btn-primary" onclick="openMessageModal(${openArgs})">
                    <i class="fas fa-envelope"></i> إرسال رسالة
                </button>
            </div>
        </div>`;
    }).join('');
}

// فتح نافذة الرسالة
async function openMessageModal(recipientId, recipientName) {
    const currentUser = dataManager.getCurrentUser();

    if (!currentUser) {
        alert('يرجى التسجيل أولاً لإرسال الرسائل');
        showPage('register', null);
        return;
    }

    try {
        await dataManager.getDonorById(recipientId);
    } catch (_) {
        alert('المتبرع غير موجود');
        return;
    }

    document.getElementById('recipientId').value = recipientId;
    document.getElementById('recipientName').textContent = recipientName;
    document.getElementById('messagePhone').value = currentUser.phone || '';
    document.getElementById('messageModal').classList.add('active');
}

function closeMessageModal() {
    document.getElementById('messageModal').classList.remove('active');
    document.getElementById('messageForm').reset();
}

// إدارة إشعارات المتصفح
class NotificationManager {
    static async requestPermission() {
        if (!('Notification' in window)) {
            console.log('هذا المتصفح لا يدعم الإشعارات');
            return false;
        }

        if (Notification.permission === 'granted') {
            return true;
        }

        if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }

        return false;
    }

    static async showNotification(title, options) {
        const hasPermission = await this.requestPermission();

        if (!hasPermission) {
            console.log('لم يتم منح الإذن للإشعارات');
            return;
        }

        // إظهار إشعار المتصفح
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.ready;
                await registration.showNotification(title, options);
            } catch (error) {
                // إذا فشل Service Worker، استخدم الإشعارات العادية
                new Notification(title, options);
            }
        } else {
            new Notification(title, options);
        }
    }

    static async sendUrgentNotification(messageData) {
        const title = '🚨 حالة طارئة - طلب دم عاجل';
        const bodyText = messageData.neededDateTime
            ? `${messageData.senderName} يحتاج فصيلة دم فوراً!\nالوقت المطلوب: ${new Date(messageData.neededDateTime).toLocaleString('ar-SA')}\n${messageData.message.substring(0, 80)}...`
            : `${messageData.senderName} يحتاج فصيلة دم فوراً!\n${messageData.message.substring(0, 100)}...`;

        const options = {
            body: bodyText,
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyIiBoZWlnaHQ9IjE5MiIgdmlld0JveD0iMCAwIDE5MiAxOTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxOTIiIGhlaWdodD0iMTkyIiBmaWxsPSIjZGMzNTQ1Ii8+CjxwYXRoIGQ9Ik05NiA2MEM5NiA2MCA3MCA4MCA3MCAxMTBDNzAgMTQwIDk2IDE2MCA5NiAxNjBDOTYgMTYwIDEyMiAxNDAgMTIyIDExMEMxMjIgODAgOTYgNjAgOTYgNjBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4=',
            badge: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyIiBoZWlnaHQ9IjE5MiIgdmlld0JveD0iMCAwIDE5MiAxOTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxOTIiIGhlaWdodD0iMTkyIiBmaWxsPSIjZGMzNTQ1Ii8+CjxwYXRoIGQ9Ik05NiA2MEM5NiA2MCA3MCA4MCA3MCAxMTBDNzAgMTQwIDk2IDE2MCA5NiAxNjBDOTYgMTYwIDEyMiAxNDAgMTIyIDExMEMxMjIgODAgOTYgNjAgOTYgNjBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4=',
            tag: `urgent-${messageData.id}`,
            requireInteraction: true,
            vibrate: [200, 100, 200, 100, 200, 100, 200],
            data: {
                messageId: messageData.id,
                senderId: messageData.senderId,
                isUrgent: true,
                phone: messageData.phone || null,
                neededDateTime: messageData.neededDateTime || null
            },
            actions: messageData.phone ? [
                {
                    action: 'call',
                    title: '📞 اتصل الآن'
                },
                {
                    action: 'view',
                    title: '📩 عرض الرسالة'
                }
            ] : [
                {
                    action: 'view',
                    title: '📩 عرض الرسالة'
                }
            ]
        };

        await this.showNotification(title, options);
    }

    static async sendNormalNotification(messageData) {
        const title = '📩 رسالة جديدة';
        const options = {
            body: `رسالة من ${messageData.senderName}`,
            icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTkyIiBoZWlnaHQ9IjE5MiIgdmlld0JveD0iMCAwIDE5MiAxOTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxOTIiIGhlaWdodD0iMTkyIiBmaWxsPSIjZGMzNTQ1Ii8+CjxwYXRoIGQ9Ik05NiA2MEM5NiA2MCA3MCA4MCA3MCAxMTBDNzAgMTQwIDk2IDE2MCA5NiAxNjBDOTYgMTYwIDEyMiAxNDAgMTIyIDExMEMxMjIgODAgOTYgNjAgOTYgNjBaIiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4=',
            tag: `message-${messageData.id}`,
            data: {
                messageId: messageData.id,
                senderId: messageData.senderId
            }
        };

        await this.showNotification(title, options);
    }
}

// تحويل رقم الهاتف اليمني إلى الصيغة الدولية
function formatPhoneNumber(phone) {
    if (!phone) return null;

    // إزالة المسافات والرموز
    let cleaned = phone.replace(/\s+/g, '').replace(/[()-]/g, '');

    // إذا كان الرقم يبدأ بـ 0، استبدله برمز اليمن
    if (cleaned.startsWith('0')) {
        cleaned = '+967' + cleaned.substring(1); // رمز اليمن: +967
    }

    // إذا كان الرقم يبدأ بـ 7 (بدون 0)، أضف رمز اليمن
    if (cleaned.match(/^7\d{8}$/)) {
        cleaned = '+967' + cleaned;
    }

    // إذا لم يبدأ بـ +، أضف رمز اليمن
    if (!cleaned.startsWith('+')) {
        // إذا كان الرقم يبدأ بـ 967، أضف +
        if (cleaned.startsWith('967')) {
            cleaned = '+' + cleaned;
        } else {
            cleaned = '+967' + cleaned; // افتراض أنه رقم يمني
        }
    }

    // التحقق من أن الرقم يبدأ بـ +967
    if (!cleaned.startsWith('+967')) {
        console.warn('⚠️ الرقم لا يبدو أنه يمني:', cleaned);
        // يمكنك إرجاع null أو السماح بالرقم كما هو
    }

    return cleaned;
}

// تحديث رقم الهاتف عند تحديد حالة طارئة
document.getElementById('isUrgent')?.addEventListener('change', function () {
    const phoneInput = document.getElementById('messagePhone');
    const phoneGroup = document.getElementById('phoneGroup');
    const phoneRequired = document.getElementById('phoneRequired');
    const phoneHint = document.getElementById('phoneHint');

    if (this.checked) {
        phoneInput.required = true;
        phoneRequired.style.display = 'inline';
        phoneGroup.style.borderRightColor = 'var(--primary-red)';
        phoneGroup.style.background = '#fff5f5';
        phoneHint.innerHTML = '<i class="fas fa-exclamation-circle" style="color: var(--primary-red);"></i> <strong>إلزامي:</strong> يرجى وضع رقمك للتواصل الفوري في الحالات الطارئة';
    } else {
        phoneInput.required = false;
        phoneRequired.style.display = 'none';
        phoneGroup.style.borderRightColor = '#ddd';
        phoneGroup.style.background = '#f8f9fa';
        phoneHint.textContent = 'يرجى وضع رقمك للسماح للمتبرع بالتواصل معك مباشرة';
    }
});

// إرسال رسالة
document.getElementById('messageForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();

    const currentUser = dataManager.getCurrentUser();
    if (!currentUser) {
        alert('يرجى التسجيل أولاً');
        return;
    }

    const recipientId = document.getElementById('recipientId').value;
    let recipient;
    try {
        recipient = await dataManager.getDonorById(recipientId);
    } catch (_) {
        alert('المتبرع غير موجود');
        return;
    }

    const isUrgent = document.getElementById('isUrgent').checked;
    const neededDateTime = document.getElementById('neededDateTime').value;
    const phone = document.getElementById('messagePhone').value;

    if (isUrgent && !phone) {
        alert('يرجى إدخال رقم هاتفك للتواصل الفوري في الحالات الطارئة');
        return;
    }

    const message = {
        senderId: currentUser.id,
        senderName: currentUser.fullName,
        recipientId,
        recipientName: recipient.fullName,
        message: document.getElementById('messageText').value,
        phone: phone || null,
        isUrgent,
        neededDateTime: neededDateTime || null
    };

    let sendResult;
    try {
        sendResult = await dataManager.addMessage(message);
    } catch (err) {
        alert('فشل إرسال الرسالة: ' + (err.message || err));
        return;
    }

    const newMessage = sendResult.data;
    const rawPhone =
        typeof recipient.phone === 'string' && recipient.phone.includes('مخفي')
            ? null
            : recipient.phone;

    if (isUrgent) {
        await NotificationManager.sendUrgentNotification({
            ...newMessage,
            recipientPhone: rawPhone
        });

        const u = sendResult.urgentSms;
        if (u && u.skipped) {
            alert(
                '✅ تم إرسال الطلب الطارئ.\n\n' +
                    'تنبيه: لا يوجد رقم هاتف محفوظ في حساب المتبرع، لذلك لم يُرسل SMS. يمكنه الاطلاع من التطبيق.'
            );
        } else if (u && u.queued) {
            alert(
                '✅ تم إرسال الطلب الطارئ.\n\n' +
                    'يُشعَر المتبرع عبر المنصة، ويُرسل له تلقائياً رسالة نصية إن وُجد رقم مسجّل في حسابه (حتى لو كان الرقم مخفياً للعامة).'
            );
        } else {
            alert('✅ تم إرسال رسالة طارئة! (إشعارات المتصفح)');
        }
    } else {
        await NotificationManager.sendNormalNotification(newMessage);
        alert('تم إرسال الرسالة بنجاح!');
    }

    closeMessageModal();

    if (document.getElementById('messages').classList.contains('active')) {
        await loadMessages();
    }

    dataManager.updateMessageCount();
    void updateHomeStats();
});

/** واجهة التأكيد المزدوج (محتاج + متبرع) لكل رسالة */
function renderHelpConfirmationBlock(msg, currentUserId) {
    const isNeedy = msg.senderId === currentUserId;
    const isDonor = msg.recipientId === currentUserId;
    if (!isNeedy && !isDonor) return '';

    const n = !!(msg.needyConfirmedAt);
    const d = !!(msg.donorConfirmedAt);
    const complete = msg.helpComplete || (n && d);
    /** للـ onclick: لا نستخدم JSON.stringify لأن " يكسر خاصية HTML المحددة بـ " */
    const midSafe = String(msg.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    if (complete) {
        let block = `
            <div class="help-confirm-section help-confirm-complete">
                <div class="help-complete-banner">
                    <i class="fas fa-check-double"></i>
                    اكتمل التأكيد المزدوج — شكراً لكما على إتمام الخير في هذا الطلب.
                </div>`;
        if (isNeedy) {
            block += `
                <p class="help-thanks-hint">
                    <i class="fas fa-heart"></i>
                    يمكنك أن تشكر المتبرع بأنه سهّل عليك الخير بإذن الله — يظهر ذلك في سجل المنصة لفاعلي الخير المؤكَّدين.
                </p>`;
        }
        block += '</div>';
        return block;
    }

    let html = `
        <div class="help-confirm-section">
            <p class="help-disclaimer">
                <i class="fas fa-info-circle"></i>
                التأكيدان إقراران شخصيان في المنصة؛ المنصّة لا تتحقق طبياً من وقوع التبرع في المستشفى.
            </p>`;

    if (isNeedy) {
        if (!n) {
            html += `
                <p class="help-hint help-hint-needy">
                    <i class="fas fa-hand-holding-heart"></i>
                    يُفضّل الضغط <strong>بعد</strong> أن يتم التبرع فعلياً أو بعد أن تتحقق أن المساعدة المتفق عليها تمت.
                </p>
                <button type="button" class="btn btn-confirm-needy" onclick="confirmHelpAsNeedy('${midSafe}')">
                    <i class="fas fa-check"></i> أؤكد أنني تلقيتُ المساعدة المتفق عليها
                </button>`;
        } else {
            html += `
                <p class="help-status-line"><i class="fas fa-check-circle"></i> سجّلتَ تأكيد استلام المساعدة.</p>`;
            if (!d) {
                html += `<p class="help-wait"><i class="fas fa-hourglass-half"></i> بانتظار تأكيد المتبرع لإكمال السجل.</p>`;
            }
        }
    }

    if (isDonor) {
        if (!d) {
            html += `
                <p class="help-hint help-hint-donor">
                    <i class="fas fa-hand-holding-medical"></i>
                    اضغط بعد أن تكون قد نفّذت ما تعهدت به في هذا الطلب (مثلاً التبرع أو التنسيق كما اتفقتما).
                </p>
                <button type="button" class="btn btn-confirm-donor" onclick="confirmHelpAsDonor('${midSafe}')">
                    <i class="fas fa-check"></i> أؤكد أنني نفّذتُ ما تعهدتُ به في هذا الطلب
                </button>`;
        } else {
            html += `
                <p class="help-status-line"><i class="fas fa-check-circle"></i> سجّلتَ تأكيد تنفيذ المساعدة.</p>`;
            if (!n) {
                html += `<p class="help-wait"><i class="fas fa-hourglass-half"></i> بانتظار تأكيد مُرسِل الطلب.</p>`;
            }
        }
    }

    html += '</div>';
    return html;
}

async function confirmHelpAsNeedy(messageId) {
    const ok = confirm(
        'هل أنت متأكد؟\n\n' +
        'يُفضّل التأكيد بعد أن تتحقق من إتمام التبرع أو المساعدة المتفق عليها.\n' +
        'بالتأكيد تُشكر المتبرع وتُسجّل في المنصة أن الطلب انتهى بما يرضيك — دون أن تكون المنصة شاهدة طبية على التبرع.'
    );
    if (!ok) return;
    try {
        await dataManager.confirmHelpAsNeedy(messageId);
        alert('بارك الله فيك. تم تسجيل تأكيدك.');
        await loadMessages();
        void updateHomeStats();
    } catch (e) {
        alert(e.message || e);
    }
}

async function confirmHelpAsDonor(messageId) {
    const ok = confirm(
        'هل أنت متأكد أنك نفّذت ما تعهدت به في هذا الطلب؟\n\n' +
        'إقرارك يساعد مُرسِل الطلب على إغلاق الطلب بشكر صادق.'
    );
    if (!ok) return;
    try {
        await dataManager.confirmHelpAsDonor(messageId);
        alert('بارك الله فيك. تم تسجيل تأكيدك.');
        await loadMessages();
        void updateHomeStats();
    } catch (e) {
        alert(e.message || e);
    }
}

// تحميل الرسائل
async function loadMessages() {
    const currentUser = dataManager.getCurrentUser();

    if (!currentUser) {
        document.getElementById('messagesList').innerHTML =
            '<p class="no-results">يرجى التسجيل أولاً لعرض الرسائل</p>';
        return;
    }

    let messages;
    try {
        messages = await dataManager.getMessagesForUser(currentUser.id);
    } catch (e) {
        document.getElementById('messagesList').innerHTML =
            '<p class="no-results">تعذر تحميل الرسائل. جرّب تحديث الصفحة.</p>';
        return;
    }

    const messagesList = document.getElementById('messagesList');

    if (messages.length === 0) {
        messagesList.innerHTML = '<p class="no-results">لا توجد رسائل</p>';
        return;
    }

    messages.sort((a, b) => {
        if (a.isUrgent && !b.isUrgent) return -1;
        if (!a.isUrgent && b.isUrgent) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    messagesList.innerHTML = messages.map(msg => {
        const isIncoming = msg.recipientId === currentUser.id;
        const otherPerson = escapeHtml(String(isIncoming ? msg.senderName : msg.recipientName || ''));
        const date = new Date(msg.createdAt).toLocaleDateString('ar-SA', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const urgentBadge = msg.isUrgent
            ? '<span class="urgent-badge"><i class="fas fa-exclamation-triangle"></i> حالة طارئة</span>'
            : '';

        const neededTime = msg.neededDateTime
            ? `<div class="needed-time">
                <i class="fas fa-clock"></i> 
                <strong>وقت الحاجة:</strong> ${escapeHtml(
                    new Date(msg.neededDateTime).toLocaleString('ar-SA', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })
                )}
            </div>`
            : '';

        const bodyText = escapeHtml(String(msg.message || msg.content || ''));
        const rawPhone = String(msg.phone || '').trim();
        const safeTel = rawPhone.replace(/[^\d+]/g, '');

        return `
            <div class="message-card ${msg.isUrgent ? 'urgent-message' : ''} ${!msg.read && isIncoming ? 'unread' : ''}">
                <div class="message-header">
                    <span class="message-sender">
                        ${isIncoming ? '<i class="fas fa-inbox"></i> من: ' : '<i class="fas fa-paper-plane"></i> إلى: '}
                        ${otherPerson}
                        ${urgentBadge}
                    </span>
                    <span class="message-date">${escapeHtml(date)}</span>
                </div>
                ${neededTime}
                <div class="message-content">${bodyText}</div>
                ${rawPhone
                    ? `
                    <div class="message-phone">
                        <i class="fas fa-phone"></i> رقم للتواصل: <strong>${escapeHtml(rawPhone)}</strong>
                        ${msg.isUrgent && safeTel ? `<a href="tel:${safeTel}" class="call-btn"><i class="fas fa-phone-alt"></i> اتصل الآن</a>` : ''}
                    </div>
                `
                    : ''}
                ${renderHelpConfirmationBlock(msg, currentUser.id)}
            </div>
        `;
    }).join('');

    for (const msg of messages) {
        if (msg.recipientId === currentUser.id && !msg.read) {
            try {
                await dataManager.markMessageAsRead(msg.id);
            } catch (_) {
                /* ignore */
            }
        }
    }
}

// الحصول على اسم الحالة الصحية
function getHealthConditionName(condition) {
    const conditions = {
        'diabetes': 'داء السكري',
        'hypertension': 'ارتفاع ضغط الدم',
        'heart_disease': 'أمراض القلب',
        'anemia': 'فقر الدم',
        'hepatitis': 'التهاب الكبد (B أو C)',
        'hiv': 'فيروس نقص المناعة (HIV)',
        'cancer': 'سرطان (تم الشفاء منه)',
        'pregnancy': 'حمل',
        'recent_surgery': 'جراحة حديثة (أقل من 6 أشهر)',
        'medication': 'تناول أدوية معينة',
        'other': 'حالة صحية أخرى'
    };
    return conditions[condition] || condition;
}

// تحميل الملف الشخصي
async function loadProfile() {
    const profileContent = document.getElementById('profileContent');
    let currentUser = dataManager.getCurrentUser();

    if (!currentUser) {
        profileContent.innerHTML = `
            <p class="no-results">لم تقم بتسجيل الدخول بعد</p>
            <button class="btn btn-primary btn-block" onclick="showPage('register', null)" style="margin-top: 1rem;">
                <i class="fas fa-user-plus"></i> إنشاء حساب متبرع
            </button>
            <button class="btn btn-secondary btn-block" onclick="showPage('login', null)" style="margin-top: 0.5rem;">
                <i class="fas fa-sign-in-alt"></i> تسجيل الدخول
            </button>
        `;
        return;
    }

    if (localStorage.getItem('bloodConnect_token')) {
        try {
            const fresh = await apiFetch('/auth/profile');
            currentUser = fresh;
            dataManager.setSession(fresh, localStorage.getItem('bloodConnect_token'));
        } catch (_) {
            /* use cached */
        }
    }

    const avSrc = currentUser.avatarUrl ? String(currentUser.avatarUrl).trim() : '';
    const showAvatarImg =
        avSrc &&
        (avSrc.startsWith('/uploads/') ||
            avSrc.startsWith('/api/auth/avatar/') ||
            avSrc.startsWith('http://') ||
            avSrc.startsWith('https://'));
    const avatarHeader =
        showAvatarImg && (avSrc.startsWith('/uploads/') || avSrc.startsWith('/api/auth/avatar/'))
            ? `<div class="profile-avatar profile-avatar--photo"><img src="${escapeHtml(avSrc)}?v=${Date.now()}" alt="" width="120" height="120" loading="lazy" decoding="async" /></div>`
            : showAvatarImg
              ? `<div class="profile-avatar profile-avatar--photo"><img src="${escapeHtml(avSrc)}" alt="" width="120" height="120" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></div>`
              : `<div class="profile-avatar">${escapeHtml(currentUser.fullName.charAt(0))}</div>`;

    profileContent.innerHTML = `
        <div class="profile-header">
            ${avatarHeader}
            <h2>${currentUser.fullName}</h2>
            ${currentUser.email ? `<p class="form-hint">${currentUser.email}</p>` : ''}
        </div>
        <div class="profile-spirit-card" aria-labelledby="profileSpiritTitle">
            <h3 id="profileSpiritTitle" class="profile-spirit-title">تقبل الله منك</h3>
            <p class="profile-spirit-body">أخي الكريم/ أختي الكريمة، اعلم أن الله اطلع على صنيعك، وقد أثمر عطاؤك في ميزان حسناتك. إن إحياءك لنفسٍ بشرية هو أمانةٌ عظيمة، وقد أديتها بفضل الله. نسأل الله أن يبارك في صحتك، وأن يجعل عملك هذا سبباً في دخولك الفردوس الأعلى.</p>
        </div>
        <div class="profile-info">
            <h3><i class="fas fa-info-circle"></i> المعلومات الشخصية</h3>
            <div class="info-item">
                <span class="info-label">الاسم الكامل:</span>
                <span class="info-value">${currentUser.fullName}</span>
            </div>
            <div class="info-item">
                <span class="info-label">العمر:</span>
                <span class="info-value">${currentUser.age != null ? currentUser.age + ' سنة' : '—'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">فصيلة الدم:</span>
                <span class="info-value"><span class="blood-badge">${currentUser.bloodType}</span></span>
            </div>
            <div class="info-item">
                <span class="info-label">المحافظة:</span>
                <span class="info-value">${currentUser.governorate || currentUser.city || '—'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">المنطقة:</span>
                <span class="info-value">${currentUser.region}</span>
            </div>
            <div class="info-item">
                <span class="info-label">رقم الهاتف:</span>
                <span class="info-value">${currentUser.phone || 'غير مسجل'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">إظهار الرقم:</span>
                <span class="info-value">${currentUser.showPhone ? 'نعم' : 'لا'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">الحالة الصحية:</span>
                <span class="info-value">${currentUser.hasHealthCondition ?
            (currentUser.healthConditions && currentUser.healthConditions.length > 0 ?
                currentUser.healthConditions.map(c => getHealthConditionName(c)).join('، ') :
                (currentUser.healthCondition ? getHealthConditionName(currentUser.healthCondition) : 'حالة صحية')) :
            'بصحة جيدة'}</span>
            </div>
            ${currentUser.hasHealthCondition && currentUser.healthNotes ? `
            <div class="info-item">
                <span class="info-label">ملاحظات صحية:</span>
                <span class="info-value">${currentUser.healthNotes}</span>
            </div>
            ` : ''}
        </div>
        <div class="form-group profile-avatar-field">
            <label><i class="fas fa-camera"></i> صورة العرض</label>
            <p class="form-hint" style="margin-bottom:0.65rem">الحد الأقصى ٢ ميجا — صيغة JPEG أو PNG أو WebP.</p>
            <input type="file" id="profileAvatarFile" accept="image/jpeg,image/png,image/webp" class="profile-avatar-file-input">
            <button type="button" class="btn btn-primary btn-block" id="profileAvatarUploadBtn" style="margin-top:0.65rem" onclick="uploadProfileAvatarFile()">
                <i class="fas fa-cloud-upload-alt"></i> رفع الصورة وحفظها
            </button>
            <label for="profileAvatarUrl" style="margin-top:1rem;display:block"><i class="fas fa-link"></i> أو الصق رابط صورة (اختياري)</label>
            <input type="url" id="profileAvatarUrl" dir="ltr" style="text-align:left" maxlength="2000"
                placeholder="https://…"
                value="${escapeHtml(String(currentUser.avatarUrl && String(currentUser.avatarUrl).startsWith('http') ? currentUser.avatarUrl : ''))}">
            <button type="button" class="btn btn-secondary btn-block" style="margin-top:0.65rem" onclick="saveProfileAvatarUrl()">
                <i class="fas fa-save"></i> حفظ الرابط فقط
            </button>
        </div>
        <div class="form-group">
            <label>
                <input type="checkbox" id="togglePhonePrivacy" ${currentUser.showPhone ? 'checked' : ''} 
                       onchange="togglePhonePrivacy()">
                <span>إظهار رقمي للمستخدمين الآخرين</span>
            </label>
        </div>
        <div style="margin-top: 2rem; padding-top: 2rem; border-top: 2px solid #e9ecef;">
            <button class="btn btn-primary btn-block" onclick="logout()" style="margin-bottom: 1rem;">
                <i class="fas fa-sign-out-alt"></i> تسجيل الخروج
            </button>
            <button class="btn btn-danger btn-block" onclick="deleteAccount()" style="background: #dc3545; border-color: #dc3545;">
                <i class="fas fa-trash-alt"></i> حذف الحساب
            </button>
            <small class="form-hint" style="display: block; text-align: center; margin-top: 0.5rem; color: var(--gray);">
                <i class="fas fa-exclamation-triangle"></i> تحذير: حذف الحساب نهائي ولا يمكن التراجع عنه
            </small>
        </div>
    `;
}

async function saveProfileAvatarUrl() {
    const currentUser = dataManager.getCurrentUser();
    if (!currentUser) return;
    const el = document.getElementById('profileAvatarUrl');
    const raw = (el && el.value ? el.value : '').trim();
    const prev = currentUser.avatarUrl ? String(currentUser.avatarUrl) : '';
    if (!raw) {
        if (prev.startsWith('/uploads/') || prev.startsWith('/api/auth/avatar/')) {
            alert('لاستبدال صورتك الحالية ارفع صورة جديدة من الأعلى.');
            return;
        }
    }
    try {
        await dataManager.updateDonor(currentUser.id, { avatarUrl: raw === '' ? null : raw });
        alert('تم حفظ رابط الصورة');
        await loadProfile();
    } catch (e) {
        alert('تعذر الحفظ: ' + (e.message || e));
    }
}

const PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function uploadProfileAvatarFile() {
    const currentUser = dataManager.getCurrentUser();
    if (!currentUser) return;
    const input = document.getElementById('profileAvatarFile');
    const btn = document.getElementById('profileAvatarUploadBtn');
    if (!input || !input.files || !input.files[0]) {
        alert('يرجى اختيار صورة أولاً');
        return;
    }
    const file = input.files[0];
    if (file.size > PROFILE_AVATAR_MAX_BYTES) {
        alert('حجم الصورة يتجاوز ٢ ميجابايت. اختر صورة أصغر.');
        return;
    }
    if (!PROFILE_AVATAR_TYPES.includes(file.type)) {
        alert('يُسمح بصيغ JPEG أو PNG أو WebP فقط');
        return;
    }
    const token = localStorage.getItem('bloodConnect_token');
    if (!token) {
        alert('انتهت الجلسة. سجّل الدخول مجدداً');
        return;
    }
    const fd = new FormData();
    fd.append('avatar', file);
    if (btn) {
        btn.disabled = true;
    }
    try {
        const res = await fetch('/api/auth/profile/avatar', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'تعذر رفع الصورة');
        }
        if (data.user) {
            dataManager.setSession(data.user, token);
        }
        input.value = '';
        alert('تم حفظ الصورة بنجاح');
        await loadProfile();
    } catch (e) {
        alert(e.message || 'تعذر رفع الصورة. تحقق من الاتصال.');
    } finally {
        if (btn) {
            btn.disabled = false;
        }
    }
}

// تبديل إعدادات الخصوصية
async function togglePhonePrivacy() {
    const currentUser = dataManager.getCurrentUser();
    if (!currentUser) return;

    const showPhone = document.getElementById('togglePhonePrivacy').checked;
    try {
        await dataManager.updateDonor(currentUser.id, { showPhone });
        alert('تم تحديث إعدادات الخصوصية');
    } catch (e) {
        alert('تعذر الحفظ: ' + (e.message || e));
    }
}

// تسجيل الخروج
function logout() {
    if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
        dataManager.clearCurrentUser();
        showPage('home', null);
        void updateHomeStats();
    }
}

// حذف الحساب
async function deleteAccount() {
    const currentUser = dataManager.getCurrentUser();

    if (!currentUser) {
        alert('لا يوجد حساب مسجل');
        return;
    }

    // تأكيد الحذف
    const confirmMessage = `⚠️ تحذير: حذف الحساب نهائي!\n\n` +
        `سيتم حذف:\n` +
        `- حسابك الشخصي\n` +
        `- جميع الرسائل المرسلة والمستقبلة\n` +
        `- جميع البيانات المرتبطة بحسابك\n\n` +
        `هل أنت متأكد تماماً من حذف الحساب؟\n\n` +
        `اكتب "حذف" للتأكيد:`;

    const userConfirmation = prompt(confirmMessage);

    if (userConfirmation !== 'حذف') {
        alert('تم إلغاء عملية الحذف');
        return;
    }

    try {
        await dataManager.deleteAccount();
        alert('✅ تم تأكيد حذف حسابك وجميع الرسائل بنجاح.');
        showPage('home', null);
        await updateHomeStats();
        dataManager.updateMessageCount();
    } catch (e) {
        alert('حدث خطأ أثناء حذف الحساب: ' + (e.message || e));
    }
}

// إغلاق النوافذ المنبثقة عند النقر خارجها
window.onclick = function (event) {
    const messageModal = document.getElementById('messageModal');
    const donorModal = document.getElementById('donorModal');

    if (event.target === messageModal) {
        closeMessageModal();
    }
    if (event.target === donorModal) {
        closeDonorModal();
    }
}

function closeDonorModal() {
    document.getElementById('donorModal').classList.remove('active');
}

// إدارة السلايدر
let currentSlide = 0;
let slideInterval;

function initSlider() {
    const slides = document.querySelectorAll('.slide');
    const indicators = document.querySelectorAll('.indicator');

    if (slides.length === 0) return;

    // بدء السلايدر التلقائي
    startSlider();
}

function startSlider() {
    slideInterval = setInterval(() => {
        nextSlide();
    }, MS_HERO_MAIN_SLIDER);
}

function stopSlider() {
    if (slideInterval) {
        clearInterval(slideInterval);
    }
}

function nextSlide() {
    const slides = document.querySelectorAll('.slide');
    const indicators = document.querySelectorAll('.indicator');

    if (slides.length === 0) return;

    // إزالة النشاط من الشريحة الحالية
    slides[currentSlide].classList.remove('active');
    indicators[currentSlide].classList.remove('active');

    // الانتقال للشريحة التالية
    currentSlide = (currentSlide + 1) % slides.length;

    // إضافة النشاط للشريحة الجديدة
    slides[currentSlide].classList.add('active');
    indicators[currentSlide].classList.add('active');
}

function goToSlide(index) {
    const slides = document.querySelectorAll('.slide');
    const indicators = document.querySelectorAll('.indicator');

    if (slides.length === 0 || index < 0 || index >= slides.length) return;

    // إيقاف السلايدر التلقائي مؤقتاً
    stopSlider();

    // إزالة النشاط من الشريحة الحالية
    slides[currentSlide].classList.remove('active');
    indicators[currentSlide].classList.remove('active');

    // الانتقال للشريحة المحددة
    currentSlide = index;

    // إضافة النشاط للشريحة الجديدة
    slides[currentSlide].classList.add('active');
    indicators[currentSlide].classList.add('active');

    // إعادة تشغيل السلايدر التلقائي بعد توقف يدوي قصير
    setTimeout(() => {
        startSlider();
    }, MS_GO_TO_SLIDE_RESUME);
}

// تسجيل Service Worker + تحديث فوري عند نشر إصدار جديد (PWA)
if ('serviceWorker' in navigator) {
    let swReloading = false;

    function showSwUpdateBanner() {
        const b = document.getElementById('swUpdateBanner');
        if (b) b.style.display = 'flex';
    }

    function hideSwUpdateBanner() {
        const b = document.getElementById('swUpdateBanner');
        if (b) b.style.display = 'none';
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .then((registration) => {
                console.log('Service Worker مسجل بنجاح:', registration.scope);

                if (registration.waiting) {
                    showSwUpdateBanner();
                }

                registration.addEventListener('updatefound', () => {
                    const nw = registration.installing;
                    if (!nw) return;
                    nw.addEventListener('statechange', () => {
                        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                            showSwUpdateBanner();
                        }
                    });
                });

                setInterval(
                    () => {
                        registration.update().catch(() => {});
                    },
                    5 * 60 * 1000
                );
            })
            .catch((error) => {
                console.log('فشل تسجيل Service Worker:', error);
            });

        // عند تفعيل SW جديد بعد نشر تحديث — إعادة تحميل لتحميل الأصول الجديدة
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (swReloading) return;
            swReloading = true;
            hideSwUpdateBanner();
            window.location.reload();
        });
    });

    document.getElementById('swUpdateNowBtn')?.addEventListener('click', () => {
        navigator.serviceWorker.getRegistration().then((r) => {
            if (r && r.waiting) {
                r.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            window.location.reload();
        });
    });
}

/** تثبيت PWA (Chrome/Edge/Android) — Safari يستخدم «إضافة إلى الشاشة الرئيسية» يدوياً */
let deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    try {
        if (sessionStorage.getItem('pwaInstallDismissed') === '1') return;
    } catch (_) { /* ignore */ }
    deferredPwaPrompt = e;
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'flex';
});
document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
    if (!deferredPwaPrompt) return;
    deferredPwaPrompt.prompt();
    await deferredPwaPrompt.userChoice;
    deferredPwaPrompt = null;
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'none';
});
document.getElementById('pwaInstallDismiss')?.addEventListener('click', () => {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.style.display = 'none';
    try {
        sessionStorage.setItem('pwaInstallDismissed', '1');
    } catch (_) { /* ignore */ }
});

// استقبال رسائل من Service Worker
navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'OPEN_MESSAGE') {
        showPage('messages', null);
        loadMessages();
    }
});

// تهيئة الصفحة عند التحميل
document.addEventListener('DOMContentLoaded', function () {
    // التأكد من تحميل DOM بالكامل
    setTimeout(function () {
        try {
            // التحقق من وجود العناصر الأساسية
            if (!document.getElementById('home')) {
                console.warn('عنصر الصفحة الرئيسية غير موجود');
                return;
            }

            if (typeof updateHomeStats === 'function') {
                updateHomeStats();
            }

            if (typeof dataManager !== 'undefined' && dataManager.updateMessageCount) {
                dataManager.updateMessageCount();
            }

            // طلب إذن الإشعارات عند تحميل الصفحة
            if (typeof NotificationManager !== 'undefined' && NotificationManager.requestPermission) {
                NotificationManager.requestPermission().then(function () {
                    void tryRegisterWebPush();
                });
            } else {
                void tryRegisterWebPush();
            }

            // تهيئة خدمة SMS
            if (typeof SMSNotificationService !== 'undefined' && SMSNotificationService.init) {
                SMSNotificationService.init();
            }

            // إظهار الصفحة الرئيسية افتراضياً
            if (typeof showPage === 'function') {
                try {
                    showPage('home', null);
                } catch (showPageError) {
                    console.error('خطأ في showPage:', showPageError);
                }
            }

            // تهيئة السلايدر بعد تأخير بسيط لضمان تحميل العناصر
            setTimeout(function () {
                if (typeof initSlider === 'function') {
                    try {
                        initSlider();
                    } catch (sliderError) {
                        console.error('خطأ في initSlider:', sliderError);
                    }
                }
            }, 100);

            // فحص الرسائل: طلب واحد كل 30ث (شارة + إشعار واجهة + إشعارات المتصفح)
            if (typeof setInterval !== 'undefined' && typeof pollInboxAndNotifications === 'function') {
                setTimeout(function () {
                    try {
                        pollInboxAndNotifications();
                    } catch (e) {
                        console.error('pollInbox:', e);
                    }
                }, 1600);
                setInterval(function () {
                    try {
                        pollInboxAndNotifications();
                    } catch (e) {
                        console.error('pollInbox:', e);
                    }
                }, POLL_INBOX_MS);
            }

            // تحديث إحصائيات الصفحة الرئيسية (بطاقة التوعية والأعداد) كل 45 ثانية أثناء بقاء المستخدم في الرئيسية
            if (typeof setInterval !== 'undefined') {
                setInterval(function () {
                    const home = document.getElementById('home');
                    if (
                        home &&
                        home.classList.contains('active') &&
                        typeof updateHomeStats === 'function'
                    ) {
                        void updateHomeStats();
                    }
                }, 45000);
            }
        } catch (error) {
            console.error('خطأ في تهيئة الصفحة:', error);
        }
    }, 100);
});

// إدارة إشعارات SMS داخل التطبيق
class SMSNotificationService {
    static currentSMSData = null;
    static lastShownMessageId = null;
    static checkInterval = null;

    /** فحص دوري موحّد كل 30ث لتفادي 429 */
    static init() {
        this.checkInterval = null;

        window.addEventListener('storage', (e) => {
            if (e.key === 'bloodConnect_messages') {
                setTimeout(() => {
                    if (typeof pollInboxAndNotifications === 'function') {
                        pollInboxAndNotifications();
                    }
                }, 500);
            }
        });
    }

    /** يُستدعى من poll بعد جلب الرسائل مرة واحدة */
    static checkForNewMessagesFromList(messages) {
        const currentUser = dataManager.getCurrentUser();
        if (!currentUser) return;

        const unreadMessages = messages.filter(
            m =>
                m.recipientId === currentUser.id &&
                !m.read &&
                m.id !== this.lastShownMessageId
        );
        if (unreadMessages.length > 0) {
            const newMessage = unreadMessages[0];
            this.showSMSNotification(newMessage);
            this.lastShownMessageId = newMessage.id;
        }
    }

    // إظهار إشعار SMS
    static showSMSNotification(messageData) {
        const smsNotification = document.getElementById('smsNotification');
        if (!smsNotification) return;

        // إخفاء أي إشعار سابق
        this.hideSMSNotification();

        // حفظ بيانات الرسالة
        this.currentSMSData = messageData;

        // ملء البيانات
        document.getElementById('smsSenderName').textContent = messageData.senderName || 'مرسل غير معروف';
        document.getElementById('smsSenderPhone').textContent = messageData.phone || 'رقم غير معروف';

        // إظهار/إخفاء شارة الطوارئ
        const urgentBadge = document.getElementById('smsUrgentBadge');
        if (messageData.isUrgent) {
            urgentBadge.style.display = 'inline-flex';
        } else {
            urgentBadge.style.display = 'none';
        }

        // محتوى الرسالة
        const messageBody = document.getElementById('smsMessageBody');
        const rawText = String(messageData.message || messageData.content || 'لا توجد رسالة');
        let messageHTML = `<div class="message-text">${escapeHtml(rawText)}</div>`;

        if (messageData.neededDateTime) {
            const neededTime = escapeHtml(
                new Date(messageData.neededDateTime).toLocaleString('ar-YE', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })
            );
            messageHTML += `
                <div class="needed-time-sms">
                    <i class="fas fa-clock"></i> 
                    <span><strong>وقت الحاجة:</strong> ${neededTime}</span>
                </div>
            `;
        }

        messageBody.innerHTML = messageHTML;

        // وقت الاستلام
        const now = new Date();
        document.getElementById('smsTime').textContent = now.toLocaleTimeString('ar-YE', {
            hour: '2-digit',
            minute: '2-digit'
        });

        // إظهار/إخفاء زر الاتصال
        const callBtn = document.getElementById('smsCallBtn');
        if (messageData.phone) {
            callBtn.style.display = 'flex';
            callBtn.setAttribute('data-phone', messageData.phone);
        } else {
            callBtn.style.display = 'none';
        }

        // إظهار الإشعار مع تأثير اهتزاز
        smsNotification.classList.add('active', 'vibrate');

        // إزالة تأثير الاهتزاز بعد انتهاءه
        setTimeout(() => {
            smsNotification.classList.remove('vibrate');
        }, 600);

        // تشغيل صوت SMS
        this.playSMSSound();

        // إخفاء تلقائي بعد 15 ثانية (إذا لم يتم التفاعل)
        setTimeout(() => {
            if (smsNotification.classList.contains('active') && this.currentSMSData?.id === messageData.id) {
                this.hideSMSNotification();
            }
        }, 15000);
    }

    // إخفاء إشعار SMS
    static hideSMSNotification() {
        const smsNotification = document.getElementById('smsNotification');
        if (smsNotification) {
            smsNotification.classList.remove('active', 'vibrate');
            this.currentSMSData = null;
        }
    }

    // تشغيل صوت SMS
    static playSMSSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // نغمة SMS بسيطة (نغمتان)
            const frequencies = [800, 1000];

            const playTone = (freq, duration, delay) => {
                setTimeout(() => {
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();

                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);

                    oscillator.frequency.value = freq;
                    oscillator.type = 'sine';

                    gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

                    oscillator.start(audioContext.currentTime);
                    oscillator.stop(audioContext.currentTime + duration);
                }, delay);
            };

            playTone(frequencies[0], 0.15, 0);
            playTone(frequencies[1], 0.15, 200);
        } catch (error) {
            console.log('لا يمكن تشغيل صوت SMS');
        }
    }

    // إيقاف الفحص
    static stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
}

// إغلاق إشعار SMS
function closeSMSNotification() {
    SMSNotificationService.hideSMSNotification();
}

// الاتصال من إشعار SMS
function callFromSMS() {
    const callBtn = document.getElementById('smsCallBtn');
    const phone = callBtn.getAttribute('data-phone');
    if (phone) {
        window.location.href = `tel:${phone}`;
    }
    SMSNotificationService.hideSMSNotification();
}

// عرض الرسالة من إشعار SMS
function viewMessageFromSMS() {
    SMSNotificationService.hideSMSNotification();
    showPage('messages', null);
    setTimeout(() => {
        loadMessages();
    }, 300);
}

/** جلب الرسائل مرة ثم تحديث الشارة وإشعارات المتصفح وواجهة «SMS» */
function pollInboxAndNotifications() {
    const currentUser = dataManager.getCurrentUser();
    if (!currentUser) return;

    dataManager
        .getMessagesForUser(currentUser.id)
        .then(messages => {
            dataManager.updateMessageCount(messages);
            if (typeof SMSNotificationService !== 'undefined') {
                SMSNotificationService.checkForNewMessagesFromList(messages);
            }
            checkNewMessagesFromList(messages);
        })
        .catch(() => {});
}

function checkNewMessagesFromList(messages) {
    const currentUser = dataManager.getCurrentUser();
    if (!currentUser) return;

    const unreadMessages = messages.filter(
        m => m.recipientId === currentUser.id && !m.read
    );
    if (unreadMessages.length > 0) {
        unreadMessages.forEach(msg => {
            if (msg.isUrgent) {
                NotificationManager.sendUrgentNotification(msg);
            } else {
                NotificationManager.sendNormalNotification(msg);
            }
        });
    }
}

/** توافق قديم — يعيد استخدام الاستطلاع الموحّد */
function checkNewMessages() {
    pollInboxAndNotifications();
}

/** شريط تشجيع صفحة فاعلو الخير */
const HEROES_ENCOURAGEMENT_LINES = [
    'هنا يُذكر من ثبّت إسناده.. جزاهم الله خيراً.',
    'شكراً لكل من بادر.. عطاؤكم يمنح الحياة أملاً جديداً.',
    "بصمتك اليوم في 'فاعلو الخير' هي نبضٌ لمريضٍ ينتظر.",
    'تتبرع بدمك اليوم، لتكتب قصة حياةٍ لغيرك غداً.',
    'بأيديكم أعدتم نبضاً كاد أن يتوقف.. شكراً لعطائكم النبيل.',
    'فاعلو الخير.. هم النور الذي يضيء دروب المرضى في أشد لحظاتهم.',
    'في ميزان حسناتكم ما قدمتم، وفي قلوب المرضى دعواتٌ لكم بالخير.'
];

const HERO_CARD_SNIPPETS = [
    'جزاكم الله خيراً على العطاء.',
    'عطاؤكم يمنح الحياة أملاً جديداً.',
    'في ميزان حسناتكم ما قدمتم.',
    'بصمتكم نبضٌ لمريضٍ ينتظر.',
    'شكراً لكل من بادر.',
    'اللهم تقبل من فاعلي الخير.',
    'أثرٌ يُذكر عند الله أولاً.'
];

let heroesEncouragementTimer = null;

function startHeroesEncouragementRotation() {
    const el = document.getElementById('heroesEncouragementLine');
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = HEROES_ENCOURAGEMENT_LINES[0];
        return;
    }
    stopHeroesEncouragementRotation();
    let idx = 0;
    el.textContent = HEROES_ENCOURAGEMENT_LINES[0];
    heroesEncouragementTimer = setInterval(() => {
        idx = (idx + 1) % HEROES_ENCOURAGEMENT_LINES.length;
        el.classList.add('is-transitioning');
        setTimeout(() => {
            el.textContent = HEROES_ENCOURAGEMENT_LINES[idx];
            el.classList.remove('is-transitioning');
        }, 240);
    }, 9000);
}

function stopHeroesEncouragementRotation() {
    if (heroesEncouragementTimer) {
        clearInterval(heroesEncouragementTimer);
        heroesEncouragementTimer = null;
    }
}

// سلايدر صفحة فاعلو الخير — صور + آية + تلقائي ولمس
const MS_HEROES_PAGE_CAROUSEL = 9000;
let heroesCarouselIdx = 0;
let heroesCarouselTimer = null;

function heroesCarouselApplySlide(index) {
    const root = document.getElementById('heroesPageCarousel');
    if (!root) return;
    const slides = root.querySelectorAll('.heroes-pc-slide');
    const dots = root.querySelectorAll('.heroes-pc-dot');
    if (slides.length === 0) return;
    const n = slides.length;
    const i = ((index % n) + n) % n;
    slides.forEach((s, j) => {
        const on = j === i;
        s.classList.toggle('active', on);
        s.setAttribute('aria-hidden', on ? 'false' : 'true');
        const bg = s.querySelector('.heroes-pc-bg');
        if (bg) {
            const isPhoto = s.classList.contains('heroes-pc-slide--photo');
            bg.classList.toggle('heroes-pc-bg--animating', on && isPhoto);
            bg.classList.toggle(
                'heroes-pc-bg--ken-rev',
                on && isPhoto && s.classList.contains('heroes-pc-slide--ken-alt')
            );
        }
    });
    dots.forEach((d, j) => {
        d.classList.toggle('active', j === i);
        d.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    const cur = slides[i];
    root.classList.toggle(
        'heroes-page-carousel--verse',
        !!(cur && cur.classList.contains('heroes-pc-slide--verse'))
    );
    heroesCarouselIdx = i;
}

function restartHeroesCarouselAutoplay() {
    stopHeroesCarouselAutoplay();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    heroesCarouselTimer = setInterval(() => {
        heroesCarouselApplySlide(heroesCarouselIdx + 1);
    }, MS_HEROES_PAGE_CAROUSEL);
}

function stopHeroesCarouselAutoplay() {
    if (heroesCarouselTimer) {
        clearInterval(heroesCarouselTimer);
        heroesCarouselTimer = null;
    }
}

function heroesCarouselStep(delta) {
    heroesCarouselApplySlide(heroesCarouselIdx + delta);
    restartHeroesCarouselAutoplay();
}

function heroesCarouselGoTo(index) {
    heroesCarouselApplySlide(index);
    restartHeroesCarouselAutoplay();
}

function initHeroesCarouselTouchOnce() {
    const root = document.getElementById('heroesPageCarousel');
    if (!root || root.dataset.heroesTouchBound === '1') return;
    root.dataset.heroesTouchBound = '1';
    let startX = 0;
    const threshold = 56;
    root.addEventListener(
        'touchstart',
        (e) => {
            if (e.changedTouches && e.changedTouches[0]) {
                startX = e.changedTouches[0].screenX;
            }
        },
        { passive: true }
    );
    root.addEventListener(
        'touchend',
        (e) => {
            if (!e.changedTouches || !e.changedTouches[0]) return;
            const endX = e.changedTouches[0].screenX;
            const dx = endX - startX;
            if (Math.abs(dx) < threshold) return;
            if (dx < 0) {
                heroesCarouselStep(1);
            } else {
                heroesCarouselStep(-1);
            }
        },
        { passive: true }
    );
}

function initHeroImagesSlider() {
    const root = document.getElementById('heroesPageCarousel');
    if (!root) return;
    stopHeroesCarouselAutoplay();
    initHeroesCarouselTouchOnce();
    heroesCarouselApplySlide(0);
    restartHeroesCarouselAutoplay();
}

function stopHeroImagesSlider() {
    stopHeroesCarouselAutoplay();
}

function heroPhotoFallbackDataUrl(name) {
    const n = encodeURIComponent(String(name || 'م').trim().slice(0, 48) || 'م');
    return `https://ui-avatars.com/api/?name=${n}&size=160&background=dc3545&color=fff&rounded=true&bold=true`;
}

function buildHeroAvatarHtml(hero) {
    const safeName = String(hero.fullName || '').trim() || 'متبرع';
    const raw = hero.avatarUrl && String(hero.avatarUrl).trim();
    const primary = raw || heroPhotoFallbackDataUrl(safeName);
    const fb = heroPhotoFallbackDataUrl(safeName);
    const primaryJson = JSON.stringify(primary);
    const fbJson = JSON.stringify(fb);
    return `
        <div class="hero-avatar-wrap">
            <img class="hero-avatar-img" src=${primaryJson} alt="" width="120" height="120" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src=${fbJson};" />
        </div>`;
}

function buildConfirmedHeroCardHtml(hero, index) {
    const snippet = HERO_CARD_SNIPPETS[Math.floor(Math.random() * HERO_CARD_SNIPPETS.length)];
    const safeName = String(hero.fullName || '').trim() || 'متبرع';
    const loc = escapeHtml(formatHeroLocation(hero.governorate, hero.region));
    const blood = escapeHtml(String(hero.bloodType || ''));
    const matchesN = Number(hero.successfulMatches) || 0;
    const msgsN = Number(hero.totalMessages) || 0;
    return `
        <div class="hero-card hero-card--confirmed-only" style="animation-delay: ${index * 0.05}s;">
            ${buildHeroAvatarHtml(hero)}
            <span class="hero-role-badge hero-role-badge--confirmed">أثبت إسناده</span>
            <h3 class="hero-name">${escapeHtml(safeName)}</h3>
            <span class="hero-blood-type">${blood}</span>
            <div class="hero-location">
                <i class="fas fa-map-marker-alt"></i> ${loc}
            </div>
            <div class="hero-message">${escapeHtml(snippet)}</div>
            <div class="hero-stats">
                <div class="hero-stat">
                    <span class="hero-stat-number">${matchesN}</span>
                    <span class="hero-stat-label">تأكيد مزدوج</span>
                </div>
                <div class="hero-stat">
                    <span class="hero-stat-number">${msgsN}</span>
                    <span class="hero-stat-label">رسالة</span>
                </div>
            </div>
        </div>`;
}

function renderConfirmedHeroesInto(containerEl, heroes) {
    if (!containerEl) return;
    if (!heroes || heroes.length === 0) {
        containerEl.innerHTML = `
            <div class="heroes-empty-confirmed" style="text-align: center; padding: 2.5rem; color: var(--gray); grid-column: 1 / -1;">
                <i class="fas fa-user-check" style="font-size: 3rem; margin-bottom: 0.75rem; opacity: 0.35;"></i>
                <p style="font-size: 1.1rem;">لا يوجد أحد بعد ضمن <strong>فاعلي الخير المؤكدين</strong>.</p>
                <p class="form-hint">يُدرَج المتبرع هنا عندما يكون هو مستقبل الطلب ويُكمّل الطرفان (محتاج + متبرع) تأكيد الإسناد في الرسائل.</p>
            </div>`;
        return;
    }
    containerEl.innerHTML = heroes.map((h, i) => buildConfirmedHeroCardHtml(h, i)).join('');
}

async function loadHeroesGallery() {
    const grid = document.getElementById('heroesGalleryGrid');
    if (!grid) return;
    grid.innerHTML =
        '<p class="no-results" style="grid-column:1/-1;text-align:center">جاري التحميل...</p>';
    try {
        const res = await apiFetch('/donors/heroes/confirmed');
        const heroes = res.heroes || [];
        renderConfirmedHeroesInto(grid, heroes);
    } catch (e) {
        grid.innerHTML =
            '<p class="no-results" style="grid-column:1/-1">تعذر تحميل المعرض. جرّب تحديث الصفحة.</p>';
    }
}

