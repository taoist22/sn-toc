

https://github.com/user-attachments/assets/aa0400e3-179f-4b12-b1e2-cc18e99d4b4a

# Supernote TOC Generator (sn-toc)

A Supernote plugin that scans the currently open notebook for native handwritten
"Titles" and dynamically inserts a clickable, structured Table of Contents onto
the current page.

> Scope note: `sn-toc` is intentionally limited to the currently open note. It
> uses the lightweight native `getTitles` API for discovery, then calls
> `getElements` only on pages where native titles were found so it can resolve
> title text/OCR. It does not scan folders or libraries.

## Features
- **Live OCR Recognition**: Extracts your actual handwriting directly from the Title strokes to generate text links.
- **Hierarchical Outlines**: Uses the visual style of your Titles to automatically indent and structure your TOC.
- **Auto-Scaling**: If your TOC is too long to fit on a single page, the plugin intelligently scales down the font and row height so it fits cleanly.
- **Multiple Styles**: Pick the layout that suits your note — Outline, Compact, Numbered, or Page index — before generating.
- **Full-Row Links**: Each entry is a single tappable link spanning the whole row. A clean underline leads your eye from the title across to the page number.

## Installation
1. Download the latest `sn-toc.snplg` file from the releases page.
2. Transfer the `.snplg` file to your Supernote and place it in the `MyStyle` folder.
3. Open any note on your device and tap the plugin icon on your toolbar.
4. Select **Manage Plugins**, then **Add Plugin**, and choose the TOC plugin. 
*(Note: Supernote currently has a 10-plugin limit. If you already have 10 installed, you will need to uninstall one before adding a new one).*

## How to Use
1. **Create Titles**: As you take notes, use the Lasso tool to circle the word you want to use as a header, tap the **"H"** icon from the popup menu, and then select the color you want.
2. **Assign Hierarchy**: Pay attention to the background style you apply to the Title! The plugin uses these styles to determine how deeply to indent the link in your Table of Contents (the markers below show the default **Outline** style — see [TOC Styles](#toc-styles) for how each layout renders them):
   - **Black Background**: Main Header (H1 - bold, largest font, no indent)
   - **Dark Gray Background**: Subheader (H2 - indented slightly, bulleted with `•`)
   - **Light Gray Background**: Sub-Subheader (H3 - indented further, bulleted with `◦`)
   - **Shadow**: Deepest Subheader (H4 - indented the most, bulleted with `-`)
3. **Go to a Blank Page**: Navigate to the blank page in your notebook where you want the Table of Contents to live.
4. **Choose a Style**: Tap the **TOC** icon in your toolbar to open the panel, then pick a layout (see [TOC Styles](#toc-styles) below).
5. **Generate**: Tap **Generate TOC**. The plugin scans native Titles in the current notebook, runs OCR on the Title strokes where needed, and inserts the clickable links directly onto the page. On a clean run it closes itself so you land back on your new TOC; if anything needs your attention it stays open and shows a **Done** button.

## TOC Styles
Choose the layout from the panel before generating:
- **Outline**: Hierarchical, with `•` / `◦` / `-` bullets and generous indentation. The traditional table-of-contents look.
- **Compact**: The same hierarchy as Outline but with smaller text and tighter rows to fit more entries per page.
- **Numbered**: Adds section numbers — top-level entries read as `1.`, `2.`, and nested levels as `1.1`, `1.1.1`.
- **Page index**: A flat, single-level list with no bullets or indentation — every entry is treated the same. This is the lightest and fastest layout.

## Credits
- [Table of content icons created by Haris Masood - Flaticon](https://www.flaticon.com/free-icons/table-of-content)
