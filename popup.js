// --- متغیرهای سراسری برای مرتب‌سازی، فیلتر و داده‌ها ---
let currentData = [];
let sortColumn = 'dispatchDate'; // مرتب‌سازی پیش‌فرض بر اساس تاریخ اعزام
let sortDirection = 'asc'; // جهت مرتب‌سازی پیش‌فرض (صعودی)
let currentFilters = {}; // ذخیره فیلترهای فعال
// --- پایان متغیرهای سراسری ---

// -- بخش مدیریت قوانین داینامیک و متغیرها --
let rules = [];
const rulesContainer = document.getElementById('rules-container');
const addRuleBtn = document.getElementById('add-rule-btn');
const ruleTemplate = document.getElementById('rule-template');
const extractButton = document.getElementById('extractButton');
const daysInput = document.getElementById('daysInput');
const violationsReportDiv = document.getElementById('violations-report');

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
                    // 1. پردازش داده‌ها و ذخیره در متغیر جهانی
                    currentData = processDataAndApplyRules(rawData, alertDays);
                    
                    // 2. تحلیل تخلفات (بدون تغییر)
                    const violations = analyzeCaravanLimits(currentData, rules);
                    violationsReportDiv.style.display = 'block';
                    if (violations.length > 0) {
                        violationsReportDiv.innerHTML = '<h4 style="direction: rtl;">بخش هشدار تخلفات</h4><ul style="direction: rtl;">' + violations.map(v => `<li>${v}</li>`).join('') + '</ul>';
                    } else {
                        violationsReportDiv.innerHTML = '<h4 style="direction: rtl;">بخش هشدار تخلفات</h4><p style="direction: rtl;">هیچ تخلفی در مورد تعداد کاروان‌ها یافت نشد.</p>';
                    }

                    // 3. مرتب‌سازی و فیلتر اولیه و ساخت جدول
                    renderTableAndSummary(currentData, alertDays);
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
 * تابع جدید: مرتب‌سازی داده‌های ذخیره شده و رندر مجدد جدول و خلاصه
 * **توجه: منطق حفظ فوکوس در اینجا اضافه شده است**
 */
function renderTableAndSummary(data, alertDays) {
    // 1. **ذخیره حالت فوکوس قبل از رندر مجدد**
    let focusedElement = document.activeElement;
    // بررسی می‌کنیم که عنصر فوکوس شده یک فیلد فیلتر با data-key معتبر باشد
    let focusedKey = focusedElement && focusedElement.dataset && focusedElement.dataset.key ? focusedElement.dataset.key : null;
    let cursorPosition = focusedElement ? focusedElement.selectionStart : null;

    // 2. اعمال فیلتر بر داده‌های خام
    const filteredData = applyFilters(data, currentFilters);

    // 3. اعمال مرتب‌سازی بر داده‌های فیلتر شده
    const sortedData = [...filteredData];
    sortedData.sort(getSortComparator(sortColumn, sortDirection));

    const { htmlTable, summary } = createHtmlReportTable(sortedData, alertDays);
    document.getElementById('result').innerHTML = htmlTable;
    document.getElementById('summary-container').innerHTML = createSummaryReport(summary, alertDays);
    
    // 4. اعمال Event Listenerها برای مرتب‌سازی و فیلتر
    attachSortListeners(alertDays);
    attachFilterListeners(alertDays); 
    
    // 5. **بازیابی فوکوس و مکان نما**
    if (focusedKey) {
        // پیدا کردن فیلد ورودی که به تازگی ساخته شده است
        const newFocusedInput = document.querySelector(`#filter-row input[data-key="${focusedKey}"]`);
        if (newFocusedInput) {
            // بازگرداندن فوکوس
            newFocusedInput.focus();
            // بازگرداندن مکان نما به موقعیت قبلی
            if (cursorPosition !== null && cursorPosition <= newFocusedInput.value.length) {
                newFocusedInput.setSelectionRange(cursorPosition, cursorPosition);
            }
        }
    }
}

/**
 * تابع جدید: منطق اعمال فیلترها
 */
function applyFilters(data, filters) {
    return data.filter(row => {
        for (const key in filters) {
            const filterValue = String(filters[key]).trim();
            if (!filterValue) continue;

            let rowValue = String(row[key]);
            const isNumericColumn = ['capacity', 'pilgrimCount', 'availableSpots', 'cancellationCount'].includes(key);

            if (isNumericColumn) {
                const numericRowValue = parseInt(rowValue, 10) || 0;
                
                // فیلتر عددی (مثال: > 20, < 10, 15-25)
                const comparisonMatch = filterValue.match(/([<>]=?)\s*(\d+)/);
                const rangeMatch = filterValue.match(/^(\d+)-(\d+)$/);
                const exactMatch = filterValue.match(/^\d+$/);

                if (comparisonMatch) {
                    const operator = comparisonMatch[1];
                    const target = parseInt(comparisonMatch[2], 10);
                    // بررسی شرط
                    if (operator === '>' && numericRowValue <= target) return false;
                    if (operator === '>=' && numericRowValue < target) return false;
                    if (operator === '<' && numericRowValue >= target) return false;
                    if (operator === '<=' && numericRowValue > target) return false;
                } else if (rangeMatch) {
                    const min = parseInt(rangeMatch[1], 10);
                    const max = parseInt(rangeMatch[2], 10);
                    if (numericRowValue < min || numericRowValue > max) return false;
                } else if (exactMatch && numericRowValue !== parseInt(filterValue, 10)) {
                    return false;
                }
            } else {
                // فیلتر متنی (جستجوی زیررشته)
                if (!rowValue.toLowerCase().includes(filterValue.toLowerCase())) {
                    return false;
                }
            }
        }
        return true;
    });
}


/**
 * تابع جدید: منطق مقایسه برای مرتب‌سازی
 */
function getSortComparator(column, direction) {
    return (a, b) => {
        let valA = a[column];
        let valB = b[column];

        // تبدیل نوع برای مقایسه صحیح (عددی یا تاریخ)
        if (['capacity', 'pilgrimCount', 'availableSpots', 'cancellationCount'].includes(column)) {
            valA = parseInt(valA, 10) || 0;
            valB = parseInt(valB, 10) || 0;
        } else if (column === 'dispatchDate') {
            // تبدیل تاریخ شمسی (YYYY/MM/DD) به یک رشته عددی قابل مقایسه (YYYYMMDD)
            valA = a.dispatchDate ? a.dispatchDate.replace(/\//g, '') : '00000000';
            valB = b.dispatchDate ? b.dispatchDate.replace(/\//g, '') : '00000000';
        }
        
        let comparison = 0;
        if (valA > valB) {
            comparison = 1;
        } else if (valA < valB) {
            comparison = -1;
        }
        
        // اعمال جهت مرتب‌سازی
        return direction === 'asc' ? comparison : comparison * -1;
    };
}


/**
 * تابع جدید: اضافه کردن Event Listener به سر ستون‌ها
 */
function attachSortListeners(alertDays) {
    const headers = document.querySelectorAll('#result table thead tr:first-child th'); // فقط ردیف اول (عنوان‌ها)
    const columnKeys = ['kargozarName', 'province', 'executingCompany', 'dispatchDate', 'capacity', 'pilgrimCount', 'availableSpots', 'cancellationCount'];
    
    headers.forEach((header, index) => {
        const key = columnKeys[index];
        header.style.cursor = 'pointer';
        
        // اضافه کردن نشانگر مرتب‌سازی (مثلث بالا یا پایین)
        if (key === sortColumn) {
            header.classList.add(sortDirection);
            header.innerHTML = header.innerText.replace(/ [▲▼]/g, '') + (sortDirection === 'asc' ? ' ▲' : ' ▼');
        } else {
            header.innerHTML = header.innerText.replace(/ [▲▼]/g, '');
        }

        header.onclick = () => {
            if (sortColumn === key) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = key;
                sortDirection = 'asc';
            }
            renderTableAndSummary(currentData, alertDays);
        };
    });
}

/**
 * تابع جدید: اضافه کردن Event Listener به فیلدهای فیلتر
 */
function attachFilterListeners(alertDays) {
    const filterInputs = document.querySelectorAll('#filter-row input');
    
    filterInputs.forEach(input => {
        // بازگرداندن مقدار فیلتر قبلی
        input.value = currentFilters[input.dataset.key] || '';
        
        // افزودن Event Listener برای هر بار تغییر در ورودی
        input.oninput = (e) => {
            const key = e.target.dataset.key;
            currentFilters[key] = e.target.value;
            // رندر مجدد جدول با فیلتر جدید (با منطق حفظ فوکوس در renderTableAndSummary)
            renderTableAndSummary(currentData, alertDays);
        };
    });
}


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
 * تابع پردازشگر: منطق تاریخ و رنگ‌بندی را اعمال می‌کند.
 */
function processDataAndApplyRules(rawData, alertDays) {
    const todayGregorian = new Date();
    const [todayJalaliYear, todayJalaliMonth, todayJalaliDay] = dateConverter.gregorianToJalali( 
        todayGregorian.getFullYear(), todayGregorian.getMonth() + 1, todayGregorian.getDate() 
    );
    const todayJulian = dateConverter.jalaliToJulian(todayJalaliYear, todayJalaliMonth, todayJalaliDay);

    return rawData.map(row => {
        const capacity = parseInt(row.capacity, 10);
        const pilgrimCount = parseInt(row.pilgrimCount, 10);
        const availableSpots = (!isNaN(capacity) && !isNaN(pilgrimCount)) ? capacity - pilgrimCount : 0;
        
        let rowStatus = 'alert'; 

        if (availableSpots <= 0) {
            rowStatus = 'full';
        } else if (row.dispatchDate) {
            const [dispatchYear, dispatchMonth, dispatchDay] = row.dispatchDate.split('/').map(Number);
            const dispatchJulian = dateConverter.jalaliToJulian(dispatchYear, dispatchMonth, dispatchDay);
            
            const dayDiff = dispatchJulian - todayJulian; 
            
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
    const columnKeys = ['kargozarName', 'province', 'executingCompany', 'dispatchDate', 'capacity', 'pilgrimCount', 'availableSpots', 'cancellationCount'];
    
    let htmlTable = `
        <style> 
            table { width: 100%; border-collapse: collapse; font-size: 11px; direction: rtl; } 
            th, td { border: 1px solid #ccc; padding: 4px; text-align: right; } 
            th { background-color: #f2f2f2; } 
            
            /* رنگ‌های درخواستی شما */
            .status-critical { background-color: #f15555 !important; font-weight: bold; } 
            .status-alert { background-color: #fdbaba !important; } 
            .status-full { background-color: #a3f3a3 !important; color: #000000; } 
            
            /* استایل‌های جدید برای فیلتر و مرتب‌سازی */
            #result table thead tr:first-child th { cursor: pointer; user-select: none; }
            #result table thead tr:first-child th.asc { background-color: #e6f7ff; }
            #result table thead tr:first-child th.desc { background-color: #ffe6e6; }

            #filter-row input { 
                width: 90%; 
                box-sizing: border-box; 
                direction: rtl; 
                font-family: 'Vazirmatn', Tahoma, sans-serif;
                font-size: 10px;
                padding: 2px;
                border: 1px solid #ccc;
                border-radius: 2px;
            }
            #filter-row td { padding: 2px 4px; }
        </style>
        <div id="summary-container"></div>
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
            <tr id="filter-row">
                ${columnKeys.map(key => `<td><input type="text" data-key="${key}" placeholder="فیلتر..."></td>`).join('')}
            </tr>
        </thead>
        <tbody>
    `;
    
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
 * تابع ساخت گزارش آماری بالای جدول
 */
function createSummaryReport(summary, alertDays) {
    const todayGregorian = new Date();
    const [todayJalaliYear, todayJalaliMonth, todayJalaliDay] = dateConverter.gregorianToJalali( 
        todayGregorian.getFullYear(), todayGregorian.getMonth() + 1, todayGregorian.getDate() 
    );
    const todayJalali = `${todayJalaliYear}/${String(todayJalaliMonth).padStart(2, '0')}/${String(todayJalaliDay).padStart(2, '0')}`;
    
    const endAlertGregorian = new Date(todayGregorian);
    endAlertGregorian.setDate(todayGregorian.getDate() + alertDays);
    const [endAlertY, endAlertM, endAlertD] = dateConverter.gregorianToJalali( 
        endAlertGregorian.getFullYear(), endAlertGregorian.getMonth() + 1, endAlertGregorian.getDate() 
    );
    const finalAlertDate = `${endAlertY}/${String(endAlertM).padStart(2, '0')}/${String(endAlertD).padStart(2, '0')}`;

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
 * تابع محاسبه روز هفته شمسی 
 */
function getJalaliDayOfWeek(jDateStr) {
    const gregorianDate = dateConverter.jalaliToGregorian(jDateStr);
    
    let dayOfWeekGregorian = gregorianDate.getDay(); 
    
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
        if (!j_date_str) return new Date(); 
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