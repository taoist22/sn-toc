import React, {useCallback, useEffect, useRef, useState} from 'react';
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
import {subscribeToButtonEvents} from '../app/pluginRouter';
import {
  addScanError,
  describeApiError,
  describeThrownError,
  formatRecentErrors,
  ScanError,
} from '../domain/scanErrors';
import {
  getTitleTextFromElements,
  getTitleTrailNums,
  normalizeTrailNums,
  TitleMeta,
} from '../domain/tocTitles';
import {normalizeStoragePath} from '../supernote/paths';

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
type TocPresetValue = 'outline' | 'numbered' | 'compact' | 'pageIndex';
type TocPresetOption = {
  label: string;
  value: TocPresetValue;
  preview: string;
  rowHeight: number;
  linkHeight: number;
  fontSize: number;
  indentStep: number;
  truncateAt: number;
  hierarchy: boolean;
};
type ScanProgress = {
  action: string;
  page: number;
  totalPages: number;
  titlesFound: number;
  elapsedMs: number;
};

const TOC_PRESET_OPTIONS: TocPresetOption[] = [
  {
    label: 'Outline',
    value: 'outline',
    preview: '• Chapter Title      12',
    rowHeight: ROW_HEIGHT,
    linkHeight: LINK_H,
    fontSize: FONT_SIZE,
    indentStep: 80,
    truncateAt: 20,
    hierarchy: true,
  },
  {
    label: 'Compact',
    value: 'compact',
    preview: '• Chapter Title    12',
    rowHeight: 60,
    linkHeight: 48,
    fontSize: 24,
    indentStep: 56,
    truncateAt: 26,
    hierarchy: true,
  },
  {
    label: 'Numbered',
    value: 'numbered',
    preview: '1.2 Chapter Title      12',
    rowHeight: ROW_HEIGHT,
    linkHeight: LINK_H,
    fontSize: FONT_SIZE,
    indentStep: 72,
    truncateAt: 18,
    hierarchy: true,
  },
  {
    label: 'Page index',
    value: 'pageIndex',
    preview: 'Chapter Title      12',
    rowHeight: 64,
    linkHeight: 50,
    fontSize: 26,
    indentStep: 0,
    truncateAt: 28,
    hierarchy: false,
  },
];

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

async function recycleElementsSafe(elements: any[] | null | undefined) {
  if (!Array.isArray(elements)) {return;}
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

export default function TOCPanel() {
  const [loading, setLoading] = useState(false);
  const [isManta, setIsManta] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [tocPreset, setTocPreset] = useState<TocPresetValue>('outline');
  const [finished, setFinished] = useState(false);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTocPreset = TOC_PRESET_OPTIONS.find(option => option.value === tocPreset)
    ?? TOC_PRESET_OPTIONS[0];

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
      // The view is only hidden on close, not unmounted, so reset the
      // finished/status state each time the toolbar button reopens the panel.
      setStatus('');
      setFinished(false);
      setScanProgress(null);
    });
    return () => {
      unsub();
      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current);
        autoCloseRef.current = null;
      }
    };
  }, []);

  const generateTOC = useCallback(async () => {
    if (loading) {return;}
    setLoading(true);
    setFinished(false);
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
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
      const linkDestPath = normalizeStoragePath(notePath);

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
        addScanError(scanErrors, {
          action: 'getTitles',
          message: 'Title scan stopped. Refusing all-page getElements fallback because it can exhaust native element/trail cache.',
        });
      }

      clearElementCacheSafe();
      tocEntries.sort((a, b) => a.page - b.page);

      if (tocEntries.length === 0) {
        let msg = nativeTitles === null
          ? 'Could not read the native title list. TOC generation stopped before page-element scanning.'
          : 'No titles found in this notebook. Use the lasso tool to create Titles first.';
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
      const requiredHeight = tocEntries.length * selectedTocPreset.rowHeight;
      let dynamicScale = 1.0;

      if (requiredHeight > availableHeight) {
        dynamicScale = availableHeight / requiredHeight;
      }

      const scaledRowHeight = Math.floor(selectedTocPreset.rowHeight * dynamicScale);
      const scaledLinkH = Math.floor(selectedTocPreset.linkHeight * dynamicScale);
      const scaledFontSize = Math.floor(selectedTocPreset.fontSize * dynamicScale);

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
      const numberedCounters = [0, 0, 0, 0];
      const insertStartedAt = Date.now();

      for (const entry of tocEntries) {
        // We no longer overflow, we just shrink!
        if (y + scaledLinkH > maxY + 50) {
           break; // Failsafe
        }

        let label = entry.text || 'Title';

        let currentLeft = TOC_LEFT;
        let currentFontSize = scaledFontSize;
        let prefix = '';

        const styleNum = Number(entry.style);
        const titleLevel = Math.max(1, Math.min(4, styleNum || 1));

        // Apply hierarchical formatting based on Title Style
        // 1: Black (H1), 2: Dark Gray (H2), 3: Light Gray (H3), 4: Shadow (H4)
        if (selectedTocPreset.value === 'numbered') {
          for (let i = 0; i < titleLevel - 1; i++) {
            if (numberedCounters[i] === 0) {
              numberedCounters[i] = 1;
            }
          }
          numberedCounters[titleLevel - 1] += 1;
          for (let i = titleLevel; i < numberedCounters.length; i++) {
            numberedCounters[i] = 0;
          }
          // Top-level entries read as "1." for consistency; nested levels stay
          // "1.1" / "1.1.1" (no trailing period).
          const numberStr = numberedCounters.slice(0, titleLevel).join('.');
          prefix = `${numberStr}${titleLevel === 1 ? '.' : ''} `;
          currentLeft += selectedTocPreset.indentStep * (titleLevel - 1);
          if (titleLevel === 1) {
            currentFontSize += Math.max(1, Math.floor(4 * dynamicScale));
          }
        } else if (selectedTocPreset.hierarchy && styleNum === 2) {
          currentLeft += selectedTocPreset.indentStep;
          prefix = '• ';
        } else if (selectedTocPreset.hierarchy && styleNum === 3) {
          currentLeft += selectedTocPreset.indentStep * 2;
          prefix = '◦ ';
        } else if (selectedTocPreset.hierarchy && styleNum === 4) {
          currentLeft += selectedTocPreset.indentStep * 3;
          prefix = '- ';
        } else if (selectedTocPreset.hierarchy) {
          // Style 1 (Black) or default
          currentFontSize += Math.max(1, Math.floor(4 * dynamicScale)); // Make H1 slightly larger
        }

        // Build the row as a single full-width text link. The native link
        // underline spans the whole rect, so it doubles as a solid leader
        // line — we pad with plain spaces (no dotted leader) so we don't
        // stack a dotted line on top of the underline. One native call per
        // row instead of two (insertText + insertTextLink).
        const pageStr = String(entry.page + 1);
        const maxChars = isManta ? 55 : 45;
        const indentChars = (currentLeft - TOC_LEFT) / 20;
        // Reserve room for the indent, prefix, page number, and the small
        // link glyph the OS appends after the linked text.
        const LINK_ICON_CLEARANCE = 2;
        const fixedChars = indentChars + prefix.length + pageStr.length + LINK_ICON_CLEARANCE;

        let leaderChars = Math.floor(maxChars - fixedChars - label.length);
        if (leaderChars < 2 && label.length > selectedTocPreset.truncateAt) {
          label = label.substring(0, selectedTocPreset.truncateAt) + '...';
          leaderChars = Math.floor(maxChars - fixedChars - label.length);
        }
        const spaces = ' '.repeat(Math.max(2, leaderChars));

        const rowText = prefix + label + spaces + pageStr;

        try {
          const res = (await PluginNoteAPI.insertTextLink({
            category: 0,
            linkType: 0, // Note Page
            destPath: linkDestPath,
            destPage: entry.page,
            style: 0,
            rect: {left: currentLeft, top: y, right: TOC_LEFT + linkW, bottom: y + scaledLinkH},
            fontSize: currentFontSize,
            fullText: rowText,
            showText: rowText,
            isItalic: 0,
            textBold: styleNum === 1 ? 1 : 0,
          } as any)) as any;

          if (res?.success) {ok++;}
          else {failed++;}
        } catch {
          failed++;
        }
        y += scaledRowHeight;
      }

      try { await PluginNoteAPI.saveCurrentNote(); } catch {}

      const scanSecs = ((insertStartedAt - startedAt) / 1000).toFixed(1);
      const insertSecs = ((Date.now() - insertStartedAt) / 1000).toFixed(1);

      let msg = `TOC Generated! ${ok} titles added.`;
      if (failed > 0) {msg += ` ${failed} failed.`;}
      if (dynamicScale < 1.0) {msg += ` Scaled down to ${Math.floor(dynamicScale * 100)}% to fit page.`;}
      msg += ` (scan ${scanSecs}s, insert ${insertSecs}s)`;
      if (scanErrors.length > 0) {
        msg += ` ${scanErrors.length} scan issue${scanErrors.length === 1 ? '' : 's'}. Recent: ${formatRecentErrors(scanErrors)}.`;
      }

      setStatus(msg);
      setFinished(true);

      // Clean run: close the plugin automatically so the user can see the
      // result on the page. Leave the panel open (with a Done button) when
      // something failed or a scan issue needs reading.
      if (ok > 0 && failed === 0 && scanErrors.length === 0) {
        autoCloseRef.current = setTimeout(() => {
          autoCloseRef.current = null;
          setFinished(false);
          setStatus('');
          setScanProgress(null);
          PluginManager.closePluginView();
        }, 2500);
      }

    } catch (e) {
      setStatus('Error: ' + String(e));
    } finally {
      clearElementCacheSafe();
      setScanProgress(null);
      setLoading(false);
    }
  }, [loading, isManta, selectedTocPreset]);

  const handleClose = useCallback(() => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    setFinished(false);
    setStatus('');
    setScanProgress(null);
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
            This tool will scan the current note for "Titles" and print them here as clickable links.
          </Text>

          <View style={styles.optionGroup}>
            <Text style={styles.optionLabel}>TOC style</Text>
            <View style={styles.segmentedControl}>
              {TOC_PRESET_OPTIONS.map(option => {
                const selected = option.value === tocPreset;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setTocPreset(option.value)}
                    disabled={loading}
                    style={({pressed}) => [
                      styles.segmentButton,
                      selected && styles.segmentButtonSelected,
                      pressed && !selected && styles.segmentButtonPressed,
                      loading && styles.segmentButtonDisabled,
                    ]}>
                    <Text style={[
                      styles.segmentButtonText,
                      selected && styles.segmentButtonTextSelected,
                    ]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.tocPreview}>
              <View style={styles.tocPreviewRow}>
                <Text style={styles.tocPreviewText}>{selectedTocPreset.preview.replace(/\s*12$/, '')}</Text>
                <Text style={[styles.tocPreviewText, styles.linkPreviewUnderline]}>12</Text>
              </View>
            </View>
          </View>

          <Pressable
            onPress={finished ? handleClose : generateTOC}
            disabled={loading}
            style={({pressed}) => [
              styles.primaryBtn,
              finished && styles.finishedBtn,
              loading && styles.btnDisabled,
              pressed && styles.primaryBtnPressed,
            ]}>
            <Text style={styles.primaryBtnText}>
              {loading
                ? (scanProgress?.action ?? 'Working...')
                : finished
                  ? '✓ Done — Tap to close'
                  : 'Generate TOC'}
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
    marginBottom: 22,
    lineHeight: 26,
    textAlign: 'center',
  },
  optionGroup: {
    marginBottom: 18,
  },
  optionLabel: {
    fontSize: 15,
    color: '#444',
    fontWeight: '600',
    marginBottom: 10,
  },
  segmentedControl: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#d5d5d5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#d5d5d5',
    paddingHorizontal: 8,
  },
  segmentButtonSelected: {
    backgroundColor: '#222',
  },
  segmentButtonPressed: {
    backgroundColor: '#f2f2f2',
  },
  segmentButtonDisabled: {
    opacity: 0.6,
  },
  segmentButtonText: {
    color: '#333',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  segmentButtonTextSelected: {
    color: '#fff',
  },
  linkPreviewUnderline: {
    textDecorationLine: 'underline',
  },
  tocPreview: {
    minHeight: 42,
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f8f8f8',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 6,
  },
  tocPreviewText: {
    color: '#333',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  tocPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
  finishedBtn: {
    backgroundColor: '#1a7f37',
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
