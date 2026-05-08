const vscode = require('vscode');
const { showCommitModal } = require('./src/modalView');
const { promptForSettings, resetSettings } = require('./src/settingsManager');
const { sendTimeLog, getUserRoles, getCurrentUser, getUserRoleName, getAppsPermissionsName } = require('./src/apiClient');
const { BranchParser } = require('./src/branchParser');
const { TimeTracker } = require('./src/timeTracker');

let timeTracker;
let branchParser;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('Kaiten Time Logger extension is now active');
    
    timeTracker = new TimeTracker(context);
    branchParser = new BranchParser();
    
    // Команда для логирования времени
    let logTimeCommand = vscode.commands.registerCommand('kaiten-time-logger.showModal', async () => {
        // Пытаемся определить ID карточки из ветки
        let detectedCardInfo = null;
        const config = vscode.workspace.getConfiguration('kaitenTimeLogger');
        const autoDetect = config.get('autoDetectCardFromBranch', true);
        
        if (autoDetect) {
            try {
                const gitExtension = vscode.extensions.getExtension('vscode.git');
                if (gitExtension && gitExtension.isActive) {
                    const git = gitExtension.exports.getAPI(1);
                    const repo = git.repositories[0];
                    if (repo) {
                        const branchName = repo.state.HEAD?.name;
                        if (branchName) {
                            detectedCardInfo = branchParser.extractCardId(branchName, false);
                            if (detectedCardInfo) {
                                vscode.window.showInformationMessage(`Обнаружена карточка #${detectedCardInfo.cardId} из ветки ${branchName}`);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error detecting branch:', error);
            }
        }
        
        // Проверяем настройки
        const settings = vscode.workspace.getConfiguration('kaitenTimeLogger');
        const token = settings.get('apiToken');
        const baseUrl = settings.get('baseUrl');
        
        if (!token || !baseUrl) {
            const configured = await promptForSettings();
            if (!configured) {
                vscode.window.showWarningMessage('Настройки не сохранены. Операция отменена.');
                return;
            }
        }
        
        const commitData = await showCommitModal(detectedCardInfo);
        
        if (commitData) {
            try {
                await sendTimeLog(commitData);
                vscode.window.showInformationMessage(`Время по задаче #${commitData.card_id} успешно залогировано!`);
            } catch (error) {
                vscode.window.showErrorMessage(`Ошибка: ${error.message}`);
            }
        }
    });
    
    // Команда для получения информации о текущем пользователе
    let showUserInfoCommand = vscode.commands.registerCommand('kaiten-time-logger.showUserInfo', async () => {
        try {
            const settings = vscode.workspace.getConfiguration('kaitenTimeLogger');
            const token = settings.get('apiToken');
            const baseUrl = settings.get('baseUrl');
            
            if (!token || !baseUrl) {
                const configured = await promptForSettings();
                if (!configured) {
                    return;
                }
            }
            
            const user = await getCurrentUser();
            
            // Формируем сообщение с информацией о пользователе
            let message = `📋 Информация о пользователе Kaiten:\n\n`;
            message += `👤 Имя: ${user.full_name || user.username || 'Не указано'}\n`;
            message += `📧 Email: ${user.email || 'Не указан'}\n`;
            message += `🆔 ID: ${user.id || 'Не указан'}\n`;
            message += `🏢 Компания ID: ${user.company_id || 'Не указана'}\n`;
            message += `🔑 Роль: ${getUserRoleName(user.role)}\n`;
            message += `🌍 Часовой пояс: ${user.timezone || 'Не указан'}\n`;
            message += `🌐 Язык: ${user.lng || 'Не указан'}\n`;
            message += `🎨 Тема: ${user.theme || 'Не указана'}\n`;
            message += `📱 Доступ: ${getAppsPermissionsName(user.apps_permissions)}\n`;
            message += `✅ Активен: ${user.activated ? 'Да' : 'Нет'}\n`;
            message += `🔗 Внешний пользователь: ${user.external ? 'Да' : 'Нет'}\n`;
            
            if (user.created) {
                const createdDate = new Date(user.created).toLocaleDateString('ru-RU');
                message += `📅 Дата регистрации: ${createdDate}\n`;
            }
            
            vscode.window.showInformationMessage(message, { modal: true }, 'OK');
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка получения информации о пользователе: ${error.message}`);
        }
    });
    
    // Команда для обновления ролей
    let refreshRolesCommand = vscode.commands.registerCommand('kaiten-time-logger.refreshRoles', async () => {
        try {
            const roles = await getUserRoles();
            vscode.window.showInformationMessage(`Загружено ${roles.length} ролей`);
        } catch (error) {
            vscode.window.showErrorMessage(`Ошибка загрузки ролей: ${error.message}`);
        }
    });
    
    // Команда для сброса настроек
    let resetSettingsCommand = vscode.commands.registerCommand('kaiten-time-logger.resetSettings', async () => {
        const confirmed = await vscode.window.showWarningMessage(
            'Вы уверены, что хотите сбросить все настройки?',
            { modal: true },
            'Да', 'Нет'
        );
        
        if (confirmed === 'Да') {
            await resetSettings();
            vscode.window.showInformationMessage('Настройки сброшены. Пожалуйста, перезапустите VSCode для применения изменений.');
        }
    });
    
    // Команда для показа времени за сегодня
    let showTodayTimeCommand = vscode.commands.registerCommand('kaiten-time-logger.showTodayTime', async () => {
        await timeTracker.showTodayTimeSummary();
    });
    
    // Команда для переключения авто-открытия
    let toggleAutoModalCommand = vscode.commands.registerCommand('kaiten-time-logger.toggleAutoModal', async () => {
        const config = vscode.workspace.getConfiguration('kaitenTimeLogger');
        const current = config.get('autoOpenAfterCommit', false);
        await config.update('autoOpenAfterCommit', !current, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Авто-открытие после коммита: ${!current ? 'Включено' : 'Выключено'}`);
    });
    
    // Команда для переключения авто-определения карточки
    let toggleAutoDetectCommand = vscode.commands.registerCommand('kaiten-time-logger.toggleAutoDetect', async () => {
        const config = vscode.workspace.getConfiguration('kaitenTimeLogger');
        const current = config.get('autoDetectCardFromBranch', true);
        await config.update('autoDetectCardFromBranch', !current, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Авто-определение карточки из ветки: ${!current ? 'Включено' : 'Выключено'}`);
    });
    
    context.subscriptions.push(
        logTimeCommand,
        refreshRolesCommand,
        resetSettingsCommand,
        showTodayTimeCommand,
        toggleAutoModalCommand,
        toggleAutoDetectCommand,
        showUserInfoCommand
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};