// ——— واجهة الخادم (منصة كاملة) ———
const API_BASE = '/api';

async function apiFetch(path, options = {}) {
    const token = localStorage.getItem('bloodConnect_token');
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(API_BASE + path, { ...options, headers });
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch (_) {
        data = {};
    }
    if (!res.ok) {
        const msg = data.error
            || (Array.isArray(data.errors) && data.errors[0] && (data.errors[0].msg || data.errors[0].message))
            || 'Request failed';
        throw new Error(msg);
    }
    return data;
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
        const result = await apiFetch('/messages', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        return result.data;
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

    updateMessageCount() {
        const currentUser = this.getCurrentUser();
        const badge = document.getElementById('messageCount');
        if (!currentUser || !badge) return;
        apiFetch('/messages?userId=' + encodeURIComponent(currentUser.id) + '&type=all')
            .then(result => {
                const n = result.unreadCount || 0;
                badge.textContent = n;
                badge.style.display = n > 0 ? 'inline' : 'none';
            })
            .catch(() => {});
    }
};

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
    } else {
        if (typeof stopAnnouncementCarousel === 'function') {
            stopAnnouncementCarousel();
        }
        if (typeof stopAwarenessCardQuotes === 'function') {
            stopAwarenessCardQuotes();
        }
    }

    // تحميل محتوى الصفحة
    try {
        if (typeof loadPageContent === 'function') {
            loadPageContent(pageId);
        }
    } catch (error) {
        console.error('خطأ في تحميل محتوى الصفحة:', error);
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
                if (typeof loadHeroes === 'function') {
                    setTimeout(() => {
                        loadHeroes();
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

let awarenessBarInitialized = false;

const LS_STATS_EXIT = 'bc_stats_last_exit_v1';
const SS_STATS_PREV = 'bc_stats_prev_poll_v1';

/** آخر إحصائيات لحفظها عند مغادرة الصفحة (مقارنة الزيارات) */
let lastStatsSnapshot = null;
/** يُعرض فرق «منذ آخر زيارة» مرة واحدة لكل تحميل للصفحة */
let motivationalVisitDeltaShown = false;

/** شرائح الإعلان التوعوي (تتبدّل كل 3 ثوانٍ) */
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
    }, 3000);
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

/** عبارات قصيرة دوّارة داخل بطاقة الهدف (كل 3 ثوانٍ) */
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
    }, 3000);
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

const REGISTER_SUCCESS_QUOTES = [
    'أثمن ما تملكه ليس في رصيدك، بل في الأثر الذي تتركه في حياة الآخرين.',
    'قد تكون بالنسبة للعالم مجرد شخص، لكنك بالنسبة لشخص واحد قد تكون العالم كله.',
    'نحن لا نعيش لأنفسنا فقط؛ جمال الحياة يكمن في أن نكون سنداً لبعضنا.'
];

let registerSuccessQuoteInterval = null;

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
            }, 4000);
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

    const platformLine = `إجمالي المنصة: ${formatArNumber(totalDonors)} متبرعاً مسجّلاً · ${formatArNumber(totalMsg)} طلب مساعدة · ${formatArNumber(matches)} تأكيد مزدوج ناجح.`;
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
                        bits.push(`+<strong>${formatArNumber(dD)}</strong> متبرعاً على المنصة`);
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
                    bits.push(`+<strong>${formatArNumber(dD)}</strong> متبرعاً على المنصة`);
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

/** بطاقة الهدف — نصوص إنسانية بلا أسلوب تقني؛ أرقام واضحة من الخادم */
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
            `هذا الشهر: سجّل معنا <strong>${m}</strong> متبرعاً — بفضل الله ثم بكم تحقّق هدفنا البالغ <strong>${g}</strong> متبرعاً جديداً.`;
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
            `هدفنا هذا الشهر: <strong>${g}</strong> متبرعاً جديداً — وسجّل معنا حتى الآن <strong>${m}</strong> متبرعاً.`;
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
            `شكراً لـ <strong>${m}</strong> متبرعاً معنا هذا الشهر — أنتم من يصنع الفرق.` +
            (weekCount > 0
                ? `<br><span class="awareness-footer-note">هذا الأسبوع انضم <strong>${formatArNumber(
                      weekCount
                  )}</strong> منهم.</span>`
                : '');
    } else if (weekCount === 0) {
        footerEl.textContent = 'هذا الأسبوع: كن أول من يضيف بصمة خير جديدة.';
    } else {
        footerEl.innerHTML = `هذا الأسبوع: <strong>${formatArNumber(
            weekCount
        )}</strong> متبرعاً انضموا — شكراً لكم.`;
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
        console.warn('تعذر تحميل الإحصائيات (شغّل الخادم: npm start)', e);
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

// تسجيل متبرع جديد (حساب على الخادم)
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
        healthNotes
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

    resultsContainer.innerHTML = donors.map(donor => `
        <div class="donor-card">
            <div class="donor-info">
                <span class="blood-badge">${donor.bloodType}</span>
                <h3>${donor.fullName}</h3>
                <p><i class="fas fa-birthday-cake"></i> العمر: ${donor.age != null ? donor.age + ' سنة' : '—'}</p>
                <p><i class="fas fa-map-marker-alt"></i> ${donor.governorate || ''} - ${donor.region || ''}</p>
                ${donor.showPhone && donor.phone ?
            `<p><i class="fas fa-phone"></i> ${donor.phone}</p>` :
            '<p><i class="fas fa-phone-slash"></i> الرقم مخفي - استخدم الرسائل للتواصل</p>'
        }
            </div>
            <div>
                <button class="btn btn-primary" onclick="openMessageModal('${donor.id}', '${donor.fullName}')">
                    <i class="fas fa-envelope"></i> إرسال رسالة
                </button>
            </div>
        </div>
    `).join('');
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

    let newMessage;
    try {
        newMessage = await dataManager.addMessage(message);
    } catch (err) {
        alert('فشل إرسال الرسالة: ' + (err.message || err));
        return;
    }

    const rawPhone = typeof recipient.phone === 'string' && recipient.phone.includes('مخفي')
        ? null
        : recipient.phone;

    if (isUrgent) {
        await NotificationManager.sendUrgentNotification({
            ...newMessage,
            recipientPhone: rawPhone
        });

        let smsSent = false;
        if (rawPhone) {
            const internationalPhone = formatPhoneNumber(rawPhone);
            if (internationalPhone) {
                try {
                    const response = await fetch('/api/sms/urgent', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            to: internationalPhone,
                            recipientName: recipient.fullName,
                            bloodType: recipient.bloodType,
                            urgency: 'عاجل جداً',
                            location: `${recipient.governorate || ''} - ${recipient.region || ''}`
                        })
                    });
                    if (response.ok) smsSent = true;
                } catch (error) {
                    console.error('SMS:', error);
                }
            }
        }

        if (smsSent) {
            alert('✅ تم إرسال رسالة طارئة وتمت محاولة إشعار المتبرع عبر SMS');
        } else {
            alert('✅ تم إرسال رسالة طارئة! (إشعارات المتصفح)' +
                (rawPhone ? ' — إن لم يُرسل SMS فتحقق من إعداد Twilio في الخادم' : ''));
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
    const mid = String(msg.id).replace(/'/g, '');

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
                    يمكنك أن تشكر المتبرع بأنه <strong>البطل</strong> الذي سهّل عليك هذا الخير — يظهر ذلك في سجل المنصة للأبطال المؤكدين.
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
                <button type="button" class="btn btn-confirm-needy" onclick="confirmHelpAsNeedy('${mid}')">
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
                <button type="button" class="btn btn-confirm-donor" onclick="confirmHelpAsDonor('${mid}')">
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
            '<p class="no-results">تعذر تحميل الرسائل. تأكد من تشغيل الخادم.</p>';
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
        const otherPerson = isIncoming ? msg.senderName : msg.recipientName;
        const date = new Date(msg.createdAt).toLocaleDateString('ar-SA', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // شارة الطوارئ
        const urgentBadge = msg.isUrgent ?
            '<span class="urgent-badge"><i class="fas fa-exclamation-triangle"></i> حالة طارئة</span>' : '';

        // وقت الحاجة
        const neededTime = msg.neededDateTime ?
            `<div class="needed-time">
                <i class="fas fa-clock"></i> 
                <strong>وقت الحاجة:</strong> ${new Date(msg.neededDateTime).toLocaleString('ar-SA', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })}
            </div>` : '';

        return `
            <div class="message-card ${msg.isUrgent ? 'urgent-message' : ''} ${!msg.read && isIncoming ? 'unread' : ''}">
                <div class="message-header">
                    <span class="message-sender">
                        ${isIncoming ? '<i class="fas fa-inbox"></i> من: ' : '<i class="fas fa-paper-plane"></i> إلى: '}
                        ${otherPerson}
                        ${urgentBadge}
                    </span>
                    <span class="message-date">${date}</span>
                </div>
                ${neededTime}
                <div class="message-content">${msg.message || msg.content || ''}</div>
                ${msg.phone ? `
                    <div class="message-phone">
                        <i class="fas fa-phone"></i> رقم للتواصل: <strong>${msg.phone}</strong>
                        ${msg.isUrgent ? '<a href="tel:' + msg.phone + '" class="call-btn"><i class="fas fa-phone-alt"></i> اتصل الآن</a>' : ''}
                    </div>
                ` : ''}
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

    profileContent.innerHTML = `
        <div class="profile-header">
            <div class="profile-avatar">
                ${currentUser.fullName.charAt(0)}
            </div>
            <h2>${currentUser.fullName}</h2>
            ${currentUser.email ? `<p class="form-hint">${currentUser.email}</p>` : ''}
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
        alert('✅ تم حذف الحساب وجميع الرسائل المرتبطة به من الخادم.');
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
    }, 5000); // كل 5 ثواني
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

    // إعادة تشغيل السلايدر التلقائي بعد 3 ثواني
    setTimeout(() => {
        startSlider();
    }, 3000);
}

// تسجيل Service Worker للإشعارات الفورية
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('Service Worker مسجل بنجاح:', registration.scope);
            })
            .catch((error) => {
                console.log('فشل تسجيل Service Worker:', error);
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
                NotificationManager.requestPermission();
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

            // فحص الرسائل الجديدة كل 30 ثانية
            if (typeof setInterval !== 'undefined') {
                setInterval(function () {
                    if (typeof checkNewMessages === 'function') {
                        try {
                            checkNewMessages();
                        } catch (checkError) {
                            console.error('خطأ في checkNewMessages:', checkError);
                        }
                    }
                }, 30000);
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

    // تهيئة الخدمة
    static init() {
        // فحص دوري كل 2 ثانية للرسائل الجديدة
        this.checkInterval = setInterval(() => {
            this.checkForNewMessages();
        }, 2000);

        // فحص فوري عند تحميل الصفحة
        setTimeout(() => {
            this.checkForNewMessages();
        }, 1000);

        // الاستماع لتغييرات LocalStorage (للتبويبات الأخرى)
        window.addEventListener('storage', (e) => {
            if (e.key === 'bloodConnect_messages') {
                setTimeout(() => {
                    this.checkForNewMessages();
                }, 500);
            }
        });
    }

    // فحص الرسائل الجديدة
    static checkForNewMessages() {
        const currentUser = dataManager.getCurrentUser();
        if (!currentUser) return;

        dataManager.getMessagesForUser(currentUser.id).then(messages => {
            const unreadMessages = messages.filter(m =>
                m.recipientId === currentUser.id &&
                !m.read &&
                m.id !== this.lastShownMessageId
            );
            if (unreadMessages.length > 0) {
                const newMessage = unreadMessages[0];
                this.showSMSNotification(newMessage);
                this.lastShownMessageId = newMessage.id;
            }
        }).catch(() => {});
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
        let messageHTML = `<div class="message-text">${messageData.message || messageData.content || 'لا توجد رسالة'}</div>`;

        // إضافة وقت الحاجة إذا كان موجود
        if (messageData.neededDateTime) {
            const neededTime = new Date(messageData.neededDateTime).toLocaleString('ar-YE', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
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

// فحص الرسائل الجديدة
function checkNewMessages() {
    const currentUser = dataManager.getCurrentUser();
    if (!currentUser) return;

    dataManager.getMessagesForUser(currentUser.id).then(messages => {
        const unreadMessages = messages.filter(m =>
            m.recipientId === currentUser.id && !m.read
        );
        if (unreadMessages.length > 0) {
            unreadMessages.forEach(msg => {
                if (msg.isUrgent) {
                    NotificationManager.sendUrgentNotification(msg);
                } else {
                    NotificationManager.sendNormalNotification(msg);
                }
            });
            dataManager.updateMessageCount();
        }
    }).catch(() => {});
}

// إدارة سلايدر صور الأبطال
let heroImageSlide = 0;
let heroImageInterval;

function initHeroImagesSlider() {
    const slides = document.querySelectorAll('.image-slide');
    if (slides.length === 0) return;

    heroImageInterval = setInterval(() => {
        slides[heroImageSlide].classList.remove('active');
        heroImageSlide = (heroImageSlide + 1) % slides.length;
        slides[heroImageSlide].classList.add('active');
    }, 4000); // تغيير الصورة كل 4 ثواني
}

function stopHeroImagesSlider() {
    if (heroImageInterval) {
        clearInterval(heroImageInterval);
    }
}

// رسائل تحفيزية للأبطال
const heroMessages = [
    "أنت بطل حقيقي، عطاؤك ينقذ الأرواح",
    "كل قطرة دم منك تعني حياة جديدة",
    "شكراً لأنك تختار العطاء",
    "أنت مصدر الأمل للكثيرين",
    "عطاؤك صدقة جارية",
    "أنت تجسد معنى الإنسانية",
    "شكراً لأنك موجود",
    "أنت فارس الخير الحقيقي"
];

// تحميل قائمة الأبطال
async function loadHeroes() {
    const heroesList = document.getElementById('heroesList');
    if (!heroesList) return;

    let donorStats;
    try {
        const res = await apiFetch('/donors/heroes/list');
        donorStats = res.heroes || [];
    } catch (e) {
        heroesList.innerHTML =
            '<p class="no-results">تعذر تحميل القائمة. شغّل الخادم (npm start).</p>';
        return;
    }

    if (donorStats.length === 0) {
        heroesList.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--gray);">
                <i class="fas fa-users" style="font-size: 4rem; margin-bottom: 1rem; opacity: 0.3;"></i>
                <p style="font-size: 1.2rem;">لا يوجد متبرعين مسجلين بعد</p>
                <p>كن أول بطل ينضم إلينا!</p>
            </div>
        `;
        return;
    }

    heroesList.innerHTML = donorStats.map((hero, index) => {
        const randomMessage = heroMessages[Math.floor(Math.random() * heroMessages.length)];
        const heroInitial = hero.fullName.charAt(0);

        return `
            <div class="hero-card" style="animation-delay: ${index * 0.1}s;">
                <div class="hero-avatar">
                    ${heroInitial}
                </div>
                <h3 class="hero-name">${hero.fullName}</h3>
                <span class="hero-blood-type">${hero.bloodType}</span>
                <div class="hero-location">
                    <i class="fas fa-map-marker-alt"></i> ${hero.governorate || ''} - ${hero.region || ''}
                </div>
                <div class="hero-message">
                    ${randomMessage}
                </div>
                <div class="hero-stats">
                    <div class="hero-stat">
                        <span class="hero-stat-number">${hero.successfulMatches}</span>
                        <span class="hero-stat-label">تأكيد مزدوج</span>
                    </div>
                    <div class="hero-stat">
                        <span class="hero-stat-number">${hero.totalMessages}</span>
                        <span class="hero-stat-label">رسالة</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // بدء سلايدر الصور
    stopHeroImagesSlider();
    setTimeout(() => {
        initHeroImagesSlider();
    }, 100);
}

