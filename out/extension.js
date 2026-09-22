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
 * @param {boolean|undefined} forceCompact - If defined, overrides the noCompact setting. True = force compact, False = force no-compact.
 * @returns {Promise<{content: string, changed: boolean}>}
 */
function formatWithPythonBridge(text, forceCompact) {
	return new Promise((resolve, reject) => {
		// NOTE: Adjust pythonPath if necessary (e.g., 'python3' or a path to a virtual environment)
		const pythonPath = 'py';

		// Correct path relative to the extension's root directory
		const scriptPath = path.join(__dirname, '..', 'bin', 'logic_optimizer.py');

		const config = vscode.workspace.getConfiguration('paradox-formatter');
		const args = [scriptPath];

		let noCompact = false;
		if (typeof forceCompact === 'boolean') {
			noCompact = !forceCompact;
		} else {
			noCompact = config.get('noCompact');
		}

		if (noCompact) {
			args.push('--no-compact');
		}

		const safeNavigationMode = config.get('safeNavigation') || 'auto';
		args.push('--safe-navigation', String(safeNavigationMode));

		// 1. Spawn Python process
		const pythonProcess = spawn(pythonPath, args);

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
		// Protect Strings and Comments in one pass to avoid nesting
		// Group 1: Strings "..." (using non-capturing group for content)
		// Group 2: Comments #...
		text = text.replace(/("(?:\\.|[^"\\])*")|(#.*)/g, (match, strMatch, comMatch) => {
			if (strMatch) {
				const key = `__STR_${counter++}__`;
				placeholderMap.set(key, match);
				return key;
			}
			if (comMatch) {
				const key = `__COM_${counter++}__`;
				placeholderMap.set(key, match);
				return key;
			}
			return match;
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
		text = text.replace(/(?<![<>\!])\s*=\s*/g, (match) => {
			if (match === ' = ') return match;
			if (match.includes('\t')) {
				if (match.startsWith('\t')) {
					const parts = match.split('=');
					return parts[0].replace(/ /g, '') + '= ';
				}
				if (match.endsWith('\t')) {
					const parts = match.split('=');
					return parts[1].replace(/ /g, '') + '= ';
				}
			}
			return ' = ';
		});

		// Add newlines around { and }
		// Case: "name = {"  ->  "name = {\n"
		// Modified to keep inline comments on the same line: "name = { # comment" -> "name = { # comment"
		text = text.replace(/\s*\{(\s*)(__COM_\d+__)?/g, (match, spaces, comment) => {
			if (comment && !spaces.includes('\n')) {
				return ' { ' + comment;
			}
			if (comment) {
				return ' {\n' + comment;
			}
			return ' {\n';
		});
		// Case: "}"  ->  "\n}"
		text = text.replace(/\s*\}\s*/g, '\n}\n');

		// Add newlines between multiple properties on the same line
		// Look for pattern:  Value (space) NextKey =
		// We assume a "Key" is an alphanumeric identifier followed by "="
		// The $1 matches the previous value's last char, $2 matches the new key
		text = text.replace(/(\S)\s+([a-zA-Z0-9_\.@:]+\s*=)/g, '$1\n$2');

		return text;
	}

	// Starting indentation for a selection: take it from the selection's own first line.
	// Counting braces over the whole preceding document cannot see '@[ ... ]' / '[[ ... ]]'
	// blocks or values that span lines, so that count drifts and every following line was
	// shifted - which collapsed the indentation of blocks like an event's 'trigger = {...}'.
	baseIndentLevel(document, range, options) {
		const tabWidth = (options && options.tabSize) ? options.tabSize : 4;
		const lastLine = Math.min(range.end.line, document.lineCount - 1);
		for (let i = range.start.line; i <= lastLine; i++) {
			const raw = document.lineAt(i).text;
			if (raw.trim().length === 0) {
				continue;
			}
			const indentText = raw.slice(0, raw.length - raw.trimStart().length);
			const tabs = (indentText.match(/\t/g) || []).length;
			const spaces = indentText.replace(/\t/g, '').length;
			let level = tabs + Math.round(spaces / tabWidth);
			if (raw.trimStart().startsWith('}')) {
				level += 1; // the line closes its own level
			}
			return Math.max(0, level);
		}
		return 0;
	}

	// Braces inside '@[ ... ]' and '[[ ... ]]' hold text, not script structure.
	rawBraceClean(line) {
		return line.replace(/@\[[^\]]*\]|\[\[[^\]]*\]\]/g, '');
	}

	// True when a fragment stands on its own (no block left open or closed early), which is
	// what the Python tool needs to re-parse it safely.
	isBalancedFragment(fragment) {
		let depth = 0;
		for (const raw of fragment.split('\n')) {
			const line = this.rawBraceClean(raw.replace(/("(?:\\.|[^"\\])*")|(#.*)/g, ''));
			depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
			if (depth < 0) {
				return false;
			}
		}
		return depth === 0;
	}

	// This is the JS formatter for range (selection) formatting
	formatRange(document, range, options) {
		// Expand range to cover full lines to ensure correct indentation context
		const start = new vscode.Position(range.start.line, 0);
		const endLine = document.lineAt(range.end.line);
		const end = new vscode.Position(range.end.line, endLine.text.length);
		const extendedRange = new vscode.Range(start, end);

		const config = vscode.workspace.getConfiguration('paradox-formatter');
		const noCompact = config.get('noCompact');

		const fullText = document.getText(extendedRange);
		const placeholderMap = new Map();

		// A. Protect strings/comments so regex doesn't mangle them
		let safeText = this.protectContent(fullText, placeholderMap);

		// B. Expand structure (Insert newlines)
		let expandedText = safeText;
		if (noCompact) {
			expandedText = this.expandOneLineBlock(safeText);
		} else {
			// Minimal formatting for compact mode: just normalize spacing around =
			expandedText = expandedText.replace(/(?<![<>\!])\s*=\s*/g, (match) => {
				if (match === ' = ') return match;
				if (match.includes('\t')) {
					if (match.startsWith('\t')) {
						const parts = match.split('=');
						return parts[0].replace(/ /g, '') + '= ';
					}
					if (match.endsWith('\t')) {
						const parts = match.split('=');
						return parts[1].replace(/ /g, '') + '= ';
					}
				}
				return ' = ';
			});
		}

		// C. Split into lines for indentation. Empty lines belong to the selection and are
		// kept - dropping them (as this did before) removes the author's blank lines.
		let lines = expandedText.split('\n').map(l => l.trim());

		// D. Starting Indentation: from the selection's own first line, see baseIndentLevel().
		let level = this.baseIndentLevel(document, range, options);

		// E. Build the final formatted result
		const resultLines = [];

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];

			if (line.length === 0) {
				// Blank line: emit it untouched, it carries no indentation and no nesting.
				resultLines.push('');
				continue;
			}

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
			const countedLine = this.rawBraceClean(line);
			const open = (countedLine.match(/\{/g) || []).length;
			const close = (countedLine.match(/\}/g) || []).length;

			if (line.startsWith('}')) {
				level += open - (close - 1);
			} else {
				level += open - close;
			}
		}

		return [vscode.TextEdit.replace(extendedRange, resultLines.join('\n'))];
	}

	// Format a selection through the Python tool, so the logic conversions (scope? folding,
	// if -> OR, NOR repair, ...) run there as well. The fragment is wrapped in a throwaway
	// block because the parser needs a complete document, the wrapper is stripped from the
	// answer, the levels are re-based onto the selection's own indentation and the author's
	// blank lines are put back in front of the lines that survived unchanged.
	// Returns null when the wrapper did not survive (selections that cut through a block and
	// the like), so the caller can fall back to the built-in re-indenter.
	async formatRangeWithPython(document, range, options) {
		const start = new vscode.Position(range.start.line, 0);
		const endLine = document.lineAt(range.end.line);
		const end = new vscode.Position(range.end.line, endLine.text.length);
		const extendedRange = new vscode.Range(start, end);

		const fragment = document.getText(extendedRange);
		if (!this.isBalancedFragment(fragment)) {
			// The selection cuts through a block: wrapping it would let the parser's brace
			// recovery eat the selection's own closing braces, so leave it to the re-indenter.
			return null;
		}
		const baseLevel = this.baseIndentLevel(document, range, options);
		const wrapperKey = '__pdx_selection__';
		const wrapped = wrapperKey + ' = {\n' + fragment + '\n}\n';

		// Try with the user's compacting setting first; when a small selection comes back on
		// one line the wrapper is gone, so retry with --no-compact before giving up.
		for (const forceCompact of [undefined, false]) {
			const answer = await formatWithPythonBridge(wrapped, forceCompact);
			const body = this.unwrapSelectionFragment(answer.content, wrapperKey);
			if (body) {
				return [vscode.TextEdit.replace(extendedRange, this.reindentSelection(body, fragment, baseLevel, options))];
			}
		}
		return null;
	}

	// Strip the throwaway wrapper from the tool's answer; null when it is not intact.
	unwrapSelectionFragment(content, wrapperKey) {
		const lines = content.split('\n');
		while (lines.length && lines[0].trim() === '') lines.shift();
		while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
		if (lines.length < 2) {
			return null;
		}
		if (lines[0].trim() !== wrapperKey + ' = {') {
			return null;
		}
		if (lines[lines.length - 1].trim() !== '}') {
			return null;
		}
		return lines.slice(1, lines.length - 1);
	}

	// Re-base the wrapped fragment onto the selection's indentation and restore the blank
	// lines the underlying formatter normalises away.
	reindentSelection(body, fragment, baseLevel, options) {
		const result = body.map(line => {
			if (line.trim().length === 0) {
				return '';
			}
			// The wrapper added one level, so the first tab is dropped and the rest is
			// re-indented starting at the selection's own base level.
			const leading = (line.match(/^\t+/) || [''])[0];
			return getIndent(baseLevel + Math.max(0, leading.length - 1), options) + line.slice(leading.length);
		});

		// A blank line in the fragment is put back in front of the next line that survived.
		const original = fragment.split('\n');
		let cursor = 0;
		for (let i = 1; i < original.length; i++) {
			if (original[i].trim().length === 0 || original[i - 1].trim().length !== 0) {
				continue;
			}
			const next = original[i].trim();
			const at = result.findIndex((line, idx) => idx >= cursor && line.trim() === next);
			if (at < 0) {
				continue;
			}
			if (at > cursor && result[at - 1].trim().length !== 0) {
				result.splice(at, 0, '');
				cursor = at + 1;
			} else {
				cursor = at + 1;
			}
		}
		// Leading and trailing blank lines belong to the selection just as much.
		if (original.length > 0 && result.length > 0
			&& original[0].trim().length === 0 && result[0].trim().length !== 0) {
			result.unshift('');
		}
		if (original.length > 0 && result.length > 0
			&& original[original.length - 1].trim().length === 0 && result[result.length - 1].trim().length !== 0) {
			result.push('');
		}
		return result.join('\n');
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

	// Selections go through the Python tool as well, so the same conversions run; the
	// built-in re-indenter stays as the fallback for anything the tool cannot handle.
	async provideDocumentRangeFormattingEdits(document, range, options) {
		try {
			const converted = await this.formatRangeWithPython(document, range, options);
			if (converted) {
				return converted;
			}
		} catch (err) {
			console.error('Selection formatting through the Python formatter failed, falling back to the built-in re-indenter:', err);
		}
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

	const formatAllCommand = vscode.commands.registerCommand('paradox-formatter.formatAllFiles', async () => {
		const files = await vscode.workspace.findFiles('**/*.txt', '{node_modules,.git,out,bin}/**');
		if (files.length === 0) {
			vscode.window.showInformationMessage('No text files found to format.');
			return;
		}
		
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Formatting all Paradox files...",
			cancellable: true
		}, async (progress, token) => {
			let formattedCount = 0;
			let total = files.length;
			for (let i = 0; i < total; i++) {
				if (token.isCancellationRequested) {
					break;
				}
				const file = files[i];
				progress.report({ message: `Processing ${i + 1}/${total}`, increment: (100 / total) });
				try {
					const document = await vscode.workspace.openTextDocument(file);
					const text = document.getText();
					const result = await formatWithPythonBridge(text);
					if (result.changed) {
						const edit = new vscode.WorkspaceEdit();
						const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
						edit.replace(file, fullRange, result.content);
						await vscode.workspace.applyEdit(edit);
						await document.save();
						formattedCount++;
					}
				} catch (err) {
					console.error(`Error formatting ${file.fsPath}:`, err);
				}
			}
			vscode.window.showInformationMessage(`Formatted ${formattedCount} files.`);
		});
	});

	ctx.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(selector, formatter),
		vscode.languages.registerDocumentRangeFormattingEditProvider(selector, formatter),
		formatAllCommand
	);
}
