"""
CSS block-level deletion tool.

Consumes entire rule blocks (selector + `{ ... }`) as atomic units,
handling:
  - Nested braces (@media, @keyframes, etc.)
  - Comments before selectors
  - Multi-line declarations
  - Blank lines between blocks

Usage:
  python css_block_delete.py <css_file> --markers "/* marker1 */" "/* marker2 */"
  python css_block_delete.py <css_file> --selectors ".mafw-foo" ".mafw-bar"
  python css_block_delete.py <css_file> --dry-run --markers "/* Usage config */"
"""

import io
import re
import sys
import argparse


def find_block_end(lines, start_idx):
    """
    Given a line index where a `{` appears (possibly on this line),
    return the index of the line containing the matching closing `}`.

    Handles nested braces for @media / @keyframes.
    """
    depth = 0
    for i in range(start_idx, len(lines)):
        for ch in lines[i]:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return i
    # Unclosed block — consume to end
    return len(lines) - 1


def find_block_start(lines, marker_line_idx):
    """
    Given the index of a comment/marker line, find where the actual
    block starts (may have blank lines or more comments between marker
    and the selector).  Returns the index of the selector line.
    """
    i = marker_line_idx + 1
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped == '' or stripped.startswith('/*') or stripped.startswith('//'):
            i += 1
            continue
        # Found a non-empty, non-comment line — this is the selector
        return i
    return marker_line_idx + 1


def is_comment_line(line):
    stripped = line.strip()
    return (stripped.startswith('/*') or stripped.startswith('//')
            or stripped.startswith('*'))


def is_rule_line(line):
    """Check if a line starts a CSS rule (selector with {)."""
    s = line.strip()
    if not s:
        return False
    if s.startswith('/*') or s.startswith('//'):
        return False
    # Must contain an opening brace (selector or @-rule)
    if '{' not in s:
        return False
    # Reject lines that are only closing braces or content inside blocks
    if s.startswith('}'):
        return False
    return True


def delete_blocks_by_markers(lines, markers):
    """
    Delete entire blocks preceded by the given marker strings.
    After matching a marker, consume ALL consecutive rule blocks
    until the next section comment (/* ... */) or end of file.
    """
    markers_lower = [m.strip().lower() for m in markers]
    result = []
    deleted = 0
    i = 0

    while i < len(lines):
        stripped = lines[i].strip().lower()

        # Check if this line matches any marker
        matched_marker = False
        for m in markers_lower:
            if m in stripped:
                matched_marker = True
                break

        if matched_marker:
            # Walk back to consume any preceding blank lines / comments
            header_start = i
            while header_start > 0 and (
                lines[header_start - 1].strip() == ''
                or is_comment_line(lines[header_start - 1])
            ):
                header_start -= 1

            # Consume the marker line itself
            i += 1

            # Now consume ALL consecutive rule blocks after this marker
            # Stop at: section comment (/* ... */), blank+comment boundary,
            # or end of file
            block_end = header_start - 1  # will be overwritten
            while i < len(lines):
                s = lines[i].strip()
                
                # Stop if we hit a section comment (/* ... */) that's not
                # a property comment inside a rule
                if s.startswith('/*') and '*/' in s and '{' not in s:
                    # This is a standalone section comment — stop
                    break
                
                # Skip blank lines between blocks
                if s == '':
                    i += 1
                    continue
                
                # Skip inline property comments (inside a rule block)
                if s.startswith('/*') or s.startswith('//'):
                    # Could be a property comment — advance past it
                    i += 1
                    continue
                
                # If this line looks like a selector + {, consume the block
                if is_rule_line(lines[i]):
                    block_end = find_block_end(lines, i)
                    deleted += 1
                    i = block_end + 1
                    # Skip trailing blank line between blocks
                    if i < len(lines) and lines[i].strip() == '':
                        i += 1
                    continue
                
                # Anything else (e.g., a bare property line without context)
                # means we've left the block region
                break

            # Eat trailing blank lines after the deleted region
            while i < len(lines) and lines[i].strip() == '':
                i += 1

            continue

        result.append(lines[i])
        i += 1

    return result, deleted


def delete_blocks_by_selectors(lines, selectors):
    """
    Delete entire blocks whose selector text matches any of the given
    selector strings.  Matches substring in the selector line.
    """
    selectors_lower = [s.strip().lower() for s in selectors]
    result = []
    deleted = 0
    i = 0

    while i < len(lines):
        stripped = lines[i].strip().lower()

        matched = any(s in stripped for s in selectors_lower)

        if matched and '{' in lines[i]:
            # This line is a selector with opening brace
            block_end = find_block_end(lines, i)
            # Walk back to consume preceding comments
            header_start = i
            while header_start > 0 and (
                lines[header_start - 1].strip() == ''
                or is_comment_line(lines[header_start - 1])
            ):
                header_start -= 1
            # Eat trailing blank line
            if block_end + 1 < len(lines) and lines[block_end + 1].strip() == '':
                block_end += 1
            deleted += 1
            i = block_end + 1
            continue

        result.append(lines[i])
        i += 1

    return result, deleted


def main():
    parser = argparse.ArgumentParser(description='Delete CSS rule blocks')
    parser.add_argument('css_file', help='Path to CSS file')
    parser.add_argument('--markers', nargs='*', help='Comment markers to match')
    parser.add_argument('--selectors', nargs='*', help='Selector substrings to match')
    parser.add_argument('--dry-run', action='store_true', help='Print result without writing')
    parser.add_argument('--output', '-o', help='Write to this file instead of in-place')
    args = parser.parse_args()

    with io.open(args.css_file, encoding='utf-8') as f:
        lines = f.read().splitlines(keepends=True)

    original_count = len(lines)
    total_deleted = 0

    if args.markers:
        lines, n = delete_blocks_by_markers(lines, args.markers)
        total_deleted += n
        print(f'Markers: deleted {n} block(s)')

    if args.selectors:
        lines, n = delete_blocks_by_selectors(lines, args.selectors)
        total_deleted += n
        print(f'Selectors: deleted {n} block(s)')

    removed_lines = original_count - len(lines)
    print(f'Total: {total_deleted} block(s), {removed_lines} line(s) removed '
          f'({original_count} → {len(lines)})')

    if args.dry_run:
        print('\n--- DRY RUN (no files modified) ---')
        # Show first 50 and last 20 lines as preview
        preview = ''.join(lines[:50])
        if len(lines) > 70:
            preview += f'\n... ({len(lines) - 70} lines omitted) ...\n'
            preview += ''.join(lines[-20:])
        print(preview)
    else:
        target = args.output or args.css_file
        with io.open(target, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        print(f'Written to {target}')


if __name__ == '__main__':
    main()
