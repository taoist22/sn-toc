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
const GET_TITLES_TIMEOUT_MS = 15000;
const GET_ELEMENTS_TIMEOUT_MS = 8000;
const GET_PAGE_SIZE_TIMEOUT_MS = 4000;
const RECOGNIZE_TIMEOUT_MS = 8000;

type TOCEntry = { text: string; page: number; style: number };
type ScanError = { page?: number; action: string; message: string };
type ScanProgress = {
  action: string;
  page: number;
  totalPages: number;
  titlesFound: number;
  elapsedMs: number;
};

type TitleMeta = {
  page: number;
  style: number;
  controlTrailNums: number[];
  source?: any;
};

function estimateWidth(text: string, font: number, maxW: number): number {
  const w = Math.ceil(text.length * font * 0.62) + 50;
  return Math.max(140, Math.min(w, maxW - 120));
}

function describeApiError(res: any, fallback: string): string {
  const code = res?.error?.code ?? res?.code;
  const message = res?.error?.message ?? res?.message ?? fallback;
  return code !== undefined ? `${message} (${code})` : String(message);
}

function describeThrownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function normalizeTrailNums(value: any): number[] {
  return Array.isArray(value) ? value.filter((num: any) => typeof num === 'number') : [];
}

function sameTrailNums(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every(num => b.includes(num));
}

function formatRecentErrors(errors: ScanError[], limit = 3): string {
  return errors
    .slice(-limit)
    .map(error => {
      const page = error.page !== undefined ? `Page ${error.page + 1} ` : '';
      return `${page}${error.action}: ${error.message}`;
    })
    .join('; ');
}

function addScanError(errors: ScanError[], error: ScanError) {
  errors.push(error);
  if (errors.length > 20) {
    errors.shift();
  }
}

async function recycleElementsSafe(elements: any[] | null | undefined) {
  if (!Array.isArray(elements)) return;
  for (const el of elements) {
    try {
      await el?.recycle?.();
    } catch {}
  }
}

function clearElementCacheSafe() {
  try {
    (PluginCommAPI as any).clearElementCache?.();
  } catch {}
}

function getTitleTextFromElements(titleMeta: TitleMeta, pageElements: any[], fallbackIndex = 0): string {
  const titleEl = findMatchingTitleElement(titleMeta, pageElements, fallbackIndex) ?? titleMeta.source;
  const titleElementTrailNums = normalizeTrailNums(titleEl?.title?.controlTrailNums);
  const trailNums = titleElementTrailNums.length > 0 ? titleElementTrailNums : titleMeta.controlTrailNums;

  const textBoxEl = trailNums.length > 0
    ? pageElements.find((el: any) => el?.textBox?.textContentFull && trailNums.includes(el.numInPage))
    : undefined;
  const textBoxText = textBoxEl?.textBox?.textContentFull?.trim?.();
  if (textBoxText) return textBoxText;

  const titleText = titleEl?.textBox?.textContentFull?.trim?.();
  if (titleText) return titleText;

  const guess = titleEl?.recognizeResult?.predict_name?.trim?.();
  if (guess && !/^\.?\d+$/.test(guess)) return guess;

  return '';
}

function getTitleTrailNums(titleMeta: TitleMeta, pageElements: any[], fallbackIndex = 0): number[] {
  const titleEl = findMatchingTitleElement(titleMeta, pageElements, fallbackIndex) ?? titleMeta.source;
  const titleElementTrailNums = normalizeTrailNums(titleEl?.title?.controlTrailNums);
  return titleElementTrailNums.length > 0 ? titleElementTrailNums : titleMeta.controlTrailNums;
}

function findMatchingTitleElement(titleMeta: TitleMeta, pageElements: any[], fallbackIndex = 0): any | undefined {
  const titleElements = pageElements.filter((el: any) => el?.type === ELEMENT_TYPE_TITLE);
  if (titleElements.length === 0) return undefined;

  const byTrailNums = titleMeta.controlTrailNums.length > 0
    ? titleElements.find((el: any) => sameTrailNums(normalizeTrailNums(el?.title?.controlTrailNums), titleMeta.controlTrailNums))
    : undefined;
  if (byTrailNums) return byTrailNums;

  return titleElements[fallbackIndex]
    ?? titleElements.find((el: any) => Number(el?.title?.style || 0) === Number(titleMeta.style || 0))
    ?? titleElements[0];
}

export default function TOCPanel() {
  const [loading, setLoading] = useState(false);
  const [isManta, setIsManta] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

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
    setStatus('Preparing notebook...');
    setScanProgress(null);
    const startedAt = Date.now();

    const updateProgress = (
      action: string,
      page: number,
      totalPages: number,
      titlesFound: number,
    ) => {
      setScanProgress({
        action,
        page,
        totalPages,
        titlesFound,
        elapsedMs: Date.now() - startedAt,
      });
    };

    try {
      await PluginNoteAPI.saveCurrentNote();
    } catch {}

    try {
      const pathRes = (await PluginCommAPI.getCurrentFilePath()) as any;
      const notePath = pathRes?.result;
      if (!notePath || typeof notePath !== 'string') {
        setStatus('Failed to get current note path.');
        return;
      }

      const totalRes = (await PluginFileAPI.getNoteTotalPageNum(notePath)) as any;
      const totalPages = typeof totalRes?.result === 'number' ? totalRes.result : 0;
      
      if (totalPages === 0) {
        setStatus('Failed to get page count.');
        return;
      }

      const scanErrors: ScanError[] = [];
      const tocEntries: TOCEntry[] = [];
      const pageList = Array.from({length: totalPages}, (_, index) => index);
      let nativeTitles: TitleMeta[] | null = null;

      updateProgress('Reading native title list', 0, totalPages, 0);

      try {
        const titleRes = (await withTimeout(
          PluginFileAPI.getTitles(notePath, pageList) as Promise<any>,
          'getTitles',
          GET_TITLES_TIMEOUT_MS,
        )) as any;

        if (titleRes?.success && Array.isArray(titleRes.result)) {
          nativeTitles = titleRes.result.map((title: any) => ({
            page: typeof title?.page === 'number' ? title.page : 0,
            style: Number(title?.style || 1),
            controlTrailNums: normalizeTrailNums(title?.controlTrailNums),
            source: title,
          }));
        } else {
          addScanError(scanErrors, {
            action: 'getTitles',
            message: describeApiError(titleRes, 'Native title lookup failed'),
          });
        }
      } catch (error) {
        addScanError(scanErrors, {
          action: 'getTitles',
          message: describeThrownError(error),
        });
      }

      const resolveTitlesOnPage = async (page: number, titleMetas: TitleMeta[]) => {
        let pageElements: any[] | null = null;
        try {
          const elementsRes = (await withTimeout(
            PluginFileAPI.getElements(page, notePath) as Promise<any>,
            `getElements page ${page + 1}`,
            GET_ELEMENTS_TIMEOUT_MS,
          )) as any;

          if (!elementsRes?.success || !Array.isArray(elementsRes.result)) {
            addScanError(scanErrors, {
              page,
              action: 'getElements',
              message: describeApiError(elementsRes, 'Could not read page elements'),
            });
            for (const titleMeta of titleMetas) {
              tocEntries.push({ text: `Page ${page + 1} Title`, page, style: titleMeta.style || 1 });
            }
            return;
          }

          const loadedPageElements = elementsRes.result as any[];
          pageElements = loadedPageElements;
          let pageSize: any | null = null;

          for (let titleIndex = 0; titleIndex < titleMetas.length; titleIndex++) {
            const titleMeta = titleMetas[titleIndex];
            let recognizedText = getTitleTextFromElements(titleMeta, loadedPageElements, titleIndex);
            const trailNums = getTitleTrailNums(titleMeta, loadedPageElements, titleIndex);

            if (!recognizedText && trailNums.length > 0) {
              const strokes = loadedPageElements.filter((el: any) =>
                el?.type === 0 && trailNums.includes(el.numInPage)
              );

              if (strokes.length > 0) {
                if (!pageSize) {
                  try {
                    const sizeRes = (await withTimeout(
                      PluginFileAPI.getPageSize(notePath, page) as Promise<any>,
                      `getPageSize page ${page + 1}`,
                      GET_PAGE_SIZE_TIMEOUT_MS,
                    )) as any;
                    pageSize = sizeRes?.success ? sizeRes.result : { width: 1404, height: 1872 };
                    if (!sizeRes?.success) {
                      addScanError(scanErrors, {
                        page,
                        action: 'getPageSize',
                        message: describeApiError(sizeRes, 'Using default page size'),
                      });
                    }
                  } catch (error) {
                    pageSize = { width: 1404, height: 1872 };
                    addScanError(scanErrors, {
                      page,
                      action: 'getPageSize',
                      message: describeThrownError(error),
                    });
                  }
                }

                try {
                  const recogRes = (await withTimeout(
                    PluginCommAPI.recognizeElements(strokes, pageSize) as Promise<any>,
                    `recognizeElements page ${page + 1}`,
                    RECOGNIZE_TIMEOUT_MS,
                  )) as any;
                  if (recogRes?.success && typeof recogRes.result === 'string') {
                    recognizedText = recogRes.result.trim();
                  } else if (!recogRes?.success) {
                    addScanError(scanErrors, {
                      page,
                      action: 'OCR',
                      message: describeApiError(recogRes, 'Recognition failed'),
                    });
                  }
                } catch (error) {
                  addScanError(scanErrors, {
                    page,
                    action: 'OCR',
                    message: describeThrownError(error),
                  });
                }
              }
            }

            if (!recognizedText) {
              recognizedText = `Page ${page + 1} Title`;
            }

            tocEntries.push({ text: recognizedText, page, style: titleMeta.style || 1 });
          }
        } catch (error) {
          addScanError(scanErrors, {
            page,
            action: 'getElements',
            message: describeThrownError(error),
          });
          for (const titleMeta of titleMetas) {
            tocEntries.push({ text: `Page ${page + 1} Title`, page, style: titleMeta.style || 1 });
          }
        } finally {
          await recycleElementsSafe(pageElements);
          clearElementCacheSafe();
        }
      };

      const resolveNativeTitlesOnPage = async (page: number, titleMetas: TitleMeta[]) => {
        const beforeCount = tocEntries.length;
        await resolveTitlesOnPage(page, titleMetas);

        const resolvedEntries = tocEntries.slice(beforeCount);
        const allPlaceholderText = resolvedEntries.length === titleMetas.length
          && resolvedEntries.every(entry => entry.text === `Page ${page + 1} Title`);

        if (!allPlaceholderText || page <= 0) {
          return;
        }

        tocEntries.splice(beforeCount, resolvedEntries.length);
        addScanError(scanErrors, {
          page,
          action: 'title text',
          message: 'Trying previous page because native title metadata did not match OCR strokes',
        });
        await resolveTitlesOnPage(page - 1, titleMetas.map(title => ({...title, page: page - 1})));
      };

      if (nativeTitles) {
        const titlesByPage = new Map<number, TitleMeta[]>();
        for (const title of nativeTitles) {
          const page = Math.max(0, Math.min(totalPages - 1, title.page || 0));
          const existing = titlesByPage.get(page) ?? [];
          existing.push({...title, page});
          titlesByPage.set(page, existing);
        }

        const pagesWithTitles = Array.from(titlesByPage.keys()).sort((a, b) => a - b);
        for (const page of pagesWithTitles) {
          updateProgress('Resolving title text', page + 1, totalPages, tocEntries.length);
          await resolveNativeTitlesOnPage(page, titlesByPage.get(page) ?? []);
        }
      } else {
        for (let p = 0; p < totalPages; p++) {
          updateProgress('Scanning pages for titles', p + 1, totalPages, tocEntries.length);
          let pageElements: any[] | null = null;
          try {
            const elementsRes = (await withTimeout(
              PluginFileAPI.getElements(p, notePath) as Promise<any>,
              `getElements page ${p + 1}`,
              GET_ELEMENTS_TIMEOUT_MS,
            )) as any;

            if (elementsRes?.success && Array.isArray(elementsRes.result)) {
              const loadedPageElements = elementsRes.result as any[];
              pageElements = loadedPageElements;
              const titles = loadedPageElements
                .filter((el: any) => el?.type === ELEMENT_TYPE_TITLE)
                .map((titleEl: any) => ({
                  page: p,
                  style: Number(titleEl?.title?.style || 1),
                  controlTrailNums: normalizeTrailNums(titleEl?.title?.controlTrailNums),
                  source: titleEl,
                }));

              if (titles.length > 0) {
                await recycleElementsSafe(pageElements);
                clearElementCacheSafe();
                pageElements = null;
                await resolveTitlesOnPage(p, titles);
              }
            } else {
              addScanError(scanErrors, {
                page: p,
                action: 'getElements',
                message: describeApiError(elementsRes, 'Could not read page elements'),
              });
            }
          } catch (error) {
            addScanError(scanErrors, {
              page: p,
              action: 'getElements',
              message: describeThrownError(error),
            });
          } finally {
            await recycleElementsSafe(pageElements);
            clearElementCacheSafe();
          }
        }
      }

      clearElementCacheSafe();
      tocEntries.sort((a, b) => a.page - b.page);

      if (tocEntries.length === 0) {
        let msg = 'No titles found in this notebook. Use the lasso tool to create Titles first.';
        if (scanErrors.length > 0) {
          msg += ` ${scanErrors.length} scan issue${scanErrors.length === 1 ? '' : 's'}. Recent: ${formatRecentErrors(scanErrors)}.`;
        }
        setStatus(msg);
        return;
      }

      setStatus(`Found ${tocEntries.length} titles. Inserting links...`);
      updateProgress('Inserting links', totalPages, totalPages, tocEntries.length);

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
        // We subtract the indent size, prefix length, label length, page string length, and 3 trailing spaces for link icon clearance.
        const pageStr = String(entry.page + 1);
        const maxChars = isManta ? 55 : 45;
        const indentChars = (currentLeft - TOC_LEFT) / 20; 
        const remainingChars = maxChars - indentChars - prefix.length - label.length - pageStr.length - 3;
        
        let spaces = '';
        if (remainingChars > 3) {
          spaces = ' ' + ' '.repeat(Math.floor(remainingChars)) + ' ';
        } else {
          spaces = '   ';
          // If the label is too long, truncate it
          if (label.length > 20) {
             label = label.substring(0, 20) + '...';
             const newRemain = maxChars - indentChars - prefix.length - label.length - pageStr.length - 3;
             spaces = ' ' + ' '.repeat(Math.max(3, Math.floor(newRemain))) + ' ';
          }
        }

        const finalText = prefix + label + spaces + pageStr + '   ';

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
      if (scanErrors.length > 0) {
        msg += ` ${scanErrors.length} scan issue${scanErrors.length === 1 ? '' : 's'}. Recent: ${formatRecentErrors(scanErrors)}.`;
      }
      msg += ' Close to view.';
      
      setStatus(msg);

    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      clearElementCacheSafe();
      setScanProgress(null);
      setLoading(false);
    }
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
              {loading ? (scanProgress?.action ?? 'Working...') : 'Generate TOC'}
            </Text>
          </Pressable>

          {(status !== '' || scanProgress) && (
            <View style={styles.statusBox}>
              {status !== '' && (
                <Text style={styles.statusText}>{status}</Text>
              )}
              {scanProgress && (
                <View style={styles.progressGrid}>
                  <Text style={styles.progressText}>
                    Page {Math.min(scanProgress.page, scanProgress.totalPages)}/{scanProgress.totalPages}
                  </Text>
                  <Text style={styles.progressText}>
                    Titles {scanProgress.titlesFound}
                  </Text>
                  <Text style={styles.progressText}>
                    {Math.max(0, Math.floor(scanProgress.elapsedMs / 1000))}s
                  </Text>
                </View>
              )}
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
  progressGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 10,
  },
  progressText: {
    flex: 1,
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
  },
});
