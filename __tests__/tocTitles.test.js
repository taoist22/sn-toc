import {
  findMatchingTitleElement,
  getTitleTextFromElements,
  getTitleTrailNums,
  normalizeTrailNums,
  sameTrailNums,
} from '../src/domain/tocTitles';

describe('toc title helpers', () => {
  it('normalizes trail numbers to numeric values only', () => {
    expect(normalizeTrailNums([1, '2', 3, null])).toEqual([1, 3]);
    expect(normalizeTrailNums(undefined)).toEqual([]);
  });

  it('matches title elements by trail number regardless of order', () => {
    const elements = [
      {type: 100, title: {controlTrailNums: [9], style: 1}},
      {type: 100, title: {controlTrailNums: [3, 2], style: 2}},
    ];

    expect(sameTrailNums([2, 3], [3, 2])).toBe(true);
    expect(
      findMatchingTitleElement(
        {page: 0, style: 2, controlTrailNums: [2, 3]},
        elements,
      ),
    ).toBe(elements[1]);
  });

  it('resolves title text from controlled text boxes before title OCR guesses', () => {
    const elements = [
      {
        type: 100,
        title: {controlTrailNums: [7]},
        recognizeResult: {predict_name: 'Fallback'},
      },
      {type: 0, numInPage: 7, textBox: {textContentFull: '  Chapter One  '}},
    ];

    expect(
      getTitleTextFromElements(
        {page: 0, style: 1, controlTrailNums: [7]},
        elements,
      ),
    ).toBe('Chapter One');
  });

  it('returns title trail numbers from the matched title element', () => {
    const elements = [{type: 100, title: {controlTrailNums: [4, 5]}}];

    expect(
      getTitleTrailNums(
        {page: 0, style: 1, controlTrailNums: [1]},
        elements,
      ),
    ).toEqual([4, 5]);
  });
});
