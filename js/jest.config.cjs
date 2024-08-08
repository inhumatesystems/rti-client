module.exports = {
    roots: ['<rootDir>/test'],
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
      transform: {
      '^.+\\.tsx?$': ['ts-jest', { useESM: true } ]
    },
    testRegex: '.*_(test|spec)\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  }
  