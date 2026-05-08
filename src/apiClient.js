const vscode = require('vscode');
const https = require('https');
const http = require('http');

// Кеш для ролей
let rolesCache = null;
let lastFetchTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 минут

// Кеш для текущего пользователя
let currentUserCache = null;
let lastUserFetchTime = null;
const USER_CACHE_DURATION = 10 * 60 * 1000; // 10 минут

// Кеш для логов времени по карточкам
const timeLogsCache = new Map();
const LOGS_CACHE_DURATION = 2 * 60 * 1000; // 2 минуты

async function getCurrentUser() {
    // Проверяем кеш
    if (currentUserCache && lastUserFetchTime && (Date.now() - lastUserFetchTime) < USER_CACHE_DURATION) {
        return currentUserCache;
    }
    
    const settings = vscode.workspace.getConfiguration('kaitenTimeLogger');
    const baseUrl = settings.get('baseUrl');
    const token = settings.get('apiToken');
    
    const url = new URL(`${baseUrl}/api/latest/users/current`);
    
    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'VSCode-KaitenTimeLogger/1.0.0'
        }
    };
    
    return new Promise((resolve, reject) => {
        const protocol = url.protocol === 'https:' ? https : http;
        
        const req = protocol.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const user = JSON.parse(data);
                        currentUserCache = user;
                        lastUserFetchTime = Date.now();
                        resolve(user);
                    } catch (e) {
                        reject(new Error(`Ошибка парсинга данных пользователя: ${e.message}`));
                    }
                } else {
                    let errorMessage = `Ошибка получения пользователя: ${res.statusCode}`;
                    if (res.statusCode === 401) {
                        errorMessage += ' - Неверный токен';
                    } else if (res.statusCode === 403) {
                        errorMessage += ' - Доступ запрещен';
                    } else if (res.statusCode === 404) {
                        errorMessage += ' - Пользователь не найден';
                    }
                    reject(new Error(errorMessage));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(new Error(`Не удалось получить данные пользователя: ${error.message}`));
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Таймаут получения данных пользователя'));
        });
        
        req.end();
    });
}

async function getUserRoles() {
    // Проверяем кеш
    if (rolesCache && lastFetchTime && (Date.now() - lastFetchTime) < CACHE_DURATION) {
        return rolesCache;
    }
    
    const settings = vscode.workspace.getConfiguration('kaitenTimeLogger');
    const baseUrl = settings.get('baseUrl');
    const token = settings.get('apiToken');
    
    const url = new URL(`${baseUrl}/api/latest/user-roles`);
    
    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'VSCode-KaitenTimeLogger/1.0.0'
        }
    };
    
    return new Promise((resolve, reject) => {
        const protocol = url.protocol === 'https:' ? https : http;
        
        const req = protocol.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const roles = JSON.parse(data);
                        // Убеждаемся, что это массив
                        const rolesArray = Array.isArray(roles) ? roles : [];
                        
                        // Добавляем стандартную роль Employee если её нет
                        const hasEmployee = rolesArray.some(role => role.id === -1);
                        if (!hasEmployee) {
                            rolesArray.unshift({
                                id: -1,
                                name: "Employee (по умолчанию)",
                                uid: "employee_default"
                            });
                        }
                        
                        rolesCache = rolesArray;
                        lastFetchTime = Date.now();
                        resolve(rolesArray);
                    } catch (e) {
                        reject(new Error(`Ошибка парсинга ролей: ${e.message}`));
                    }
                } else {
                    let errorMessage = `Ошибка получения ролей: ${res.statusCode}`;
                    if (res.statusCode === 401) {
                        errorMessage += ' - Неверный токен';
                    } else if (res.statusCode === 403) {
                        errorMessage += ' - Доступ запрещен';
                    }
                    reject(new Error(errorMessage));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(new Error(`Не удалось получить роли: ${error.message}`));
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Таймаут получения ролей'));
        });
        
        req.end();
    });
}

// Новая функция для получения логов времени по карточке
async function getCardTimeLogs(cardId, forDate = null, personal = true) {
    // Проверяем кеш
    const cacheKey = `${cardId}_${forDate || 'all'}_${personal}`;
    if (timeLogsCache.has(cacheKey)) {
        const cached = timeLogsCache.get(cacheKey);
        if (Date.now() - cached.timestamp < LOGS_CACHE_DURATION) {
            return cached.data;
        }
    }
    
    const settings = vscode.workspace.getConfiguration('kaitenTimeLogger');
    const baseUrl = settings.get('baseUrl');
    const token = settings.get('apiToken');
    
    const url = new URL(`${baseUrl}/api/latest/cards/${cardId}/time-logs`);
    
    if (forDate) {
        url.searchParams.append('for_date', forDate);
    }
    if (personal) {
        url.searchParams.append('personal', 'true');
    }
    
    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'VSCode-KaitenTimeLogger/1.0.0'
        }
    };
    
    return new Promise((resolve, reject) => {
        const protocol = url.protocol === 'https:' ? https : http;
        
        const req = protocol.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        let logs = JSON.parse(data);
                        if (!Array.isArray(logs)) {
                            logs = [];
                        }
                        
                        // Кешируем результат
                        timeLogsCache.set(cacheKey, {
                            data: logs,
                            timestamp: Date.now()
                        });
                        
                        resolve(logs);
                    } catch (e) {
                        resolve([]);
                    }
                } else if (res.statusCode === 404) {
                    resolve([]); // Нет логов - не ошибка
                } else {
                    let errorMessage = `Ошибка получения логов: ${res.statusCode}`;
                    if (res.statusCode === 401) {
                        errorMessage += ' - Неверный токен';
                    } else if (res.statusCode === 403) {
                        errorMessage += ' - Доступ запрещен';
                    }
                    reject(new Error(errorMessage));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(new Error(`Не удалось получить логи времени: ${error.message}`));
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Таймаут получения логов времени'));
        });
        
        req.end();
    });
}

async function sendTimeLog(timeLogData) {
    const settings = vscode.workspace.getConfiguration('kaitenTimeLogger');
    const baseUrl = settings.get('baseUrl');
    const token = settings.get('apiToken');
    
    // Формируем URL для запроса
    const url = new URL(`${baseUrl}/api/latest/cards/${timeLogData.card_id}/time-logs`);
    
    // Подготавливаем данные для отправки согласно API Kaiten
    const payload = {
        role_id: timeLogData.role_id,
        time_spent: timeLogData.time_spent,
        for_date: timeLogData.for_date,
        comment: timeLogData.comment || ''
    };
    
    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'VSCode-KaitenTimeLogger/1.0.0'
        }
    };
    
    console.log('Sending request to:', url.href);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    
    return new Promise((resolve, reject) => {
        const protocol = url.protocol === 'https:' ? https : http;
        
        const req = protocol.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log('Response status:', res.statusCode);
                console.log('Response data:', data);
                
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const response = JSON.parse(data);
                        // Очищаем кеш для этой карточки после успешной отправки
                        const cacheKey = `${timeLogData.card_id}_${timeLogData.for_date}_true`;
                        timeLogsCache.delete(cacheKey);
                        resolve(response);
                    } catch (e) {
                        resolve({ success: true, data: data });
                    }
                } else {
                    let errorMessage = `API вернул ошибку ${res.statusCode}`;
                    
                    try {
                        const error = JSON.parse(data);
                        if (error.message) {
                            errorMessage += `: ${error.message}`;
                        }
                    } catch (e) {
                        if (data) {
                            errorMessage += `: ${data}`;
                        }
                    }
                    
                    // Обработка специфичных кодов ошибок Kaiten
                    if (res.statusCode === 401) {
                        errorMessage += '\nНеверный или отсутствующий токен. Проверьте настройки API токена.';
                    } else if (res.statusCode === 403) {
                        errorMessage += '\nДоступ запрещен. Убедитесь, что у вас есть права на логирование времени для этой карточки.';
                    } else if (res.statusCode === 404) {
                        errorMessage += '\nКарточка с указанным ID не найдена. Проверьте ID карточки.';
                    } else if (res.statusCode === 400) {
                        errorMessage += '\nОшибка валидации данных. Проверьте правильность заполнения полей.';
                    } else if (res.statusCode === 402) {
                        errorMessage += '\nФункция логирования времени недоступна в вашем тарифе Kaiten.';
                    }
                    
                    reject(new Error(errorMessage));
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('Request error:', error);
            reject(new Error(`Не удалось отправить запрос: ${error.message}. Проверьте соединение и базовый URL.`));
        });
        
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Таймаут запроса. Сервер не отвечает в течение 30 секунд.'));
        });
        
        req.write(JSON.stringify(payload));
        req.end();
    });
}

// Функция для форматирования времени
function formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
        return `${mins}м`;
    } else if (mins === 0) {
        return `${hours}ч`;
    } else {
        return `${hours}ч ${mins}м`;
    }
}

// Функция для получения роли пользователя в читаемом виде
function getUserRoleName(roleEnum) {
    switch(roleEnum) {
        case 1: return 'Владелец';
        case 2: return 'Пользователь';
        case 3: return 'Деактивирован';
        default: return 'Неизвестно';
    }
}

// Функция для получения прав доступа в читаемом виде
function getAppsPermissionsName(permissions) {
    switch(permissions) {
        case '0': return 'Нет доступа';
        case '1': return 'Полный доступ к Kaiten';
        case '2': return 'Гостевой доступ к Kaiten';
        case '4': return 'Доступ только к Service Desk';
        case '5': return 'Полный доступ к Kaiten и Service Desk';
        case '6': return 'Гостевой доступ к Kaiten и Service Desk';
        default: return 'Неизвестно';
    }
}

module.exports = { 
    sendTimeLog, 
    getUserRoles, 
    getCurrentUser,
    getCardTimeLogs,
    formatTime,
    getUserRoleName,
    getAppsPermissionsName
};