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

### 3\. Format Selection (Range Formatting)

Allows formatting of just a specific block of code without touching the rest of the file.

  * **Shortcut:** `Ctrl + K`, `Ctrl + F` (or `Cmd + K`, `Cmd + F` on Mac)

### 4. Advanced Logic Optimization (NAND)
The extension can now recognize and simplify complex logical expressions, such as nested `NAND` blocks, into a more readable and efficient format. This is particularly useful for complex AI logic or event scripting.

Inside `allow`, `potential`, `destroy_trigger` and `trigger` blocks a trigger-side conditional is rewritten as the equivalent implication: `if = { limit = L body }` means "if `L` then `body`", which is exactly `OR = { NOT = { L } body }`. Conditional chains (`else_if`/`else`) keep their form, effect-side conditionals and other containers are never touched. This is independent of the safe navigation setting.

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
* A negation is never pushed into an optional scope block: `NOT = { xyz = { C... } }` means `not(xyz exists AND C...)`, which is not `xyz = { not C... }`. In `fold` mode the block keeps the check itself (`NOT = { xyz? = { C... } }`, which is the same expression and states the optionality); in `revert`/`ignore` mode it is left as written. Only scopes a surrounding conjunctive list guarantees to exist (`exists = xyz` or another `xyz? = { ... }` next to it) and the always-present `root`/`this` are still negated in place.
* A `xyz? = { ... }` node is never negated (`exists AND ...` cannot be negated by flipping only its inner value), and trigger-side conditionals (`if = { limit = L body }`, i.e. `L implies body`) are never folded into `scope? = ...` - inside `allow`, `potential`, `destroy_trigger` and `trigger` blocks they are rewritten as `OR = { NOT = { L } body }` instead (see section 4).
* When reverting, the `if = { limit = { exists = xyz } xyz = { ... } }` wrapper is only written inside known effect scopes; everywhere else the flat `exists = xyz` + `xyz = { ... }` pair is used.
* **Migration:** the old boolean `paradox-formatter.useSafeNavigation` option was replaced by this setting - `useSafeNavigation: true` corresponds to `safeNavigation: "fold"`.

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
