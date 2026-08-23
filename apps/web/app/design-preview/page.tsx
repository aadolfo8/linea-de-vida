import Link from 'next/link';
import styles from './preview.module.css';

const directions = [
  [
    'immersive',
    'Recorrido vivo',
    'La dirección actual: una ruta temporal que responde al desplazamiento y abre los recuerdos a escala completa.',
  ],
  [
    'atlas',
    'Atlas of shared journeys',
    'Road-atlas wayfinding turns known dates into legs of a shared route.',
  ],
  [
    'control-desk',
    'Creator control desk',
    'A precise, dense instrument for scanning the archive by time and status.',
  ],
  [
    'monochrome',
    'Monochrome desktop archive',
    'A compact desktop archive with careful one-pixel texture and color-preserving photos.',
  ],
];

export default function DesignPreviewIndex() {
  return (
    <main className={styles.selector}>
      <header>
        <p>Comparación visual · archivo privado</p>
        <h1>Una ruta para volver a vivir el tiempo.</h1>
        <span>
          La dirección actual usa la cronología autenticada cuando está disponible. La aplicación
          principal no cambia; los prototipos anteriores quedan solo como referencia descartada.
        </span>
      </header>
      <nav aria-label="Choose a design direction" className={styles.directionList}>
        {directions.map(([slug, title, description]) => (
          <Link
            key={slug}
            href={`/design-preview/${slug}`}
            className={`${styles.directionLink} ${slug === 'immersive' ? styles.recommended : ''}`}
          >
            <span className={`${styles.directionMark} ${styles[slug]}`} aria-hidden="true" />
            <strong>{title}</strong>
            <span>{description}</span>
            <b>
              {slug === 'immersive' ? 'Abrir dirección actual →' : 'Ver prototipo descartado →'}
            </b>
          </Link>
        ))}
      </nav>
    </main>
  );
}
