# Supernote Plugin Development Notes

*This document serves as a persistent "memory block" containing crucial technical lessons, quirks, and best practices discovered while building Supernote plugins (specifically the Links plugin). Reference this when building or debugging future plugins.*

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
