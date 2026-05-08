const vscode = require('vscode');

async function checkSettings() {
    const settings = vscode.workspace.getConfiguration('kaitenTimeLogger');
    const token = settings.get('apiToken');
    const baseUrl = settings.get('baseUrl');
    
    return {
        isConfigured: !!(token && baseUrl),
        token,
        baseUrl
    };
}

async function promptForSettings() {
    // Запрашиваем базовый URL
    const baseUrl = await vscode.window.showInputBox({
        title: 'Настройка Kaiten Time Logger',
        prompt: 'Введите базовый URL вашего Kaiten пространства',
        placeHolder: 'https://kaiten.ru',
        value: 'https://kaiten.ru',
        validateInput: (value) => {
            if (!value) return 'Базовый URL обязателен';
            if (!value.startsWith('http://') && !value.startsWith('https://')) {
                return 'URL должен начинаться с http:// или https://';
            }
            if (!value.includes('kaiten.ru')) {
                return 'Пожалуйста, введите корректный URL Kaiten (например, https://ваш-пространство.kaiten.ru)';
            }
            return null;
        }
    });
    
    if (!baseUrl) return false;
    
    // Запрашиваем токен
    const token = await vscode.window.showInputBox({
        title: 'Настройка Kaiten Time Logger',
        prompt: 'Введите API токен Kaiten',
        placeHolder: 'ваш-api-токен-здесь',
        password: true,
        validateInput: (value) => {
            if (!value) return 'API токен обязателен';
            if (value.length < 10) return 'Токен слишком короткий. Убедитесь, что вы ввели правильный токен';
            return null;
        }
    });
    
    if (!token) return false;
    
    // Сохраняем настройки
    const config = vscode.workspace.getConfiguration('kaitenTimeLogger');
    await config.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);
    await config.update('apiToken', token, vscode.ConfigurationTarget.Global);
    
    vscode.window.showInformationMessage('Настройки Kaiten успешно сохранены!');
    
    // Предлагаем протестировать соединение
    const testConnection = await vscode.window.showInformationMessage(
        'Хотите протестировать соединение?',
        'Да', 'Нет'
    );
    
    if (testConnection === 'Да') {
        await testApiConnection(baseUrl, token);
    }
    
    return true;
}

async function testApiConnection(baseUrl, token) {
    const https = require('https');
    const http = require('http');
    
    const url = new URL(`${baseUrl}/api/latest/boards`);
    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        }
    };
    
    return new Promise((resolve) => {
        const protocol = url.protocol === 'https:' ? https : http;
        const req = protocol.request(options, (res) => {
            if (res.statusCode === 200) {
                vscode.window.showInformationMessage('✅ Соединение с Kaiten успешно установлено!');
                resolve(true);
            } else {
                vscode.window.showWarningMessage(`⚠️ Не удалось подключиться к Kaiten. Статус: ${res.statusCode}. Проверьте токен и URL.`);
                resolve(false);
            }
        });
        
        req.on('error', () => {
            vscode.window.showErrorMessage('❌ Не удалось подключиться к Kaiten. Проверьте URL и интернет-соединение.');
            resolve(false);
        });
        
        req.end();
    });
}

async function updateSettings(baseUrl, token) {
    const config = vscode.workspace.getConfiguration('kaitenTimeLogger');
    
    if (baseUrl) {
        await config.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);
    }
    if (token) {
        await config.update('apiToken', token, vscode.ConfigurationTarget.Global);
    }
}

module.exports = { checkSettings, promptForSettings, updateSettings };