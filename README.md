# Paradox Script Formatter for VS Code

![Version](https://img.shields.io/badge/version-0.5.9-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A robust, whitespace-aware formatter for Paradox Interactive game scripts (Stellaris, HOI4, EU4, CK3).

This extension provides **smart indentation**, **block expansion**, and **syntax protection**, ensuring your code looks clean without breaking game logic or deleting comments. It also supports the Stellaris **v4.4+ Safe Navigation** syntax (`scope? = { ... }`): an optional pass that folds `exists = xyz` + `xyz = { ... }` (and `has_owner = yes` + `owner`/`space_owner = { ... }`) into `xyz? = { ... }` for 4.4+ targets, including the negated forms (`NOT = { xyz = { ... } }`, `OR = { NOT = { exists = xyz } xyz? = { ... } }`), and reverts it for older versions.

---

## ✨ Features

### 1. Smart Block Expansion
Automatically expands one-line blocks into readable, multi-line structures, which is crucial for complex scope logic.

**Before:**
```paradox
AND = { NOT = { has_overlord = event_target:FirstSleeper } NOT = { has_overlord = event_target:SecondSleeper } }
````

**After:**

```paradox
NOR = {
    has_overlord = event_target:FirstSleeper
    has_overlord = event_target:SecondSleeper
}
```

### 2\. Code Protection Logic

Unlike other formatters that delete code context, this formatter treats your code as **text**, preserving crucial elements:

  * **Preserves Comments:** `# Comments` are protected and restored exactly where they were.
  * **Preserves Strings:** Strings like `name = "don't split { here }"` are safe from accidental formatting.
  * **Re-indents raw blocks:** the contents of `switch`/`inverted_switch` blocks are script, so they are re-indented line by line - a body line left at column 0 (or indented with spaces) no longer stays collapsed through every run. Template-style blocks (`resource_terms`, `in_breach_of`, `discrete_terms`) are still kept verbatim, because their leading whitespace can be meaningful.

### 3\. Format Selection (Range Formatting)

Allows formatting of just a specific block of code without touching the rest of the file.

  * **Shortcut:** `Ctrl + K`, `Ctrl + F` (or `Cmd + K`, `Cmd + F` on Mac)
  * A selection keeps its own base indentation (taken from the first selected line) and its blank lines, so formatting an event's `trigger = { ... }` block in place leaves the rest of the file untouched.
  * Selections run the same logic conversions as whole documents (`scope?` folding, `if` → `OR`, NOR repair): the block is wrapped, formatted by the Python tool, then re-based onto the selection's indentation so only the selected lines change.
  * Selections that cut through a block (unbalanced braces) are only re-indented, and any failure falls back to that built-in re-indenter.
  * Regression test: `node test/extension_range_formatter.test.js`

### 4. Advanced Logic Optimization (NAND)
The extension can now recognize and simplify complex logical expressions, such as nested `NAND` blocks, into a more readable and efficient format. This is particularly useful for complex AI logic or event scripting.

Inside `allow`, `potential`, `destroy_trigger` and `trigger` blocks a trigger-side conditional is rewritten as the equivalent implication: `if = { limit = L body }` means "if `L` then `body`", which is exactly `OR = { NOT = { L } body }`. In a container the formatter does not know (`my_scripted_trigger = { ... }` and the like) a conditional is rewritten only when it can only be trigger script - its body consisting of trigger leaves (`is_owned_by = ...`, `is_same_value = ...`, comparisons, `any_*`/`count_*`, logic) - because an effect body can never look like that; conditionals that use scope blocks in their limit or body are left untouched there. Conditional chains (`else_if`/`else`) keep their form, effect-side conditionals are never touched, and the whole rewrite is independent of the safe navigation setting. A conditional that holds a tooltip (`custom_tooltip` or its `text` key, anywhere in the limit or body) is always left as written, because tooltips exist in trigger and effect script alike and moving one into an OR branch - or into the negated limit - would change when it is shown.

Alongside that, the formatter repairs a specific dead leftover that older builds of this extension used to write: `NOR = { exists = x  x = { C... } }`. While `x` exists the guard makes the NOR false, and while it is missing the block cannot be true, so the script behind it was really the guarded, negated block. In `fold` mode it becomes `x? = { NOT = { C... } }`, which the usual simplification turns into `x? = { <negated C...> }`:

```paradox
NOR = {
    exists = event_target:MSI_country
    event_target:MSI_country = { allows_slavery = yes }
}
```

becomes

```paradox
event_target:MSI_country? = { allows_slavery = no }
```

Only that exact shape is repaired - `exists = x` plus a block on the same scope holding a single condition - so valid idioms like `NOR = { exists = archaeological_site  has_planet_flag = y }` and blocks with several conditions stay untouched. Note it is a repair rather than a rewrite: the NOR form is dead while the scope exists, and the guarded block is what the script was meant to say.

**Before:**
```paradox
allow = {
    if = {
        limit = { exists = orbital_defence }
        has_starbase_size >= starbase_starport
    }
}
```

**After:**
```paradox
allow = {
    OR = {
        NOT = { exists = orbital_defence }
        has_starbase_size >= starbase_starport
    }
}
```

**Before:**
```paradox
limit = {
    OR = {
        AND = {
            NOT = { exists = owner }
            OR = {
                is_active_resolution = "resolution_rulesofwar_reverence_for_life"
                is_active_resolution = "resolution_rulesofwar_independent_tribunals"
                is_active_resolution = "resolution_rulesofwar_last_resort_doctrine"
                is_active_resolution = "resolution_rulesofwar_demobilization_initiative"
            }
        }
        AND = {
            exists = owner
            owner = {
                is_crisis_faction = no
                NOT = { has_been_declared_crisis = yes }
            }
            OR = {
                is_active_resolution = "resolution_rulesofwar_reverence_for_life"
                is_active_resolution = "resolution_rulesofwar_independent_tribunals"
                is_active_resolution = "resolution_rulesofwar_last_resort_doctrine"
                is_active_resolution = "resolution_rulesofwar_demobilization_initiative"
            }
        }
    }
}
```

**After:**
```paradox
limit = {
    OR = {
        is_active_resolution = "resolution_rulesofwar_reverence_for_life"
        is_active_resolution = "resolution_rulesofwar_independent_tribunals"
        is_active_resolution = "resolution_rulesofwar_last_resort_doctrine"
        is_active_resolution = "resolution_rulesofwar_demobilization_initiative"
    }
    NAND = {
        exists = owner
        owner = {
            OR = {
                is_crisis_faction = yes
                has_been_declared_crisis = yes
            }
        }
    }
}
```

### 5. Format All Files
You can trigger a bulk formatting operation across all open files or the entire workspace using the `PDX Formatter: Format all files` command.

### 6. Safe Navigation Support (Stellaris v4.4+)
Enable or disable the four handling modes for the Stellaris **v4.4+ safe navigation** syntax (`xyz? = { ... }`) with the `paradox-formatter.safeNavigation` setting:

| Mode | Behaviour |
| --- | --- |
| `auto` (default) | Mirror the file's own style: files that already use safe navigation get their `exists = xyz` + `xyz = { ... }` pairs folded into `xyz? = { ... }`; files without it are left untouched. |
| `fold` | Always create safe navigation: `exists = xyz` + `xyz = { ... }` becomes `xyz? = { ... }` (comments may sit in between, and so may other conditions - as long as none of them uses `xyz`); the scope-less `has_owner = yes` guard is folded the same way into an `owner`/`space_owner` block. Negated scope blocks and `OR = { NOT = { exists = xyz } xyz? = { NOT = { C... } } }` leftovers are folded too (see the notes). Targets Stellaris v4.4+. |
| `revert` | Always expand safe navigation back to `exists = xyz` + `xyz = { ... }`; inside known effect scopes the pair is wrapped in `if = { limit = { exists = xyz } ... }`. Targets pre-4.4 Stellaris. |
| `ignore` | Never touch safe navigation - neither fold nor revert. |

```jsonc
// .vscode/settings.json
{
    "paradox-formatter.safeNavigation": "fold"   // "auto" | "fold" | "revert" | "ignore"
}
```

Notes:

* Folding only happens in conjunctive lists (never inside `OR`/`NOR`/`NOT`/`calc_true_if`), and only when dropping the guard cannot lose anything: the scope block either follows directly (comments aside) or every condition in between ignores that scope - `exists = from` + `is_owned_by = from` + `from = { ... }` keeps its guard, while `exists = from` + `has_star_flag = x` + `from = { ... }` folds. A redundant `exists = xyz` in front of an existing `xyz? = { ... }` is removed.
* `exists = xyz` + `NOT = { xyz = { C... } }` becomes `xyz? = { NOT = { C... } }` (`NAND` instead of `NOT` when the block holds several conditions), because `xyz = { ... }` can only be true when the scope exists, so `exists AND NOT(C...)` is exactly `exists AND NOT(xyz = { C... })`.
* The same holds for the disjunctive form: `OR = { NOT = { exists = xyz } xyz? = { NOT = { C... } } }` (the long way other tools and hand conversions write `NOT = { xyz = { C... } }`) collapses into `NOT = { xyz? = { C... } }`, since `not(exists xyz) OR (xyz exists AND not C...)` is `not(xyz exists AND C...)`. The inner negation may be a `NOT`, a `NOR`/`NAND` or a `= no`/`!=` leaf; anything else (un-negated content, a different scope, extra children) is left alone. A redundant `exists = xyz` in front of `NOT = { xyz? = { C... } }` is merged into `xyz? = { NOT = { C... } }`.
* A negation is never pushed into an optional scope block: `NOT = { xyz = { C... } }` means `not(xyz exists AND C...)`, which is not `xyz = { not C... }`. In `fold` mode the block keeps the check itself (`NOT = { xyz? = { C... } }`, which is the same expression and states the optionality); in `revert`/`ignore` mode it is left as written. Only scopes a surrounding conjunctive list guarantees to exist (`exists = xyz` or another `xyz? = { ... }` next to it) and the always-present `root`/`this` are still negated in place. The same guarantee is required before a scope block is treated as a negation at all, so `X = { NOT = { k } }` is no longer merged into a `NAND`/`NOR` as if it were `not X = { k }`.
* A `xyz? = { ... }` node is never negated (`exists AND ...` cannot be negated by flipping only its inner value), and trigger-side conditionals (`if = { limit = L body }`, i.e. `L implies body`) are never folded into `scope? = ...` - inside `allow`, `potential`, `destroy_trigger` and `trigger` blocks they are rewritten as `OR = { NOT = { L } body }` instead (see section 4).
* When reverting, the `if = { limit = { exists = xyz } xyz = { ... } }` wrapper is only written inside known effect scopes; everywhere else the flat `exists = xyz` + `xyz = { ... }` pair is used.
* **Migration:** the old boolean `paradox-formatter.useSafeNavigation` option was replaced by this setting - `useSafeNavigation: true` corresponds to `safeNavigation: "fold"`.

### 7. Diagnostics (CLI)

`--check-indent` reports every line whose indentation does not match its block depth (the tool's rule is one tab per level), for the input and for the result:

```bash
py bin/logic_optimizer.py --safe-navigation fold --check-indent < yourfile.txt
```

* stderr lists the input's offenders as `input line N: <tabs> tab(s), expected <depth> | <text>` plus a summary `N line(s) in the input, M left after formatting`;
* the JSON output carries them as `indent_issues` (input) and `indent_issues_after` (what the formatter left), so a script can act on them.

Anything still listed *after* formatting is a construct the renderer does not model (or a line that needs another pass) - useful to audit a whole mod with a single command.

-----

## 🚀 Installation

### Manual Installation (.vsix)

You can install the packaged extension directly using the `.vsix` file.

1.  **Download** the `paradox-script-formatter-0.5.9.vsix` file.
2.  Open **VS Code**.
3.  Go to the **Extensions View** (`Ctrl+Shift+X`).
4.  Click the **three dots icon (...)** at the top-right of the Extensions menu.
5.  Select **"Install from VSIX..."**.
6.  Locate and select the `paradox-script-formatter-0.5.9.vsix` file.

Alternatively, you can install it via the command line:

```bash
code --install-extension paradox-script-formatter-0.5.9.vsix
```

### Supported File Types

Automatically activates for:

  * `.txt` (Paradox Script)
  * `.gui` (Interface Files)
  * Language IDs: `paradox`, `stellaris`

-----

## ⚙️ Configuration

To ensure this formatter is used automatically when you save a file, you need to set it as the default formatter for the Paradox language.

1.  Open your **Settings** (`Ctrl + ,`).
2.  Search for `default formatter`.
3.  You can set the formatter globally or specifically for Paradox files in your `settings.json`:

<!-- end list -->

```json
{
    // Sets the PDX Formatter as the default for all languages where it applies
    "editor.defaultFormatter": "f1r3pr1nc3.paradox-script-formatter",

    // Recommended: Set preferred indentation style (if not using .editorconfig)
    "editor.insertSpaces": false, // Use tabs
    "editor.tabSize": 4
}
```

### Enable "Format On Paste"

To automatically format code when pasting, add these settings to your `settings.json`:

```json
"[paradox]": {
    "editor.defaultFormatter": "f1r3pr1nc3.paradox-script-formatter",
    "editor.formatOnPaste": true
},
"[stellaris]": {
    "editor.defaultFormatter": "f1r3pr1nc3.paradox-script-formatter",
    "editor.formatOnPaste": true
}
```

**Troubleshooting Tips:**
If it doesn't format automatically, check the global setting: Search settings for `Format On Paste` and ensure it is checked.

-----

## 🤝 Contributing

Contributions are welcome\! If you find a case where the formatter breaks a specific script structure, please open an issue with a code snippet.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

-----

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
