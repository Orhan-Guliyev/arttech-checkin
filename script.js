const SUPABASE_URL = 'https://nehoucfpvltpnfconjme.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LMoXPJd71hhZL72xzElE7A_Bh_efcGW';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const userDisplay = document.getElementById('user-display');
const toggleWorkBtn = document.getElementById('toggle-work-btn');
const workerPanel = document.getElementById('worker-panel');
const bossPanel = document.getElementById('boss-panel');
const geoStatus = document.getElementById('geo-status');
const userStatusBadge = document.getElementById('user-status-badge');

let currentUser = null;
let currentWorkLogId = null;

let workerMap = null;
let workerMapMarkers = [];
let bossMap = null;
let bossMapMarkers = [];

let currentWorkerLogs = [];
let currentBossLogs = [];
let globalLogsData = {};

const greenIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const redIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

document.addEventListener('DOMContentLoaded', checkSession);
document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('toggle-work-btn').addEventListener('click', handleWorkAction);
document.getElementById('boss-filter').addEventListener('change', loadBossData);

async function login() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('auth-error');
    
    if (!email || !password) {
        errorEl.textContent = 'Заполните email и пароль.';
        return;
    }

    errorEl.textContent = 'Вход...';
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    
    if (error) {
        errorEl.textContent = getErrorMessage(error);
    } else {
        errorEl.textContent = '';
        checkSession();
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    authSection.classList.remove('hidden');
    appSection.classList.add('hidden');
    currentUser = null;
    
    if (workerMap) { workerMap.remove(); workerMap = null; }
    if (bossMap) { bossMap.remove(); bossMap = null; }
}

async function checkSession() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
        currentUser = user;
        authSection.classList.add('hidden');
        appSection.classList.remove('hidden');
        userDisplay.textContent = user.email;

        if (user.email === 'boss@company.com') {
            workerPanel.classList.add('hidden');
            bossPanel.classList.remove('hidden');
            userStatusBadge.classList.add('hidden');
            initMap('boss');
            loadBossData();
        } else {
            workerPanel.classList.remove('hidden');
            bossPanel.classList.add('hidden');
            userStatusBadge.classList.remove('hidden');
            initMap('worker');
            checkCurrentStatus();
            loadWorkerHistory();
        }
    } else {
        authSection.classList.remove('hidden'); 
        appSection.classList.add('hidden');
    }
}

// --- Секция сотрудника ---

function updateStatusBadge(isOnWork) {
    if (isOnWork) {
        userStatusBadge.textContent = 'На работе';
        userStatusBadge.className = 'status-badge status-on';
    } else {
        userStatusBadge.textContent = 'Не на работе';
        userStatusBadge.className = 'status-badge status-off';
    }
}

async function checkCurrentStatus() {
    const { data, error } = await supabaseClient
        .from('work_logs')
        .select('*')
        .eq('user_id', currentUser.id)
        .is('check_out_time', null)
        .order('check_in_time', { ascending: false })
        .limit(1);

    if (data && data.length > 0) {
        currentWorkLogId = data[0].id;
        setButtonState('checkout');
        updateStatusBadge(true);
        showShiftOnMap('worker', data[0]); 
    } else {
        currentWorkLogId = null;
        setButtonState('checkin');
        updateStatusBadge(false);
    }
}

function setButtonState(state) {
    toggleWorkBtn.className = ''; 
    if (state === 'checkin') {
        toggleWorkBtn.textContent = 'Начать работу';
        toggleWorkBtn.classList.add('btn-checkin');
    } else {
        toggleWorkBtn.textContent = 'Завершить работу';
        toggleWorkBtn.classList.add('btn-checkout');
    }
}

async function handleWorkAction() {
    geoStatus.textContent = 'Получение точных координат...';
    toggleWorkBtn.disabled = true;

    const successCallback = async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        if (!currentWorkLogId) await performCheckIn(lat, lng);
        else await performCheckOut(lat, lng);
        toggleWorkBtn.disabled = false;
    };

    const finalErrorCallback = async (error) => {
        console.warn('Геолокация недоступна:', error.message);
        geoStatus.textContent = 'Сохранено без координат.';
        if (!currentWorkLogId) await performCheckIn(null, null);
        else await performCheckOut(null, null);
        toggleWorkBtn.disabled = false;
    };

    navigator.geolocation.getCurrentPosition(
        successCallback,
        (err) => {
            geoStatus.textContent = 'Поиск базовых координат...';
            navigator.geolocation.getCurrentPosition(
                successCallback,
                finalErrorCallback,
                { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
            );
        },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
    );
}

async function performCheckIn(lat, lng) {
    const { data, error } = await supabaseClient
        .from('work_logs')
        .insert([{
            user_id: currentUser.id,
            user_email: currentUser.email,
            check_in_lat: lat,
            check_in_lng: lng,
            check_in_time: new Date().toISOString()
        }])
        .select();

    if (!error && data) {
        currentWorkLogId = data[0].id;
        setButtonState('checkout');
        updateStatusBadge(true);
        geoStatus.textContent = 'Успешно: Вы на работе.';
        showShiftOnMap('worker', data[0]);
        loadWorkerHistory();
    } else {
        geoStatus.textContent = 'Ошибка чек-ина.';
    }
}

async function performCheckOut(lat, lng) {
    const { data: logData } = await supabaseClient.from('work_logs').select('check_in_time').eq('id', currentWorkLogId).single();
    
    const checkOutTime = new Date();
    const checkInTime = new Date(logData.check_in_time);
    const durationMins = Math.round((checkOutTime - checkInTime) / 60000);

    const { data, error } = await supabaseClient
        .from('work_logs')
        .update({
            check_out_time: checkOutTime.toISOString(),
            check_out_lat: lat,
            check_out_lng: lng,
            duration_minutes: durationMins
        })
        .eq('id', currentWorkLogId)
        .select();

    if (!error && data) {
        currentWorkLogId = null;
        setButtonState('checkin');
        updateStatusBadge(false);
        geoStatus.textContent = `Успешно: Работа завершена. Отработано: ${durationMins} мин.`;
        showShiftOnMap('worker', data[0]);
        loadWorkerHistory();
    } else {
        geoStatus.textContent = 'Ошибка чек-аута.';
    }
}

function getErrorMessage(error) {
    if (!error) return '';
    
    const message = error.message.toLowerCase();

    if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
        return 'Неверный email или пароль.';
    }
    if (message.includes('email not confirmed')) {
        return 'Email еще не подтвержден. Проверьте вашу почту.';
    }
    if (message.includes('user not found')) {
        return 'Пользователь с таким email не найден.';
    }
    if (message.includes('too many requests') || message.includes('rate limit')) {
        return 'Слишком много попыток входа. Попробуйте позже.';
    }
    if (message.includes('network') || message.includes('failed to fetch')) {
        return 'Ошибка сети. Проверьте подключение к интернету.';
    }

    return 'Ошибка входа: ' + error.message;
}

// --- Работа с картами ---

function initMap(type) {
    const defaultCoords = [51.505, -0.09];
    if (type === 'worker' && !workerMap) {
        workerMap = L.map('worker-map').setView(defaultCoords, 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(workerMap);
    } else if (type === 'boss' && !bossMap) {
        bossMap = L.map('boss-map').setView(defaultCoords, 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(bossMap);
    }
}

function clearMap(type) {
    if (type === 'worker') {
        workerMapMarkers.forEach(m => workerMap.removeLayer(m));
        workerMapMarkers = [];
    } else if (type === 'boss') {
        bossMapMarkers.forEach(m => bossMap.removeLayer(m));
        bossMapMarkers = [];
    }
}

function showShiftOnMap(type, log) {
    clearMap(type);
    const targetMap = type === 'worker' ? workerMap : bossMap;
    const markersArray = type === 'worker' ? workerMapMarkers : bossMapMarkers;

    if (!targetMap) return;

    setTimeout(() => {
        targetMap.invalidateSize();
    }, 100);

    let bounds = [];

    if (log.check_in_lat && log.check_in_lng) {
        const timeIn = new Date(log.check_in_time).toLocaleTimeString();
        const mIn = L.marker([log.check_in_lat, log.check_in_lng], { icon: greenIcon }).addTo(targetMap)
                     .bindPopup(`<b>🟢 Чек-ин</b><br>Время: ${timeIn}`);
        markersArray.push(mIn);
        bounds.push([log.check_in_lat, log.check_in_lng]);
    }

    if (log.check_out_lat && log.check_out_lng) {
        let outLat = log.check_out_lat;
        let outLng = log.check_out_lng;

        // Смещение маркера ухода при совпадении координат с приходом
        if (log.check_in_lat === outLat && log.check_in_lng === outLng) {
            outLat -= 0.00015;
            outLng += 0.00015;
        }

        const timeOut = new Date(log.check_out_time).toLocaleTimeString();
        const mOut = L.marker([outLat, outLng], { icon: redIcon }).addTo(targetMap)
                      .bindPopup(`<b>🔴 Чек-аут</b><br>Время: ${timeOut}`);
        markersArray.push(mOut);
        bounds.push([outLat, outLng]);
    }

    if (bounds.length > 0) {
        targetMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    }
}

window.viewShiftMap = function(logId, type) {
    const log = globalLogsData[logId];
    if (log) {
        showShiftOnMap(type, log);
    }
};

// --- Форматирование и статистика ---

function formatDate(isoString) {
    if (!isoString) return 'В процессе';
    return new Date(isoString).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function formatJustDate(isoString) {
    if (!isoString) return '';
    return new Date(isoString).toLocaleDateString();
}

function formatCoords(lat, lng) {
    if (lat === null || lat === undefined || lng === null || lng === undefined) {
        return 'Нет данных';
    }
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function formatMinutesToHours(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} ч ${mins} мин`;
}

function calculateStats(logs, prefix) {
    if (!logs) logs = [];

    const now = new Date();

    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    let weekMinutes = 0;
    let monthMinutes = 0;
    let totalMinutes = 0;

    logs.forEach(log => {
        if (log.duration_minutes && log.check_in_time) {
            const checkInDate = new Date(log.check_in_time);
            const duration = log.duration_minutes;

            totalMinutes += duration;
            if (checkInDate >= startOfMonth) {
                monthMinutes += duration;
            }
            if (checkInDate >= startOfWeek) {
                weekMinutes += duration;
            }
        }
    });

    document.getElementById(`${prefix}-week-time`).textContent = formatMinutesToHours(weekMinutes);
    document.getElementById(`${prefix}-month-time`).textContent = formatMinutesToHours(monthMinutes);
    document.getElementById(`${prefix}-total-time`).textContent = formatMinutesToHours(totalMinutes);
}

async function loadWorkerHistory() {
    const { data } = await supabaseClient
        .from('work_logs')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('check_in_time', { ascending: false });
    
    currentWorkerLogs = data || [];
    globalLogsData = {};
    if (data) {
        data.forEach(log => { globalLogsData[log.id] = log; });
    }

    renderTable(data, 'history-table', false, 'worker');
    calculateStats(data, 'worker');
    
    if (data && data.length > 0) {
        showShiftOnMap('worker', data[0]);
    }
}

async function loadBossData() {
    const filter = document.getElementById('boss-filter').value;
    let query = supabaseClient.from('work_logs').select('*').order('check_in_time', { ascending: false });
    
    if (filter !== 'all') {
        query = query.eq('user_email', filter);
    }

    const { data } = await query;
    currentBossLogs = data || [];

    globalLogsData = {};
    if (data) {
        data.forEach(log => { globalLogsData[log.id] = log; });
    }

    renderTable(data, 'boss-table', true, 'boss');
    calculateStats(data, 'boss');

    if (data && data.length > 0) {
        showShiftOnMap('boss', data[0]);
    } else {
        clearMap('boss');
    }
}

function renderTable(data, tableId, showEmail, mapType) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    tbody.innerHTML = '';
    
    if (!data || data.length === 0) {
        const colCount = showEmail ? 7 : 5;
        tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;">Нет данных</td></tr>`;
        return;
    }

    data.forEach(row => {
        const tr = document.createElement('tr');
        
        const dateStr = formatJustDate(row.check_in_time);
        const checkInStr = formatDate(row.check_in_time);
        const checkOutStr = formatDate(row.check_out_time);
        const durationStr = row.duration_minutes !== null ? `${row.duration_minutes} мин` : '-';
        
        const isWorking = row.check_out_time === null;
        const statusHtml = isWorking 
            ? `<span class="status-badge status-on" style="font-size:11px; padding:3px 6px;">На работе</span>`
            : `<span class="status-badge status-off" style="font-size:11px; padding:3px 6px;">Завершено</span>`;

        const inCoords = formatCoords(row.check_in_lat, row.check_in_lng);
        const outCoords = formatCoords(row.check_out_lat, row.check_out_lng);

        const hasCoords = (row.check_in_lat !== null && row.check_in_lng !== null) || 
                          (row.check_out_lat !== null && row.check_out_lng !== null);

        let html = '';
        if (showEmail) {
            html += `<td>${row.user_email}</td>`;
            html += `<td>${statusHtml}</td>`;
            html += `<td>${dateStr}</td>`;
        } else {
            html += `<td>${dateStr}</td>`;
        }
        
        html += `
            <td><b>Приход:</b> ${checkInStr}<br><b>Уход:</b> ${checkOutStr}</td>
            <td>${durationStr}</td>
            <td class="coord-text">
                <b>Вход:</b> ${inCoords}<br>
                <b>Выход:</b> ${outCoords}
            </td>
            <td>
                ${hasCoords 
                    ? `<button class="btn-small" onclick="viewShiftMap('${row.id}', '${mapType}')">Отобразить</button>` 
                    : `<button class="btn-small" disabled>Нет данных</button>`}
            </td>
        `;
        
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

// --- Экспорт данных ---

function prepareExportData(logs, isBoss) {
    return logs.map(row => {
        const item = {};
        if (isBoss) {
            item['Сотрудник'] = row.user_email || '';
            item['Статус смены'] = row.check_out_time === null ? 'На работе' : 'Завершено';
        }
        item['Дата'] = formatJustDate(row.check_in_time);
        item['Время прихода'] = formatDate(row.check_in_time);
        item['Время ухода'] = formatDate(row.check_out_time);
        item['Отработано (мин)'] = row.duration_minutes !== null ? row.duration_minutes : '-';
        item['Отработано (часы)'] = row.duration_minutes !== null ? (row.duration_minutes / 60).toFixed(2) : '-';
        item['Координаты прихода'] = formatCoords(row.check_in_lat, row.check_in_lng);
        item['Координаты ухода'] = formatCoords(row.check_out_lat, row.check_out_lng);
        return item;
    });
}

function exportToCSV(logs, filename, isBoss) {
    const formattedData = prepareExportData(logs, isBoss);
    if (formattedData.length === 0) {
        alert('Нет данных для экспорта');
        return;
    }

    const headers = Object.keys(formattedData[0]);
    let csvContent = '\uFEFF';
    csvContent += headers.join(';') + '\n';

    formattedData.forEach(row => {
        const values = headers.map(header => `"${(row[header] || '').toString().replace(/"/g, '""')}"`);
        csvContent += values.join(';') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportToExcel(logs, filename, isBoss) {
    const formattedData = prepareExportData(logs, isBoss);
    if (formattedData.length === 0) {
        alert('Нет данных для экспорта');
        return;
    }

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Отчёт');
    XLSX.writeFile(workbook, filename);
}

window.exportWorkerCSV = () => exportToCSV(currentWorkerLogs, `my_work_history_${new Date().toISOString().slice(0,10)}.csv`, false);
window.exportWorkerExcel = () => exportToExcel(currentWorkerLogs, `my_work_history_${new Date().toISOString().slice(0,10)}.xlsx`, false);

window.exportBossCSV = () => exportToCSV(currentBossLogs, `company_work_logs_${new Date().toISOString().slice(0,10)}.csv`, true);
window.exportBossExcel = () => exportToExcel(currentBossLogs, `company_work_logs_${new Date().toISOString().slice(0,10)}.xlsx`, true);