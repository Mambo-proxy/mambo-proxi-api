import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC remplace esbuild pour émettre les métadonnées de décorateurs dont dépend l'injection de NestJS.
// Deux passes : les fichiers `.ts` sont analysés sans JSX (une assertion `<T>valeur` ou un générique `<T>(…) =>`
// y reste valide) ; les gabarits d'e-mails `.tsx` avec le JSX de React (transformation « automatic », comme
// `"jsx": "react-jsx"` dans tsconfig.json). La configuration est explicite (`tsconfigFile: false`) : sinon le
// greffon déduirait de `jsx` l'analyse TSX pour tous les fichiers TypeScript.
const jsc = {
  target: 'es2023',
  keepClassNames: true,
  parser: { syntax: 'typescript', decorators: true },
  transform: { legacyDecorator: true, decoratorMetadata: true },
} as const;

export default defineConfig({
  plugins: [
    swc.vite({ tsconfigFile: false, include: /\.m?ts$/, module: { type: 'es6' }, jsc }),
    swc.vite({
      tsconfigFile: false,
      include: /\.tsx$/,
      module: { type: 'es6' },
      jsc: {
        ...jsc,
        parser: { ...jsc.parser, tsx: true },
        transform: { ...jsc.transform, react: { runtime: 'automatic' } },
      },
    }),
  ],
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
