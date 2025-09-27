// -- بخش مدیریت قوانین داینامیک و متغیرها --
let rules = [];
const rulesContainer = document.getElementById('rules-container');
const addRuleBtn = document.getElementById('add-rule-btn');
const ruleTemplate = document.getElementById('rule-template');
const extractButton = document.getElementById('extractButton');
const daysInput = document.getElementById('daysInput');
const violationsReportDiv = document.getElementById('violations-report');
const summaryContainer = document.getElementById('summary-container'); // اطمینان از وجود این المنت

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
    const defaultRules = [
        { keyword: 'دریای کرم', day: -2, count: 2 }, 
        { keyword: 'شمسا', day: -1, count: 1 },     
        { keyword: 'دریای کرم', day: 6, count: 1 },  
        { keyword: 'شمسا', day: 6, count: 2 }       
    ];
    chrome.storage.local.get({ caravanRules: defaultRules, alertDays: 2 }, (data) => {
        rules = data.caravanRules;
        daysInput.value = data.alertDays;
        renderAllRules();
    });
});

extractButton.addEventListener('click', () => {
    saveState();
    const alertDays = parseInt(daysInput.value, 10);
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: scrapeRawTableData,
            args: [] 
        }, (injectionResults) => {
            const resultDiv = document.getElementById('result');

            if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                const rawData = injectionResults[0].result;
                
                if (rawData.length > 0) {
                    // 1. پردازش داده‌های خام و اعمال منطق تاریخ و رنگ‌بندی
                    const processedData = processDataAndApplyRules(rawData, alertDays);

                    // 2. تحلیل تخلفات (از processedData استفاده می‌شود)
                    const violations = analyzeCaravanLimits(processedData, rules);
                    violationsReportDiv.style.display = 'block';
                    if (violations.length > 0) {
                        violationsReportDiv.innerHTML = '<h4 style="direction: rtl;">بخش هشدار تخلفات</h4><ul style="direction: rtl;">' + violations.map(v => `<li>${v}</li>`).join('') + '</ul>';
                    } else {
                        violationsReportDiv.innerHTML = '<h4 style="direction: rtl;">بخش هشدار تخلفات</h4><p style="direction: rtl;">هیچ تخلفی در مورد تعداد کاروان‌ها یافت نشد.</p>';
                    }

                    // 3. ساخت جدول و گزارش آماری
                    const { htmlTable, summary } = createHtmlReportTable(processedData, alertDays);
                    resultDiv.innerHTML = htmlTable;
                    // **اضافه شدن مجدد ساخت گزارش خلاصه به DOM**
                    document.getElementById('summary-container').innerHTML = createSummaryReport(summary, alertDays); 
                } else {
                    resultDiv.innerHTML = "<p style='direction: rtl;'>هیچ ردیف معتبری (با متن مشکی) در جدول پیدا نشد.</p>";
                    document.getElementById('summary-container').innerHTML = '';
                }
                
            } else {
                resultDiv.innerHTML = "<p style='direction: rtl; color: red;'>خطا: جدول با شناسه ctl00_cp1_grdKarGroup در صفحه یافت نشد.</p>";
                document.getElementById('summary-container').innerHTML = '';
            }
        });
    });
});

/**
 * تابع تزریق شده: فقط مسئول اسکرپینگ داده خام است.
 */
function scrapeRawTableData() { 
    const mainTable = document.getElementById('ctl00_cp1_grdKarGroup'); 
    if (!mainTable) return null; 
    
    const dataRows = mainTable.querySelectorAll('tbody tr'); 
    const extractedData = [];

    dataRows.forEach(row => { 
        const cells = row.querySelectorAll('td'); 
        if (cells.length < 25) return; 
        
        const cellToCheck = cells[1]; 
        // استخراج فقط ردیف‌هایی که توسط سامانه قرمز نشده‌اند.
        const cellColor = window.getComputedStyle(cellToCheck).color; 
        if (cellColor === 'rgb(255, 99, 71)') { return; } 
        
        const rowData = { 
            province: cells[2] ? cells[2].innerText.trim() : '', 
            kargozarName: cells[3] ? cells[3].innerText.trim() : '', 
            dispatchDate: cells[4] ? cells[4].innerText.trim() : '', 
            capacity: cells[5] ? cells[5].innerText.trim() : '0', 
            pilgrimCount: cells[8] ? cells[8].innerText.trim() : '0', 
            executingCompany: cells[25] ? cells[25].innerText.trim() : '', 
            cancellationCount: cells[28] ? cells[28].innerText.trim() : '0'
        };
        extractedData.push(rowData); 
    }); 
    return extractedData;
}


/**
 * تابع پردازشگر: منطق تاریخ و رنگ‌بندی را در محیط امن popup.js اعمال می‌کند.
 */
function processDataAndApplyRules(rawData, alertDays) {
    const todayGregorian = new Date();
    // استفاده از تابع داخلی gregorianToJalali برای اطمینان از دقت
    const [todayJalaliYear, todayJalaliMonth, todayJalaliDay] = dateConverter.gregorianToJalali( 
        todayGregorian.getFullYear(), todayGregorian.getMonth() + 1, todayGregorian.getDate() 
    );
    const todayJulian = dateConverter.jalaliToJulian(todayJalaliYear, todayJalaliMonth, todayJalaliDay);

    return rawData.map(row => {
        const capacity = parseInt(row.capacity, 10);
        const pilgrimCount = parseInt(row.pilgrimCount, 10);
        const availableSpots = (!isNaN(capacity) && !isNaN(pilgrimCount)) ? capacity - pilgrimCount : 0;
        
        // وضعیت پیش‌فرض برای گروه‌هایی که خالی هستند اما فوری نیستند (نارنجی)
        let rowStatus = 'alert'; 

        if (availableSpots <= 0) {
            rowStatus = 'full';
        } else if (row.dispatchDate) {
            const [dispatchYear, dispatchMonth, dispatchDay] = row.dispatchDate.split('/').map(Number);
            const dispatchJulian = dateConverter.jalaliToJulian(dispatchYear, dispatchMonth, dispatchDay);
            
            // تفاضل دقیق روزها (نباید دیگر خطای آفست داشته باشد)
            const dayDiff = dispatchJulian - todayJulian; 
            
            // منطق اصلی رنگ‌بندی (Critical): امروز (0) تا روز هشدار
            if (dayDiff >= 0 && dayDiff <= alertDays) {
                rowStatus = 'critical';
            } else if (dayDiff < 0) {
                rowStatus = 'ignored';
            }
        }
        return { ...row, availableSpots, rowStatus };
    });
}


/**
 * تابع ساخت گزارش و جدول نهایی و تعیین رنگ ردیف‌ها
 */
function createHtmlReportTable(data, alertDays) { 
    // **برگرداندن کلاس‌های CSS برای رنگ‌بندی دقیق**
    let htmlTable = `
        <style> 
            table { width: 100%; border-collapse: collapse; font-size: 11px; direction: rtl; } 
            th, td { border: 1px solid #ccc; padding: 4px; text-align: right; } 
            th { background-color: #f2f2f2; } 
            .status-critical { background-color: #ec4f4fff !important; font-weight: bold; } /* قرمز پررنگ */
            .status-alert { background-color: #ffb0b7ff !important; } /* نارنجی کم‌رنگ */
            .status-full { background-color: #a7f8a7ff !important; color: #000000ff; }
        </style>
        <table border="1">
        <thead>
            <tr>
                <th>نام کارگزار</th>
                <th>استان</th>
                <th>شرکت مجری</th>
                <th>تاریخ اعزام</th>
                <th>ظرفیت</th>
                <th>تعداد زائر</th>
                <th>ظرفیت خالی</th>
                <th>انصرافی</th>
            </tr>
        </thead>
        <tbody>
    `;
    
    // **شمارش بر اساس rowStatus**
    const summary = { critical: 0, alert: 0, full: 0 }; 

    data.forEach(row => {
        let rowClass = '';

        if (row.rowStatus === 'full') {
            rowClass = 'class="status-full"';
            summary.full++;
        } else if (row.rowStatus === 'critical') {
            rowClass = 'class="status-critical"';
            summary.critical++;
        } else if (row.rowStatus === 'alert') {
            rowClass = 'class="status-alert"';
            summary.alert++;
        }
        
        // اگر rowStatus 'ignored' باشد (تاریخ گذشته)، آن را در شمارش نمی‌آوریم اما در جدول نمایش می‌دهیم
        if (row.rowStatus === 'ignored') {
             rowClass = 'class="status-full"'; 
        }

        htmlTable += `<tr ${rowClass}> 
            <td>${row.kargozarName}</td> 
            <td>${row.province}</td> 
            <td>${row.executingCompany}</td> 
            <td>${row.dispatchDate}</td> 
            <td>${row.capacity}</td> 
            <td>${row.pilgrimCount}</td> 
            <td>${row.availableSpots}</td> 
            <td>${row.cancellationCount}</td> 
        </tr>`;
    });
    htmlTable += '</tbody></table>';
    
    return { htmlTable, summary };
}


/**
 * تابع ساخت گزارش آماری بالای جدول (بازسازی کامل)
 */
function createSummaryReport(summary, alertDays) {
    const todayGregorian = new Date();
    const [todayJalaliYear, todayJalaliMonth, todayJalaliDay] = dateConverter.gregorianToJalali( 
        todayGregorian.getFullYear(), todayGregorian.getMonth() + 1, todayGregorian.getDate() 
    );
    const todayJalali = `${todayJalaliYear}/${String(todayJalaliMonth).padStart(2, '0')}/${String(todayJalaliDay).padStart(2, '0')}`;
    
    // محاسبه تاریخ پایان محدوده هشدار
    const endAlertGregorian = new Date(todayGregorian);
    endAlertGregorian.setDate(todayGregorian.getDate() + alertDays);
    const [endAlertY, endAlertM, endAlertD] = dateConverter.gregorianToJalali( 
        endAlertGregorian.getFullYear(), endAlertGregorian.getMonth() + 1, endAlertGregorian.getDate() 
    );
    const finalAlertDate = `${endAlertY}/${String(endAlertM).padStart(2, '0')}/${String(endAlertD).padStart(2, '0')}`;


    // محاسبه روز بعد از محدوده هشدار (شروع محدوده Alert)
    const nextDayGregorian = new Date(todayGregorian);
    nextDayGregorian.setDate(todayGregorian.getDate() + alertDays + 1);
    const [nextDayY, nextDayM, nextDayD] = dateConverter.gregorianToJalali( 
        nextDayGregorian.getFullYear(), nextDayGregorian.getMonth() + 1, nextDayGregorian.getDate() 
    );
    const nextDayFormatted = `${nextDayY}/${String(nextDayM).padStart(2, '0')}/${String(nextDayD).padStart(2, '0')}`;


    return `
        <div class="summary-report" style="direction: rtl; text-align: right;">
            <h4>خلاصه وضعیت کاروان‌ها</h4>
            <p>تاریخ امروز: <b>${todayJalali}</b></p>
            <ul>
                <li>تعداد <b>${summary.critical}</b> گروه <b>نزدیک به اعزام</b> (تا <b>${alertDays}</b> روز آینده یعنی <b>${finalAlertDate}</b>) هستند و هنوز تکمیل نشده‌اند.</li>
                <li>تعداد <b>${summary.alert}</b> گروه، اعزام آن‌ها بعد از <b>${nextDayFormatted}</b> است و هنوز تکمیل نشده‌اند.</li>
                <li>تعداد <b>${summary.full}</b> گروه، تکمیل شده‌اند (ظرفیت خالی صفر یا منفی).</li>
            </ul>
        </div>
    `;
}


/**
 * تابع تحلیلگر تخلفات (شمارش کاروان)
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
        const isFriday = dayInfo.dayOfWeek === 6;

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


/**
 * تابع محاسبه روز هفته شمسی (بازگشت به متد دقیق)
 */
function getJalaliDayOfWeek(jDateStr) {
    // استفاده از تبدیل به میلادی و متد getDay برای دقت بالا در روز هفته
    const gregorianDate = dateConverter.jalaliToGregorian(jDateStr);
    
    let dayOfWeekGregorian = gregorianDate.getDay(); 
    
    // تبدیل روز هفته میلادی (0=یکشنبه تا 6=شنبه) به شمسی (0=شنبه تا 6=جمعه)
    return (dayOfWeekGregorian + 1) % 7; 
}


// توابع کمکی تبدیل تاریخ (الگوریتم‌های ریاضی استاندارد)
const dateConverter = {
    // تبدیل تاریخ میلادی به شمسی
    gregorianToJalali: (gy, gm, gd) => { 
        var g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; 
        var jy = (gy > 1600) ? 979 : 0; 
        gy -= (gy > 1600) ? 1600 : 621; 
        var gy2 = (gm > 2) ? (gy + 1) : gy; 
        var days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1]; 
        jy += 33 * Math.floor(days / 12053); 
        days %= 12053; 
        jy += 4 * Math.floor(days / 1461); 
        days %= 1461; 
        if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; } 
        var jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30); 
        var jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30)); 
        return [jy, jm, jd]; 
    },
    // تبدیل تاریخ شمسی به میلادی
    jalaliToGregorian: (j_date_str) => { 
        if (!j_date_str) return new Date(); // در صورت خطا، تاریخ امروز میلادی را برمی‌گرداند.
        const [j_y, j_m, j_d] = j_date_str.split('/').map(Number); 
        
        const jalali_to_jd = (y, m, d) => { 
            let epbase, epyear; 
            epbase = y - ((y >= 0) ? 474 : 473); 
            epyear = 474 + (epbase % 2820); 
            return d + ((m <= 6) ? ((m - 1) * 31) : (((m - 7) * 30) + 186)) + Math.floor(((epyear * 682) - 110) / 2816) + (epyear - 1) * 365 + Math.floor(epbase / 2820) * 1029983 + (474 * 365) + 1948320; 
        }; 
        const jd_to_gregorian = (jd) => { 
            let z = jd + 0.5;
            let w = Math.floor((z - 1867216.25) / 36524.25); 
            let x = w - Math.floor(w / 4); 
            let b = z + 1 + x + 1524; 
            let c = Math.floor((b - 122.1) / 365.25); 
            let d = Math.floor(365.25 * c); 
            let e = Math.floor((b - d) / 30.6001); 
            let day = b - d - Math.floor(30.6001 * e); 
            let month = e - ((e > 13) ? 13 : 1); 
            let y = c - ((month > 2) ? 4716 : 4715); 
            return new Date(y, month - 1, day);
        }; 
        const jd = jalali_to_jd(j_y, j_m, j_d); 
        return jd_to_gregorian(jd); 
    },
    // تبدیل تاریخ شمسی به عدد روز جولیان (Julian Day Number)
    jalaliToJulian: (jy, jm, jd) => { 
        var a = jy;
        var b = jm;
        var c = jd;

        var jdn = 1948320; 

        jdn += 365 * (a - 475) + 
               Math.floor((33 * (a - 475) + 3) / 132) + 
               Math.floor((a - 475) / 4) - 
               Math.floor((a - 475) / 100) + 
               Math.floor((a - 475) / 400);

        if (b <= 6) {
            jdn += (b - 1) * 31 + c;
        } else {
            jdn += 186 + (b - 7) * 30 + c;
        }
        
        return jdn;
    }
};