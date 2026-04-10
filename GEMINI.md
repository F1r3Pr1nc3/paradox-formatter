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
- The `logic_optimizer.py` was updated to replace regex-based logic with a proper parser to handle `factor=0` modifiers and nested blocks without corrupting the file structure (preventing unbalanced braces).
- Indentation preference for the workspace is set to 4-space tabs.
