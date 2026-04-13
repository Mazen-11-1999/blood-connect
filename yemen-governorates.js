/**
 * المحافظات اليمنية (على البرّ الرئيسي) — للاختيار من قائمة ثابتة عند التسجيل والبحث.
 * أرخبيل سقطرى مُستثنى لأنه جزيرة منفصلة.
 * المنطقة/الشارع يبقى نصاً حراً يكتبه المستخدم (قرية، مديرية، وصاب، إلخ).
 */
const YEMEN_GOVERNORATES = [
    'أمانة العاصمة',
    'محافظة صنعاء',
    'عدن',
    'لحج',
    'أبين',
    'الضالع',
    'تعز',
    'الحديدة',
    'إب',
    'ذمار',
    'البيضاء',
    'ريمة',
    'المحويت',
    'حجة',
    'عمران',
    'صعدة',
    'الجوف',
    'مأرب',
    'المهرة',
    'حضرموت',
    'شبوة'
];

function fillGovernorateSelect(selectEl, includePlaceholder, placeholderText) {
    if (!selectEl) return;
    const first = includePlaceholder
        ? `<option value="">${placeholderText || '—'}</option>`
        : '';
    const opts = YEMEN_GOVERNORATES.map(
        g => `<option value="${g.replace(/"/g, '&quot;')}">${g}</option>`
    ).join('');
    selectEl.innerHTML = first + opts;
}

function initYemenGovernorateDropdowns() {
    fillGovernorateSelect(
        document.getElementById('governorate'),
        true,
        'اختر المحافظة'
    );
    const searchGov = document.getElementById('searchGovernorate');
    if (searchGov) {
        searchGov.innerHTML = '<option value="">جميع المحافظات</option>';
        YEMEN_GOVERNORATES.forEach(g => {
            searchGov.innerHTML += `<option value="${g.replace(/"/g, '&quot;')}">${g}</option>`;
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { YEMEN_GOVERNORATES, fillGovernorateSelect, initYemenGovernorateDropdowns };
}
