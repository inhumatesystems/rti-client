module.exports = {
    roots: ['<rootDir>/test'],
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
      transform: {
      // Override the library's `module: nodenext` (hybrid kind) with a plain ESM
      // module kind here. ts-jest transpiles file-at-a-time, which requires
      // `isolatedModules` — only valid with a non-hybrid module kind (avoids ts-jest
      // warning TS151002 while keeping the ESM emit jest needs via useESM).
      '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: { module: 'esnext', isolatedModules: true } } ]
    },
    testRegex: '.*_(test|spec)\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  }
  