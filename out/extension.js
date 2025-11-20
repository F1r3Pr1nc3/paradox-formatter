'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode_1 = require("vscode");
function getIndentationString(level, options) {
    if (options.insertSpaces) {
        return ' '.repeat(options.tabSize * level);
    }
    return '\t'.repeat(level);
}
class ParadoxDocumentFormatter {
    formatLines(document, range, options) {
        const edits = [];
        let level = 0;
        // --- LOGIC TO DETERMINE STARTING INDENTATION LEVEL ---
        // We must run the formatting logic up to the line *before* the start of the range
        // to correctly calculate the starting 'level' for the selected block.
        if (range.start.line > 0) {
            let tempLevel = 0;
            for (let tempLineNum = 0; tempLineNum < range.start.line; tempLineNum++) {
                const line = document.lineAt(tempLineNum);
                if (!line.isEmptyOrWhitespace) {
                    const lineText = line.text;
                    let openBraceIndex = lineText.indexOf('{');
                    let closeBraceIndex = lineText.indexOf('}');
                    const commentIndex = lineText.indexOf('#');
                    if (commentIndex >= 0) {
                        if (openBraceIndex > commentIndex) {
                            openBraceIndex = -1;
                        }
                        if (closeBraceIndex > commentIndex) {
                            closeBraceIndex = -1;
                        }
                    }
                    if (lineText.trim().startsWith('}')) {
                        tempLevel--;
                    }
                    if (openBraceIndex >= 0 && closeBraceIndex === -1) {
                        tempLevel++;
                    }
                    else if (openBraceIndex === -1 && closeBraceIndex >= 0 && !lineText.trim().startsWith('}')) {
                        tempLevel--;
                    }
                }
            }
            level = Math.max(0, tempLevel); // Ensure level doesn't go negative
        }
        // --- END STARTING INDENTATION LOGIC ---
        for (let i = range.start.line; i <= range.end.line; i++) {
            const line = document.lineAt(i);
            if (line.isEmptyOrWhitespace) {
                if (line.text.length > 0) {
                    // Remove whitespace from empty lines
                    edits.push(vscode_1.TextEdit.delete(line.range));
                }
                continue;
            }
            let decreaseLevelForLine = false;
            const trimmedLine = line.text.trim();
            if (trimmedLine.startsWith('}')) {
                level--;
                decreaseLevelForLine = true;
            }
            const newText = getIndentationString(Math.max(0, level), options) + trimmedLine;
            let openBraceIndex = newText.indexOf('{');
            let closeBraceIndex = newText.indexOf('}');
            const commentIndex = newText.indexOf('#');
            if (commentIndex >= 0) {
                if (openBraceIndex > commentIndex) {
                    openBraceIndex = -1;
                }
                if (closeBraceIndex > commentIndex) {
                    closeBraceIndex = -1;
                }
            }
            if (openBraceIndex >= 0 && closeBraceIndex === -1) {
                level++;
            }
            else if (openBraceIndex === -1 && closeBraceIndex >= 0 && !decreaseLevelForLine) {
                level--;
            }
            if (newText !== line.text) {
                edits.push(vscode_1.TextEdit.replace(line.range, newText));
            }
        }
        return edits;
    }
    provideDocumentFormattingEdits(document, options, token) {
        const fullRange = new vscode_1.Range(document.positionAt(0), document.positionAt(document.getText().length));
        return this.formatLines(document, fullRange, options);
    }
    provideDocumentRangeFormattingEdits(document, range, options, token) {
        return this.formatLines(document, range, options);
    }
}
function activate(context) {
    const selector = { scheme: 'file', language: 'paradox' };
    const formatter = new ParadoxDocumentFormatter();
    context.subscriptions.push(vscode_1.languages.registerDocumentFormattingEditProvider(selector, formatter));
    context.subscriptions.push(vscode_1.languages.registerDocumentRangeFormattingEditProvider(selector, formatter));
}
//# sourceMappingURL=extension.js.map