'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
const vscode = require("vscode");
const { spawn } = require('child_process');
const path = require('path');

// Helper: Generate tab/space string
function getIndent(level, options) {
    const tab = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
    return tab.repeat(Math.max(0, level));
}

/**
 * Executes the Python formatter script and returns the formatted content.
 * @param {string} text - The raw document text to format.
 * @returns {Promise<{content: string, changed: boolean}>}
 */
function formatWithPythonBridge(text) {
    return new Promise((resolve, reject) => {
        // NOTE: Adjust pythonPath if necessary (e.g., 'python3' or a path to a virtual environment)
        const pythonPath = 'py'; 
        
        // Correct path relative to the extension's root directory
        const scriptPath = path.join(__dirname, '..', 'bin', 'logic_optimizer.py'); 

        // 1. Spawn Python process
        const pythonProcess = spawn(pythonPath, [scriptPath]);
        
        let stdout = '';
        let stderr = '';
        
        // 2. Capture stdout (formatted result)
        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        // 3. Capture stderr (errors from Python)
        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        // 4. Handle process close
        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`Python script exited with code ${code}. Stderr: ${stderr}`);
                // Reject promise but still resolve with original content to avoid blocking VSCode
                vscode.window.showErrorMessage(`Stellaris Formatter failed: ${stderr}`);
                return resolve({ content: text, changed: false }); 
            }

            try {
                // The Python script outputs a JSON object {"content": "...", "changed": true}
                const result = JSON.parse(stdout);
                resolve(result);
            } catch (e) {
                console.error("Failed to parse JSON output from Python:", e, "Raw output:", stdout);
                vscode.window.showErrorMessage("Stellaris Formatter: Corrupted output from Python script.");
                resolve({ content: text, changed: false });
            }
        });

        // 5. Send input (document text) to Python's stdin
        pythonProcess.stdin.write(text);
        pythonProcess.stdin.end();
    });
}

class ParadoxDocumentFormatter {

    // 1. Tokenizer: Protects strings and comments to prevent formatting them
    protectContent(text, placeholderMap) {
        let counter = 0;
        // Protect Strings "..."
        text = text.replace(/"(\\.|[^"\\])*"/g, (match) => {
            const key = `__STR_${counter++}__`;
            placeholderMap.set(key, match);
            return key;
        });
        // Protect Comments #...
        text = text.replace(/#.*/g, (match) => {
            const key = `__COM_${counter++}__`;
            placeholderMap.set(key, match);
            return key;
        });
        return text;
    }

    // 2. Restorer: Puts original strings and comments back
    restoreContent(text, placeholderMap) {
        // We loop until no placeholders remain (handling potential nesting edge cases)
        // But simple replace is usually enough for this structure
        return text.replace(/__(STR|COM)_\d+__/g, (match) => {
            return placeholderMap.get(match) || match;
        });
    }

    // 3. Expander: Inserts newlines for structure
    expandOneLineBlock(text) {
        // Ensure space around =
        text = text.replace(/\s*=\s*/g, ' = ');

        // Add newlines around { and }
        // Case: "name = {"  ->  "name = {\n"
        text = text.replace(/\s*\{\s*/g, ' {\n');
        // Case: "}"  ->  "\n}"
        text = text.replace(/\s*\}\s*/g, '\n}\n');

        // Add newlines between multiple properties on the same line
        // Look for pattern:  Value (space) NextKey =
        // We assume a "Key" is an alphanumeric identifier followed by "="
        // The $1 matches the previous value's last char, $2 matches the new key
        text = text.replace(/(\S)\s+([a-zA-Z0-9_\.@:]+\s*=)/g, '$1\n$2');

        return text;
    }

    // This is the JS formatter for range (selection) formatting
    formatRange(document, range, options) {
        const fullText = document.getText(range);
        const placeholderMap = new Map();

        // A. Protect strings/comments so regex doesn't mangle them
        let safeText = this.protectContent(fullText, placeholderMap);

        // B. Expand structure (Insert newlines)
        let expandedText = this.expandOneLineBlock(safeText);

        // C. Split into lines for indentation
        let lines = expandedText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // D. Calculate Starting Indentation (Context Awareness)
        // We look at the lines BEFORE the selection to know the current indentation level
        let level = 0;
        if (range.start.line > 0) {
            let tempL = 0;
            while (tempL < range.start.line) {
                const line = document.lineAt(tempL);
                if (!line.isEmptyOrWhitespace) {
                    const txt = line.text.split('#')[0]; // Ignore comments for indent calc
                    const open = (txt.match(/\{/g) || []).length;
                    const close = (txt.match(/\}/g) || []).length;
                    level += open - close;
                }
                tempL++;
            }
            level = Math.max(0, level);
        }

        // E. Build the final formatted result
        const resultLines = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Logic: If line starts with }, decrement indent immediately
            if (line.startsWith('}')) {
                level--;
            }

            // Add indentation
            const indentString = getIndent(level, options);
            // Restore content (put strings/comments back)
            const restoredLine = this.restoreContent(line, placeholderMap);

            resultLines.push(indentString + restoredLine);

            // Logic: Calculate indent for NEXT line
            const open = (line.match(/\{/g) || []).length;
            const close = (line.match(/\}/g) || []).length;

            if (line.startsWith('}')) {
                level += open - (close - 1);
            } else {
                level += open - close;
            }
        }

        return [vscode.TextEdit.replace(range, resultLines.join('\n'))];
    }

    // This now uses the Python bridge for whole-document formatting
    async provideDocumentFormattingEdits(document, options) {
        const text = document.getText();
        const { content, changed } = await formatWithPythonBridge(text);

        if (changed) {
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(text.length)
            );
            return [vscode.TextEdit.replace(fullRange, content)];
        }

        return [];
    }

    // This uses the old JS formatter for selection formatting
    provideDocumentRangeFormattingEdits(document, range, options) {
        return this.formatRange(document, range, options);
    }
}

function activate(ctx) {
    const selector = [
        { scheme: 'file', language: 'paradox' },
        { scheme: 'file', language: 'stellaris' },
        { scheme: 'file', language: 'hoi4' },
        { scheme: 'file', language: 'ck2' },
        { scheme: 'file', language: 'eu4' },
        { scheme: 'file', language: 'imperator' },
        { scheme: 'file', language: 'vic2' },
        { scheme: 'file', language: 'ck3' },
        { scheme: 'file', language: 'vic3' },
        { scheme: 'file', language: 'eu5' }
    ];

    const formatter = new ParadoxDocumentFormatter();

    ctx.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(selector, formatter),
        vscode.languages.registerDocumentRangeFormattingEditProvider(selector, formatter)
    );
}