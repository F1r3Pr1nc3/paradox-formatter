import re
import copy
import sys # Import sys here for execution context
import json

# --- Comment Formatter ---
def format_comment(val):
    if not val.startswith('##'):
        if len(val) > 1 and not val[1].isspace():
            return f"# {val[1:]}"
    return val

# --- 1. Tokenizer ---
def tokenize(text):
    # Captures: comments, quoted strings, operators, words, newlines

    # Added group 3: (@\[[\s\S]*?\]) to capture @[ ... ] blocks including newlines
    token_pattern = re.compile(r'(#.*)|("[^"]*")|(@\[[\s\S]*?\])|((?:!=|>=|<=|[=\{\}<>!]))|([^\s=\{\}<>!]+)|\n')

    tokens = []
    current_line = 1
    last_idx = 0
    for match in token_pattern.finditer(text):
        start, end = match.span()
        val = match.group(0)
        gap = text[last_idx:start]
        last_idx = end
        if val == '\n':
            current_line += 1
            continue
        t_type = ''
        if match.group(1): t_type = 'comment'; val = format_comment(match.group(1))
        elif match.group(2): t_type = 'str'; val = match.group(2)
        elif match.group(3):
            t_type = 'word' # Treat inline math as a value/word
            val = match.group(3)
            # Fix line counting if the math block spans multiple lines
            current_line += val.count('\n')
        elif match.group(4): t_type = 'op'; val = match.group(4)
        elif match.group(5): t_type = 'word'; val = match.group(5)
        else: continue
        tokens.append({'type': t_type, 'val': val, 'line': current_line, 'pre': gap})
    return tokens

# --- 2. Parser ---
def parse(tokens):
    stack = []
    current_list = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        token_line = token['line']
        token_val = token['val']

        def get_inline_comment(current_idx, current_line_num):
            if current_idx + 1 < len(tokens):
                next_t = tokens[current_idx + 1]
                if next_t['type'] == 'comment' and next_t['line'] == current_line_num:
                    return next_t['pre'] + next_t['val'], 1
            return None, 0

        if token['type'] == 'comment':
            current_list.append(token)
            i += 1; continue

        if token_val == "}":
            if not stack: break
            finished_list = current_list
            current_list = stack.pop()
            if current_list and current_list[-1].get('val') == 'PENDING_BLOCK':
                parent_node = current_list[-1]
                parent_node['val'] = finished_list
                cm, offset = get_inline_comment(i, token_line)
                if cm:
                    parent_node['_cm_close'] = cm
                    i += offset
            i += 1; continue

        elif token_val == "{":
            if current_list and current_list[-1].get('val') == 'PENDING_BLOCK':
                cm, offset = get_inline_comment(i, token_line)
                if cm:
                    current_list[-1]['_cm_open'] = cm
                    i += offset
            stack.append(current_list)
            current_list = []
            i += 1; continue

        else:
            is_key_op = False # Key followed by operator (=, <, >, etc.)
            is_key_block = False # Key followed immediately by { (e.g., hsv {)
            operator_found = "="
            next_idx = i + 1
            temp_idx = next_idx
            # --- Lookahead to determine structure ---
            while temp_idx < len(tokens):
                t = tokens[temp_idx]
                if t['type'] == 'comment': temp_idx += 1; continue

                if t['type'] == 'op':
                    # Type 1: Key followed by operator (e.g., key = val)
                    if t['val'] not in ['{', '}']:
                        is_key_op = True
                        operator_found = t['val']
                        next_idx = temp_idx
                        break

                    # Type 2: Key followed immediately by block (e.g., hsv {)
                    elif t['val'] == '{':
                        is_key_block = True
                        next_idx = temp_idx
                        break

                break
                temp_idx += 1

            if is_key_op or is_key_block:

                # If followed by operator, the value starts at next_idx + 1
                if is_key_op:
                    scan_idx = next_idx + 1

                # If followed by block, the value (block) starts at next_idx
                else: # is_key_block
                    scan_idx = next_idx

                val_type = 'leaf'
                temp_idx = scan_idx

                # --- Lookahead to find actual Value/Block start (past any comments) ---
                while temp_idx < len(tokens):
                    t = tokens[temp_idx]
                    if t['type'] == 'comment': temp_idx += 1; continue

                    # Found the target token index
                    scan_idx = temp_idx
                    if t['val'] == '{': val_type = 'block'
                    break
                    temp_idx += 1

                if val_type == 'block':
                    # If it was an immediate block (hsv {), we set op to None/Empty
                    op_for_node = operator_found if is_key_op else None

                    node = {'key': token_val, 'op': op_for_node, 'val': 'PENDING_BLOCK', 'type': 'node'}
                    current_list.append(node)
                    i = scan_idx # Advance to '{'
                    continue

                # Should only happen if is_key_op (e.g., key = val)
                elif is_key_op:
                    val_token = tokens[scan_idx]

                    # --- LOOKAHEAD FOR BLOCK ---
                    # Check if a block follows the value token (e.g. hsv {)
                    block_follows = False
                    block_scan_idx = scan_idx + 1
                    while block_scan_idx < len(tokens):
                        t = tokens[block_scan_idx]
                        if t['type'] == 'comment':
                            block_scan_idx += 1
                            continue
                        if t['val'] == '{':
                            block_follows = True
                        break # Found next non-comment token

                    if block_follows:
                        node = {'key': token_val, 'op': operator_found, 'val_key': val_token['val'], 'val': 'PENDING_BLOCK', 'type': 'node'}
                        current_list.append(node)
                        i = block_scan_idx # Advance to '{'
                        continue

                    # --- ORIGINAL LOGIC FOR SIMPLE KEY-VALUE ---
                    node = {'key': token_val, 'op': operator_found, 'val': val_token['val'], 'type': 'node'}
                    cm, offset = get_inline_comment(scan_idx, val_token['line'])
                    if cm:
                        node['_cm_inline'] = cm
                        scan_idx += offset
                    current_list.append(node)
                    i = scan_idx + 1
                    continue

            # If neither operator nor block follows immediately, treat as standalone (existing logic)
            else:
                node = {'key': token_val, 'val': None, 'type': 'node'}
                cm, offset = get_inline_comment(i, token_line)
                if cm:
                    node['_cm_inline'] = cm
                    i += offset
                current_list.append(node)
            i += 1; continue
        i += 1
    return current_list

# --- 3. Nodes Equal ---
def nodes_are_equal(n1, n2):
    if n1['type'] != n2['type']: return False
    if n1['type'] == 'comment': return n1['val'] == n2['val']
    if n1.get('key') != n2.get('key'): return False
    if n1.get('op') != n2.get('op'): return False
    v1, v2 = n1.get('val'), n2.get('val')
    if isinstance(v1, list) and isinstance(v2, list):
        c1 = [x for x in v1 if x['type'] == 'node']
        c2 = [x for x in v2 if x['type'] == 'node']
        if len(c1) != len(c2): return False
        for i in range(len(c1)):
            if not nodes_are_equal(c1[i], c2[i]): return False
        return True
    return v1 == v2

# --- 4. Optimize ---
def optimize_node_list(node_list, parent_key=None):
    changed_any = False

    # Safely merge sibling scopes like OR and AND, depending on the parent
    merged_list = []
    keys_to_merge_indices = {}

    for node in node_list:
        if node['type'] == 'node' and isinstance(node.get('val'), list):
            key = node.get('key')

            can_merge = False
            if key == 'OR' and parent_key in ('OR', 'NOR'):
                can_merge = True
            elif key == 'AND' and parent_key in ('AND', 'NAND', None): # Root scope is implicitly AND
                can_merge = True

            if can_merge and key in keys_to_merge_indices:
                target_node_index = keys_to_merge_indices[key]
                merged_list[target_node_index]['val'].extend(node['val'])
                changed_any = True
            else:
                # Reset for this key, as it's not in a mergeable context or is the first of its kind
                keys_to_merge_indices[key] = len(merged_list)
                merged_list.append(node)
        else:
            merged_list.append(node)

    if changed_any:
        node_list = merged_list

    # --- Start of other optimization passes (simplified boilerplate for brevity) ---
    new_list = []
    # Combine consecutive NOTs and 'no' values into a NOR
    i = 0
    while i < len(node_list):
        node = node_list[i]
        if i + 1 < len(node_list):
            next_node = node_list[i+1]

            # Case 1: NOT followed by key=no
            if node['type'] == 'node' and node.get('key') == 'NOT' and \
               next_node['type'] == 'node' and next_node.get('val') == 'no':

                nor_children = []
                if isinstance(node.get('val'), list):
                    nor_children.extend(node['val'])

                new_no_node = copy.deepcopy(next_node)
                new_no_node['val'] = 'yes'
                nor_children.append(new_no_node)

                new_nor_node = {'key': 'NOR', 'op': '=', 'val': nor_children, 'type': 'node'}
                new_list.append(new_nor_node)
                changed_any = True
                i += 2 # Skip next node
                continue

            # Case 2: key=no followed by NOT
            elif node['type'] == 'node' and node.get('val') == 'no' and \
                 next_node['type'] == 'node' and next_node.get('key') == 'NOT':

                nor_children = []
                new_no_node = copy.deepcopy(node)
                new_no_node['val'] = 'yes'
                nor_children.append(new_no_node)

                if isinstance(next_node.get('val'), list):
                    nor_children.extend(next_node['val'])

                new_nor_node = {'key': 'NOR', 'op': '=', 'val': nor_children, 'type': 'node'}
                new_list.append(new_nor_node)
                changed_any = True
                i += 2 # Skip next node
                continue

        new_list.append(node)
        i += 1

    node_list = new_list
    new_list = []

    # Combine consecutive NOTs into a NOR
    i = 0
    while i < len(node_list):
        node = node_list[i]
        if node['type'] == 'node' and node.get('key') == 'NOT':
            # Found a NOT, look ahead for more
            not_sequence = [node]
            j = i + 1
            while j < len(node_list):
                next_node = node_list[j]
                # Only merge plain NOTs, not NOT={OR...} which becomes NOR
                if next_node['type'] == 'node' and next_node.get('key') == 'NOT':
                    child_val = next_node.get('val')
                    if isinstance(child_val, list) and len(child_val) == 1 and child_val[0].get('key') in ('OR', 'AND'):
                        break
                    not_sequence.append(next_node)
                    j += 1
                else:
                    break

            if len(not_sequence) > 1:
                # Merge into a NOR
                nor_children = []
                for not_node in not_sequence:
                    if isinstance(not_node.get('val'), list):
                        nor_children.extend(not_node['val'])

                new_nor_node = {'key': 'NOR', 'op': '=', 'val': nor_children, 'type': 'node'}
                new_list.append(new_nor_node)
                changed_any = True
                i = j # Move index past the processed sequence
                continue

        new_list.append(node)
        i += 1

    node_list = new_list
    new_list = []

    for node in node_list:
        if node['type'] == 'comment': new_list.append(node); continue
        key = node.get('key', '')
        if isinstance(node.get('val'), list):
            optimized_children, child_changed = optimize_node_list(node['val'], parent_key=key)
            if child_changed: node['val'] = optimized_children; changed_any = True

            if key in ('AND', 'OR', 'this'):
                children_nodes = [n for n in node['val'] if n['type'] == 'node']
                if len(children_nodes) == 1:
                    # The AND/OR is redundant. Replace it with its children, preserving comments.
                    new_children = []
                    cm_open = node.get('_cm_open')
                    if cm_open:
                        new_children.append({'type': 'comment', 'val': cm_open.strip()})

                    new_children.extend(node['val'])

                    cm_close = node.get('_cm_close')
                    if cm_close:
                        new_children.append({'type': 'comment', 'val': cm_close.strip()})

                    new_list.extend(new_children)
                    changed_any = True
                    print("Simplified AND and OR with single item", file=sys.stderr)
                    continue # Important: skip appending the original 'node'

            if key == 'NOR':
                children_nodes = [n for n in node['val'] if n['type'] == 'node']
                if len(children_nodes) == 1:
                    node['key'] = 'NOT'
                    changed_any = True

            if key == 'AND':
                children_nodes = [n for n in node['val'] if n['type'] == 'node']
                if children_nodes and all(c.get('key') == 'NOT' for c in children_nodes):
                    node['key'] = 'NOR'
                    new_val = []
                    for child in children_nodes:
                        if isinstance(child.get('val'), list):
                            new_val.extend(child['val'])
                    node['val'] = new_val
                    changed_any = True

            if key == 'NOT':
                children_nodes = [n for n in node['val'] if n['type'] == 'node']
                if len(children_nodes) > 1:
                    node['key'] = 'NOR'
                    changed_any = True
                elif len(children_nodes) == 1:
                    child = children_nodes[0]
                    if child.get('key') == 'AND' and isinstance(child.get('val'), list):
                        node['key'] = 'NAND'
                        node['val'] = child['val']
                        changed_any = True
                        print("Created NAND from NOT-AND", file=sys.stderr)
                    # NOR <=> NOT = { OR ... }
                    elif child.get('key') == 'OR' and isinstance(child.get('val'), list):
                        node['key'] = 'NOR'
                        node['val'] = child['val']
                        changed_any = True
                        print("Created NOR from NOT-OR", file=sys.stderr)
                    # Simplification for `NOT = { key = yes }` to `key = no`
                    elif child.get('val') == 'yes' and not isinstance(child.get('val'), list):
                        node['key'] = child['key']
                        node['op'] = child['op']
                        node['val'] = 'no'
                        if '_cm_inline' in child: node['_cm_inline'] = child['_cm_inline']
                        if '_cm_open' in node: del node['_cm_open']
                        if '_cm_close' in node: del node['_cm_close']
                        changed_any = True
                    # Simplification for `NOT = { A = { B = yes } }` to `A = { B = no }`
                    elif isinstance(child.get('val'), list):
                        grandchildren = [gc for gc in child.get('val') if gc['type'] == 'node']
                        if len(grandchildren) == 1:
                            grandchild = grandchildren[0]
                            if grandchild.get('val') == 'yes' and not isinstance(grandchild.get('val'), list):
                                grandchild['val'] = 'no'

                                # Hoist child up to replace the NOT node
                                node['key'] = child['key']
                                node['op'] = child['op']
                                node['val'] = child['val']

                                # Transfer comments
                                if '_cm_open' in child: node['_cm_open'] = child['_cm_open']
                                elif '_cm_open' in node: del node['_cm_open']

                                if '_cm_close' in child: node['_cm_close'] = child['_cm_close']
                                elif '_cm_close' in node: del node['_cm_close']

                                changed_any = True

            if key == 'OR':
                children = [n for n in node['val'] if n['type'] == 'node']

                # NAND <=> OR = { '(NO)'/AND(\1NO/NOR)' ... }
                # (NOT A) OR (A AND (NOT C))  <=> NAND = { A, C }
                if len(children) == 2:
                    c1, c2 = children[0], children[1]

                    not_a_node, a_node, and_node = None, None, None

                    if c1.get('key') == 'AND' and isinstance(c1.get('val'), list):
                        and_node = c1
                        not_a_node_candidate = c2
                    elif c2.get('key') == 'AND' and isinstance(c2.get('val'), list):
                        and_node = c2
                        not_a_node_candidate = c1

                    if and_node:
                        # Identify 'A' and 'NOT C' inside the AND block
                        and_children = [n for n in and_node['val'] if n['type'] == 'node']
                        not_c_node, a_node_candidate = None, None

                        for child in and_children:
                            # Find 'NOT C'
                            if child.get('key') == 'NOT' and isinstance(child.get('val'), list):
                                not_c_node = child
                            # Find 'A'
                            else:
                                a_node_candidate = child

                        # Now check if the other node is 'NOT A'
                        if a_node_candidate:
                            # Case 1: not_a_node is `key = no` and a_node is `key = yes`
                            if not_a_node_candidate.get('val') == 'no' and \
                               a_node_candidate.get('key') == not_a_node_candidate.get('key') and \
                               a_node_candidate.get('val') == 'yes':
                                a_node, not_a_node = a_node_candidate, not_a_node_candidate
                            # Case 2: not_a_node is `NOT { A }`
                            elif not_a_node_candidate.get('key') == 'NOT' and isinstance(not_a_node_candidate.get('val'), list):
                                not_a_children = [n for n in not_a_node_candidate['val'] if n['type'] == 'node']
                                if len(not_a_children) == 1 and nodes_are_equal(not_a_children[0], a_node_candidate):
                                    a_node, not_a_node = a_node_candidate, not_a_node_candidate

                        if a_node and not_a_node and not_c_node:
                            c_nodes = [n for n in not_c_node['val'] if n['type'] == 'node']
                            node['key'] = 'NAND'
                            node['val'] = [a_node] + c_nodes
                            changed_any = True
                            print("Created NAND from OR-AND structure", file=sys.stderr)

                # NAND <=> OR = { NOT ... }
                if all(child.get('key') == 'NOT' and isinstance(child.get('val'), list) for child in children):
                    new_children = []
                    for child in children:
                        not_children = [n for n in child['val'] if n['type'] == 'node']
                        new_children.extend(not_children)
                    node['key'] = 'NAND'
                    node['val'] = new_children
                    changed_any = True
                    print("Created NAND from OR-NOT structure", file=sys.stderr)

                # NAND <=> OR = { 'NO'/'NOT' ... }
                elif all((child.get('key') == 'NOT' and isinstance(child.get('val'), list)) or (child.get('val') == 'no') for child in children):
                    new_children = []
                    for child in children:
                        if child.get('key') == 'NOT':
                            new_children.extend([n for n in child['val'] if n['type'] == 'node'])
                        elif child.get('val') == 'no':
                            child['val'] = 'yes'
                            new_children.append(child)
                    node['key'] = 'NAND'
                    node['val'] = new_children
                    changed_any = True
                    print("Created NAND from OR-NO/NOT structure", file=sys.stderr)

                # NAND => MERGE OR = no/NOT, NAND
                nand_children = [c for c in children if c.get('key') == 'NAND']
                if len(nand_children) == 1:
                    other_children = [c for c in children if c.get('key') != 'NAND']
                    if all((child.get('key') == 'NOT' and isinstance(child.get('val'), list)) or (child.get('val') == 'no') for child in other_children):
                        new_nand_children = [n for n in nand_children[0].get('val', []) if n['type'] == 'node']
                        for child in other_children:
                            if child.get('key') == 'NOT':
                                new_nand_children.extend([n for n in child['val'] if n['type'] == 'node'])
                            elif child.get('val') == 'no':
                                child['val'] = 'yes'
                                new_nand_children.append(child)

                        node['key'] = 'NAND'
                        node['val'] = new_nand_children
                        changed_any = True
                        print("Merged into NAND from OR-NO/NOT/NAND structure", file=sys.stderr)

                if len(children) > 1:
                    if all(child.get('key') == 'AND' and isinstance(child.get('val'), list) for child in children):
                        first_and_block = [n for n in children[0]['val'] if n['type'] == 'node']
                        common_nodes = []
                        for candidate in first_and_block:
                            is_everywhere = True
                            for other_child in children[1:]:
                                other_contents = [n for n in other_child['val'] if n['type'] == 'node']
                                found_match = False
                                for other_node in other_contents:
                                    if nodes_are_equal(candidate, other_node): found_match = True; break
                                if not found_match: is_everywhere = False; break
                            if is_everywhere: common_nodes.append(candidate)

                            if common_nodes:
                                changed_any = True
                                for common in common_nodes: new_list.append(copy.deepcopy(common))
                                for child in children:
                                    new_child_val = []
                                    for child_node in child['val']:
                                        if child_node['type'] == 'comment': new_child_val.append(child_node); continue
                                        is_common = False
                                        for c in common_nodes:
                                            if nodes_are_equal(child_node, c): is_common = True; break
                                        if not is_common: new_child_val.append(child_node)
                                    child['val'] = new_child_val
        new_list.append(node)
    return new_list, changed_any

# --- 5. Output Builder ---
# Define keys that should always be forced compact if they have no operator or are simple lists
force_compact_keys = {"atmosphere_color"} # for 'key_val' , "hsv", "rgb", "rgb255"
compact_nodes = ("_event", "switch", "tags", "NOT", "_technology", "_offset", "_flag", "flags") # Never LB if possible
not_compact_nodes = ("cost", "upkeep", "produces", "else", "if", "else_if", "NOR", "OR", "NAND", "AND", "hidden_effect", "init_effect", "settings", "while") # Always LB
normal_nodes = ("limit", "add_resource", "ai_chance") # If > 1 item LB
def should_be_compact(node):
    if not isinstance(node.get('val'), list): return False
    children = node['val']
    if not children: return True
    key = str(node.get('key', ''))

    if any(child['type'] == 'comment' for child in children): return False
    if node.get('_cm_open'): return False
    if key in force_compact_keys: return True
    logic_children = [c for c in children if c['type'] == 'node']
    children_len = len(logic_children)
    if children_len > 2: return False
    if children_len > 1 and key in normal_nodes: return False
    # Ignore detailed child check
    if children_len == 1 and key.isdigit() and should_be_compact(logic_children[0]): return True

    # Do not check _cm_close here, it's irrelevant to compactness inside the block
    cm_close = node.get('_cm_close', '') # Strong indicator it could be compact
    cm_inline = ''
    # if cm_close: return True
    total_len = len(key) + 5

    # 1 - 2 child nodes
    for child in logic_children:
        key = str(child.get('key', ''))
        val = child.get('val', '')
        # Check 2: If child is a block, return False (enforce multiline for nested blocks)
        if isinstance(val, list):
            if key in not_compact_nodes: return False
            if not should_be_compact(child): return False
            k_len = len(key)
            v_len = len(str(val))
            total_len += k_len + v_len
            continue
        else:
            _cm_inline = child.get('_cm_inline', '')
            _cm_close = child.get('_cm_close', '')
            if _cm_inline or _cm_close: return False
            # TODO # Check 1: Inline comment (comment on the leaf)
            # if cm_inline and _cm_inline: return False
            # if cm_close and _cm_inline: return False
            # else: cm_close = cm_inline = _cm_inline
            # if cm_close and _cm_close: return False
            # else: cm_close = _cm_close
        # Check 3: Length Calculation
        k_len = len(key)
        v_len = len(str(val))
        child_len = k_len + v_len + 3
        if children_len != 1 and not cm_close:
            if v_len > 9 and k_len > 28: return False
            if child_len > 48: return False
        total_len += child_len

    if total_len > 80 and not cm_close: return False

    return True

def node_to_string(node, depth=0, be_compact=False):
    indent = "\t" * depth
    if node['type'] == 'comment': return f"{indent}{node['val'].rstrip()}"

    key = node.get('key')
    op = node.get('op', '=')

    # 2. Block
    if isinstance(node.get('val'), list):
        children = node['val']
        cm_open = node.get('_cm_open', "")
        cm_close = node.get('_cm_close', "")

        is_compactable = False

        # --- Compacting Logic (Based on Heuristic and Depth) ---
        # 1. Determine Compacting Rule based on Key and Depth
        if (
            not be_compact and
            depth and
            (depth > 1 or key.endswith(compact_nodes)) and
            not key.endswith(not_compact_nodes)
        ):
            is_compactable = should_be_compact(node)

        # Parent Node can never be_compact with not compact childs
        if be_compact or is_compactable:
            child_strs = []
            is_compactable = True
            for c in children:
                if not be_compact and not cm_close:
                    # Move inline comment to parent, only if parent is not compact
                    if c.get('_cm_inline'):
                        cm_close = c.get('_cm_inline','')
                        del c['_cm_inline']
                    elif c.get('_cm_close'):
                        cm_close = c.get('_cm_close','')
                        del c['_cm_close']
                # This would be an fault of should_be_compact
                elif (be_compact or not cm_close) and (c.get('_cm_inline') or c.get('_cm_close')): # DEBUG: But lets double check
                    be_compact = is_compactable = False
                    print(f"ERROR:❌ Don't put comments {cm_close} inside a compact block {key}!{(c.get('_cm_inline') or c.get('_cm_close'))}", file=sys.stderr)
                    break
                if is_compactable:
                    s = node_to_string(c, depth=-1, be_compact=True)
                    child_strs.append(s)
            if is_compactable:
                joined_children = " ".join(child_strs)
                val_key_str = f"{node.get('val_key')} " if node.get('val_key') else ""
                return f"{indent}{key} {op} {val_key_str}{{ {joined_children} }}{cm_close}"

        # Not compact
        val_key_str = f"{node.get('val_key')} " if node.get('val_key') else ""
        lines = [f"{indent}{key} {op} {val_key_str}{{{cm_open}"]
        prev_was_header = False
        prev_was_comment = False
        prev_is_block = False

        for i, child in enumerate(children):
            is_comment = child.get('type') == 'comment'
            is_block = isinstance(child.get('val'), list)
            key = child.get('key')

            comment_is_header = False
            if is_comment:
                comment_is_header = child.get('val').startswith('##')
            # Apply general spacing only for depth 0 and 1
            if i and not depth:
                add_space = False
                # General spacing rule: add a line between blocks, but not for comments unless they are headers.
                if (not is_comment and (not prev_was_comment or prev_was_header)) or \
                    (comment_is_header and not prev_was_comment) or \
                    (is_comment and prev_is_block):
                    if is_block or prev_is_block:
                        add_space = True
                # Find previous non-comment node to get its key for the user's rule
                if add_space and depth == 1 and is_block:
                    prev_node_real = None
                    for j in range(i - 1, -1, -1):
                        if children[j].get('type') != 'comment':
                            prev_node_real = children[j]
                            break
                    if prev_node_real and isinstance(prev_node_real.get('val'), list):
                        if key == prev_node_real.get('key'):
                            add_space = False
                if add_space:
                    lines.append("")

            lines.append(node_to_string(child, depth + 1))

            prev_was_header = comment_is_header
            prev_was_comment = is_comment
            prev_is_block = is_block

        lines.append(f"{indent}}}{cm_close}")
        return "\n".join(lines)

    else:
        val = node.get('val')
        cm_inline = node.get('_cm_inline', "")
        if val is None: return f"{indent}{key}{cm_inline}"
        return f"{indent}{key} {op} {val}{cm_inline}"

def block_to_string(block_list):
    """Add empty line before root nodes"""
    lines = []
    prev_was_header = False
    prev_was_comment = False
    prev_is_block = False
    i = 0

    for node in block_list:
        is_comment = node['type'] == 'comment'
        if is_comment:
            is_comment = node['val'][1:]
            comment_is_header = is_comment.startswith(('#','}',' }'))
        else:
            comment_is_header = False
        is_var = False
        if node['type'] == 'node' and not isinstance(node['val'], list) :
            is_var = node['key'].startswith('@')
        is_block = isinstance(node['val'], list)

        if (
            (not is_comment and not is_var and
            (not prev_was_comment or prev_was_header)) or
            (comment_is_header and not prev_was_comment and i) or
            (is_comment and prev_is_block)
        ):
            lines.append("")
        i += 1
        prev_was_header = comment_is_header
        prev_was_comment = is_comment
        prev_is_block = is_block

        cm_open = node.get('_cm_open')
        node_to_print = node
        if node['type'] == 'node' and is_block and cm_open:
            lines.append(cm_open.strip())
            node_to_print = node.copy() # Shallow copy is enough
            del node_to_print['_cm_open']

        lines.append(node_to_string(node_to_print, depth=0))
    return "\n".join(lines)

# --- 6. Main ---
def process_text(content):
    try:
        content = content.replace('\r\n', '\n')
        tokens = tokenize(content)
        tree = parse(tokens)
        optimized_tree, logic_changed = optimize_node_list(tree)
        new_content = block_to_string(optimized_tree)
        if new_content != content:
            return new_content, True
        else:
            return content, False
    except Exception as e:
        print(f"[Logic Optimizer] Error: {e}", file=sys.stderr)
        return content, False

if __name__ == "__main__":
    stdin_content = sys.stdin.read()
    new_content, changed = process_text(stdin_content)
    output = {
        "content": new_content,
        "changed": changed
    }
    print(json.dumps(output))
