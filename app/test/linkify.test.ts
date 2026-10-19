import { describe, expect, it } from 'vitest';
import { linkify, safeHref } from '../src/common/linkify';
const links = (s: string) => linkify(s).filter((t) => t.kind === 'link').map((t) => (t as { href: string }).href);
describe('linkify', () => {
  it('finds multiple links and keeps surrounding text', () => {
    const t = linkify('Repo https://github.com/a/b and docs www.example.com/x.');
    expect(t.map((x) => x.text).join('')).toBe('Repo https://github.com/a/b and docs www.example.com/x.');
    expect(links('Repo https://github.com/a/b and docs www.example.com/x.')).toEqual(['https://github.com/a/b', 'https://www.example.com/x']);
  });
  it('excludes trailing punctuation', () => {
    expect(links('see https://a.com/path, then (https://b.com/q?x=1). Done!')).toEqual(['https://a.com/path', 'https://b.com/q?x=1']);
    expect(links('wiki https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
  });
  it('never produces javascript:, file: or other schemes', () => {
    expect(links('javascript:alert(1) file:///etc/passwd ftp://x.com mailto:a@b.c')).toEqual([]);
    expect(safeHref('javascript:alert(1)')).toBeNull(); expect(safeHref('file:///c:/x')).toBeNull();
    expect(safeHref('http://ok.com')).toBe('http://ok.com/');
  });
  it('plain text without links is one text token', () => { expect(linkify('no links here')).toEqual([{ kind: 'text', text: 'no links here' }]); });
});
