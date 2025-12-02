# Paradox Script Formatter for VS Code

![Version](https://img.shields.io/badge/version-0.2.7-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A robust, whitespace-aware formatter for Paradox Interactive game scripts (Stellaris, HOI4, EU4, CK3).

This extension provides **smart indentation**, **block expansion**, and **syntax protection**, ensuring your code looks clean without breaking game logic or deleting comments.

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

-----

## 🚀 Installation

### Manual Installation (.vsix)

You can install the packaged extension directly using the `.vsix` file.

1.  **Download** the `paradox-script-formatter-0.2.7.vsix` file.
2.  Open **VS Code**.
3.  Go to the **Extensions View** (`Ctrl+Shift+X`).
4.  Click the **three dots icon (...)** at the top-right of the Extensions menu.
5.  Select **"Install from VSIX..."**.
6.  Locate and select the `paradox-script-formatter-0.2.7.vsix` file.

Alternatively, you can install it via the command line:

```bash
code --install-extension paradox-script-formatter-0.2.7.vsix
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
    // Sets the Paradox Formatter as the default for all languages where it applies
    "editor.defaultFormatter": "f1r3pr1nc3.paradox-script-formatter",

    // Recommended: Set preferred indentation style (if not using .editorconfig)
    "editor.insertSpaces": false, // Use tabs
    "editor.tabSize": 4
}
```

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
