"""Regression test for the logic optimizer (bin/logic_optimizer.py).

Run with:  python test/logic_optimizer_cases.test.py

Covers the two things that went wrong around scope blocks in conditions:
  * comments must never be duplicated ('NOR = { exists = X  X = { # c ... } }' and the
    conditional it came from are the shapes where that used to happen), and
  * a conditional whose body is a scope block must keep its meaning - the OR the
    implication rewrite produces must not be merged into a NOR/NAND, because
    'X = { NOT = { k } }' is not the negation of 'X = { k }' while X may be missing.
"""
import importlib.util
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('logic_optimizer', os.path.join(ROOT, 'bin', 'logic_optimizer.py'))
optimizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(optimizer)

COMMENT = 'Subject integration is handled in shroud.70'
BLOCK = ("\t\tif = {\n"
	'\t\t\tlimit = { exists = fromfrom }\n'
	'\t\t\tfrom = { # ' + COMMENT + '\n'
	'\t\t\t\tNOT = { is_same_value = root.fromfrom }\n'
	'\t\t\t}\n'
	'\t\t}\n')

SHELLS = {
	'trigger container': 'shroud_event = {\n\tid = shroud.70\n\ttrigger = {\n' + BLOCK + '\t}\n}\n',
	'allow container': 'decision = {\n\tallow = {\n' + BLOCK + '\t}\n}\n',
	'unknown container': 'my_trigger = {\n' + BLOCK + '}\n',
	'effect container': 'shroud_event = {\n\timmediate = {\n' + BLOCK + '\t}\n}\n',
}

passed = failed = 0


def run(text, mode='fold'):
	optimizer.SAFE_NAVIGATION_MODE = mode
	optimizer.USE_SAFE_NAVIGATION = True
	saved = sys.stderr
	sys.stderr = io.StringIO()
	try:
		content, _ = optimizer.process_text(text)
	finally:
		sys.stderr = saved
	return content


def check(title, condition, detail=''):
	global passed, failed
	if condition:
		passed += 1
		print('[ok]   ' + title)
	else:
		failed += 1
		print('[FAIL] ' + title)
		if detail:
			for line in detail.split('\n'):
				print('       |' + line)


for name, text in SHELLS.items():
	for mode in ('fold', 'ignore', 'revert'):
		out = run(text, mode)
		check('%s / %s: comment kept exactly once' % (name, mode), out.count(COMMENT) == 1, out)
		stable = run(out, mode)
		check('%s / %s: stable' % (name, mode), stable.replace('\n\n', '\n') == out.replace('\n\n', '\n'), out + '---\n' + stable)

out = run(SHELLS['trigger container'])
check('trigger: implication becomes an OR', 'OR = {' in out and 'if = {' not in out, out)
check('trigger: OR is not merged into a NAND', 'NAND = {' not in out, out)
check('trigger: the scope block keeps its own NOT', 'from = {' in out and 'NOT = { is_same_value = root.fromfrom }' in out, out)

out = run(SHELLS['unknown container'])
check('unknown container: conditional untouched', 'if = {' in out and 'OR = {' not in out, out)
out = run(SHELLS['effect container'])
check('effect container: conditional untouched', 'if = {' in out and 'OR = {' not in out, out)

leaf = 'decision = {\n\tallow = {\n\t\tif = {\n\t\t\tlimit = { is_ai = no }\n\t\t\tis_homeworld = yes\n\t\t}\n\t}\n}\n'
out = run(leaf)
check('plain trigger leaves still convert to OR', 'OR = {' in out and 'if = {' not in out, out)

nor_leftover = 'x = {\n\tNOR = {\n\t\texists = event_target:T\n\t\tevent_target:T = { allows_slavery = yes }\n\t}\n}\n'
out = run(nor_leftover)
check('dead NOR leftover repaired', 'event_target:T? = { allows_slavery = no }' in ' '.join(out.split()), out)

# --- switch blocks ('raw_block') must be re-indented, not copied verbatim --------------
SWITCH_CASES = {
	'switch body at column 0': (
		'e = {\n\ttrigger = {\n\t\tswitch = {\n\t\t\tswitch = is_country_type\nnew_type = { is_ai = no }\n\t\t}\n\t}\n}\n',
		['\t\tswitch = {', '\t\t\tswitch = is_country_type', '\t\t\tnew_type = { is_ai = no }', '\t\t}']),
	'switch body with spaces': (
		'e = {\n\ttrigger = {\n\t\tswitch = {\n\t\t\tswitch = is_country_type\n    new_type = { is_ai = no }\n\t\t}\n\t}\n}\n',
		['\t\tswitch = {', '\t\t\tswitch = is_country_type', '\t\t\tnew_type = { is_ai = no }', '\t\t}']),
	'one-line switch keeps its inner braces': (
		'e = {\n\ttrigger = {\n\t\tswitch = { switch = is_country_type default = { is_ai = no } }\n\t}\n}\n',
		['\t\tswitch = { switch = is_country_type default = { is_ai = no }', '\t\t}']),
}
for name, (source, expected_lines) in SWITCH_CASES.items():
	out = run(source)
	body = out.split('\n')
	check(name + ': re-indented', all(any(line == exp for line in body) for exp in expected_lines), out)
	check(name + ': no indentation issues left', not optimizer.check_indentation(out), out)
	check(name + ': still stable', run(out) == out, out)

# a stale, collapsed body in the file is repaired by one run
COLLAPSED = ('e = {\n\ttrigger = {\n\t\tfrom.owner = { is_country_type = ai_empire }\n\t\tswitch = {\n'
	'\t\t\tswitch = is_country_type\n\t\t\tdefault = {\n\t\tis_ai = no\n\t\t\t}\n\t\t}\n\t}\n}\n')
check('collapsed switch body reports issues in the input', len(optimizer.check_indentation(COLLAPSED)) > 0)
fixed = run(COLLAPSED)
check('collapsed switch body is repaired', not optimizer.check_indentation(fixed), fixed)
check('repaired switch body is stable', run(fixed) == fixed, fixed)

# --- hoisting a common scope out of NAND/NOR needs the scope to exist -------------------
NAND_CASE = ('e = {\n\ttrigger = {\n\t\tNAND = {\n\t\t\tfrom = { is_primitive = no }\n'
	'\t\t\tfrom = { is_fallen_empire = no }\n\t\t}\n\t}\n}\n')
out = run(NAND_CASE)
check('NAND with a common scope and no guard keeps its NAND', 'NAND = {' in out, out)
check('NAND case is stable', run(out) == out, out)

GUARDED_NAND = ('e = {\n\ttrigger = {\n\t\texists = from\n\t\tNAND = {\n\t\t\tfrom = { is_primitive = no }\n'
	'\t\t\tfrom = { is_fallen_empire = no }\n\t\t}\n\t}\n}\n')
out = run(GUARDED_NAND)
check('NAND with a guard may hoist the common scope', ('from = {' in out or 'from? = {' in out) and 'NAND = {' in out, out)

OR_CASE = ('e = {\n\ttrigger = {\n\t\tOR = {\n\t\t\tfrom = { is_primitive = no }\n'
	'\t\t\tfrom = { is_fallen_empire = no }\n\t\t}\n\t}\n}\n')
out = run(OR_CASE)
check('OR with a common scope still hoists it', out.count('from = {') == 1, out)

# --- a collapsed scope block with a comment on the closing brace must re-indent ---------
# The exact shape reported for crisis.2610: 'NOT = { solar_system? = {' with the body
# written at column 0 and the inner block's '} # comment'. The compactor used to try to
# inline 'NOT = { solar_system? = { ... } }' and, meeting the comment, abort halfway and
# leave the block unindented. It now keeps such blocks multi-line and the indentation
# returns, on every pass.
COLLAPSED = ('starbase_event = {\n'
	'\tid = crisis.2610\n'
	'\ttrigger = {\n'
	'\t\tfrom.owner = { is_country_type = ai_empire }\n'
	'\t\tNOT = { solar_system? = {\n'
	'any_system_planet_colony = {\n'
	'} # For populated systems, they need to invade first\n'
	'} }\n'
	'\t}\n'
	'}\n')
out = run(COLLAPSED)
issues = optimizer.check_indentation(out)
check('collapsed comment block is re-indented', not issues, out)
check('collapsed comment block keeps its comment once', out.count('For populated systems') == 1, out)
check('collapsed comment block is stable', run(out) == out, out)

print('=' * 60)
print('logic optimizer cases: %d/%d passed' % (passed, passed + failed))
sys.exit(1 if failed else 0)
