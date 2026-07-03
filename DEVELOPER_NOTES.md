# Supernote Plugin Development Notes

*This document serves as a persistent "memory block" containing crucial technical lessons, quirks, and best practices discovered while building Supernote plugins (specifically the Links plugin). Reference this when building or debugging future plugins.*

## 0. Scope and getElements Safety

`sn-toc` must remain limited to the currently open note. It should not scan
folders, libraries, or linked notes.

Discovery should use `PluginFileAPI.getTitles(notePath, pageList)`. This is the
lightweight native title metadata path and is the reason `sn-toc` is not in the
same risk category as broad link aggregation.

`PluginFileAPI.getElements` is allowed only as a targeted follow-up for pages
that `getTitles` already reported as containing titles, so the plugin can map
title metadata to text/OCR. Do not restore an all-page `getElements` fallback if
`getTitles` fails. See:

- `../references/get-elements-link-aggregation-warning.md`

## 1. Native Linking API (`insertTextLink`)
When programmatically inserting links to other notes or documents via the Supernote API, strict formatting is required:
- **Absolute Paths**: The `destPath` must be an absolute path starting from the root of the device's storage. If you only provide the relative file name, the link will break. Always prefix with `/storage/emulated/0/` if it is not already present.
- **Page Addressing (`destPage`)**: 
  - Pages are strictly **0-indexed** in the API. If a user selects Page 3, you must pass `destPage: 2`.
  - If you are passing a page number, you MUST use `linkType: 0` (Note Page). 
  - If you want to link to the *entire file* (and just open it to its last viewed state), you must omit the page index and switch to `linkType: 1` (Note File). Passing a page number alongside `linkType: 1` will fail or be ignored.

## 2. Coordinate Systems & Device Scaling (Nomad vs Manta)
- The **Nomad (A6 X2)** reports a logical screen width of `1404px`.
- The **Manta (A5 X2)** reports a logical screen width of `1920px`.
- **Device Detection**: You can use `PluginManager.getDeviceType()` to detect the active hardware. A return value of `5` (`dtVal === 5`) indicates the Manta.
- **Toolbar Obfuscation**: The Supernote OS has floating, dockable toolbars. If you attempt to use `insertTextLink` with coordinates that are too close to the screen edges (e.g., `X=100`, `Y=160`), the link will successfully place, but it may be completely hidden *underneath* the user's toolbar depending on where they docked it. 
- **Safe Margins**: Always use generous inner padding. In the Links plugin, we found that using `220px` margins (e.g., `X=220`, `Y=220` for Top-Left, or `dev.w - width - 220` for Top-Right) safely clears all standard toolbar docking positions.

## 3. React Native State & "Stale Closures"
- The Supernote plugin system heavily relies on standard React Native. If you are using `useCallback` hooks for button press events (e.g., the "Insert Link" button), you must ensure your dependency arrays are perfectly accurate.
- **The "Page 1" Bug**: During development, the plugin was correctly letting users pick a page, but constantly linking to Page 1. This was caused by a stale closure—the insertion function didn't have the `destPageStr` state in its dependency array, so it was "frozen in time" reading the initial default value (`"1"`) instead of the user's actual selection.

## 4. Build System & File Caching
- **The "Ghost Build" Bug**: The Supernote "Browse and Access" functionality (which handles file transfers over Wi-Fi) can aggressively cache files. 
- If you run `./buildPlugin.sh` and try to sync the `.snplg` file, the device might not see the new code.
- **Solution**: You must explicitly delete the old build directory (`rm -rf build`) before running the build script again to force the file system to recognize the newly generated bundle.

## 5. Current TOC State and Next Pass Ideas
Current state after the July 2026 architecture pass:
- Project is migrated toward the workspace standard structure/scripts/tooling.
- TOC discovery is still current-note only and still uses `PluginFileAPI.getTitles` first.
- `getElements` is still only used on pages where `getTitles` found native Titles.
- TOC link destinations are normalized to `/storage/emulated/0/...` before `insertTextLink`.
- TOC presets currently include Outline, Compact, Numbered, and Page index.
- Generated TOC rows now insert each row as a single full-width `insertTextLink`
  (one native call per row). The native link underline spans the whole rect, so
  it doubles as a solid leader line. Rows pad with plain spaces (no dotted
  leader) so a dotted line is not stacked on top of the underline. Trade-off
  accepted deliberately: the whole row is tappable and the leader is a solid
  underline instead of dots. `dottedLeader` was removed from the presets.
  History: an earlier version split each row into `insertText` (label, plain) +
  `insertTextLink` (page number only) to get a dotted leader with only the
  number underlined, but that doubled native calls per row and was the main
  source of insertion slowness.

When returning to `sn-toc`, revisit these tightening and feature ideas:
- **Verify the single-link speedup**: The doubled-native-call insert path was
  collapsed to one `insertTextLink` per row. Confirm on-device that insertion is
  now noticeably faster and that page-number alignment (driven by the space
  leader char-width heuristic) still reads cleanly across presets.
- **Numbered formatting**: The Numbered preset currently formats H1 prefixes as `1` with no trailing period. User feedback: H1 should probably render as `1.` while nested levels remain like `1.1` / `1.1.1`.
- **H4 wrapping**: H4/deep title rows can wrap to the next line after indentation/prefixing. Next pass should reduce H4 indentation, reserve more label width, truncate earlier by level, or shrink deep-level font so every row stays one line.
- **Title style mapping**: On-device lasso Title toolbar order is black, dark gray, light gray, shadow. `sn-toc` intentionally maps style `2` to H2/dark gray and style `3` to H3/light gray even though current `sn-plugin-lib` comments document those two values in the opposite order.
- **Improve long TOCs**: Current behavior scales all entries onto one page, which can become unreadable. Consider paginating TOC output across inserted pages instead of shrinking indefinitely.
- **Support refresh/replace**: Running the plugin multiple times appends another TOC. Consider marking generated TOC content or using dedicated TOC pages so a rerun can replace the previous output.
- **Extract more pure helpers**: Title matching and path normalization now have tests. Row formatting, numbering, truncation, spacing, and scaling should be extracted/tested next.
