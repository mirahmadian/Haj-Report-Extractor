// -- بخش مدیریت قوانین داینامیک --
let rules = [];
const rulesContainer = document.getElementById('rules-container');
const addRuleBtn = document.getElementById('add-rule-btn');
const ruleTemplate = document.getElementById('rule-template');
const extractButton = document.getElementById('extractButton');
const daysInput = document.getElementById('daysInput');

function saveState() {
    chrome.storage.local.set({ caravanRules: rules, alertDays: parseInt(daysInput.value, 10) || 2 });
}

function renderRule(rule, index) {
    const ruleRow = document.importNode(ruleTemplate.content, true).firstElementChild;
    const keywordInput = ruleRow.querySelector('.company-keyword');
    const daySelect = ruleRow.querySelector('.day-select');
    const limitInput = ruleRow.querySelector('.limit-count');
    const deleteBtn = ruleRow.querySelector('.delete-rule-btn');

    keywordInput.value = rule.keyword;
    daySelect.value = rule.day;
    limitInput.value = rule.count;

    keywordInput.addEventListener('input', (e) => { rules[index].keyword = e.target.value; saveState(); });
    daySelect.addEventListener('change', (e) => { rules[index].day = parseInt(e.target.value, 10); saveState(); });
    limitInput.addEventListener('input', (e) => { rules[index].count = parseInt(e.target.value, 10); saveState(); });
    deleteBtn.addEventListener('click', () => {
        rules.splice(index, 1);
        saveState();
        renderAllRules();
    });

    rulesContainer.appendChild(ruleRow);
}

function renderAllRules() {
    rulesContainer.innerHTML = '';
    rules.forEach((rule, index) => renderRule(rule, index));
}

addRuleBtn.addEventListener('click', () => {
    rules.push({ keyword: '', day: -1, count: 0 });
    renderAllRules();
    saveState();
});

// -- منطق اصلی افزونه --
document.addEventListener('DOMContentLoaded', () => {
    // اصلاح قوانین پیش‌فرض بر اساس (شنبه=0، یکشنبه=1،...، جمعه=6)
    const defaultRules = [
        { keyword: 'دریای کرم', day: -2, count: 2 }, // شنبه تا پنجشنبه
        { keyword: 'شمسا', day: -1, count: 1 },     // هر روز
        { keyword: 'دریای کرم', day: 6, count: 1 },  // جمعه
        { keyword: 'شمسا', day: 6, count: 2 }       // جمعه
    ];
    chrome.storage.local.get({ caravanRules: defaultRules, alertDays: 2 }, (data) => {
        rules = data.caravanRules;
        daysInput.value = data.alertDays;
        renderAllRules();
    });
});

extractButton.addEventListener('click', () => {
    saveState();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: scrapeExactTableData
        }, (injectionResults) => {
            const resultDiv = document.getElementById('result');
            const violationsReportDiv = document.getElementById('violations-report');

            if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                const tableData = injectionResults[0].result;
                const violations = analyzeCaravanLimits(tableData, rules);
                
                violationsReportDiv.style.display = 'block';
                if (violations.length > 0) {
                    violationsReportDiv.innerHTML = '<h4>بخش هشدار تخلفات</h4><ul>' + violations.map(v => `<li>${v}</li>`).join('') + '</ul>';
                } else {
                    violationsReportDiv.innerHTML = '<h4>بخش هشدار تخلفات</h4><p>هیچ تخلفی در مورد تعداد کاروان‌ها یافت نشد.</p>';
                }

                if (tableData.length > 0) {
                    resultDiv.innerHTML = createHtmlReportTable(tableData, parseInt(daysInput.value, 10));
                } else {
                    resultDiv.innerHTML = "<p>هیچ ردیف معتبری (با متن مشکی) در جدول پیدا نشد.</p>";
                }
            } else {
                resultDiv.innerText = "خطا: جدول با شناسه ctl00_cp1_grdKarGroup در صفحه یافت نشد.";
            }
        });
    });
});

/**
 * تابع جدید و اصلاح شده برای محاسبه روز هفته شمسی
 */
function getJalaliDayOfWeek(jDateStr) {
    const refDate = '1404/07/08';
    const refDayOfWeek = 3; // سه‌شنبه در تقویم ما (شنبه=0, یکشنبه=1, ...)

    const [refY, refM, refD] = refDate.split('/').map(Number);
    const [jY, jM, jD] = jDateStr.split('/').map(Number);
    
    const julianRef = dateConverter.jalaliToJulian(refY, refM, refD);
    const julianDate = dateConverter.jalaliToJulian(jY, jM, jD);
    
    const dayDifference = julianDate - julianRef;
    const dayOfWeek = (refDayOfWeek + dayDifference) % 7;
    
    return (dayOfWeek + 7) % 7;
}

/**
 * تابع تحلیلگر تخلفات (با اولویت‌بندی قوانین و استفاده از تابع جدید)
 */
function analyzeCaravanLimits(data, currentRules) {
    const dailyData = {};
    const violations = [];
    const dayNames = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
    const checkedViolations = new Set(); 

    data.forEach(row => {
        const date = row.dispatchDate;
        if (!date) return;
        if (!dailyData[date]) {
            const dayOfWeek = getJalaliDayOfWeek(date);
            dailyData[date] = { dayOfWeek: dayOfWeek, counts: {} };
        }
        currentRules.forEach(rule => {
            if (rule.keyword && row.executingCompany.includes(rule.keyword)) {
                dailyData[date].counts[rule.keyword] = (dailyData[date].counts[rule.keyword] || 0) + 1;
            }
        });
    });

    for (const date in dailyData) {
        const dayInfo = dailyData[date];
        const isFriday = dayInfo.dayOfWeek === 6; // جمعه

        currentRules.forEach(rule => {
            if (!rule.keyword) return;

            const specificRule = currentRules.find(r => r.keyword === rule.keyword && r.day === dayInfo.dayOfWeek);
            const weekdayRule = currentRules.find(r => r.keyword === rule.keyword && r.day === -2);
            const genericRule = currentRules.find(r => r.keyword === rule.keyword && r.day === -1);
            
            let ruleToApply = null;
            if (specificRule) {
                ruleToApply = specificRule;
            } else if (!isFriday && weekdayRule) {
                ruleToApply = weekdayRule;
            } else if (genericRule) {
                ruleToApply = genericRule;
            }
            
            if (!ruleToApply) return;

            const actualCount = dayInfo.counts[rule.keyword] || 0;
            const expectedCount = ruleToApply.count;
            const violationId = `${date}-${rule.keyword}`; 

            if (actualCount !== expectedCount && !checkedViolations.has(violationId)) {
                const dayName = dayNames[dayInfo.dayOfWeek];
                violations.push(`تاریخ ${date} (${dayName}): شرکت با کلیدواژه "${rule.keyword}" ${actualCount} کاروان دارد (قانون: ${expectedCount}).`);
                checkedViolations.add(violationId);
            }
        });
    }
    return violations;
}


// توابع کمکی دیگر (بدون تغییر)
const dateConverter = { 
  gregorianToJalali: (gy, gm, gd) => { const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; const gy2 = (gm > 2) ? (gy + 1) : gy; let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1]; let jy = -1595 + (33 * Math.floor(days / 12053)); days %= 12053; jy += 4 * Math.floor(days / 1461); days %= 1461; if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; } const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30); const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30)); return [jy, jm, jd]; },
  jalaliToGregorian: (j_date_str) => { if (!j_date_str) return null; const [j_y, j_m, j_d] = j_date_str.split('/').map(Number); const jalali_to_jd = (y, m, d) => { let epbase, epyear; epbase = y - ((y >= 0) ? 474 : 473); epyear = 474 + (epbase % 2820); return d + ((m <= 7) ? ((m - 1) * 31) : (((m - 1) * 30) + 6)) + Math.floor(((epyear * 682) - 110) / 2816) + (epyear - 1) * 365 + Math.floor(epbase / 2820) * 1029983 + (474 * 365) + 8585; }; const jd_to_gregorian = (jd) => { let z = Math.floor(jd + 0.5); let w = Math.floor((z - 1867216.25) / 36524.25); let x = w - Math.floor(w / 4); let b = z + 1 + x + 1524; let c = Math.floor((b - 122.1) / 365.25); let d = Math.floor(365.25 * c); let e = Math.floor((b - d) / 30.6001); let day = b - d - Math.floor(30.6001 * e); let month = e - ((e > 13) ? 13 : 1); let y = c - ((month > 2) ? 4716 : 4715); return [y, month, day]; }; const jd = jalali_to_jd(j_y, j_m, j_d); const [g_y, g_m, g_d] = jd_to_gregorian(jd); return new Date(g_y, g_m - 1, g_d); },
  jalaliToJulian: (jy, jm, jd) => { const r = (jy + ((jm > 6) ? 1 : 0) - 474) % 2820; const p = 474 + r; return (1948321 + 1029983 * Math.floor((jy - 474) / 2820) + 365 * (p - 1) + Math.floor((682 * p - 110) / 2816) + ((jm > 6) ? (jm - 7) * 30 + 186 : (jm - 1) * 31) + jd); }
};
function createHtmlReportTable(data, alertDays) { 
    let table = `<style> table { width: 100%; border-collapse: collapse; font-size: 11px; } th, td { border: 1px solid #ccc; padding: 4px; text-align: right; } th { background-color: #f2f2f2; } .alert-row { background-color: #ffcccc !important; font-weight: bold; } </style>`;
    table += `<table border="1"><thead> <tr> <th>نام کارگزار</th> <th>استان</th> <th>شرکت مجری</th> <th>تاریخ اعزام</th> <th>ظرفیت</th> <th>تعداد زائر</th> <th>ظرفیت خالی</th> <th>انصرافی</th> </tr> </thead><tbody>`;
    const todayGregorian = new Date(); const [todayJalaliYear, todayJalaliMonth, todayJalaliDay] = dateConverter.gregorianToJalali( todayGregorian.getFullYear(), todayGregorian.getMonth() + 1, todayGregorian.getDate() ); const todayJulian = dateConverter.jalaliToJulian(todayJalaliYear, todayJalaliMonth, todayJalaliDay);
    data.forEach(row => { const capacity = parseInt(row.capacity, 10); const pilgrimCount = parseInt(row.pilgrimCount, 10); const availableSpots = (!isNaN(capacity) && !isNaN(pilgrimCount)) ? capacity - pilgrimCount : 0; let rowClass = ''; if (row.dispatchDate) { const [dispatchYear, dispatchMonth, dispatchDay] = row.dispatchDate.split('/').map(Number); const dispatchJulian = dateConverter.jalaliToJulian(dispatchYear, dispatchMonth, dispatchDay); const dayDiff = dispatchJulian - todayJulian; if (availableSpots > 0 && dayDiff >= 0 && dayDiff <= alertDays) { rowClass = 'class="alert-row"'; } }
    table += `<tr ${rowClass}> <td>${row.kargozarName}</td> <td>${row.province}</td> <td>${row.executingCompany}</td> <td>${row.dispatchDate}</td> <td>${capacity}</td> <td>${pilgrimCount}</td> <td>${availableSpots}</td> <td>${row.cancellationCount}</td> </tr>`; });
    table += '</tbody></table>'; return table;
}
function scrapeExactTableData() { 
    const mainTable = document.getElementById('ctl00_cp1_grdKarGroup'); if (!mainTable) return null; const dataRows = mainTable.querySelectorAll('tbody tr'); const extractedData = [];
    dataRows.forEach(row => { const cells = row.querySelectorAll('td'); if (cells.length < 25) return; const cellToCheck = cells[1]; if (cellToCheck) { const cellColor = window.getComputedStyle(cellToCheck).color; if (cellColor === 'rgb(255, 99, 71)') { return; } }
    const rowData = { province: cells[2] ? cells[2].innerText.trim() : '', kargozarName: cells[3] ? cells[3].innerText.trim() : '', dispatchDate: cells[4] ? cells[4].innerText.trim() : '', capacity: cells[5] ? cells[5].innerText.trim() : '0', pilgrimCount: cells[8] ? cells[8].innerText.trim() : '0', executingCompany: cells[25] ? cells[25].innerText.trim() : '', cancellationCount: cells[28] ? cells[28].innerText.trim() : '0' };
    extractedData.push(rowData); }); return extractedData;
}
