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

// Hints the Python tool reports (shapes it recognised but deliberately left alone). They are
// appended to an output channel and announced on the status bar - never in a popup, because the
// formatter also runs through 'formatOnSave' and a dialog per save would be worse than the hint.
let hintsChannel = null;

function getHintsChannel() {
	if (!hintsChannel) {
		hintsChannel = vscode.window.createOutputChannel('PDX Script Formatter');
	}
	return hintsChannel;
}

function reportFormatterHints(hints) {
	if (!Array.isArray(hints) || hints.length === 0) {
		return 0;
	}
	const channel = getHintsChannel();
	for (const hint of hints) {
		channel.appendLine('hint: ' + hint);
	}
	channel.appendLine('');
	vscode.window.setStatusBarMessage(
		'PDX Script Formatter: ' + hints.length + (hints.length === 1 ? ' hint' : ' hints')
		+ ' (see Output -> PDX Script Formatter)',
		6000
	);
	return hints.length;
}

/**
 * Executes the Python formatter script and returns the formatted content.
 * @param {string} text - The raw document text to format.
 * @param {boolean|undefined} forceCompact - If defined, overrides the noCompact setting. True = force compact, False = force no-compact.
 * @param {string|undefined} sourceName - Name printed in front of a hint (the file being formatted).
 * @returns {Promise<{content: string, changed: boolean, hints?: string[]}>}
 */
function formatWithPythonBridge(text, forceCompact, sourceName) {
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

		if (config.get('conditionalConversions') === true) {
			args.push('--conditional-conversions');
		} else {
			// The script itself keeps the (BETA) conversions on by default, so the extension has
			// to say so explicitly when its setting is off.
			args.push('--no-conditional-conversions');
		}

		// The 'exactly one of {A, B}' fold is a switch of its own: unlike the rewrites above it
		// *creates* a counted trigger, so it is off unless asked for - even though the script
		// defaults it on.
		if (config.get('calcTrueIfConversions') === true) {
			args.push('--calc-true-if-conversions');
		} else {
			args.push('--no-calc-true-if-conversions');
		}

		// How a fully written out 'exactly one of {A, B}' is written. 'calc_true_if' is the
		// default; 'auto' mirrors the file's own style and 'or_nand' works in any version.
		args.push('--xor-form', String(config.get('xorForm') || 'calc_true_if'));

		// Lets a hint name the file it came from instead of leaving the author to search for it.
		if (sourceName) {
			args.push('--source-name', sourceName);
		}

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

	constructor() {
		// The paste that was just handled (or deliberately left alone), so the range request the
		// editor fires right after it - its own 'format on paste' - is answered here instead of
		// formatting the same lines a second time, or formatting them at all while this
		// extension's 'paradox-formatter.formatOnPaste' is off.
		this.lastPaste = null;
	}

	// 'paradox-formatter.formatOnPaste' - the extension's own switch. Off, a paste is never
	// formatted, whatever the editor's settings say; on, it is formatted even when the editor's
	// 'editor.formatOnPaste' is off.
	wantsPasteFormatting() {
		return vscode.workspace.getConfiguration('paradox-formatter').get('formatOnPaste') === true;
	}

	// The editor's own switch. It can be set per language, so ask with the document at hand.
	editorFormatsPaste(document) {
		try {
			const scope = document && document.uri ? document.uri : undefined;
			return vscode.workspace.getConfiguration('editor', scope).get('formatOnPaste') === true;
		} catch (err) {
			return false;
		}
	}

	// Remember a paste so the range request that follows it is answered from here instead.
	// 'formatted' says whether this extension already formatted it (then the editor must not format
	// it again) or left it alone (then the editor must not format it either, while the switch is
	// off).
	notePaste(document, ranges, formatted) {
		let endLine = ranges[0].end.line;
		for (const range of ranges) {
			if (range.end.line > endLine) {
				endLine = range.end.line;
			}
		}
		this.lastPaste = {
			uri: document.uri.toString(),
			startLine: ranges[0].start.line,
			endLine: endLine,
			time: Date.now(),
			formatted: !!formatted,
		};
	}

	// The paste this range request is the editor's format-on-paste for, if it is one. Answers once,
	// so 'Format Selection' on those lines keeps working right after a paste.
	takePasteFormatRequest(document, range) {
		const paste = this.lastPaste;
		if (!paste || !document || !document.uri || document.uri.toString() !== paste.uri) {
			return null;
		}
		if (Date.now() - paste.time > 3000) {
			this.lastPaste = null;
			return null;
		}
		if (range.end.line < paste.startLine || range.start.line > paste.endLine) {
			return null;
		}
		this.lastPaste = null;
		return paste;
	}

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

	// The Python formatter always emits tabs. Re-render the indentation the way the editor
	// asked for, so a line that was indented with spaces does not come back as a tab (which
	// looks like a collapsed indent when tabs are displayed narrower than the spaces were).
	effectiveIndentOptions(options) {
		if (options && typeof options.insertSpaces === 'boolean') {
			return { insertSpaces: options.insertSpaces, tabSize: options.tabSize || 4 };
		}
		const editor = vscode.workspace.getConfiguration('editor');
		return { insertSpaces: !!editor.get('insertSpaces'), tabSize: editor.get('tabSize') || 4 };
	}

	applyIndentStyle(text, indentOptions) {
		if (!indentOptions.insertSpaces) {
			return text;
		}
		const unit = ' '.repeat(indentOptions.tabSize);
		return text.split('\n').map(line => {
			const leading = (line.match(/^\t+/) || [''])[0];
			return leading.length ? unit.repeat(leading.length) + line.slice(leading.length) : line;
		}).join('\n');
	}

	// Format a selection through the Python tool, so the logic conversions (scope? folding,
	// if -> OR, NOR repair, ...) run there as well. The fragment is wrapped in a throwaway
	// block because the parser needs a complete document, the wrapper is stripped from the
	// answer, the levels are re-based onto the selection's own indentation and the author's
	// blank lines are put back in front of the lines that survived unchanged.
	// Returns null when the wrapper did not survive (selections that cut through a block and
	// the like), so the caller can fall back to the built-in re-indenter.
	// The formatted form of 'fragment' (the text of 'range'), or null when the tool's wrapper did
	// not survive the round trip. Both the range provider and the paste provider go through here,
	// so a paste and a selection are formatted by exactly the same code.
	async formattedFragmentText(document, range, fragment, options) {
		if (!this.isBalancedFragment(fragment)) {
			// The fragment cuts through a block: wrapping it would let the parser's brace
			// recovery eat its own closing braces, so leave it to the built-in re-indenter.
			return null;
		}
		const baseLevel = this.baseIndentLevel(document, range, options);
		const wrapperKey = '__pdx_selection__';
		const wrapped = wrapperKey + ' = {\n' + fragment + '\n}\n';

		// Try with the user's compacting setting first; when a small fragment comes back on
		// one line the wrapper is gone, so retry with --no-compact before giving up.
		for (const forceCompact of [undefined, false]) {
			const answer = await formatWithPythonBridge(wrapped, forceCompact);
			const body = this.unwrapSelectionFragment(answer.content, wrapperKey);
			if (body) {
				return this.reindentSelection(body, fragment, baseLevel, options);
			}
		}
		return null;
	}

	async formatRangeWithPython(document, range, options) {
		const start = new vscode.Position(range.start.line, 0);
		const endLine = document.lineAt(range.end.line);
		const end = new vscode.Position(range.end.line, endLine.text.length);
		const extendedRange = new vscode.Range(start, end);

		const fragment = document.getText(extendedRange);
		const formatted = await this.formattedFragmentText(document, extendedRange, fragment, options);
		if (formatted === null) {
			return null;
		}
		return [vscode.TextEdit.replace(extendedRange, formatted)];
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
		const bridgeResult = await formatWithPythonBridge(text, undefined,
			vscode.workspace.asRelativePath(document.uri, false));
		reportFormatterHints(bridgeResult.hints);
		const content = this.applyIndentStyle(bridgeResult.content, this.effectiveIndentOptions(options));
		const changed = bridgeResult.changed || content !== text;

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
		// A paste is answered by the paste provider below, which is the only place that knows a
		// paste from a selection: the editor's own format-on-paste must not format the same lines
		// again after that provider did, and must not format them at all while this extension's
		// 'paradox-formatter.formatOnPaste' is off.
		const paste = this.takePasteFormatRequest(document, range);
		if (paste && (paste.formatted || !this.wantsPasteFormatting())) {
			return [];
		}
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

	// 'Format on paste', owned by the extension. The range provider cannot tell a paste from
	// 'Format Selection', so this provider is the signal: it runs for every paste in the language,
	// notes the pasted lines, and - when 'paradox-formatter.formatOnPaste' is on - returns the
	// formatted text as the paste edit. With the switch off it returns no edit, and the note it
	// took suppresses the editor's own paste formatting (see isPasteFormatRequest).
	async provideDocumentPasteEdits(document, ranges) {
		try {
			if (!document || !document.uri || !Array.isArray(ranges) || !ranges.length) {
				return undefined;
			}
			const wantsFormatting = this.wantsPasteFormatting();
			// Several cursors put the same text at several places, each at its own indentation, and
			// one paste edit cannot carry that: those stay with the editor's own path (formatted by
			// it when the switch is on, left alone when it is off).
			if (!wantsFormatting || ranges.length !== 1) {
				if (this.editorFormatsPaste(document)) {
					this.notePaste(document, ranges, false);
				}
				return undefined;
			}
			const range = ranges[0];
			const fragment = document.getText(range);
			if (!fragment || !fragment.trim()) {
				return undefined;
			}
			const formatted = await this.formattedFragmentText(document, range, fragment,
				this.effectiveIndentOptions(undefined));
			if (formatted === null || formatted === fragment) {
				// Nothing to say about this text (or no wrapper survived): keep the plain paste.
				return undefined;
			}
			// Noted after the fact: the editor may still ask for its own paste formatting behind
			// this edit, and it must not run a second time on the same lines.
			this.notePaste(document, [range], true);
			return [new vscode.DocumentPasteEdit(formatted, 'Format pasted Paradox script',
				vscode.DocumentDropOrPasteEditKind.Text)];
		} catch (err) {
			console.error('Formatting the pasted text failed, keeping the paste as it is:', err);
			return undefined;
		}
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
			const collectedHints = [];
			for (let i = 0; i < total; i++) {
				if (token.isCancellationRequested) {
					break;
				}
				const file = files[i];
				progress.report({ message: `Processing ${i + 1}/${total}`, increment: (100 / total) });
				try {
					const document = await vscode.workspace.openTextDocument(file);
					const text = document.getText();
					const result = await formatWithPythonBridge(text, undefined,
						vscode.workspace.asRelativePath(file, false));
					if (Array.isArray(result.hints) && result.hints.length) {
						collectedHints.push(...result.hints);
					}
					const content = formatter.applyIndentStyle(result.content, formatter.effectiveIndentOptions(undefined));
					if (result.changed || content !== text) {
						const edit = new vscode.WorkspaceEdit();
						const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
						edit.replace(file, fullRange, content);
						await vscode.workspace.applyEdit(edit);
						await document.save();
						formattedCount++;
					}
				} catch (err) {
					console.error(`Error formatting ${file.fsPath}:`, err);
				}
			}
			// Hints are reported once for the whole run, not once per file.
			const hintCount = reportFormatterHints(collectedHints);
			vscode.window.showInformationMessage(`Formatted ${formattedCount} files.`
				+ (hintCount ? ` ${hintCount} hint${hintCount === 1 ? '' : 's'} - see Output -> PDX Script Formatter.` : ''));
		});
	});

	ctx.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(selector, formatter),
		vscode.languages.registerDocumentRangeFormattingEditProvider(selector, formatter),
		formatAllCommand
	);

	// The paste API arrived in VS Code 1.86; on an older build this extension simply does not
	// register a paste provider and 'editor.formatOnPaste' stays in charge, as it was before.
	// Without the provider there is no way to tell a paste from 'Format Selection', so the switch
	// would have nothing to act on - rather than show a checkbox that does nothing, leave the
	// editor's own setting to it.
	const pasteKinds = vscode.DocumentDropOrPasteEditKind;
	const canOwnPaste = typeof vscode.languages.registerDocumentPasteEditProvider === 'function'
		&& typeof vscode.DocumentPasteEdit === 'function'
		&& !!pasteKinds && !!pasteKinds.Text;
	if (canOwnPaste) {
		ctx.subscriptions.push(vscode.languages.registerDocumentPasteEditProvider(selector, {
			provideDocumentPasteEdits: (document, ranges) => formatter.provideDocumentPasteEdits(document, ranges),
		}, { providedPasteEditKinds: [pasteKinds.Text] }));
	}
}
