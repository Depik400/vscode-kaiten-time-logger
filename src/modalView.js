const vscode = require('vscode');
const { getUserRoles, getCurrentUser, getCardTimeLogs, formatTime } = require('./apiClient');

class CommitModalPanel {
    constructor(context) {
        this.context = context;
        this.panel = null;
        this.resolve = null;
        this.detectedCardInfo = null;
        this.currentCardId = null;
    }

    async show(detectedCardInfo = null) {
        return new Promise(async (resolve) => {
            this.resolve = resolve;
            this.detectedCardInfo = detectedCardInfo;
            if (detectedCardInfo) {
                this.currentCardId = detectedCardInfo.cardId;
            }
            
            // Получаем роли и информацию о пользователе перед отображением
            let roles = [];
            let currentUser = null;
            let rolesError = null;
            let userError = null;
            let timeLogs = null;
            let timeLogsError = null;
            
            try {
                [roles, currentUser] = await Promise.all([
                    getUserRoles(),
                    getCurrentUser()
                ]);
                
                // Если есть ID карточки, получаем логи времени
                if (this.currentCardId) {
                    try {
                        timeLogs = await getCardTimeLogs(this.currentCardId);
                        console.log('Time logs loaded:', timeLogs);
                    } catch (error) {
                        timeLogsError = error.message;
                        console.error('Error loading time logs:', error);
                    }
                }
            } catch (error) {
                if (error.message.includes('ролей')) {
                    rolesError = error.message;
                } else if (error.message.includes('пользователя')) {
                    userError = error.message;
                }
                roles = [{ id: -1, name: "Employee (по умолчанию)" }];
            }
            
            this.panel = vscode.window.createWebviewPanel(
                'commitModal',
                'Логирование времени в Kaiten',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.webview.html = this.getHtmlContent(roles, rolesError, currentUser, userError, detectedCardInfo, timeLogs, timeLogsError);
            this.setupMessageHandler();
            
            // Отправляем роли в webview после загрузки
            this.panel.webview.onDidReceiveMessage(async (message) => {
                if (message.command === 'getRoles') {
                    try {
                        const freshRoles = await getUserRoles();
                        this.panel.webview.postMessage({
                            command: 'rolesLoaded',
                            roles: freshRoles,
                            lastRoleId: this.getLastSelectedRole()
                        });
                    } catch (error) {
                        this.panel.webview.postMessage({
                            command: 'rolesError',
                            error: error.message
                        });
                    }
                } else if (message.command === 'saveRoleId') {
                    await this.saveLastSelectedRole(message.roleId);
                } else if (message.command === 'webviewReady') {
                    if (this.detectedCardInfo) {
                        this.panel.webview.postMessage({
                            command: 'fillCardId',
                            cardInfo: this.detectedCardInfo
                        });
                    }
                } else if (message.command === 'refreshTimeLogs') {
                    // Обновляем логи времени при изменении ID карточки
                    try {
                        const logs = await getCardTimeLogs(message.cardId);
                        this.panel.webview.postMessage({
                            command: 'updateTimeLogs',
                            logs: logs,
                            totalTime: this.calculateTotalTime(logs)
                        });
                    } catch (error) {
                        this.panel.webview.postMessage({
                            command: 'timeLogsError',
                            error: error.message
                        });
                    }
                }
            });
        });
    }
    
    calculateTotalTime(logs) {
        if (!logs || !Array.isArray(logs)) return 0;
        const total = logs.reduce((sum, log) => sum + (log.time_spent || 0), 0);
        return total;
    }
    
    getLastSelectedRole() {
        const config = vscode.workspace.getConfiguration('kaitenTimeLogger');
        return config.get('lastSelectedRole') || -1;
    }
    
    async saveLastSelectedRole(roleId) {
        const config = vscode.workspace.getConfiguration('kaitenTimeLogger');
        await config.update('lastSelectedRole', roleId, vscode.ConfigurationTarget.Global);
    }

    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    getUserRoleText(roleEnum) {
        switch(roleEnum) {
            case 1: return 'Владелец';
            case 2: return 'Пользователь';
            case 3: return 'Деактивирован';
            default: return 'Неизвестно';
        }
    }
    
    formatTimeLogs(logs) {
        if (!logs || logs.length === 0) {
            return '<div class="no-logs">Нет залогированного времени</div>';
        }
        
        const logsByDate = {};
        logs.forEach(log => {
            const date = log.for_date;
            if (!logsByDate[date]) {
                logsByDate[date] = [];
            }
            logsByDate[date].push(log);
        });
        
        let html = '';
        for (const [date, dateLogs] of Object.entries(logsByDate)) {
            const dateTotal = dateLogs.reduce((sum, log) => sum + (log.time_spent || 0), 0);
            html += `
                <div class="log-date-group">
                    <div class="log-date">📅 ${date}</div>
                    <div class="log-date-total">Всего: ${formatTime(dateTotal)}</div>
            `;
            
            dateLogs.forEach(log => {
                const timeFormatted = formatTime(log.time_spent);
                html += `
                    <div class="log-entry">
                        <span class="log-time">${timeFormatted}</span>
                        ${log.comment ? `<span class="log-comment">- ${this.escapeHtml(log.comment)}</span>` : ''}
                    </div>
                `;
            });
            
            html += `</div>`;
        }
        
        return html;
    }

    getHtmlContent(roles, rolesError, currentUser, userError, detectedCardInfo, timeLogs, timeLogsError) {
        const today = new Date().toISOString().split('T')[0];
        const lastRoleId = this.getLastSelectedRole();
        
        const rolesOptions = roles.map(role => {
            const selected = role.id === lastRoleId ? 'selected' : '';
            return `<option value="${role.id}" ${selected}>${this.escapeHtml(role.name)} (ID: ${role.id})</option>`;
        }).join('');
        
        // Формируем блок с информацией о пользователе
        let userInfoHtml = '';
        if (currentUser && !userError) {
            userInfoHtml = `
                <div class="user-info">
                    <div class="user-header">
                        <span class="user-icon">👤</span>
                        <span class="user-name">${this.escapeHtml(currentUser.full_name || currentUser.username || 'Пользователь')}</span>
                    </div>
                    <div class="user-details">
                        ${currentUser.email ? `<div>📧 ${this.escapeHtml(currentUser.email)}</div>` : ''}
                        ${currentUser.username ? `<div>@${this.escapeHtml(currentUser.username)}</div>` : ''}
                        ${currentUser.role ? `<div>🔑 Роль в компании: ${this.getUserRoleText(currentUser.role)}</div>` : ''}
                        ${currentUser.timezone ? `<div>🌍 Часовой пояс: ${this.escapeHtml(currentUser.timezone)}</div>` : ''}
                    </div>
                </div>
            `;
        } else if (userError) {
            userInfoHtml = `
                <div class="warning">
                    ⚠️ Не удалось загрузить информацию о пользователе: ${this.escapeHtml(userError)}
                </div>
            `;
        }
        
        const errorHtml = rolesError ? `<div class="warning">⚠️ ${this.escapeHtml(rolesError)}<br>Используется роль по умолчанию.</div>` : '';
        
        // Формируем блок с логами времени
        let timeLogsHtml = '';
        const totalTime = this.calculateTotalTime(timeLogs);
        
        if (detectedCardInfo) {
            timeLogsHtml = `
                <div class="time-logs-section">
                    <div class="time-logs-header">
                        <span>📊 Время по карточке #${detectedCardInfo.cardId}</span>
                        <span class="total-time-badge">Всего: ${formatTime(totalTime)}</span>
                    </div>
                    <div id="timeLogsContent" class="time-logs-content">
                        ${timeLogsError ? `<div class="warning">⚠️ ${this.escapeHtml(timeLogsError)}</div>` : this.formatTimeLogs(timeLogs)}
                    </div>
                </div>
            `;
        }
        
        // Генерируем HTML для обнаруженной карточки
        const detectedCardHtml = detectedCardInfo ? `
            <div class="detected-card" id="detectedCard">
                🔍 Обнаружена карточка из ветки: <strong>#${detectedCardInfo.cardId}</strong> (${detectedCardInfo.fullId})
            </div>
        ` : '<div id="detectedCard" style="display: none;"></div>';
        
        const cardIdValue = detectedCardInfo ? detectedCardInfo.cardId : '';
        
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .form-group {
                        margin-bottom: 20px;
                    }
                    label {
                        display: block;
                        margin-bottom: 8px;
                        font-weight: bold;
                        color: var(--vscode-editor-foreground);
                    }
                    .required:after {
                        content: " *";
                        color: var(--vscode-errorForeground);
                    }
                    input, select, textarea {
                        width: 100%;
                        padding: 8px 12px;
                        border: 1px solid var(--vscode-input-border);
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 4px;
                        font-size: 14px;
                        box-sizing: border-box;
                    }
                    select {
                        cursor: pointer;
                    }
                    textarea {
                        resize: vertical;
                        min-height: 80px;
                        font-family: inherit;
                    }
                    .time-group {
                        display: flex;
                        gap: 10px;
                        align-items: center;
                    }
                    .time-group input {
                        flex: 2;
                    }
                    .time-group select {
                        flex: 1;
                    }
                    .button-group {
                        display: flex;
                        gap: 10px;
                        margin-top: 20px;
                    }
                    button {
                        padding: 8px 16px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                    }
                    button.primary {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    button.primary:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    button.secondary {
                        background-color: var(--vscode-secondaryButton-background);
                        color: var(--vscode-secondaryButton-foreground);
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        font-size: 12px;
                        margin-top: 5px;
                    }
                    .info {
                        color: var(--vscode-descriptionForeground);
                        font-size: 12px;
                        margin-top: 5px;
                    }
                    .warning {
                        background-color: var(--vscode-inputValidation-warningBackground);
                        border: 1px solid var(--vscode-inputValidation-warningBorder);
                        color: var(--vscode-inputValidation-warningForeground);
                        padding: 8px 12px;
                        border-radius: 4px;
                        margin-bottom: 15px;
                    }
                    .user-info {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        padding: 12px;
                        border-radius: 6px;
                        margin-bottom: 20px;
                        border-left: 3px solid var(--vscode-button-background);
                    }
                    .user-header {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        margin-bottom: 8px;
                        font-size: 16px;
                        font-weight: bold;
                    }
                    .user-icon {
                        font-size: 20px;
                    }
                    .user-name {
                        color: var(--vscode-button-foreground);
                    }
                    .user-details {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        padding-left: 30px;
                    }
                    .user-details div {
                        margin-top: 4px;
                    }
                    .time-logs-section {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        border-radius: 6px;
                        margin-bottom: 20px;
                        overflow: hidden;
                    }
                    .time-logs-header {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        padding: 10px 15px;
                        font-weight: bold;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .total-time-badge {
                        background-color: rgba(255,255,255,0.2);
                        padding: 2px 8px;
                        border-radius: 12px;
                        font-size: 12px;
                    }
                    .time-logs-content {
                        padding: 10px 15px;
                        max-height: 200px;
                        overflow-y: auto;
                    }
                    .log-date-group {
                        margin-bottom: 12px;
                        border-left: 2px solid var(--vscode-button-background);
                        padding-left: 10px;
                    }
                    .log-date {
                        font-weight: bold;
                        font-size: 12px;
                        margin-bottom: 5px;
                        color: var(--vscode-descriptionForeground);
                    }
                    .log-date-total {
                        font-size: 11px;
                        color: var(--vscode-terminal-ansiGreen);
                        margin-bottom: 5px;
                    }
                    .log-entry {
                        font-size: 12px;
                        padding: 3px 0;
                        display: flex;
                        gap: 10px;
                    }
                    .log-time {
                        font-weight: bold;
                        color: var(--vscode-terminal-ansiCyan);
                        min-width: 50px;
                    }
                    .log-comment {
                        color: var(--vscode-descriptionForeground);
                    }
                    .no-logs {
                        color: var(--vscode-descriptionForeground);
                        font-style: italic;
                        text-align: center;
                        padding: 10px;
                    }
                    h2 {
                        margin-top: 0;
                        margin-bottom: 20px;
                    }
                    hr {
                        border-color: var(--vscode-panel-border);
                        margin: 20px 0;
                    }
                    .spinner {
                        display: inline-block;
                        width: 20px;
                        height: 20px;
                        border: 2px solid var(--vscode-foreground);
                        border-top-color: transparent;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                        margin-left: 10px;
                        vertical-align: middle;
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                    .status {
                        margin-top: 10px;
                        padding: 8px;
                        border-radius: 4px;
                        font-size: 12px;
                    }
                    .status.success {
                        background-color: var(--vscode-terminal-ansiGreen);
                        color: white;
                    }
                    .status.error {
                        background-color: var(--vscode-errorForeground);
                        color: white;
                    }
                    .detected-card {
                        background-color: var(--vscode-inputValidation-infoBackground);
                        border: 1px solid var(--vscode-inputValidation-infoBorder);
                        padding: 8px 12px;
                        border-radius: 4px;
                        margin-bottom: 15px;
                        font-size: 13px;
                    }
                    .refresh-logs {
                        float: right;
                        cursor: pointer;
                        font-size: 12px;
                        opacity: 0.7;
                    }
                    .refresh-logs:hover {
                        opacity: 1;
                    }
                </style>
            </head>
            <body>
                <h2>Логирование времени в Kaiten</h2>
                
                ${userInfoHtml}
                ${errorHtml}
                
                ${detectedCardHtml}
                ${timeLogsHtml}
                
                <div class="form-group">
                    <label class="required">ID карточки (Card ID)</label>
                    <input type="number" id="cardId" placeholder="Введите ID карточки" min="1" value="${cardIdValue}">
                    <div class="info">ID карточки из Kaiten (число)</div>
                </div>
                <div class="form-group">
                    <label class="required">Затраченное время</label>
                    <div class="time-group">
                        <input type="number" id="timeValue" placeholder="Введите значение" min="1" step="1">
                        <select id="timeUnit">
                            <option value="minutes">минут</option>
                            <option value="hours">часов</option>
                        </select>
                    </div>
                    <div class="info">Минимальное значение - 1 минута</div>
                </div>
                <div class="form-group">
                    <label class="required">Дата выполнения</label>
                    <input type="date" id="forDate" value="${today}">
                    <div class="info">Дата, за которую логируется время (формат YYYY-MM-DD)</div>
                </div>
                <div class="form-group">
                    <label>Роль</label>
                    <select id="roleSelect">
                        ${rolesOptions}
                    </select>
                    <div class="info">Выберите роль, от которой логируется время</div>
                    <div id="rolesLoading" style="display: none;">
                        <span class="spinner"></span> Загрузка ролей...
                    </div>
                </div>
                <div class="form-group">
                    <label>Комментарий</label>
                    <textarea id="comment" placeholder="Опишите, на что было потрачено время (максимум 4096 символов)"></textarea>
                </div>
                
                <div class="button-group">
                    <button class="primary" id="submitBtn">Отправить</button>
                    <button class="secondary" id="cancelBtn">Отмена</button>
                </div>
                
                <div id="statusMessage" class="status" style="display: none;"></div>
                
                <script>
                    const vscode = acquireVsCodeApi();
                    let rolesLoaded = false;
                    
                    vscode.postMessage({ command: 'webviewReady' });
                    
                    // Функция обновления логов времени
                    function refreshTimeLogs(cardId) {
                        if (cardId && cardId > 0) {
                            vscode.postMessage({ 
                                command: 'refreshTimeLogs', 
                                cardId: parseInt(cardId) 
                            });
                        }
                    }
                    
                    // Обработчик сообщений от расширения
                    window.addEventListener('message', event => {
                        const message = event.data;
                        console.log('Received message:', message);
                        
                        switch (message.command) {
                            case 'fillCardId':
                                const cardIdInput = document.getElementById('cardId');
                                if (cardIdInput && message.cardInfo) {
                                    cardIdInput.value = message.cardInfo.cardId;
                                    refreshTimeLogs(message.cardInfo.cardId);
                                    
                                    const statusDiv = document.getElementById('statusMessage');
                                    statusDiv.textContent = \`✓ Автоматически заполнен ID карточки: \${message.cardInfo.cardId}\`;
                                    statusDiv.className = 'status success';
                                    statusDiv.style.display = 'block';
                                    setTimeout(() => {
                                        statusDiv.style.display = 'none';
                                    }, 3000);
                                }
                                break;
                            case 'updateTimeLogs':
                                const timeLogsContent = document.getElementById('timeLogsContent');
                                if (timeLogsContent && message.logs) {
                                    const totalTime = message.totalTime;
                                    const hours = Math.floor(totalTime / 60);
                                    const mins = totalTime % 60;
                                    const totalText = hours > 0 ? \`\${hours}ч \${mins}м\` : \`\${mins}м\`;
                                    
                                    // Обновляем заголовок
                                    const headerTotal = document.querySelector('.total-time-badge');
                                    if (headerTotal) {
                                        headerTotal.textContent = \`Всего: \${totalText}\`;
                                    }
                                    
                                    // Группируем логи по датам
                                    const logsByDate = {};
                                    message.logs.forEach(log => {
                                        const date = log.for_date;
                                        if (!logsByDate[date]) logsByDate[date] = [];
                                        logsByDate[date].push(log);
                                    });
                                    
                                    if (Object.keys(logsByDate).length === 0) {
                                        timeLogsContent.innerHTML = '<div class="no-logs">Нет залогированного времени</div>';
                                    } else {
                                        let html = '';
                                        for (const [date, dateLogs] of Object.entries(logsByDate)) {
                                            const dateTotal = dateLogs.reduce((sum, log) => sum + (log.time_spent || 0), 0);
                                            const dateHours = Math.floor(dateTotal / 60);
                                            const dateMins = dateTotal % 60;
                                            const dateTotalText = dateHours > 0 ? \`\${dateHours}ч \${dateMins}м\` : \`\${dateMins}м\`;
                                            
                                            html += \`
                                                <div class="log-date-group">
                                                    <div class="log-date">📅 \${date}</div>
                                                    <div class="log-date-total">Всего: \${dateTotalText}</div>
                                            \`;
                                            
                                            dateLogs.forEach(log => {
                                                const logHours = Math.floor(log.time_spent / 60);
                                                const logMins = log.time_spent % 60;
                                                const logText = logHours > 0 ? \`\${logHours}ч \${logMins}м\` : \`\${logMins}м\`;
                                                html += \`
                                                    <div class="log-entry">
                                                        <span class="log-time">\${logText}</span>
                                                        \${log.comment ? \`<span class="log-comment">- \${log.comment.replace(/[&<>]/g, function(m) {
                                                            if (m === '&') return '&amp;';
                                                            if (m === '<') return '&lt;';
                                                            if (m === '>') return '&gt;';
                                                            return m;
                                                        })}</span>\` : ''}
                                                    </div>
                                                \`;
                                            });
                                            
                                            html += \`</div>\`;
                                        }
                                        timeLogsContent.innerHTML = html;
                                    }
                                }
                                break;
                            case 'timeLogsError':
                                const timeLogsContent2 = document.getElementById('timeLogsContent');
                                if (timeLogsContent2) {
                                    timeLogsContent2.innerHTML = \`<div class="warning">⚠️ \${message.error}</div>\`;
                                }
                                break;
                            case 'rolesLoaded':
                                const roleSelect = document.getElementById('roleSelect');
                                const loadingDiv = document.getElementById('rolesLoading');
                                if (loadingDiv) loadingDiv.style.display = 'none';
                                
                                roleSelect.innerHTML = '';
                                message.roles.forEach(role => {
                                    const option = document.createElement('option');
                                    option.value = role.id;
                                    option.textContent = role.name + ' (ID: ' + role.id + ')';
                                    if (role.id === message.lastRoleId) {
                                        option.selected = true;
                                    }
                                    roleSelect.appendChild(option);
                                });
                                rolesLoaded = true;
                                
                                const statusDiv = document.getElementById('statusMessage');
                                statusDiv.textContent = '✓ Роли успешно загружены';
                                statusDiv.className = 'status success';
                                statusDiv.style.display = 'block';
                                setTimeout(() => {
                                    statusDiv.style.display = 'none';
                                }, 2000);
                                break;
                            case 'rolesError':
                                const loadingDiv2 = document.getElementById('rolesLoading');
                                if (loadingDiv2) loadingDiv2.style.display = 'none';
                                console.error('Roles error:', message.error);
                                
                                const statusDiv2 = document.getElementById('statusMessage');
                                statusDiv2.textContent = '⚠️ ' + message.error;
                                statusDiv2.className = 'status error';
                                statusDiv2.style.display = 'block';
                                break;
                        }
                    });
                    
                    // Запрашиваем свежие роли
                    vscode.postMessage({ command: 'getRoles' });
                    
                    // Сохраняем выбранную роль
                    const roleSelect = document.getElementById('roleSelect');
                    if (roleSelect) {
                        roleSelect.addEventListener('change', () => {
                            vscode.postMessage({ 
                                command: 'saveRoleId', 
                                roleId: parseInt(roleSelect.value) 
                            });
                        });
                    }
                    
                    // Обновляем логи при изменении ID карточки
                    const cardIdInput = document.getElementById('cardId');
                    if (cardIdInput) {
                        cardIdInput.addEventListener('change', () => {
                            const cardId = parseInt(cardIdInput.value);
                            if (cardId > 0) {
                                refreshTimeLogs(cardId);
                            }
                        });
                    }
                    
                    document.getElementById('submitBtn').addEventListener('click', () => {
                        const cardId = document.getElementById('cardId').value;
                        const timeValue = document.getElementById('timeValue').value;
                        const timeUnit = document.getElementById('timeUnit').value;
                        const forDate = document.getElementById('forDate').value;
                        const comment = document.getElementById('comment').value;
                        const roleId = document.getElementById('roleSelect').value;
                        
                        const errors = [];
                        if (!cardId) errors.push('ID карточки обязателен');
                        if (cardId <= 0) errors.push('ID карточки должен быть положительным числом');
                        if (!timeValue) errors.push('Время обязательно');
                        if (timeValue <= 0) errors.push('Время должно быть больше 0');
                        if (!Number.isInteger(parseFloat(timeValue))) errors.push('Время должно быть целым числом');
                        if (!forDate) errors.push('Дата обязательна');
                        
                        const dateRegex = /^\\d{4}-\\d{2}-\\d{2}$/;
                        if (forDate && !dateRegex.test(forDate)) {
                            errors.push('Дата должна быть в формате YYYY-MM-DD');
                        }
                        
                        if (errors.length > 0) {
                            alert('Пожалуйста, исправьте ошибки:\\n' + errors.join('\\n'));
                            return;
                        }
                        
                        let timeSpent = parseInt(timeValue);
                        if (timeUnit === 'hours') {
                            timeSpent = timeValue * 60;
                        }
                        
                        vscode.postMessage({
                            command: 'submit',
                            data: {
                                card_id: parseInt(cardId),
                                time_spent: timeSpent,
                                for_date: forDate,
                                comment: comment || '',
                                role_id: parseInt(roleId)
                            }
                        });
                    });
                    
                    document.getElementById('cancelBtn').addEventListener('click', () => {
                        vscode.postMessage({ command: 'cancel' });
                    });
                    
                    const timeInput = document.getElementById('timeValue');
                    if (timeInput) {
                        timeInput.addEventListener('input', (e) => {
                            if (e.target.value < 0) e.target.value = 1;
                        });
                    }
                    
                    if (document.getElementById('cardId').value) {
                        document.getElementById('timeValue').focus();
                    } else {
                        document.getElementById('cardId').focus();
                    }
                </script>
            </body>
            </html>
        `;
    }

    setupMessageHandler() {
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'submit':
                        this.resolve(message.data);
                        this.panel.dispose();
                        break;
                    case 'cancel':
                        this.resolve(null);
                        this.panel.dispose();
                        break;
                    case 'getRoles':
                        break;
                    case 'saveRoleId':
                        await this.saveLastSelectedRole(message.roleId);
                        break;
                    case 'webviewReady':
                        if (this.detectedCardInfo) {
                            this.panel.webview.postMessage({
                                command: 'fillCardId',
                                cardInfo: this.detectedCardInfo
                            });
                        }
                        break;
                    case 'refreshTimeLogs':
                        try {
                            const logs = await getCardTimeLogs(message.cardId);
                            this.panel.webview.postMessage({
                                command: 'updateTimeLogs',
                                logs: logs,
                                totalTime: this.calculateTotalTime(logs)
                            });
                        } catch (error) {
                            this.panel.webview.postMessage({
                                command: 'timeLogsError',
                                error: error.message
                            });
                        }
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        this.panel.onDidDispose(() => {
            if (this.resolve) {
                this.resolve(null);
            }
        });
    }
}

async function showCommitModal(detectedCardInfo = null) {
    const panel = new CommitModalPanel({ subscriptions: [] });
    return await panel.show(detectedCardInfo);
}

module.exports = { showCommitModal };