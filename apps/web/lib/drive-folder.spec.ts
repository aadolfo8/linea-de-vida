import { describe, expect, it } from 'vitest';
import { driveFolderIdFromInput } from './drive-folder';

describe('driveFolderIdFromInput', () => {
  it('extracts a folder identifier from a standard Drive link', () => {
    expect(
      driveFolderIdFromInput('https://drive.google.com/drive/folders/abc-123?usp=sharing'),
    ).toBe('abc-123');
  });

  it('accepts an identifier pasted directly', () => {
    expect(driveFolderIdFromInput('  abc-123  ')).toBe('abc-123');
  });

  it('accepts an identifier in the Drive query parameter', () => {
    expect(driveFolderIdFromInput('https://drive.google.com/open?id=abc-123')).toBe('abc-123');
  });

  it('does not turn a blank input into an identifier', () => {
    expect(driveFolderIdFromInput('  ')).toBe('');
  });
});
