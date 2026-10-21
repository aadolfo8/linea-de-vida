import { describe, expect, it } from 'vitest';
import { headline, previewSentence, suggestionText } from './copy';

const preview = {
  scopePhotoCount: 180,
  willChangeCount: 120,
  unchangedCount: 60,
  preservesManualCount: 10,
  replacesAutomaticCount: 0,
  replacesFolderNameDateCount: 0,
};

describe('folder date preview sentence', () => {
  it('says how many photos change out of how many', () => {
    expect(previewSentence(preview)).toBe(
      'Cambiará la fecha de 120 fotos de 180. Las que tienen fecha puesta a mano (10) no se tocan.',
    );
  });

  it('mentions the camera and folder-name dates it would replace', () => {
    const sentence = previewSentence({
      ...preview,
      preservesManualCount: 0,
      replacesAutomaticCount: 1,
      replacesFolderNameDateCount: 4,
    });
    expect(sentence).toContain('Se sustituye la fecha de cámara de 1 foto.');
    expect(sentence).toContain('Se sustituye la fecha del nombre de 4 fotos.');
  });

  it('is honest when nothing would change or the folder is empty', () => {
    expect(previewSentence({ ...preview, willChangeCount: 0 })).toContain('no cambiaría ninguna');
    expect(previewSentence({ ...preview, scopePhotoCount: 0, willChangeCount: 0 })).toContain(
      'no tiene fotos',
    );
  });
});

describe('screen copy', () => {
  it('writes the headline from the pile counts', () => {
    expect(headline({ undated: 3, yearOnly: 1, total: 10 })).toContain(
      '3 fotos sin fecha y 1 foto',
    );
    expect(headline({ undated: 0, yearOnly: 0, total: 10 })).toBe(
      'Todo está en su sitio: 10 fotos con fecha.',
    );
    expect(headline({ undated: 0, yearOnly: 0, total: 0 })).toContain('Añade una carpeta');
  });

  it('describes the filename suggestions with a real example', () => {
    const text = suggestionText({
      totalCount: 24,
      groups: [
        {
          kind: 'whatsapp',
          photoCount: 24,
          earliest: '2019-01-01T00:00:00.000Z',
          latest: '2020-01-01T00:00:00.000Z',
          examples: [
            { id: 'a', fileName: 'IMG-20190312-WA0001.jpg', date: '2019-03-12T00:00:00.000Z' },
          ],
        },
      ],
    });
    expect(text.title).toBe('24 fotos llevan la fecha en el nombre (de WhatsApp).');
    expect(text.detail).toBe('Por ejemplo «IMG-20190312-WA0001.jpg» es del 12 de marzo de 2019.');
  });
});
