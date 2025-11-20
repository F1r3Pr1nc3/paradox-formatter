'use strict';

import {
    languages,
    ExtensionContext,
    DocumentSelector,
    TextDocument,
    FormattingOptions,
    CancellationToken,
    TextEdit,
    Range,
    DocumentRangeFormattingEditProvider,
    DocumentFormattingEditProvider
} from 'vscode';

function getIndentationString(level: number, options: FormattingOptions): string {
    if (options.insertSpaces) {
        return ' '.repeat(options.tabSize * level);
    }
    return '\t'.repeat(level);
}

class ParadoxDocumentFormatter implements DocumentFormattingEditProvider, DocumentRangeFormattingEditProvider {

    private formatLines(document: TextDocument, range: Range, options: FormattingOptions): TextEdit[] {
        const edits: TextEdit[] = [];
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
                        if (openBraceIndex > commentIndex) { openBraceIndex = -1; }
                        if (closeBraceIndex > commentIndex) { closeBraceIndex = -1; }
                    }

                    if (lineText.trim().startsWith('}')) {
                        tempLevel--;
                    }

                    if (openBraceIndex >= 0 && closeBraceIndex === -1) {
                        tempLevel++;
                    } else if (openBraceIndex === -1 && closeBraceIndex >= 0 && !lineText.trim().startsWith('}')) {
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
                    edits.push(TextEdit.delete(line.range));
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
                if (openBraceIndex > commentIndex) { openBraceIndex = -1; }
                if (closeBraceIndex > commentIndex) { closeBraceIndex = -1; }
            }

            if (openBraceIndex >= 0 && closeBraceIndex === -1) {
                level++;
            } else if (openBraceIndex === -1 && closeBraceIndex >= 0 && !decreaseLevelForLine) {
                level--;
            }

            if (newText !== line.text) {
                edits.push(TextEdit.replace(line.range, newText));
            }
        }
        return edits;
    }

    public provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): TextEdit[] {
        const fullRange = new Range(document.positionAt(0), document.positionAt(document.getText().length));
        return this.formatLines(document, fullRange, options);
    }

    public provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): TextEdit[] {
        return this.formatLines(document, range, options);
    }
}

export function activate(context: ExtensionContext) {
    const selector: DocumentSelector = { scheme: 'file', language: 'paradox' };
    const formatter = new ParadoxDocumentFormatter();

    context.subscriptions.push(languages.registerDocumentFormattingEditProvider(selector, formatter));
    context.subscriptions.push(languages.registerDocumentRangeFormattingEditProvider(selector, formatter));
}
