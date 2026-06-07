import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
} from 'sn-plugin-lib';
import {subscribeToButtonEvents} from './pluginRouter';

const ELEMENT_TYPE_TITLE = 100;
const NATIVE = {
  manta: {w: 1920, h: 2560},
  nomad: {w: 1404, h: 1872},
};

const TOC_LEFT = 200;
const TOC_TOP = 240;
const ROW_HEIGHT = 80;
const FONT_SIZE = 30;
const LINK_H = 60;

function estimateWidth(text: string, font: number, maxW: number): number {
  const w = Math.ceil(text.length * font * 0.62) + 50;
  return Math.max(140, Math.min(w, maxW - 120));
}

export default function TOCPanel() {
  const [loading, setLoading] = useState(false);
  const [isManta, setIsManta] = useState(false);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    const initDevice = async () => {
      try {
        const dt = (await PluginManager.getDeviceType()) as any;
        const dtVal = typeof dt === 'number' ? dt : dt?.result;
        setIsManta(dtVal === 5 || dtVal === '5');
      } catch {
        // default nomad sizing
      }
    };
    initDevice();

    const unsub = subscribeToButtonEvents(() => {
      setStatus('');
    });
    return unsub;
  }, []);

  const generateTOC = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setStatus('Generating TOC... (this may take a moment on large files)');

    try {
      await PluginNoteAPI.saveCurrentNote();
    } catch {}

    try {
      const pathRes = (await PluginCommAPI.getCurrentFilePath()) as any;
      const notePath = pathRes?.result;
      if (!notePath || typeof notePath !== 'string') {
        setStatus('Failed to get current note path.');
        setLoading(false);
        return;
      }

      const totalRes = (await PluginFileAPI.getNoteTotalPageNum(notePath)) as any;
      const totalPages = typeof totalRes?.result === 'number' ? totalRes.result : 0;
      
      if (totalPages === 0) {
        setStatus('Failed to get page count.');
        setLoading(false);
        return;
      }

      const tocEntries: { text: string; page: number; style: number }[] = [];

      for (let p = 0; p < totalPages; p++) {
        try {
          const elementsRes = (await PluginFileAPI.getElements(p, notePath)) as any;
          if (elementsRes?.success && Array.isArray(elementsRes.result)) {
            const pageElements = elementsRes.result;
            
            // Find titles on this page
            const titles = pageElements.filter(el => el?.type === ELEMENT_TYPE_TITLE);
            
            if (titles.length > 0) {
              const sizeRes = (await PluginFileAPI.getPageSize(notePath, p)) as any;
              const pageSize = sizeRes?.success ? sizeRes.result : { width: 1404, height: 1872 };
              
              for (const titleEl of titles) {
                let recognizedText = '';
                const trailNums = titleEl?.title?.controlTrailNums || [];
                
                if (trailNums.length > 0) {
                  // Find the exact strokes that make up this title
                  const strokes = pageElements.filter(el => 
                    el?.type === 0 && trailNums.includes(el.numInPage)
                  );
                  
                  if (strokes.length > 0) {
                    try {
                      const recogRes = (await PluginCommAPI.recognizeElements(strokes, pageSize)) as any;
                      if (recogRes?.success && typeof recogRes.result === 'string') {
                        recognizedText = recogRes.result.trim();
                      }
                    } catch {
                      // OCR failed
                    }
                  }
                }
                
                // Fallbacks: Try built-in predict_name, then Page #
                if (!recognizedText && titleEl?.recognizeResult?.predict_name) {
                  const guess = titleEl.recognizeResult.predict_name.trim();
                  if (guess && guess !== '001') recognizedText = guess;
                }
                
                if (!recognizedText) {
                  recognizedText = `Page ${p + 1} Title`;
                }
                
                tocEntries.push({ text: recognizedText, page: p, style: titleEl?.title?.style || 1 });
              }
            }

            for (const el of pageElements) {
              try { await el.recycle?.(); } catch {}
            }
          }
        } catch {
          // ignore page errors
        }
      }

      if (tocEntries.length === 0) {
        setStatus('No titles found in this notebook. Use the lasso tool to create Titles first.');
        setLoading(false);
        return;
      }

      setStatus(`Found ${tocEntries.length} titles. Inserting links...`);

      const dev = isManta ? NATIVE.manta : NATIVE.nomad;
      const linkW = isManta ? 800 : 600;
      const maxY = dev.h - 100;

      let y = TOC_TOP;
      let ok = 0;
      let failed = 0;

      // Dynamic scaling
      const availableHeight = maxY - (TOC_TOP + 80);
      const requiredHeight = tocEntries.length * ROW_HEIGHT;
      let dynamicScale = 1.0;
      
      if (requiredHeight > availableHeight) {
        dynamicScale = availableHeight / requiredHeight;
      }

      const scaledRowHeight = Math.floor(ROW_HEIGHT * dynamicScale);
      const scaledLinkH = Math.floor(LINK_H * dynamicScale);
      const scaledFontSize = Math.floor(FONT_SIZE * dynamicScale);

      try {
        const headerFontSize = Math.floor(46 * dynamicScale);
        const headerLeft = TOC_LEFT + (isManta ? 200 : 150);
        await PluginNoteAPI.insertText({
          fontSize: headerFontSize,
          textContentFull: 'Table of Contents',
          textBold: 1,
          textRect: {left: headerLeft, top: y, right: headerLeft + linkW, bottom: y + headerFontSize + 20},
        } as any);
      } catch {}
      
      y += 80;

      for (const entry of tocEntries) {
        // We no longer overflow, we just shrink!
        if (y + scaledLinkH > maxY + 50) {
           break; // Failsafe
        }

        let label = entry.text || `Title`;
        
        let currentLeft = TOC_LEFT;
        let currentFontSize = scaledFontSize;
        let prefix = '';

        const styleNum = Number(entry.style);

        // Apply hierarchical formatting based on Title Style
        // 1: Black (H1), 2: Dark Gray (H2), 3: Light Gray (H3), 4: Shadow (H4)
        if (styleNum === 2) {
          currentLeft += 80;
          prefix = '• ';
        } else if (styleNum === 3) {
          currentLeft += 160;
          prefix = '◦ ';
        } else if (styleNum === 4) {
          currentLeft += 240;
          prefix = '- ';
        } else {
          // Style 1 (Black) or default
          currentFontSize += Math.max(1, Math.floor(4 * dynamicScale)); // Make H1 slightly larger
        }

        // Calculate approximate space leader length
        // We use a rough heuristic: ~45 characters fit across the 800px width.
        // We subtract the indent size, prefix length, label length, and page string length.
        const pageStr = String(entry.page + 1);
        const maxChars = isManta ? 55 : 45;
        const indentChars = (currentLeft - TOC_LEFT) / 20; 
        const remainingChars = maxChars - indentChars - prefix.length - label.length - pageStr.length;
        
        let spaces = '';
        if (remainingChars > 3) {
          spaces = ' ' + ' '.repeat(Math.floor(remainingChars)) + ' ';
        } else {
          spaces = '   ';
          // If the label is too long, truncate it
          if (label.length > 20) {
             label = label.substring(0, 20) + '...';
             const newRemain = maxChars - indentChars - prefix.length - label.length - pageStr.length;
             spaces = ' ' + ' '.repeat(Math.max(3, Math.floor(newRemain))) + ' ';
          }
        }

        const finalText = prefix + label + spaces + pageStr;

        try {
          const res = (await PluginNoteAPI.insertTextLink({
            category: 0,
            linkType: 0, // Note Page
            destPath: notePath,
            destPage: entry.page,
            style: 0,
            rect: {left: currentLeft, top: y, right: TOC_LEFT + linkW, bottom: y + scaledLinkH},
            fontSize: currentFontSize,
            fullText: finalText,
            showText: finalText,
            isItalic: 0,
            textBold: styleNum === 1 ? 1 : 0,
          } as any)) as any;
          
          if (res?.success) ok++;
          else failed++;
        } catch {
          failed++;
        }
        y += scaledRowHeight;
      }

      try { await PluginNoteAPI.saveCurrentNote(); } catch {}

      let msg = `TOC Generated! ${ok} titles added.`;
      if (failed > 0) msg += ` ${failed} failed.`;
      if (dynamicScale < 1.0) msg += ` Scaled down to ${Math.floor(dynamicScale * 100)}% to fit page.`;
      msg += ' Close to view.';
      
      setStatus(msg);

    } catch (e) {
      setStatus('Error: ' + String(e));
    }

    setLoading(false);
  }, [loading, isManta]);

  const handleClose = useCallback(() => {
    PluginManager.closePluginView();
  }, []);

  return (
    <Pressable style={styles.overlay} onPress={handleClose}>
      <Pressable style={styles.panel} onPress={e => e.stopPropagation()}>
        <View style={styles.header}>
          <Text style={styles.title}>TOC Generator</Text>
          <Pressable onPress={handleClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>{'✕'}</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.hint}>
            Go to a blank page where you want your Table of Contents.
            This tool will scan your entire notebook for "Titles" and print them here as clickable links.
          </Text>

          <Pressable
            onPress={generateTOC}
            disabled={loading}
            style={({pressed}) => [
              styles.primaryBtn,
              loading && styles.btnDisabled,
              pressed && styles.primaryBtnPressed,
            ]}>
            <Text style={styles.primaryBtnText}>
              {loading ? 'Scanning...' : 'Generate TOC'}
            </Text>
          </Pressable>

          {status !== '' && (
            <View style={styles.statusBox}>
              <Text style={styles.statusText}>{status}</Text>
            </View>
          )}
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  panel: {
    width: 600,
    maxHeight: 800,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 18,
    position: 'relative',
    backgroundColor: '#fafafa',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    padding: 8,
  },
  closeText: {
    fontSize: 24,
    color: '#999',
    fontWeight: '600',
  },
  scroll: {
    paddingHorizontal: 24,
  },
  scrollContent: {
    paddingVertical: 24,
  },
  hint: {
    fontSize: 18,
    color: '#666',
    marginBottom: 24,
    lineHeight: 26,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: '#000',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  primaryBtnPressed: {
    backgroundColor: '#333',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  btnDisabled: {
    backgroundColor: '#ccc',
  },
  statusBox: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  statusText: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24,
    textAlign: 'center',
  },
});
