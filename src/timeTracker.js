const vscode = require('vscode');

class TimeTracker {
    constructor(context) {
        this.context = context;
        this.timeLogs = new Map(); // Кеш для логов времени
    }
    
    async getTodayTimeLogs(baseUrl, token) {
        const today = new Date().toISOString().split('T')[0];
        return await this.getTimeLogsForDate(baseUrl, token, today);
    }
    
    async getTimeLogsForDate(baseUrl, token, date) {
        const https = require('https');
        const http = require('http');
        
        // Формируем URL для получения логов времени пользователя
        // Примечание: Это эндпоинт может отличаться в зависимости от API Kaiten
        // Возможно, нужно будет скорректировать под ваш API
        const url = new URL(`${baseUrl}/api/latest/user/time-logs`);
        url.searchParams.append('date', date);
        
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
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
                            const logs = JSON.parse(data);
                            resolve(this.processTimeLogs(logs));
                        } catch (e) {
                            resolve(this.getMockData(date)); // Для тестирования
                        }
                    } else {
                        // Если API не поддерживается, показываем мок-данные
                        resolve(this.getMockData(date));
                    }
                });
            });
            
            req.on('error', () => {
                // При ошибке показываем мок-данные
                resolve(this.getMockData(date));
            });
            
            req.setTimeout(10000, () => {
                req.destroy();
                resolve(this.getMockData(date));
            });
            
            req.end();
        });
    }
    
    processTimeLogs(logs) {
        if (!Array.isArray(logs)) {
            return { total: 0, logs: [], byCard: {} };
        }
        
        let totalMinutes = 0;
        const byCard = {};
        
        logs.forEach(log => {
            const minutes = log.time_spent || 0;
            totalMinutes += minutes;
            
            const cardId = log.card_id;
            if (cardId) {
                if (!byCard[cardId]) {
                    byCard[cardId] = 0;
                }
                byCard[cardId] += minutes;
            }
        });
        
        return {
            total: totalMinutes,
            totalFormatted: this.formatTime(totalMinutes),
            logs: logs,
            byCard: byCard
        };
    }
    
    getMockData(date) {
        // Мок-данные для демонстрации, если API не готов
        return {
            total: 180,
            totalFormatted: "3ч 0м",
            logs: [
                { card_id: 12345, time_spent: 60, comment: "Работа над фичей" },
                { card_id: 12346, time_spent: 120, comment: "Исправление бага" }
            ],
            byCard: {
                12345: 60,
                12346: 120
            },
            isMock: true
        };
    }
    
    formatTime(minutes) {
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
    
    async showTodayTimeSummary() {
        const settings = vscode.workspace.getConfiguration('kaitenTimeLogger');
        const token = settings.get('apiToken');
        const baseUrl = settings.get('baseUrl');
        
        if (!token || !baseUrl) {
            vscode.window.showWarningMessage('Настройки не заполнены. Пожалуйста, настройте расширение.');
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        vscode.window.showInformationMessage('Загрузка данных за сегодня...', 'Отмена').then(btn => {
            if (btn === 'Отмена') return;
        });
        
        try {
            const data = await this.getTodayTimeLogs(baseUrl, token);
            
            if (data.isMock) {
                vscode.window.showWarningMessage('Данные демонстрационные (API в разработке)');
            }
            
            const message = this.formatTimeSummary(data, today);
            
            const selected = await vscode.window.showInformationMessage(
                message,
                { modal: true },
                'OK',
                'Подробнее'
            );
            
            if (selected === 'Подробнее') {
                await this.showDetailedTimeLogs(data);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка получения данных: ${error.message}`);
        }
    }
    
    formatTimeSummary(data, date) {
        const formattedDate = new Date(date).toLocaleDateString('ru-RU');
        let message = `📊 Время за ${formattedDate}:\n\n`;
        message += `Всего: ${data.totalFormatted}\n\n`;
        
        if (Object.keys(data.byCard).length > 0) {
            message += `По карточкам:\n`;
            for (const [cardId, minutes] of Object.entries(data.byCard)) {
                const formatted = this.formatTime(minutes);
                message += `  #${cardId}: ${formatted}\n`;
            }
        } else {
            message += `Нет залогированного времени`;
        }
        
        return message;
    }
    
    async showDetailedTimeLogs(data) {
        const panel = vscode.window.createWebviewPanel(
            'timeLogs',
            'Детализация времени',
            vscode.ViewColumn.One,
            {
                enableScripts: true
            }
        );
        
        const logsHtml = data.logs.map(log => `
            <div class="log-item">
                <div class="log-header">
                    <strong>Карточка #${log.card_id}</strong>
                    <span class="log-time">${this.formatTime(log.time_spent)}</span>
                </div>
                ${log.comment ? `<div class="log-comment">${this.escapeHtml(log.comment)}</div>` : ''}
            </div>
        `).join('');
        
        panel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        padding: 20px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                    }
                    .log-item {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        padding: 10px;
                        margin-bottom: 10px;
                        border-radius: 4px;
                    }
                    .log-header {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 5px;
                    }
                    .log-time {
                        color: var(--vscode-terminal-ansiGreen);
                        font-weight: bold;
                    }
                    .log-comment {
                        margin-top: 5px;
                        padding-left: 10px;
                        color: var(--vscode-descriptionForeground);
                        font-size: 12px;
                    }
                    .total {
                        font-size: 18px;
                        font-weight: bold;
                        margin-bottom: 20px;
                        padding: 10px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border-radius: 4px;
                        text-align: center;
                    }
                    .mock-badge {
                        background-color: var(--vscode-inputValidation-warningBackground);
                        padding: 5px 10px;
                        border-radius: 4px;
                        margin-bottom: 10px;
                        font-size: 12px;
                    }
                </style>
            </head>
            <body>
                ${data.isMock ? '<div class="mock-badge">⚠️ Демонстрационные данные (API в разработке)</div>' : ''}
                <div class="total">Всего за сегодня: ${data.totalFormatted}</div>
                ${logsHtml}
                <div style="margin-top: 20px; text-align: center;">
                    <button onclick="closePanel()">Закрыть</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    function closePanel() {
                        vscode.postMessage({ command: 'close' });
                    }
                </script>
            </body>
            </html>
        `;
        
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'close') {
                panel.dispose();
            }
        });
    }
    
    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

module.exports = { TimeTracker };