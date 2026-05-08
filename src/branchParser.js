class BranchParser {
    constructor() {
        // Паттерны для поиска ID карточки в названии ветки
        this.patterns = [
            // PATTERN: feat/DEV-12345
            { regex: /\/([A-Z]+-(\d+))(?:\/|$)/i, group: 1 },
            // PATTERN: DEV-12345
            { regex: /\b([A-Z]+-(\d+))\b/i, group: 1 },
            // PATTERN: bugfix/DEV-12345_some_description
            { regex: /\/([A-Z]+-(\d+))_/i, group: 1 },
            // PATTERN: feature/TASK-123
            { regex: /\/([A-Z]+-(\d+))(?:[\/_]|$)/i, group: 1 },
            // PATTERN: release/DEV-123
            { regex: /release\/([A-Z]+-(\d+))/i, group: 1 },
            // PATTERN: hotfix/DEV-123
            { regex: /hotfix\/([A-Z]+-(\d+))/i, group: 1 }
        ];
    }
    
    extractCardIdFromBranch(branchName) {
        if (!branchName) {
            return null;
        }
        
        for (const pattern of this.patterns) {
            const match = branchName.match(pattern.regex);
            if (match && match[pattern.group]) {
                const cardIdStr = match[pattern.group];
                // Извлекаем только цифры из ID (например из DEV-12345 получаем 12345)
                const numbers = cardIdStr.match(/\d+/);
                if (numbers) {
                    const cardId = parseInt(numbers[0]);
                    return {
                        cardId: cardId,
                        fullId: cardIdStr,
                        branchName: branchName
                    };
                }
            }
        }
        
        return null;
    }
    
    // Альтернативный метод - ищет любые числа в ветке (если нет стандартного формата)
    extractAnyNumber(branchName) {
        if (!branchName) return null;
        
        const numbers = branchName.match(/\b(\d+)\b/);
        if (numbers && numbers[1]) {
            return {
                cardId: parseInt(numbers[1]),
                fullId: numbers[1],
                branchName: branchName
            };
        }
        
        return null;
    }
    
    // Комбинированный метод
    extractCardId(branchName, strict = true) {
        let result = this.extractCardIdFromBranch(branchName);
        
        if (!result && !strict) {
            result = this.extractAnyNumber(branchName);
        }
        
        return result;
    }
}

module.exports = { BranchParser };