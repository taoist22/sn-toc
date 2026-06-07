# Supernote TOC Generator (sn-toc)

A Supernote plugin that automatically scans your notebook for handwritten "Titles" and dynamically inserts a clickable, structured Table of Contents onto the current page.

## Features
- **Live OCR Recognition**: Extracts your actual handwriting directly from the Title strokes to generate text links.
- **Hierarchical Outlines**: Uses the visual style of your Titles to automatically indent and structure your TOC.
- **Auto-Scaling**: If your TOC is too long to fit on a single page, the plugin intelligently scales down the font and row height so it fits cleanly.
- **Traditional Layout**: Page numbers are neatly arranged on the right side using clean formatting.

## Installation
1. Download the latest `sn-toc.snplg` file from the releases page.
2. Transfer the `.snplg` file to your Supernote and place it in the `MyStyle` folder.
3. Open any note on your device and tap the plugin icon on your toolbar.
4. Select **Manage Plugins**, then **Add Plugin**, and choose the TOC plugin. 
*(Note: Supernote currently has a 10-plugin limit. If you already have 10 installed, you will need to uninstall one before adding a new one).*

## How to Use
1. **Create Titles**: As you take notes, use the Lasso tool to circle the word you want to use as a header, tap the **"H"** icon from the popup menu, and then select the color you want.
2. **Assign Hierarchy**: Pay attention to the background style you apply to the Title! The plugin uses these styles to determine how deeply to indent the link in your Table of Contents:
   - **Black Background**: Main Header (H1 - bold, largest font, no indent)
   - **Dark Gray Background**: Subheader (H2 - indented slightly, bulleted with `•`)
   - **Light Gray Background**: Sub-Subheader (H3 - indented further, bulleted with `◦`)
   - **Shadow**: Deepest Subheader (H4 - indented the most, bulleted with `-`)
3. **Generate TOC**: When you are ready to create your TOC, navigate to a blank page in your notebook where you want the Table of Contents to live.
4. **Run Plugin**: Tap the **TOC** icon in your toolbar. The plugin will scan the entire notebook, process your handwritten strokes through OCR, and generate the clickable text links directly onto the page!

## Credits
- [Table of content icons created by Haris Masood - Flaticon](https://www.flaticon.com/free-icons/table-of-content)
