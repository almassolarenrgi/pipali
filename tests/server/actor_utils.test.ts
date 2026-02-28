import { test, expect, describe } from 'bun:test';
import path from 'path';
import os from 'os';
import {
    resolvePath,
    isBroadSearch,
    canTranslateToMdfind,
    expandBraces,
    buildMdfindArgs,
    shouldExcludeMdfindResult,
} from '../../src/server/processor/actor/actor.utils';

const home = os.homedir();

describe('resolvePath', () => {
    test('~ and empty string resolve to home directory', () => {
        expect(resolvePath('~')).toBe(home);
        expect(resolvePath('')).toBe(home);
    });

    test('~/ prefix resolves relative to home', () => {
        expect(resolvePath('~/Documents')).toBe(path.join(home, 'Documents'));
        expect(resolvePath('~/Code/project')).toBe(path.join(home, 'Code/project'));
    });

    test('absolute paths pass through unchanged', () => {
        expect(resolvePath('/tmp/test')).toBe('/tmp/test');
        expect(resolvePath('/usr/local/bin')).toBe('/usr/local/bin');
    });

    test('relative paths resolve from home directory', () => {
        expect(resolvePath('Documents')).toBe(path.join(home, 'Documents'));
        expect(resolvePath('.')).toBe(path.join(home, '.'));
    });
});

describe('isBroadSearch', () => {
    test('home and one level deep are broad, deeper paths are not', () => {
        expect(isBroadSearch(home)).toBe(true);
        expect(isBroadSearch(path.join(home, 'Documents'))).toBe(true);
        expect(isBroadSearch(path.join(home, 'Code', 'project'))).toBe(false);
    });

    test('system paths outside home are not broad', () => {
        expect(isBroadSearch('/')).toBe(false);
        expect(isBroadSearch('/tmp')).toBe(false);
    });
});

describe('canTranslateToMdfind', () => {
    test('accepts simple globs and plain strings', () => {
        expect(canTranslateToMdfind(undefined)).toBe(true);
        expect(canTranslateToMdfind('*.ts')).toBe(true);
        expect(canTranslateToMdfind('*.{ts,js}')).toBe(true);
        expect(canTranslateToMdfind('report')).toBe(true);
    });

    test('accepts **/ recursive prefix (mdfind is inherently recursive)', () => {
        expect(canTranslateToMdfind('**/*.ts')).toBe(true);
    });

    test('rejects character classes and non-recursive path separators', () => {
        expect(canTranslateToMdfind('file[1-2].*')).toBe(false);
        expect(canTranslateToMdfind('src/*.ts')).toBe(false);
    });
});

describe('expandBraces', () => {
    test('expands brace alternatives, trims whitespace', () => {
        expect(expandBraces('*.{ts,js,tsx}')).toEqual(['*.ts', '*.js', '*.tsx']);
        expect(expandBraces('*.{ ts , js }')).toEqual(['*.ts', '*.js']);
    });

    test('passes through pattern without braces unchanged', () => {
        expect(expandBraces('*.ts')).toEqual(['*.ts']);
    });
});

describe('buildMdfindArgs', () => {
    test('no pattern lists all non-folder items', () => {
        expect(buildMdfindArgs(undefined, '/Users/test')).toEqual(
            ['-onlyin', '/Users/test', 'kMDItemContentTypeTree == "public.data"']
        );
    });

    test('plain string uses -name substring match', () => {
        expect(buildMdfindArgs('report', '/Users/test')).toEqual(
            ['-name', 'report', '-onlyin', '/Users/test']
        );
    });

    test('glob pattern builds kMDItemFSName query, expands braces with OR', () => {
        expect(buildMdfindArgs('*.ts', '/Users/test')).toEqual(
            ['-onlyin', '/Users/test', "kMDItemFSName == '*.ts'"]
        );
        expect(buildMdfindArgs('*.{ts,js}', '/Users/test')).toEqual(
            ['-onlyin', '/Users/test', "(kMDItemFSName == '*.ts' || kMDItemFSName == '*.js')"]
        );
    });

    test('strips **/ recursive prefix before building query', () => {
        expect(buildMdfindArgs('**/*.pdf', '/Users/test')).toEqual(
            ['-onlyin', '/Users/test', "kMDItemFSName == '*.pdf'"]
        );
    });

    test('content filter adds kMDItemTextContent predicate', () => {
        expect(buildMdfindArgs(undefined, '/Users/test', 'pipali')).toEqual(
            ['-onlyin', '/Users/test', "kMDItemTextContent == 'pipali'"]
        );
    });

    test('combines name pattern and content filter with &&', () => {
        expect(buildMdfindArgs('*.ts', '/Users/test', 'import')).toEqual(
            ['-onlyin', '/Users/test', "kMDItemFSName == '*.ts' && kMDItemTextContent == 'import'"]
        );
    });

    test('plain name with content filter uses predicate form instead of -name', () => {
        expect(buildMdfindArgs('report', '/Users/test', 'quarterly')).toEqual(
            ['-onlyin', '/Users/test', "kMDItemFSName == '*report*' && kMDItemTextContent == 'quarterly'"]
        );
    });
});

describe('shouldExcludeMdfindResult', () => {
    const excludedDirs = new Set(['node_modules', '.git', 'dist']);

    test('excludes files in excluded directories', () => {
        expect(shouldExcludeMdfindResult('/home/user/project/node_modules/pkg/index.js', '/home/user/project', excludedDirs, false)).toBe(true);
        expect(shouldExcludeMdfindResult('/home/user/project/dist/bundle.js', '/home/user/project', excludedDirs, false)).toBe(true);
    });

    test('hidden file exclusion respects includeHidden flag', () => {
        expect(shouldExcludeMdfindResult('/home/user/.config/file.txt', '/home/user', excludedDirs, false)).toBe(true);
        expect(shouldExcludeMdfindResult('/home/user/.bashrc', '/home/user', excludedDirs, true)).toBe(false);
    });

    test('excluded dirs are always filtered regardless of includeHidden', () => {
        expect(shouldExcludeMdfindResult('/home/user/project/node_modules/pkg/index.js', '/home/user/project', excludedDirs, true)).toBe(true);
    });
});
