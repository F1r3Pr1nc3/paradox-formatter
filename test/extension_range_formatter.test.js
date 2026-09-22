// Regression test for the range (selection) formatter in out/extension.js.
//
// Run with:  node test/extension_range_formatter.test.js
//
// It stubs the 'vscode' module, activates the extension and drives
// provideDocumentRangeFormattingEdits() exactly as VS Code does when you press
// Ctrl+K Ctrl+F. Pass a path as argv[2] to test another build of the file.
'use strict';
const Module = require('module');
const path = require('path');

class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(start, end) { this.start = start; this.end = end; } }
class TextEdit {
	constructor(range, newText) { this.range = range; this.newText = newText; }
	static replace(range, newText) { return new TextEdit(range, newText); }
}
let captured = null;
const fakeVscode = {
	Position, Range, TextEdit,
	workspace: { getConfiguration: () => ({ get: (k) => (k === 'safeNavigation' ? 'fold' : undefined) }) },
	window: { showErrorMessage: () => {}, showInformationMessage: () => {} },
	commands: { registerCommand: () => ({ dispose() {} }) },
	languages: {
		registerDocumentFormattingEditProvider: () => ({ dispose() {} }),
		registerDocumentRangeFormattingEditProvider: (sel, fmt) => { captured = fmt; return { dispose() {} }; },
	},
	ProgressLocation: { Notification: 15 },
	WorkspaceEdit: class { replace() {} },
};
const origLoad = Module._load;
Module._load = function (request) {
	if (request === 'vscode') return fakeVscode;
	return origLoad.apply(this, arguments);
};
const root = path.join(__dirname, '..');
const target = process.argv[2]
	? (path.isAbsolute(process.argv[2]) ? process.argv[2] : path.join(root, process.argv[2]))
	: path.join(root, 'out', 'extension.js');
require(target).activate({ subscriptions: { push() {} } });
if (!captured) { console.error('formatter not registered'); process.exit(1); }

function makeDocument(text) {
	const lines = text.split('\n');
	return {
		lineCount: lines.length,
		lineAt(i) { const t = lines[i] === undefined ? '' : lines[i]; return { text: t, isEmptyOrWhitespace: t.trim().length === 0 }; },
		getText(range) { return range ? lines.slice(range.start.line, range.end.line + 1).join('\n') : text; },
		positionAt() { return new Position(0, 0); },
	};
}

async function formatSelection(text, startLine, endLine, options = { tabSize: 4, insertSpaces: false }) {
	const doc = makeDocument(text);
	const range = new Range(new Position(startLine, 0), new Position(endLine, doc.lineAt(endLine).text.length));
	const edits = await captured.provideDocumentRangeFormattingEdits(doc, range, options);
	return edits[0].newText;
}

// Whitespace-insensitive comparison, for results whose line breaks are a style choice.
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

async function formatDocument(text, options = { insertSpaces: false, tabSize: 4 }) {
	const doc = makeDocument(text);
	const edits = await captured.provideDocumentFormattingEdits(doc, options);
	return edits.length ? edits[0].newText : text;
}

let pass = 0, fail = 0;
function check(title, got, expected) {
	const ok = got === expected;
	console.log((ok ? '[ok]   ' : '[FAIL] ') + title);
	if (!ok) {
		console.log('   got:');
		String(got).split('\n').forEach(l => console.log('     |' + l));
		console.log('   expected:');
		String(expected).split('\n').forEach(l => console.log('     |' + l));
	}
	ok ? pass++ : fail++;
}

const event = [
	'starbase_event = {',
	'\tid = crisis.2610',
	'\thide_window = yes',
	'',
	'\tis_triggered_only = yes',
	'',
	'\ttrigger = {',
	'\t\tfrom.owner = { is_country_type = ai_empire }',
	'\t\tNOT = {',
	'\t\t\tsolar_system = {',
	'\t\t\t\tany_system_planet = { is_colony = yes } # For populated systems, they need to invade first',
	'\t\t\t}',
	'\t\t}',
	'\t}',
	'',
	'\timmediate = {',
	'\t\tsolar_system = { save_event_target_as = starbase_system }',
	'\t}',
	'}',
].join('\n');
const withRaw = ['some_event = {', '\tdesc = @[Root.GetName { }]', '\ttrigger = {', '\t\thas_owner = yes', '\t}', '}'].join('\n');
const rawInside = ['a = {', '\tval = @[ x { y } z ]', '\tnext = yes', '}'].join('\n');
const closing = ['a = {', '\tb = {', '\t\tc = yes', '\t}', '}'].join('\n');
const fragment = ['trigger = {', '\thas_owner = yes', '}'].join('\n');

(async () => {
	check('1. an event trigger block keeps its indentation (and converts)', await formatSelection(event, 6, 13),
		['\ttrigger = {',
			'\t\tfrom.owner = { is_country_type = ai_empire }',
			'\t\tNOT = {',
			'\t\t\tsolar_system? = {',
			'\t\t\t\tany_system_planet = { is_colony = yes } # For populated systems, they need to invade first',
			'\t\t\t}',
			'\t\t}',
			'\t}'].join('\n'));

	check('2. blank lines inside the selection survive', await formatSelection(event, 2, 14),
		['\thide_window = yes',
			'',
			'\tis_triggered_only = yes',
			'',
			'\ttrigger = {',
			'\t\tfrom.owner = { is_country_type = ai_empire }',
			'\t\tNOT = {',
			'\t\t\tsolar_system? = {',
			'\t\t\t\tany_system_planet = { is_colony = yes } # For populated systems, they need to invade first',
			'\t\t\t}',
			'\t\t}',
			'\t}',
			''].join('\n'));

	check('3. @[ ... ] before the selection does not shift the indent', await formatSelection(withRaw, 2, 4),
		['\ttrigger = {', '\t\thas_owner = yes', '\t}'].join('\n'));

	check('4. braces inside @[ ... ] in the selection are ignored', await formatSelection(rawInside, 1, 3),
		['\tval = @[ x { y } z ]', '\tnext = yes', '}'].join('\n'));

	check('5. a selection starting with } keeps its level', await formatSelection(closing, 2, 4),
		['\t\tc = yes', '\t}', '}'].join('\n'));

	check('6. a fragment at column 0 stays at column 0', await formatSelection(fragment, 0, 2), fragment);

	check('7. spaces honour tabSize', await formatSelection(withRaw, 2, 4, { tabSize: 2, insertSpaces: true }),
		['  trigger = {', '    has_owner = yes', '  }'].join('\n'));

	// 8-10: the logic conversions run for selections too (fold mode in the stubbed config)
	const deadNor = ['meta = {', '\tif = {', '\t\tlimit = { exists = owner }', '\t\tis_homeworld = yes', '\t}', '}'].join('\n');
	check('8. dead NOR leftover inside a selection is repaired',
		flat(await formatSelection(['x = {', '\tNOR = {', '\t\texists = event_target:T', '\t\tevent_target:T = { allows_slavery = yes }', '\t}', '}'].join('\n'), 1, 4)),
		flat('\tevent_target:T? = { allows_slavery = no }'));

	check('9. exists + scope block inside a selection is folded',
		flat(await formatSelection(['x = {', '\texists = event_target:T', '\tevent_target:T = { is_ai = no }', '}'].join('\n'), 1, 2)),
		flat('\tevent_target:T? = { is_ai = no }'));

	check('10. an if inside allow is converted to OR',
		flat(await formatSelection(deadNor, 1, 4)),
		flat('\tOR = { NOT = { exists = owner } is_homeworld = yes }'));

	// 11: a selection that cuts through a block keeps the built-in re-indenter (nothing lost)
	const cut = ['a = {', '\tb = {', '\t\tc = yes', '\t}', '}'].join('\n');
	check('11. a selection cutting through a block keeps its closing braces',
		await formatSelection(cut, 2, 4),
		['\t\tc = yes', '\t}', '}'].join('\n'));

	// 12-13: whole-document formatting honours the editor's indentation style
	const mixedIndent = ['starbase_event = {', '\tid = crisis.2610', '    trigger = {', '\t\thas_owner = yes', '\t}', '}'].join('\n');
	check('12. spaces stay spaces when the editor uses spaces',
		flat(await formatDocument(mixedIndent, { insertSpaces: true, tabSize: 4 })),
		flat(['starbase_event = {', '    id = crisis.2610', '    trigger = {', '        has_owner = yes', '    }', '}'].join('\n')));
	check('13. tabs stay tabs when the editor uses tabs',
		flat(await formatDocument(mixedIndent, { insertSpaces: false, tabSize: 4 })),
		flat(['starbase_event = {', '\tid = crisis.2610', '\ttrigger = {', '\t\thas_owner = yes', '\t}', '}'].join('\n')));

	// 14: a collapsed switch body inside a selection is re-indented like the rest
	const switched = ['e = {', '\ttrigger = {', '\t\tswitch = {', '\t\t\tswitch = is_country_type', 'new_type = { is_ai = no }', '\t\t}', '\t}', '}'].join('\n');
	check('14. a collapsed switch body inside a selection is re-indented',
		flat(await formatSelection(switched, 2, 5)),
		flat(['\t\tswitch = {', '\t\t\tswitch = is_country_type', '\t\t\tnew_type = { is_ai = no }', '\t\t}'].join('\n')));

	// 15: the real crisis.2610 trigger with its inline comments (Vfix notes) must keep
	// every comment and still fold the scope - this is the case reported twice.
	const c2610 = ['starbase_event = {',
		'\tid = crisis.2610',
		'\ttrigger = {',
		'\t\tfrom.owner = { is_country_type = ai_empire }',
		'\t\tNOT = {',
		'\t\t\tsolar_system = {',
		'\t\t\t\tany_system_planet_colony = {',
		'\t\t\t\t\thas_owner = yes # For populated systems, they need to invade first',
		'\t\t\t\t\tNOT = { is_owned_by = from.owner } # Vfix: as said',
		'\t\t\t\t}',
		'\t\t\t}',
		'\t\t}',
		'\t}',
		'}'].join('\n');
	const c2610Out = await formatSelection(c2610, 2, 12);
	const expectations = [
		'solar_system? = {',
		'has_owner = yes # For populated systems, they need to invade first',
		'NOT = { is_owned_by = from.owner } # Vfix: as said',
	];
	const problems = expectations.filter((e) => !c2610Out.includes(e));
	if (problems.length === 0) {
		// no comment may be duplicated or dropped either
		const count = (s, sub) => s.split(sub).length - 1;
		if (count(c2610Out, 'Vfix') !== 1 || count(c2610Out, 'have to invade') > 0
			|| count(c2610Out, 'they need to invade first') !== 1) {
			problems.push('a comment was duplicated or dropped');
		}
	}
	check('15. crisis.2610 keeps both inline comments and still folds the scope',
		problems.length ? problems.join(' / ') : 'ok', 'ok');

	console.log('='.repeat(60));
	console.log('range formatter: %d/%d passed', pass, pass + fail);
	process.exit(fail ? 1 : 0);
})();
