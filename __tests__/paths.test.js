import {normalizeStoragePath} from '../src/supernote/paths';

describe('supernote path helpers', () => {
  it('keeps already absolute storage paths unchanged', () => {
    expect(normalizeStoragePath('/storage/emulated/0/Note/foo.note')).toBe(
      '/storage/emulated/0/Note/foo.note',
    );
  });

  it('adds a leading slash to storage-root paths that are missing one', () => {
    expect(normalizeStoragePath('storage/emulated/0/Note/foo.note')).toBe(
      '/storage/emulated/0/Note/foo.note',
    );
  });

  it('prefixes device-root paths with the storage root', () => {
    expect(normalizeStoragePath('/Note/foo.note')).toBe(
      '/storage/emulated/0/Note/foo.note',
    );
  });

  it('prefixes relative paths with the storage root', () => {
    expect(normalizeStoragePath('Note/foo.note')).toBe(
      '/storage/emulated/0/Note/foo.note',
    );
  });
});
