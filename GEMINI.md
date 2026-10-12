# Gemini Context: Paradox Script Formatter

## Project Overview
This project is a VS Code extension (`f1r3pr1nc3.paradox-formatter`) that provides formatting and logical optimization for Paradox Interactive game scripts (Stellaris, HOI4, EU4, CK2, etc.). It aims to provide smart indentation, block expansion, and syntax protection while simplifying complex logical expressions.

## Key Components
- `bin/logic_optimizer.py`: The core Python script responsible for parsing and optimizing Clausewitz logic. It handles De Morgan's laws, double negation removal, and NAND simplifications. It uses a custom tokenizer and parser to handle the unique structure of Paradox scripts.
- `out/extension.js`: The compiled VS Code extension entry point that interfaces with the Python backend.
- `syntaxes/`: Contains TextMate grammars (`.tmLanguage.json`) for various Paradox games to provide syntax highlighting.
- `test/`: Contains test event files for verification.

## Coding Standards
- **Indentation**: Strictly use tabs (literal `	`) for indentation in all code files (Python, JavaScript, TypeScript).
- **Python**:
    - Follow established patterns in `logic_optimizer.py` for regex and node manipulation.
- **TypeScript/JavaScript**: Standard VS Code extension development practices (using tabs).
- **Paradox Script**: The formatter itself enforces specific styles, such as lowercasing certain keywords (ROOT, PREV, etc.) and upperpasing logical operators (OR, AND, NAND, NOR).

## Domain Specific Knowledge (Clausewitz Scripting)
- **Existential Quantifiers**: `any_` and `count_` triggers act as existential quantifiers.
- **Logical Negation Rules**:
    - `NOT = { any_scope = { ... } }` is **NOT** equivalent to `any_scope = { NOT = { ... } }`.
    - Negations (NOT) cannot be pushed into existential quantifier scopes because `¬∃x` (It is not the case that there exists an x such that...) is not equivalent to `∃¬x` (There exists an x such that it is not the case that...).
    - This is a critical rule for the `logic_optimizer.py` to avoid breaking game logic.
- **Logic Optimization**: The formatter can simplify `OR-AND` structures into `NAND` and similar logical transformations to improve readability and potentially performance in-game.

## Known State & Recent Fixes
- The `logic_optimizer.py` horizontal merging step was updated to prevent merging structural block keywords (like `limit`, `trigger`) into `NOR` logic gates during numerical/boolean negation routines.
- The `logic_optimizer.py` was updated to replace regex-based logic with a proper parser to handle `factor=0` modifiers and nested blocks without corrupting the file structure (preventing unbalanced braces).
- Indentation preference for the workspace is set to 4-space tabs.
- The beta conditional conversions (`CONDITIONAL_CONVERSIONS`, `--conditional-conversions`) fold a `break = yes` dispatch chain and an `else` that only wraps one `if`/`else_if`/`else` chain into a single flat chain, and turn an `if`/`if` pair whose limits negate each other into `if`/`else_if`. All of them step over interleaved comment lines and keep every comment in place - a comment on the `break` line itself moves onto the script in front of it (or becomes a comment line behind it when that script is a block that would be inlined). The `break` rules are skipped inside `while`/`inline_script`, where the stop is not local to the block.
- `XOR_FORM` / `--xor-form` / `paradox-formatter.xorForm` picks how a fully written out `exactly one of {A, B}` (`OR = { AND = { not A B } AND = { A not B } }`) is spelled: `calc_true_if = { amount = 1 A B }` (`amount` is an exact comparison from Stellaris 2.1 on - the 1.9/2.0 tooltips read "If at least $AMOUNT$ ...", 2.1+ interpolate `$COMPARATOR$` - so vanilla only ever writes `amount >= N`), or the version-safe `AND = { OR = { A B } NAND = { A B } }` (`or_nand`, two members only). `calc_true_if` is the default; `or_nand` writes the version-safe `AND = { OR = { A B } NAND = { A B } }` pair instead and `auto` mirrors the file - using the compact form only when the document already writes an `amount >= ...` comparison, the OR/NAND pair otherwise. `_xor_members` requires one `AND` per member, each holding that member positive and every other member negated, with no comments (the sub-structure is dropped) and at most four members. The trigger `if`/`else` spelling of the same expression folds too (`_trigger_if_else_xor`: `if = { limit = { A } B } else = { C }` with `C` the negation of `B` is `amount = 1` when exactly one of `A`/`B` is negated, `amount != 1` when both or neither is - `_positive_member` unwraps the negated side via `_get_positive_form`, which only accepts a node that really is a negation). It stays inside trigger positions (an effect `if`/`else` runs one of two bodies, so it is left alone), and the mode gate falls back to `_body_scan_hint` on the members when the container is unknown.

## To-Do
- `switch`/`inverted_switch` parse as raw blocks, so `_body_node_hint` skips them and they never count as "effect evidence" when guessing trigger-vs-effect for a conditional in an unknown container. Decide whether a raw `switch` should stop the trigger guess and implement it (see the `# TODO` in `_body_node_hint`).
