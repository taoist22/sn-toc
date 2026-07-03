export const ELEMENT_TYPE_TITLE = 100;

export type TitleMeta = {
  page: number;
  style: number;
  controlTrailNums: number[];
  source?: any;
};

export function normalizeTrailNums(value: any): number[] {
  return Array.isArray(value)
    ? value.filter((num: any) => typeof num === 'number')
    : [];
}

export function sameTrailNums(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every(num => b.includes(num));
}

export function findMatchingTitleElement(
  titleMeta: TitleMeta,
  pageElements: any[],
  fallbackIndex = 0,
): any | undefined {
  const titleElements = pageElements.filter(
    (el: any) => el?.type === ELEMENT_TYPE_TITLE,
  );
  if (titleElements.length === 0) {
    return undefined;
  }

  const byTrailNums =
    titleMeta.controlTrailNums.length > 0
      ? titleElements.find((el: any) =>
          sameTrailNums(
            normalizeTrailNums(el?.title?.controlTrailNums),
            titleMeta.controlTrailNums,
          ),
        )
      : undefined;
  if (byTrailNums) {
    return byTrailNums;
  }

  return (
    titleElements[fallbackIndex] ??
    titleElements.find(
      (el: any) => Number(el?.title?.style || 0) === Number(titleMeta.style || 0),
    ) ??
    titleElements[0]
  );
}

export function getTitleTextFromElements(
  titleMeta: TitleMeta,
  pageElements: any[],
  fallbackIndex = 0,
): string {
  const titleEl =
    findMatchingTitleElement(titleMeta, pageElements, fallbackIndex) ??
    titleMeta.source;
  const titleElementTrailNums = normalizeTrailNums(
    titleEl?.title?.controlTrailNums,
  );
  const trailNums =
    titleElementTrailNums.length > 0
      ? titleElementTrailNums
      : titleMeta.controlTrailNums;

  const textBoxEl =
    trailNums.length > 0
      ? pageElements.find(
          (el: any) =>
            el?.textBox?.textContentFull && trailNums.includes(el.numInPage),
        )
      : undefined;
  const textBoxText = textBoxEl?.textBox?.textContentFull?.trim?.();
  if (textBoxText) {
    return textBoxText;
  }

  const titleText = titleEl?.textBox?.textContentFull?.trim?.();
  if (titleText) {
    return titleText;
  }

  const guess = titleEl?.recognizeResult?.predict_name?.trim?.();
  if (guess && !/^\.?\d+$/.test(guess)) {
    return guess;
  }

  return '';
}

export function getTitleTrailNums(
  titleMeta: TitleMeta,
  pageElements: any[],
  fallbackIndex = 0,
): number[] {
  const titleEl =
    findMatchingTitleElement(titleMeta, pageElements, fallbackIndex) ??
    titleMeta.source;
  const titleElementTrailNums = normalizeTrailNums(
    titleEl?.title?.controlTrailNums,
  );
  return titleElementTrailNums.length > 0
    ? titleElementTrailNums
    : titleMeta.controlTrailNums;
}
